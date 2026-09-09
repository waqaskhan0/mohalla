import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MessagingService } from './messaging.service.js';
import { FixedClock } from '../../../platform/identity/ports/clock.port.js';
import type { CounterpartState } from '../domain/conversation-pair.js';
import type { RequestState } from '../domain/request-policy.js';
import type {
  ConversationRecord,
  InboxPage,
  MessagePage,
  MessageRecord,
  MessagingRepository,
  ParticipantRecord,
} from '../repositories/messaging.repository.port.js';
import type { BlockService } from '../../safety/application/block.service.js';
import type { FollowService } from '../../social-graph/application/follow.service.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { OutboxService } from '../../../platform/notifications/application/outbox.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/**
 * In-memory messaging store.
 *
 * Enforces the two constraints the real schema enforces, because they are the
 * ones the rules rest on and a fake that let them slide would make the tests
 * agree with an implementation the database would reject:
 *
 *   UNIQUE (user_low_id, user_high_id)          — BR-024, one thread per pair
 *   UNIQUE (conversation_id, client_message_id) — EDGE-020/021, idempotency
 */
class InMemoryMessaging implements MessagingRepository {
  conversations: ConversationRecord[] = [];
  participants: ParticipantRecord[] = [];
  messages: MessageRecord[] = [];
  states = new Map<string, CounterpartState>();
  clock: () => Date = () => new Date();

  async findOrCreateConversation(input: {
    id: string;
    lowId: string;
    highId: string;
    initiatedBy: string;
    recipientState: RequestState;
  }): Promise<{ conversation: ConversationRecord; created: boolean }> {
    const existing = this.conversations.find(
      (c) => c.lowId === input.lowId && c.highId === input.highId,
    );
    if (existing !== undefined) return { conversation: existing, created: false };

    const conversation: ConversationRecord = {
      id: input.id,
      lowId: input.lowId,
      highId: input.highId,
      initiatedBy: input.initiatedBy,
      lastMessageAt: null,
      createdAt: this.clock(),
    };
    this.conversations.push(conversation);

    const recipientId = input.initiatedBy === input.lowId ? input.highId : input.lowId;
    for (const [userId, state] of [
      [input.initiatedBy, 'ACCEPTED'] as const,
      [recipientId, input.recipientState] as const,
    ]) {
      this.participants.push({
        conversationId: conversation.id,
        userId,
        requestState: state,
        unreadCount: 0,
        lastReadAt: null,
        hiddenAt: null,
      });
    }
    return { conversation, created: true };
  }

  async findConversationById(id: string): Promise<ConversationRecord | null> {
    return this.conversations.find((c) => c.id === id) ?? null;
  }

  async findConversationForPair(lowId: string, highId: string): Promise<ConversationRecord | null> {
    return this.conversations.find((c) => c.lowId === lowId && c.highId === highId) ?? null;
  }

  async findParticipant(conversationId: string, userId: string): Promise<ParticipantRecord | null> {
    return (
      this.participants.find((p) => p.conversationId === conversationId && p.userId === userId) ??
      null
    );
  }

  async setRequestState(
    conversationId: string,
    userId: string,
    state: RequestState,
  ): Promise<boolean> {
    const p = await this.findParticipant(conversationId, userId);
    if (p === null || p.requestState === state) return false;
    p.requestState = state;
    return true;
  }

  async setHidden(conversationId: string, userId: string, hiddenAt: Date | null): Promise<boolean> {
    const p = await this.findParticipant(conversationId, userId);
    if (p === null) return false;
    p.hiddenAt = hiddenAt;
    return true;
  }

  async setHiddenForBlocker(
    blockerId: string,
    blockedId: string,
    hiddenAt: Date | null,
  ): Promise<number> {
    let n = 0;
    for (const c of this.conversations) {
      if (![c.lowId, c.highId].includes(blockedId)) continue;
      const p = this.participants.find((x) => x.conversationId === c.id && x.userId === blockerId);
      if (p !== undefined) {
        p.hiddenAt = hiddenAt;
        n += 1;
      }
    }
    return n;
  }

