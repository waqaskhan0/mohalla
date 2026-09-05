import type { PoolClient } from 'pg';
import type { RequestState } from '../domain/request-policy.js';
import type { CounterpartState } from '../domain/conversation-pair.js';

export const MESSAGING_REPOSITORY = Symbol.for('mohalla.messaging.repository');

export interface ConversationRecord {
  id: string;
  lowId: string;
  highId: string;
  initiatedBy: string;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface ParticipantRecord {
  conversationId: string;
  userId: string;
  requestState: RequestState;
  unreadCount: number;
  lastReadAt: Date | null;
  hiddenAt: Date | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string | null;
  mediaId: string | null;
  createdAt: Date;
}

/**
 * One row of the inbox (MSG-FR-003).
 *
 * Assembled in SQL rather than by loading conversations and then their last
 * messages, because an inbox of 50 threads would otherwise be 51 queries and
 * the preview is the whole point of the screen.
 */
export interface InboxEntry {
  conversationId: string;
  otherUserId: string;
  requestState: RequestState;
  unreadCount: number;
  lastMessageAt: Date | null;
  /** Null when the thread has no messages, or when the last one is image-only. */
  previewBody: string | null;
  previewHasMedia: boolean;
  previewSenderId: string | null;
  /** EDGE-022 / MSG-FR-001: read-only when the other side is banned or deleted. */
  otherUserState: CounterpartState;
}

export interface InboxPage {
  entries: InboxEntry[];
  nextBefore: Date | null;
}

export interface MessagePage {
  messages: MessageRecord[];
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface MessagingRepository {
  // ---- conversations -----------------------------------------------------
  /**
   * Find or create the conversation for a pair (BR-024).
   *
   * ONE round trip with `ON CONFLICT DO NOTHING`, not select-then-insert. Two
   * people messaging each other for the first time simultaneously is rare but
   * entirely possible, and select-then-insert would have both find nothing and
   * both insert — the UNIQUE constraint would then turn one of them into a
   * 500 on a first hello.
   *
   * @returns the conversation and whether this call created it. The caller
   * needs the distinction: only a genuinely new thread can be a new request,
   * and only a new request counts against the quota.
   */
  findOrCreateConversation(
    input: {
      id: string;
      lowId: string;
      highId: string;
      initiatedBy: string;
      recipientState: RequestState;
    },
    client: PoolClient,
  ): Promise<{ conversation: ConversationRecord; created: boolean }>;

  findConversationById(id: string, client?: PoolClient): Promise<ConversationRecord | null>;

  findConversationForPair(
    lowId: string,
    highId: string,
    client?: PoolClient,
  ): Promise<ConversationRecord | null>;

  // ---- participants ------------------------------------------------------
  findParticipant(
    conversationId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<ParticipantRecord | null>;

  setRequestState(
    conversationId: string,
    userId: string,
    state: RequestState,
    client: PoolClient,
  ): Promise<boolean>;

  /**
   * Set or clear `hidden_at` for one side (EDGE-019, SAFETY-FR-006).
   *
   * Takes the timestamp rather than calling `now()`, so the block and the hide
   * carry the same instant and a test can control it.
   */
  setHidden(
    conversationId: string,
    userId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<boolean>;

  /**
   * Hide (or restore) every conversation between two users, both directions.
   *
   * Called by the block path. Both directions, because BR-025 is mutual in
   * effect: the blocker's inbox loses the thread, and the blocked user's sends
   * are refused — leaving the thread in the blocked user's inbox unchanged is
   * deliberate, since removing it would itself disclose the block.
   */
  setHiddenForBlocker(
    blockerId: string,
    blockedId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<number>;

  /**
   * MSG-FR-005 A3 — promote a pending request when the recipient follows.
   *
   * @returns true when a PENDING row was promoted. DECLINED is left alone: a
   * decline was a decision too, and a follow does not silently reverse it.
   */
  promotePendingRequest(
    recipientId: string,
    senderId: string,
    client: PoolClient,
  ): Promise<boolean>;

  // ---- messages ----------------------------------------------------------
  /**
   * Insert, or return the row that already carries this client id.
   *
   * THE IDEMPOTENCY PRIMITIVE (ADR-009 · EDGE-020/021). `ON CONFLICT
   * (conversation_id, client_message_id) DO NOTHING` followed by a read of the
   * existing row — a retry, a duplicate delivery and a transport switch all
   * land on the same message.
   *
   * @returns the message and whether this call inserted it. `created: false`
   * is a normal, successful outcome, not an error: it is what "exactly one
   * message is delivered" looks like from the server's side.
   */
  insertMessage(
    input: {
      id: string;
      conversationId: string;
      senderId: string;
      clientMessageId: string;
      body: string | null;
      mediaId: string | null;
    },
    client: PoolClient,
  ): Promise<{ message: MessageRecord; created: boolean }>;

  /**
   * A conversation's history, NEWEST first, keyset-paginated.
   *
   * Newest-first because a conversation is read from the bottom — the opposite
   * of a comment thread, which is read from the top. Both are "chronological";
   * which end you start at is a property of the surface, not of the data.
   */
  listMessages(
    conversationId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    client?: PoolClient,
  ): Promise<MessagePage>;

  /**
   * Messages after a timestamp, OLDEST first — the reconnect path.
   *
   * MSG-FR-004's error case: "connection drops → the client reconnects and
   * reconciles missed messages without gaps or duplicates". Oldest-first here
   * because the client is appending to what it already has.
   */
  listMessagesSince(
    conversationId: string,
    since: Date,
    limit: number,
    client?: PoolClient,
  ): Promise<MessageRecord[]>;

  // ---- inbox -------------------------------------------------------------
  listInbox(
    userId: string,
    states: readonly RequestState[],
    limit: number,
    before: Date | undefined,
    client?: PoolClient,
  ): Promise<InboxPage>;

  /** The two badges on the inbox screen (MSG-FR-003). */
  countUnread(
    userId: string,
    client?: PoolClient,
  ): Promise<{ conversations: number; requests: number }>;

  /**
   * Mark this participant's side read up to `at`, and zero their unread count.
   *
   * @returns the new `last_read_at`. Never moves BACKWARDS — a slow request
   * that arrives after a newer one must not un-read messages the user has
   * already seen.
   */
  markRead(
    conversationId: string,
    userId: string,
    at: Date,
    client: PoolClient,
  ): Promise<Date | null>;

  // ---- request quota (MSG-FR-005 E3) -------------------------------------
  countRecentRequestsBy(senderId: string, since: Date, client?: PoolClient): Promise<number>;

  // ---- read-side helper --------------------------------------------------
  /**
   * The counterpart's account state, for EDGE-022.
   *
   * Deliberately returns the STATE and not a profile: this module needs to know
   * whether the thread is read-only, and nothing else about the other person.
   */
  counterpartState(userId: string, client?: PoolClient): Promise<CounterpartState | null>;
}
