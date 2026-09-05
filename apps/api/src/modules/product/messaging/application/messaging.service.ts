import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { CLOCK, type Clock } from '../../../platform/identity/ports/clock.port.js';
import { BlockService } from '../../safety/application/block.service.js';
import { FollowService } from '../../social-graph/application/follow.service.js';
import { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import {
  isReadOnlyBecauseOfCounterpart,
  orderPair,
  type ConversationPair,
} from '../domain/conversation-pair.js';
import { checkMessageBody, normalizeMessageBody } from '../domain/message-body.js';
import {
  MAX_NEW_REQUESTS_PER_DAY,
  REQUEST_QUOTA_WINDOW_HOURS,
  countsAgainstRequestQuota,
  initialRecipientState,
  receiptsVisibleToSender,
  type RequestState,
} from '../domain/request-policy.js';
import {
  MESSAGING_REPOSITORY,
  type ConversationRecord,
  type InboxPage,
  type MessageRecord,
  type MessagingRepository,
  type ParticipantRecord,
} from '../repositories/messaging.repository.port.js';

/**
 * A message as a participant sees it.
 *
 * `readAt` is DERIVED, not stored: a message is read when the other side's
 * `last_read_at` has passed it, and only when receipts are permitted at all.
 */
export interface MessageView {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  mediaId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface ConversationView {
  id: string;
  otherUserId: string;
  requestState: RequestState;
  unreadCount: number;
  lastMessageAt: Date | null;
  /** EDGE-022: the compose box is closed and the thread is marked. */
  readOnly: boolean;
  createdAt: Date;
}

export type OpenResult =
  | { status: 'OPEN'; conversation: ConversationView }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'CANNOT_MESSAGE_SELF' };

export type SendResult =
  | {
      status: 'SENT';
      message: MessageView;
      created: boolean;
      isRequest: boolean;
      /**
       * Who to deliver to. Returned rather than left for the caller to work
       * out: the realtime gateway would otherwise have to re-derive the other
       * participant from the conversation, which is a second place for the
       * pair logic to live and get wrong.
       */
      recipientId: string;
    }
  | { status: 'NOT_AVAILABLE' }
  | { status: 'READ_ONLY' }
  | { status: 'INVALID_INPUT'; field: string; reason: string }
  | { status: 'REQUEST_LIMIT_REACHED' };

export type RespondResult = { status: 'DONE' } | { status: 'NOT_AVAILABLE' };

/**
 * The outcome of marking a thread read, and who — if anyone — may be told.
 *
 * `notify` is null whenever a receipt must not be emitted: for a Message
 * Request (MSG-FR-009), and when there is nothing new to report. The DECISION
 * is made here rather than in the transport, so a caller cannot emit a receipt
 * by forgetting to check.
 */
export type MarkReadResult =
  { status: 'DONE'; notify: { userId: string; readAt: Date } | null } | { status: 'NOT_AVAILABLE' };

/**
 * Messaging (MSG-FR-001…009 · BR-024/025/027/028/046 · EDGE-019…022 · ADR-009).
 *
 * O2 in the requirements is what this module exists for: "Let citizens connect
 * without exposing phone numbers." Every conversation here is addressed by user
 * id, and PRIV-003 keeps the number out of the principal entirely, so there is
 * nothing in this file that could leak one even carelessly.
 *
 * FOUR RULES THAT ARE EASY TO STATE AND EASY TO BREAK IN ONE PLACE OUT OF SIX.
 *
 * 1. IDEMPOTENCY IS THE DATABASE'S, NOT THIS SERVICE'S. Every send goes through
 *    `INSERT ... ON CONFLICT DO NOTHING` on `(conversation_id,
 *    client_message_id)`. ADR-009 is emphatic that deduplication must never
 *    move into the transport, because the transport is the thing that
 *    duplicates. MSG-FR-002's acceptance criterion — "a message that fails and
 *    is retried twice... exactly one message is delivered" — is then a property
 *    of a constraint rather than of anybody's care.
 *
 * 2. A BLOCK IS NEVER DISCLOSED. Every refusal that could involve a block
 *    returns the same `NOT_AVAILABLE` the caller would get for a conversation
 *    that never existed. MSG-FR-006's criterion says the send is "refused
 *    without disclosing the block", and the only way to be sure of that is for
 *    the refusal to be indistinguishable, which means it has to be the SAME
 *    refusal — not a different one that happens to have similar wording.
 *
 * 3. A REQUEST SIGNALS NOTHING. No push (BR-027), no read receipt
 *    (MSG-FR-009), and a decline produces no event at all (BR-028). Those are
 *    three absences in three different places, and they are collected in
 *    `domain/request-policy.ts` so they are decided once.
 *
 * 4. THE THREAD SURVIVES THE PERSON. When the other participant is banned or
 *    has deleted their account the conversation becomes read-only and stays
 *    visible (EDGE-022) — someone's record of what a neighbour said is theirs,
 *    and losing it because the other person left would be a second loss.
 *
 * WHAT IS NOT HERE. Nothing logs a message body, a conversation id paired with
 * its participants, or a query into a thread. A log line that pairs two user
 * ids in a messaging context is a record of who is talking to whom, which is
 * the sensitive fact this module handles; PRIV-009 already limits who may read
 * a conversation, and log files are not covered by that limit.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository,
    private readonly blocks: BlockService,
    private readonly follows: FollowService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  // ---------------------------------------------------------------- opening
  /**
   * MSG-FR-001 — open the conversation with someone, creating it if needed.
   *
   * "An existing conversation is reopened or a new one created", and the
   * acceptance criterion is that a second is never created. The canonical pair
   * ordering makes that structural; this method's job is the authorization
   * around it.
   *
   * NOTE THAT OPENING CREATES NOTHING VISIBLE TO THE OTHER PERSON. The row
   * exists, but with no messages it does not appear in their inbox or their
   * request count. Tapping Message on a profile and changing your mind must not
   * notify anybody.
   */
  async open(viewerId: string, targetUserId: string): Promise<OpenResult> {
    const pair = orderPair(viewerId, targetUserId);
    if (pair === 'CANNOT_MESSAGE_SELF') return { status: 'CANNOT_MESSAGE_SELF' };

    // The block check comes before anything is written. A blocked pair "cannot
    // open a conversation" (MSG-FR-001), and creating the row first and then
    // refusing would leave a thread that neither person asked for.
    if (await this.blocks.isBlockedEitherWay(viewerId, targetUserId)) {
      return { status: 'NOT_AVAILABLE' };
    }

    const targetState = await this.repo.counterpartState(targetUserId);
    if (targetState === null) return { status: 'NOT_AVAILABLE' };
    // A banned or deleted counterpart does not stop an EXISTING thread being
    // opened read-only (EDGE-022), but it does stop a new one being started -
    // there is nobody to talk to, and the thread would never leave read-only.
    const existing = await this.repo.findConversationForPair(pair.lowId, pair.highId);
    if (existing === null && isReadOnlyBecauseOfCounterpart(targetState)) {
      return { status: 'NOT_AVAILABLE' };
    }

    const conversation = existing ?? (await this.createConversation(viewerId, targetUserId, pair));

    const participant = await this.repo.findParticipant(conversation.id, viewerId);
    if (participant === null) return { status: 'NOT_AVAILABLE' };

    return {
      status: 'OPEN',
      conversation: this.toConversationView(conversation, participant, viewerId, targetState),
    };
  }

  // --------------------------------------------------------------- sending
  /**
   * MSG-FR-002 / MSG-FR-004 / MSG-FR-006 · EDGE-019/020/021.
   *
   * ONE TRANSACTION covers the conversation row, both participant rows, the
   * message, and the counters the trigger moves. A partial commit here is a
   * message in a thread whose unread count never changed — a message that was
   * sent and never seen.
   */
  async send(
    senderId: string,
    input: {
      /** Either an existing conversation, or the person to start one with. */
      conversationId?: string | undefined;
      recipientId?: string | undefined;
      clientMessageId: string;
      body?: string | null | undefined;
      mediaId?: string | null | undefined;
    },
  ): Promise<SendResult> {
    const mediaId = input.mediaId ?? null;
    const bodyProblem = checkMessageBody(input.body, { hasAttachment: mediaId !== null });
    if (bodyProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'body', reason: bodyProblem };
    }
    const body = normalizeMessageBody(input.body);

    // Resolve WHO before opening the transaction, because resolution needs the
    // block check and the follow check and neither belongs inside a write lock.
    const resolved = await this.resolveTarget(senderId, input);
    if (resolved.status !== 'OK') return resolved.result;

    const { recipientId, existingConversation } = resolved;

    const counterpartState = await this.repo.counterpartState(recipientId);
    if (counterpartState === null) return { status: 'NOT_AVAILABLE' };
    if (isReadOnlyBecauseOfCounterpart(counterpartState)) return { status: 'READ_ONLY' };

    // BR-027: the RECIPIENT's follow of the SENDER decides, not the reverse.
    // Backwards, and anyone could bypass the request area by following their
    // target first - which is exactly what unwanted contact would do.
    const recipientFollowsSender =
      existingConversation !== null
        ? false // irrelevant; the existing participant row already holds the state
        : await this.follows.isFollowing(recipientId, senderId);

    const plannedRecipientState: RequestState =
      existingConversation !== null
        ? 'ACCEPTED'
        : initialRecipientState({ recipientFollowsSender });

    // MSG-FR-005 E3. Checked BEFORE the write, and only for a genuinely new
    // request: an accepted conversation and a declined one both continue
    // without counting, because the limit is on opening cold threads.
    if (
      countsAgainstRequestQuota({
        conversationExisted: existingConversation !== null,
        recipientState: plannedRecipientState,
      })
    ) {
      const since = new Date(
        this.clock.now().getTime() - REQUEST_QUOTA_WINDOW_HOURS * 60 * 60 * 1000,
      );
      const recent = await this.repo.countRecentRequestsBy(senderId, since);
      if (recent >= MAX_NEW_REQUESTS_PER_DAY) {
        this.log('message_request_limit_reached', {});
        return { status: 'REQUEST_LIMIT_REACHED' };
      }
    }

    const pair = orderPair(senderId, recipientId);
    if (pair === 'CANNOT_MESSAGE_SELF') return { status: 'NOT_AVAILABLE' };

    return this.db.withTransaction(async (client) => {
      const { conversation } =
        existingConversation !== null
          ? { conversation: existingConversation }
          : await this.repo.findOrCreateConversation(
              {
                id: randomUUID(),
                lowId: pair.lowId,
                highId: pair.highId,
                initiatedBy: senderId,
                recipientState: plannedRecipientState,
              },
              client,
            );

      const recipient = await this.repo.findParticipant(conversation.id, recipientId, client);
      if (recipient === null) return { status: 'NOT_AVAILABLE' } as const;

      let message: MessageRecord;
      let created: boolean;
      try {
        const result = await this.repo.insertMessage(
          {
            id: randomUUID(),
            conversationId: conversation.id,
            senderId,
            clientMessageId: input.clientMessageId,
            body,
            mediaId,
          },
          client,
        );
        message = result.message;
        created = result.created;
      } catch (e) {
        if (isAttachmentRejection(e)) {
          return { status: 'INVALID_INPUT', field: 'mediaId', reason: 'MEDIA_NOT_USABLE' } as const;
        }
        throw e;
      }

      // Read receipts are gated by the RECIPIENT's request state, so a message
      // into a pending or declined thread never carries one (MSG-FR-009).
      const view = this.toMessageView(message, {
        otherLastReadAt: recipient.lastReadAt,
        receiptsAllowed: receiptsVisibleToSender(recipient.requestState),
        viewerId: senderId,
      });

      this.log('message_sent', { created, isRequest: recipient.requestState !== 'ACCEPTED' });

      // BR-027 rides along as `isRequest` rather than being re-derived by the
      // pipeline. Messaging already knows - the recipient's participant row
      // says so - and deciding it twice is how the two answers diverge. The
      // pipeline drops the PUSH and keeps the record, which is what makes the
      // recipient's request count update while their phone stays quiet.
      //
      // Only a genuinely new message notifies. A retry that resolved to an
      // existing row (EDGE-020/021) must not buzz a second time.
      if (created) {
        await this.outbox.emit(
          {
            topic: 'message.sent',
            conversationId: conversation.id,
            recipientId,
            actorId: senderId,
            isRequest: recipient.requestState !== 'ACCEPTED',
            // NOTIF-FR-004 asks for "the sender and a preview". ADR-014
            // records the accepted residual risk that this reaches a lock
            // screen. Bounded here so a 2,000-character message does not
            // become a 2,000-character push payload.
            preview: (body ?? '').slice(0, 120),
          },
          client,
        );
      }
      return {
        status: 'SENT',
        message: view,
        created,
        isRequest: recipient.requestState !== 'ACCEPTED',
        recipientId,
      } as const;
    });
  }

  // ----------------------------------------------------------------- inbox
  /**
   * MSG-FR-003 — the conversation list, or the request list.
   *
   * Two sections, one query, distinguished by the state filter: "Message
   * Requests are a separate section with its own count". Hidden conversations
   * are excluded in SQL rather than filtered afterwards — a list endpoint that
   * returns everything and expects the caller to filter is how blocked content
   * leaks.
   */
  async listInbox(
    viewerId: string,
    section: 'CONVERSATIONS' | 'REQUESTS',
    limit = 20,
    before?: Date,
  ): Promise<InboxPage> {
    const states: RequestState[] = section === 'REQUESTS' ? ['PENDING'] : ['ACCEPTED'];
    return this.repo.listInbox(viewerId, states, clampLimit(limit), before);
  }

  async unreadCounts(viewerId: string): Promise<{ conversations: number; requests: number }> {
    return this.repo.countUnread(viewerId);
  }

  // --------------------------------------------------------------- history
  async listMessages(
    viewerId: string,
    conversationId: string,
    limit = 30,
    cursor?: { createdAt: Date; id: string },
  ): Promise<{
    messages: MessageView[];
    nextCursor: { createdAt: Date; id: string } | null;
  } | null> {
    const access = await this.access(viewerId, conversationId);
    if (access === null) return null;

    const page = await this.repo.listMessages(conversationId, clampLimit(limit), cursor);
    const receiptsAllowed = receiptsVisibleToSender(access.other.requestState);

    return {
      messages: page.messages.map((m) =>
        this.toMessageView(m, {
          otherLastReadAt: access.other.lastReadAt,
          receiptsAllowed,
          viewerId,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * MSG-FR-004's reconnect path, and the polling fallback ADR-009 names.
   *
   * "Connection drops → the client reconnects and reconciles missed messages
   * without gaps or duplicates." The client holds the server timestamp of the
   * last message it has; everything after that is what it missed. Duplicates
   * are impossible here because the boundary is strict, and harmless anyway
   * because every message carries its client id.
   */
  async listMessagesSince(
    viewerId: string,
    conversationId: string,
    since: Date,
    limit = 100,
  ): Promise<MessageView[] | null> {
    const access = await this.access(viewerId, conversationId);
    if (access === null) return null;

    const rows = await this.repo.listMessagesSince(conversationId, since, clampLimit(limit, 200));
    const receiptsAllowed = receiptsVisibleToSender(access.other.requestState);
    return rows.map((m) =>
      this.toMessageView(m, {
        otherLastReadAt: access.other.lastReadAt,
        receiptsAllowed,
        viewerId,
      }),
    );
  }

  // ------------------------------------------------------------ read state
  /**
   * MSG-FR-009 — mark this participant's side read.
   *
   * The receipt the SENDER eventually sees is derived from this timestamp, and
   * suppressed entirely when the reader holds the thread as a request. So this
   * method is safe to call unconditionally: reading a request updates the
   * reader's own unread count and signals nothing outward, which is exactly
   * what "the sender does not see a read state" requires.
   */
  async markRead(viewerId: string, conversationId: string): Promise<MarkReadResult> {
    const access = await this.access(viewerId, conversationId);
    if (access === null) return { status: 'NOT_AVAILABLE' };

    const readAt = await this.db.withTransaction(async (client) =>
      this.repo.markRead(conversationId, viewerId, this.clock.now(), client),
    );

    // WHO MAY BE TOLD. The receipt is gated by the READER's own request state:
    // if this viewer holds the thread as a request, reading it signals nothing
    // (MSG-FR-009), and DECLINED is included for the same reason a decline is
    // silent at all (BR-028).
    const notify =
      readAt !== null && receiptsVisibleToSender(access.me.requestState)
        ? { userId: access.other.userId, readAt }
        : null;

    return { status: 'DONE', notify };
  }

  // -------------------------------------------------------------- requests
  /**
   * MSG-FR-005 — accept a request. The thread joins the ordinary inbox.
   *
   * Acceptance is the only one of the three outcomes that produces anything
   * observable, and even then only to the accepting user: the sender's side was
   * always ACCEPTED, so nothing changes for them and nothing is emitted.
   */
  async acceptRequest(viewerId: string, conversationId: string): Promise<RespondResult> {
    return this.setOwnRequestState(
      viewerId,
      conversationId,
      'ACCEPTED',
      'message_request_accepted',
    );
  }

  /**
   * MSG-FR-005 A1 — decline. THE SENDER IS TOLD NOTHING.
   *
   * BR-028 gives the reason in one line: "A declined message request produces
   * no signal to the sender, because informing them invites retaliation." So
   * this changes one row and emits nothing — no event, no notification, no
   * change to anything the sender can observe. Their thread continues to look
   * like a conversation that has not been replied to yet, which is
   * indistinguishable from being ignored, which is the point.
   *
   * Further messages from that sender are still STORED (they land in the same
   * declined thread) but surface nowhere. Storing them rather than refusing
   * them matters: they are evidence if the recipient later reports, and the
   * recipient may still accept.
   */
  async declineRequest(viewerId: string, conversationId: string): Promise<RespondResult> {
    return this.setOwnRequestState(
      viewerId,
      conversationId,
      'DECLINED',
      'message_request_declined',
    );
  }

  // -------------------------------------------------------- media (MSG-FR-008)
  /**
   * Is this media attached to a message in a conversation the viewer is in?
   *
   * The whole of MSG-FR-008's access rule, answered here rather than in the
   * media module, because only this module knows who a participant is. The
   * media module refuses RESTRICTED objects outright on its own route; this is
   * the one path that can approve them.
   */
  async mayViewMessageMedia(viewerId: string, mediaId: string): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM messages m
           JOIN conversation_participants p
             ON p.conversation_id = m.conversation_id AND p.user_id = $1
          WHERE m.media_id = $2
       ) AS ok`,
      [viewerId, mediaId],
    );
    return r.rows[0]?.ok === true;
  }

  // --------------------------------------------------------------- internals
  /**
   * Object-level access — check 3 of SEC-009 (SEC-011).
   *
   * Returns both participant rows or null, and null is the ONLY failure. Not a
   * participant, blocked, hidden, no such conversation: one answer, because
   * telling them apart is exactly what would disclose a block.
   */
  private async access(
    viewerId: string,
    conversationId: string,
    client?: PoolClient,
  ): Promise<{
    conversation: ConversationRecord;
    me: ParticipantRecord;
    other: ParticipantRecord;
  } | null> {
    const conversation = await this.repo.findConversationById(conversationId, client);
    if (conversation === null) return null;

    const me = await this.repo.findParticipant(conversationId, viewerId, client);
    if (me === null) return null;

    const otherId = conversation.lowId === viewerId ? conversation.highId : conversation.lowId;
    const other = await this.repo.findParticipant(conversationId, otherId, client);
    if (other === null) return null;

    // The blocker's own thread is hidden from them (EDGE-019). Reachable by id
    // it would still be, if this only consulted the blocks table - so the
    // participant's own `hidden_at` is checked too, and both give the same
    // nothing.
    if (me.hiddenAt !== null) return null;
    if (await this.blocks.isBlockedEitherWay(viewerId, otherId, client)) return null;

    return { conversation, me, other };
  }

  private async resolveTarget(
    senderId: string,
    input: { conversationId?: string | undefined; recipientId?: string | undefined },
  ): Promise<
    | { status: 'OK'; recipientId: string; existingConversation: ConversationRecord | null }
    | { status: 'FAILED'; result: SendResult }
  > {
    if (input.conversationId !== undefined) {
      const access = await this.access(senderId, input.conversationId);
      // MSG-FR-006's acceptance criterion lands here: B sends into a thread A
      // has blocked them out of, and gets the same NOT_AVAILABLE as a
      // conversation that never existed.
      if (access === null) return { status: 'FAILED', result: { status: 'NOT_AVAILABLE' } };

      const otherId =
        access.conversation.lowId === senderId
          ? access.conversation.highId
          : access.conversation.lowId;
      return { status: 'OK', recipientId: otherId, existingConversation: access.conversation };
    }

    const recipientId = input.recipientId;
    if (recipientId === undefined || recipientId === senderId) {
      return { status: 'FAILED', result: { status: 'NOT_AVAILABLE' } };
    }
    if (await this.blocks.isBlockedEitherWay(senderId, recipientId)) {
      return { status: 'FAILED', result: { status: 'NOT_AVAILABLE' } };
    }

    const pair = orderPair(senderId, recipientId);
    if (pair === 'CANNOT_MESSAGE_SELF') {
      return { status: 'FAILED', result: { status: 'NOT_AVAILABLE' } };
    }

    const existing = await this.repo.findConversationForPair(pair.lowId, pair.highId);
    return { status: 'OK', recipientId, existingConversation: existing };
  }

  private async createConversation(
    viewerId: string,
    targetUserId: string,
    pair: ConversationPair,
  ): Promise<ConversationRecord> {
    const recipientFollowsSender = await this.follows.isFollowing(targetUserId, viewerId);
    return this.db.withTransaction(async (client) => {
      const { conversation } = await this.repo.findOrCreateConversation(
        {
          id: randomUUID(),
          lowId: pair.lowId,
          highId: pair.highId,
          initiatedBy: viewerId,
          recipientState: initialRecipientState({ recipientFollowsSender }),
        },
        client,
      );
      return conversation;
    });
  }

  private async setOwnRequestState(
    viewerId: string,
    conversationId: string,
    state: RequestState,
    event: string,
  ): Promise<RespondResult> {
    const access = await this.access(viewerId, conversationId);
    if (access === null) return { status: 'NOT_AVAILABLE' };

    // Only a PENDING row can be answered. Re-accepting an accepted thread or
    // re-declining a declined one is a no-op rather than an error - the caller
    // asked for a state, and that state holds.
    if (access.me.requestState === 'ACCEPTED' && state === 'ACCEPTED') {
      return { status: 'DONE' };
    }

    await this.db.withTransaction(async (client) => {
      await this.repo.setRequestState(conversationId, viewerId, state, client);
    });

    // No ids, and no indication of which conversation. See the class comment.
    this.log(event, {});
    return { status: 'DONE' };
  }

  private toConversationView(
    conversation: ConversationRecord,
    me: ParticipantRecord,
    viewerId: string,
    otherState: import('../domain/conversation-pair.js').CounterpartState,
  ): ConversationView {
    return {
      id: conversation.id,
      otherUserId: conversation.lowId === viewerId ? conversation.highId : conversation.lowId,
      requestState: me.requestState,
      unreadCount: me.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      readOnly: isReadOnlyBecauseOfCounterpart(otherState),
      createdAt: conversation.createdAt,
    };
  }

  /**
   * Derive `readAt`.
   *
   * Only for messages the VIEWER sent — a receipt on somebody else's message
   * would be telling them what they already know, and telling the recipient
   * when they themselves read something is meaningless. And only when receipts
   * are permitted for this thread at all (MSG-FR-009).
   */
  private toMessageView(
    m: MessageRecord,
    ctx: { otherLastReadAt: Date | null; receiptsAllowed: boolean; viewerId: string },
  ): MessageView {
    const readAt =
      ctx.receiptsAllowed &&
      m.senderId === ctx.viewerId &&
      ctx.otherLastReadAt !== null &&
      ctx.otherLastReadAt.getTime() >= m.createdAt.getTime()
        ? ctx.otherLastReadAt
        : null;

    return {
      id: m.id,
      clientMessageId: m.clientMessageId,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.body,
      mediaId: m.mediaId,
      createdAt: m.createdAt,
      readAt,
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No user ids, no conversation id, no body. A log line pairing two people
    // in a messaging context is a record of who is talking to whom, and PRIV-009
    // limits who may read a conversation - a limit that log files do not honour.
    this.logger.log(JSON.stringify({ event, ...extra }), 'messaging');
  }
}

function clampLimit(limit: number, max = 100): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}

/**
 * Did the attachment trigger refuse this message?
 *
 * The same shape as the posts path (ADR-013 step 7), and the same reasoning
 * about the answer: all of these collapse to ONE message to the caller.
 *
 *   23503 foreign_key_violation   no such media
 *   42501 insufficient_privilege  media belongs to somebody else
 *   23001 restrict_violation      not READY, not RESTRICTED, or not an image
 *
 * Telling them apart would confirm whether a media id exists and who owns it,
 * which is an enumeration oracle on other people's private uploads.
 */
function isAttachmentRejection(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === '23001' || code === '42501' || code === '23503';
}