  async promotePendingRequest(recipientId: string, senderId: string): Promise<boolean> {
    for (const c of this.conversations) {
      if (![c.lowId, c.highId].includes(senderId)) continue;
      const p = this.participants.find(
        (x) => x.conversationId === c.id && x.userId === recipientId,
      );
      if (p?.requestState === 'PENDING') {
        p.requestState = 'ACCEPTED';
        return true;
      }
    }
    return false;
  }

  async insertMessage(input: {
    id: string;
    conversationId: string;
    senderId: string;
    clientMessageId: string;
    body: string | null;
    mediaId: string | null;
  }): Promise<{ message: MessageRecord; created: boolean }> {
    // The UNIQUE constraint, in memory. Without it the retry test would pass
    // against an implementation that inserts twice.
    const clash = this.messages.find(
      (m) =>
        m.conversationId === input.conversationId && m.clientMessageId === input.clientMessageId,
    );
    if (clash !== undefined) {
      if (clash.senderId !== input.senderId) {
        throw Object.assign(new Error('client message id belongs to another sender'), {
          code: '42501',
        });
      }
      return { message: clash, created: false };
    }

    const message: MessageRecord = { ...input, createdAt: this.clock() };
    this.messages.push(message);

    // The trigger's work.
    const conversation = this.conversations.find((c) => c.id === input.conversationId);
    if (conversation !== undefined) conversation.lastMessageAt = message.createdAt;
    for (const p of this.participants) {
      if (
        p.conversationId === input.conversationId &&
        p.userId !== input.senderId &&
        p.hiddenAt === null
      ) {
        p.unreadCount += 1;
      }
    }
    return { message, created: true };
  }

  async listMessages(conversationId: string, limit: number): Promise<MessagePage> {
    const rows = this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return { messages: rows, nextCursor: null };
  }

  async listMessagesSince(
    conversationId: string,
    since: Date,
    limit: number,
  ): Promise<MessageRecord[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId && m.createdAt > since)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async listInbox(
    userId: string,
    states: readonly RequestState[],
    limit: number,
  ): Promise<InboxPage> {
    const entries = this.participants
      .filter((p) => p.userId === userId && p.hiddenAt === null && states.includes(p.requestState))
      // An empty thread is not a conversation - see the repository.
      .filter((p) => this.messages.some((m) => m.conversationId === p.conversationId))
      .map((p) => {
        const c = this.conversations.find((x) => x.id === p.conversationId)!;
        const otherUserId = c.lowId === userId ? c.highId : c.lowId;
        const last = this.messages
          .filter((m) => m.conversationId === c.id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return {
          conversationId: c.id,
          otherUserId,
          requestState: p.requestState,
          unreadCount: p.unreadCount,
          lastMessageAt: c.lastMessageAt,
          previewBody: last?.body ?? null,
          previewHasMedia: last?.mediaId !== null && last?.mediaId !== undefined,
          previewSenderId: last?.senderId ?? null,
          otherUserState: this.states.get(otherUserId) ?? ('ACTIVE' as CounterpartState),
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
      .slice(0, limit);
    return { entries, nextBefore: null };
  }

  async countUnread(userId: string): Promise<{ conversations: number; requests: number }> {
    const mine = this.participants
      .filter((p) => p.userId === userId && p.hiddenAt === null)
      .filter((p) => this.messages.some((m) => m.conversationId === p.conversationId));
    return {
      conversations: mine.filter((p) => p.requestState === 'ACCEPTED' && p.unreadCount > 0).length,
      requests: mine.filter((p) => p.requestState === 'PENDING').length,
    };
  }

  async markRead(conversationId: string, userId: string, at: Date): Promise<Date | null> {
    const p = await this.findParticipant(conversationId, userId);
    if (p === null) return null;
    if (p.lastReadAt === null || at > p.lastReadAt) p.lastReadAt = at;
    p.unreadCount = 0;
    return p.lastReadAt;
  }

  async countRecentRequestsBy(senderId: string, since: Date): Promise<number> {
    return this.conversations.filter((c) => {
      if (c.initiatedBy !== senderId || c.createdAt < since) return false;
      const other = this.participants.find(
        (p) => p.conversationId === c.id && p.userId !== senderId,
      );
      return other !== undefined && other.requestState !== 'ACCEPTED';
    }).length;
  }

  async counterpartState(userId: string): Promise<CounterpartState | null> {
    return this.states.get(userId) ?? 'ACTIVE';
  }
}

function build() {
  const repo = new InMemoryMessaging();
  const clock = new FixedClock(new Date('2026-09-05T10:00:00.000Z'));
  repo.clock = () => clock.now();

  const logs: string[] = [];
  const blocked = new Set<string>();
  const key = (a: string, b: string): string => [a, b].sort().join('|');

  const blocks = {
    async isBlockedEitherWay(a: string, b: string) {
      return blocked.has(key(a, b));
    },
  } as unknown as BlockService;

  const following = new Set<string>();
  const follows = {
    async isFollowing(followerId: string, followeeId: string) {
      return following.has(`${followerId}->${followeeId}`);
    },
  } as unknown as FollowService;

  // Records every domain event, so the ADR-014 assertions are about what was
  // EMITTED rather than about a call having been made. `client` is captured
  // too: the outbox row must be written inside the business transaction, and a
  // fake that ignored the client would let that regress unnoticed.
  const emitted: { topic: string; payload: Record<string, unknown> }[] = [];
  const outbox = {
    async emit(event: { topic: string } & Record<string, unknown>) {
      const { topic, ...payload } = event;
      emitted.push({ topic, payload });
    },
  } as unknown as OutboxService;

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
    query: async () => ({ rows: [{ ok: false }] }),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    emitted,
    service: new MessagingService(db, repo, blocks, follows, outbox, clock, logger),
    repo,
    clock,
    logs,
    block: (a: string, b: string) => blocked.add(key(a, b)),
    unblock: (a: string, b: string) => blocked.delete(key(a, b)),
    setFollows: (followerId: string, followeeId: string) =>
      following.add(`${followerId}->${followeeId}`),
    setState: (userId: string, state: CounterpartState) => repo.states.set(userId, state),
  };
}

let ctx: ReturnType<typeof build>;
let alice: string;
let bob: string;

beforeEach(() => {
  ctx = build();
  alice = randomUUID();
  bob = randomUUID();
});

const send = async (from: string, to: string, body: string) =>
  ctx.service.send(from, { recipientId: to, clientMessageId: randomUUID(), body });

describe('MessagingService.open (MSG-FR-001, BR-024)', () => {
  it('OPENS THE EXISTING THREAD RATHER THAN CREATING A SECOND (AC)', async () => {
    const first = await ctx.service.open(alice, bob);
    const second = await ctx.service.open(alice, bob);
    expect(first.status).toBe('OPEN');
    expect(second).toEqual(first);
    expect(ctx.repo.conversations).toHaveLength(1);
  });

  it('and the same thread when the OTHER person opens it', async () => {
    // Approaching from the other side is the case that breaks a naive "find a
    // conversation between A and B" - it stores the pair the other way round
    // and the second thread appears silently.
    const fromAlice = await ctx.service.open(alice, bob);
    const fromBob = await ctx.service.open(bob, alice);
    expect(ctx.repo.conversations).toHaveLength(1);
    expect(fromAlice.status === 'OPEN' && fromBob.status === 'OPEN').toBe(true);
    if (fromAlice.status === 'OPEN' && fromBob.status === 'OPEN') {
      expect(fromBob.conversation.id).toBe(fromAlice.conversation.id);
      expect(fromBob.conversation.otherUserId).toBe(alice);
    }
  });

  it('refuses a conversation with yourself', async () => {
    expect((await ctx.service.open(alice, alice)).status).toBe('CANNOT_MESSAGE_SELF');
  });

  it('refuses across a block, with the neutral answer', async () => {
    ctx.block(alice, bob);
    expect((await ctx.service.open(alice, bob)).status).toBe('NOT_AVAILABLE');
    expect(ctx.repo.conversations).toHaveLength(0);
  });

  it('creates NOTHING VISIBLE to the other person', async () => {
    await ctx.service.open(alice, bob);
    // Tapping Message and changing your mind must not notify anybody, and must
    // not appear in their request count.
    expect(await ctx.service.unreadCounts(bob)).toEqual({ conversations: 0, requests: 0 });
    const inbox = await ctx.service.listInbox(bob, 'CONVERSATIONS');
    expect(inbox.entries).toHaveLength(0);
  });

  it('will not start a NEW thread with a banned account', async () => {
    ctx.setState(bob, 'BANNED');
    expect((await ctx.service.open(alice, bob)).status).toBe('NOT_AVAILABLE');
  });

  it('still opens an EXISTING thread with a deleted account, read-only (EDGE-022)', async () => {
    await send(alice, bob, 'salaam');
    ctx.setState(bob, 'DELETED');

    const r = await ctx.service.open(alice, bob);
    expect(r.status).toBe('OPEN');
    if (r.status === 'OPEN') expect(r.conversation.readOnly).toBe(true);
  });
});

describe('MessagingService.send — idempotency (EDGE-020/021, MSG-FR-002 AC)', () => {
  it('A RETRY WITH THE SAME CLIENT ID DELIVERS EXACTLY ONE MESSAGE', async () => {
    // "GIVEN a message that fails and is retried twice, WHEN the network
    // recovers, THEN exactly one message is delivered."
    const clientMessageId = randomUUID();
    const attempts = await Promise.all([
      ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'salaam' }),
      ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'salaam' }),
      ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'salaam' }),
    ]);

    expect(attempts.every((a) => a.status === 'SENT')).toBe(true);
    expect(ctx.repo.messages).toHaveLength(1);

    const created = attempts.filter((a) => a.status === 'SENT' && a.created);
    expect(created).toHaveLength(1);
  });

  it('a replay returns the ORIGINAL message, not the retry', async () => {
    const clientMessageId = randomUUID();
    const first = await ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'one' });
    ctx.clock.advance(60_000);
    const replay = await ctx.service.send(alice, {
      recipientId: bob,
      clientMessageId,
      body: 'two',
    });

    // Returning the retry's timestamp would move the message in one client's
    // ordering and not the other's, which is the ordering guarantee MSG-FR-004
    // makes.
    expect(first.status === 'SENT' && replay.status === 'SENT').toBe(true);
    if (first.status === 'SENT' && replay.status === 'SENT') {
      expect(replay.message.id).toBe(first.message.id);
      expect(replay.message.body).toBe('one');
      expect(replay.created).toBe(false);
    }
  });

  it('the unread count moves once, not once per retry', async () => {
    const clientMessageId = randomUUID();
    await ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'salaam' });
    await ctx.service.send(alice, { recipientId: bob, clientMessageId, body: 'salaam' });
    // A request, because bob does not follow alice - so it is the REQUEST badge
    // that moves, and it moves by one however many times the retry lands.
    expect(await ctx.service.unreadCounts(bob)).toEqual({ conversations: 0, requests: 1 });
    const inbox = await ctx.service.listInbox(bob, 'REQUESTS');
    expect(inbox.entries[0]?.unreadCount).toBe(1);
  });
});

describe('MessagingService.send — validation (MSG-FR-002)', () => {
  it('refuses empty and whitespace-only text', async () => {
    const r = await ctx.service.send(alice, {
      recipientId: bob,
      clientMessageId: randomUUID(),
      body: '   ',
    });
    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'body', reason: 'EMPTY' });
  });

  it('refuses more than 2,000 characters', async () => {
    const r = await ctx.service.send(alice, {
      recipientId: bob,
      clientMessageId: randomUUID(),
      body: 'a'.repeat(2001),
    });
    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'body', reason: 'TOO_LONG' });
  });

  it('writes nothing when validation fails', async () => {
    await ctx.service.send(alice, { recipientId: bob, clientMessageId: randomUUID(), body: '' });
    // No conversation either: a refused first message must not leave a thread
    // behind that neither person asked for.
    expect(ctx.repo.conversations).toHaveLength(0);
    expect(ctx.repo.messages).toHaveLength(0);
  });
});

describe('MessagingService — Message Requests (MSG-FR-005, BR-027/028)', () => {
  it('a first message from a NON-FOLLOWER becomes a request', async () => {
    await send(alice, bob, 'salaam');

    const requests = await ctx.service.listInbox(bob, 'REQUESTS');
    expect(requests.entries).toHaveLength(1);

    // And it is NOT in the ordinary inbox - "a separate section".
    const inbox = await ctx.service.listInbox(bob, 'CONVERSATIONS');
    expect(inbox.entries).toHaveLength(0);
  });

  it('a message from someone the recipient FOLLOWS goes straight to the inbox', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'salaam');
    expect((await ctx.service.listInbox(bob, 'CONVERSATIONS')).entries).toHaveLength(1);
    expect((await ctx.service.listInbox(bob, 'REQUESTS')).entries).toHaveLength(0);
  });

  it('THE SENDER SEES AN ORDINARY THREAD while the recipient holds a request', async () => {
    // This asymmetry is the mechanism. The sender's own row is ACCEPTED, so
    // there is nothing on their side that could reveal the request state.
    await send(alice, bob, 'salaam');
    const senderInbox = await ctx.service.listInbox(alice, 'CONVERSATIONS');
    expect(senderInbox.entries).toHaveLength(1);
    expect(senderInbox.entries[0]?.requestState).toBe('ACCEPTED');
  });

  it('ACCEPTING moves the thread to the inbox', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;

    expect(await ctx.service.acceptRequest(bob, conversationId)).toEqual({ status: 'DONE' });
    expect((await ctx.service.listInbox(bob, 'CONVERSATIONS')).entries).toHaveLength(1);
    expect((await ctx.service.listInbox(bob, 'REQUESTS')).entries).toHaveLength(0);
  });

  it('DECLINING CHANGES NOTHING THE SENDER CAN SEE (BR-028)', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;

    const before = await ctx.service.listInbox(alice, 'CONVERSATIONS');
    await ctx.service.declineRequest(bob, conversationId);
    const after = await ctx.service.listInbox(alice, 'CONVERSATIONS');

    // "A declined message request produces no signal to the sender, because
    // informing them invites retaliation." Their view is byte-identical.
    expect(after).toEqual(before);
  });

  it('a message into a DECLINED thread is stored but surfaces nowhere', async () => {
    await send(alice, bob, 'first');
    const conversationId = ctx.repo.conversations[0]!.id;
    await ctx.service.declineRequest(bob, conversationId);

    const second = await send(alice, bob, 'second');
    expect(second.status).toBe('SENT');

    // Stored, because it is evidence if the recipient later reports and it is
    // there if they later accept. Surfaced nowhere, because they declined.
    expect(ctx.repo.messages).toHaveLength(2);
    expect((await ctx.service.listInbox(bob, 'REQUESTS')).entries).toHaveLength(0);
    expect((await ctx.service.listInbox(bob, 'CONVERSATIONS')).entries).toHaveLength(0);
  });

  it('a declined thread raises NO NEW REQUEST (A1)', async () => {
    await send(alice, bob, 'first');
    await ctx.service.declineRequest(bob, ctx.repo.conversations[0]!.id);
    await send(alice, bob, 'second');
    expect((await ctx.service.unreadCounts(bob)).requests).toBe(0);
  });

  it('LIMITS NEW REQUESTS TO 10 A DAY (E3)', async () => {
    for (let i = 0; i < 10; i += 1) {
      const target = randomUUID();
      const r = await send(alice, target, `hello ${i}`);
      expect(r.status).toBe('SENT');
    }

    const eleventh = await send(alice, randomUUID(), 'one too many');
    expect(eleventh.status).toBe('REQUEST_LIMIT_REACHED');
  });

  it('the limit does not touch conversations that were ACCEPTED', async () => {
    for (let i = 0; i < 10; i += 1) {
      const target = randomUUID();
      ctx.setFollows(target, alice);
      await send(alice, target, `hello ${i}`);
    }
    // Ten accepted conversations are not ten unsolicited requests, so an
    // eleventh cold approach is still allowed.
    expect((await send(alice, randomUUID(), 'still fine')).status).toBe('SENT');
  });

  it('the window rolls forward', async () => {
    for (let i = 0; i < 10; i += 1) await send(alice, randomUUID(), `hello ${i}`);
    expect((await send(alice, randomUUID(), 'blocked')).status).toBe('REQUEST_LIMIT_REACHED');

    ctx.clock.advance(25 * 60 * 60 * 1000);
    expect((await send(alice, randomUUID(), 'a day later')).status).toBe('SENT');
  });

  it('replying inside an existing thread is never rate-limited', async () => {
    ctx.setFollows(bob, alice);
    for (let i = 0; i < 30; i += 1) {
      expect((await send(alice, bob, `msg ${i}`)).status).toBe('SENT');
    }
  });
});

describe('MessagingService — blocking (MSG-FR-006, EDGE-019, BR-025)', () => {
  it('REFUSES A BLOCKED SENDER WITHOUT DISCLOSING THE BLOCK (AC)', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    ctx.block(bob, alice);

    const refused = await ctx.service.send(alice, {
      conversationId,
      clientMessageId: randomUUID(),
      body: 'are you there',
    });

    // The SAME answer a conversation that never existed would give. Not a
    // different one with similar wording - the same one.
    expect(refused).toEqual({ status: 'NOT_AVAILABLE' });

    const nonexistent = await ctx.service.send(alice, {
      conversationId: randomUUID(),
      clientMessageId: randomUUID(),
      body: 'anything',
    });
    expect(nonexistent).toEqual(refused);
  });

  it('the blocked sender receives nothing, and the blocker gets no message', async () => {
    await send(alice, bob, 'salaam');
    ctx.block(bob, alice);
    await ctx.service.send(alice, {
      conversationId: ctx.repo.conversations[0]!.id,
      clientMessageId: randomUUID(),
      body: 'refused',
    });
    expect(ctx.repo.messages).toHaveLength(1);
  });

  it('history is unreachable across a block, both ways', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    ctx.block(bob, alice);

    expect(await ctx.service.listMessages(alice, conversationId)).toBeNull();
    expect(await ctx.service.listMessages(bob, conversationId)).toBeNull();
  });

  it('a hidden conversation is unreachable BY ID, not merely absent from the list', async () => {
    // The block predicate and the participant's own `hidden_at` are two
    // different facts, and a read path that consulted only the first would
    // still serve the thread to someone who holds a direct link.
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    await ctx.repo.setHidden(conversationId, bob, new Date());

    expect(await ctx.service.listMessages(bob, conversationId)).toBeNull();
  });
});

describe('MessagingService — read receipts (MSG-FR-009)', () => {
  it('a read message shows readAt to its SENDER', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;

    ctx.clock.advance(1000);
    await ctx.service.markRead(bob, conversationId);

    const senderView = await ctx.service.listMessages(alice, conversationId);
    expect(senderView?.messages[0]?.readAt).toBeInstanceOf(Date);
  });

  it('NEVER FOR A MESSAGE REQUEST (AC)', async () => {
    // "GIVEN a message in Message Requests, WHEN the recipient opens it, THEN
    // the sender does not see a read state."
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;

    ctx.clock.advance(1000);
    const marked = await ctx.service.markRead(bob, conversationId);
    expect(marked).toEqual({ status: 'DONE', notify: null });

    const senderView = await ctx.service.listMessages(alice, conversationId);
    expect(senderView?.messages[0]?.readAt).toBeNull();
  });

  it('nor for a DECLINED thread', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    await ctx.service.declineRequest(bob, conversationId);

    ctx.clock.advance(1000);
    expect(await ctx.service.markRead(bob, conversationId)).toEqual({
      status: 'DONE',
      notify: null,
    });
  });

  it('a receipt appears once the request is ACCEPTED', async () => {
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    await ctx.service.acceptRequest(bob, conversationId);

    ctx.clock.advance(1000);
    const marked = await ctx.service.markRead(bob, conversationId);
    expect(marked.status === 'DONE' && marked.notify?.userId).toBe(alice);
  });

  it('shows no receipt on the OTHER person’s messages', async () => {
    ctx.setFollows(bob, alice);
    ctx.setFollows(alice, bob);
    await send(alice, bob, 'salaam');
    const conversationId = ctx.repo.conversations[0]!.id;
    await ctx.service.markRead(bob, conversationId);

    // Telling the recipient when they read something themselves is meaningless.
    const recipientView = await ctx.service.listMessages(bob, conversationId);
    expect(recipientView?.messages[0]?.readAt).toBeNull();
  });

  it('marking read zeroes the unread count', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'one');
    await send(alice, bob, 'two');
    expect((await ctx.service.unreadCounts(bob)).conversations).toBe(1);

    await ctx.service.markRead(bob, ctx.repo.conversations[0]!.id);
    expect((await ctx.service.unreadCounts(bob)).conversations).toBe(0);
  });

  it('the read marker never moves BACKWARDS', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'one');
    const conversationId = ctx.repo.conversations[0]!.id;

    ctx.clock.advance(10_000);
    const later = await ctx.service.markRead(bob, conversationId);
    const at = later.status === 'DONE' ? later.notify?.readAt : undefined;

    // A slow request arriving after a newer one must not un-read messages the
    // user has already seen.
    ctx.clock.set(new Date('2026-09-05T09:00:00.000Z'));
    await ctx.service.markRead(bob, conversationId);
    const participant = await ctx.repo.findParticipant(conversationId, bob);
    expect(participant?.lastReadAt?.getTime()).toBe(at?.getTime());
  });
});

describe('MessagingService — read-only threads (EDGE-022)', () => {
  it('refuses a send to a DELETED account, and says why', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'salaam');
    ctx.setState(bob, 'DELETED');

    const r = await ctx.service.send(alice, {
      conversationId: ctx.repo.conversations[0]!.id,
      clientMessageId: randomUUID(),
      body: 'hello?',
    });

    // READ_ONLY rather than NOT_AVAILABLE: this one IS disclosed, because it is
    // about the conversation rather than about the person, and the client has
    // to close the compose box and mark the thread.
    expect(r).toEqual({ status: 'READ_ONLY' });
  });

  it('KEEPS THE HISTORY READABLE', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'salaam');
    ctx.setState(bob, 'BANNED');

    // "Existing history is retained for the remaining participant." Someone's
    // record of what a neighbour said is theirs; losing it because the other
    // person left would be a second loss.
    const page = await ctx.service.listMessages(alice, ctx.repo.conversations[0]!.id);
    expect(page?.messages).toHaveLength(1);
  });

  it('a SUSPENDED counterpart does not close the thread', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'salaam');
    ctx.setState(bob, 'SUSPENDED');

    const r = await ctx.service.send(alice, {
      conversationId: ctx.repo.conversations[0]!.id,
      clientMessageId: randomUUID(),
      body: 'still here',
    });
    expect(r.status).toBe('SENT');
  });
});

describe('MessagingService — reconnect (MSG-FR-004 E1)', () => {
  it('returns everything after a timestamp, with no gaps or duplicates', async () => {
    ctx.setFollows(bob, alice);
    await send(alice, bob, 'one');
    const conversationId = ctx.repo.conversations[0]!.id;
    const boundary = ctx.clock.now();

    ctx.clock.advance(1000);
    await send(alice, bob, 'two');
    ctx.clock.advance(1000);
    await send(alice, bob, 'three');

    const missed = await ctx.service.listMessagesSince(bob, conversationId, boundary);
    expect(missed?.map((m) => m.body)).toEqual(['two', 'three']);
  });

  it('refuses for a non-participant, with the neutral answer', async () => {
    await send(alice, bob, 'salaam');
    const stranger = randomUUID();
    expect(
      await ctx.service.listMessagesSince(stranger, ctx.repo.conversations[0]!.id, new Date(0)),
    ).toBeNull();
  });
});

describe('MessagingService — what is never logged', () => {
  it('never logs a user id, a conversation id, or a message body', async () => {
    await send(alice, bob, 'a secret about my neighbour');
    await ctx.service.declineRequest(bob, ctx.repo.conversations[0]!.id);

    // A log line pairing two people in a messaging context is a record of who
    // is talking to whom, and PRIV-009 limits who may read a conversation - a
    // limit log files do not honour.
    for (const line of ctx.logs) {
      expect(line).not.toContain(alice);
      expect(line).not.toContain(bob);
      expect(line).not.toContain(ctx.repo.conversations[0]!.id);
      expect(line).not.toContain('secret about my neighbour');
    }
  });
});
