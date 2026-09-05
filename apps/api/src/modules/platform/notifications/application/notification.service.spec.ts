import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Locale } from '@mohalla/localization';
import { NotificationService } from './notification.service.js';
import { FakePushSender } from '../adapters/fake-push-sender.js';
import { FixedClock } from '../../identity/ports/clock.port.js';
import { TEMPLATE_KEYS } from '../domain/notification-category.js';
import type {
  NotificationCategory,
  NotificationTarget,
  PreferenceKey,
} from '../domain/notification-category.js';
import type {
  DeviceTokenRecord,
  NotificationPage,
  NotificationRecord,
  NotificationRepository,
  OutboxRow,
} from '../repositories/notification.repository.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

class InMemoryNotifications implements NotificationRepository {
  rows: NotificationRecord[] = [];
  outbox: OutboxRow[] = [];
  prefs = new Map<string, Partial<Record<PreferenceKey, boolean>>>();
  devices: DeviceTokenRecord[] = [];
  languages = new Map<string, Locale>();
  clock: () => Date = () => new Date();

  async enqueue(input: { id: string; topic: string; payload: Record<string, unknown> }) {
    this.outbox.push({ ...input, attempts: 0, createdAt: this.clock() });
  }
  async claimOutbox(limit: number) {
    return this.outbox.slice(0, limit);
  }
  async markProcessed() {}
  async markFailed() {}

  async create(input: {
    id: string;
    recipientId: string;
    category: NotificationCategory;
    actorId: string | null;
    targetType: NotificationTarget;
    targetId: string | null;
    templateKey: string;
    params: Record<string, string | number>;
    batchCount?: number;
  }): Promise<NotificationRecord> {
    const row: NotificationRecord = {
      ...input,
      targetId: input.targetId,
      batchCount: input.batchCount ?? 1,
      readAt: null,
      createdAt: this.clock(),
    };
    this.rows.push(row);
    return row;
  }

  async list(recipientId: string, limit: number): Promise<NotificationPage> {
    const rows = this.rows
      .filter((r) => r.recipientId === recipientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return { notifications: rows, nextCursor: null };
  }

  async countUnread(recipientId: string) {
    return this.rows.filter((r) => r.recipientId === recipientId && r.readAt === null).length;
  }

  async markRead(recipientId: string, ids: readonly string[], at: Date) {
    let n = 0;
    for (const row of this.rows) {
      if (row.recipientId === recipientId && ids.includes(row.id) && row.readAt === null) {
        row.readAt = at;
        n += 1;
      }
    }
    return n;
  }

  async markAllRead(recipientId: string, at: Date) {
    let n = 0;
    for (const row of this.rows) {
      if (row.recipientId === recipientId && row.readAt === null) {
        row.readAt = at;
        n += 1;
      }
    }
    return n;
  }

  async likeBatchState(recipientId: string, postId: string, since: Date) {
    const mine = this.rows.filter(
      (r) =>
        r.recipientId === recipientId &&
        r.category === 'LIKE' &&
        r.targetType === 'POST' &&
        r.targetId === postId &&
        r.createdAt >= since,
    );
    const summary = mine.find((r) => r.templateKey === TEMPLATE_KEYS.LIKE_BATCHED);
    const individual = mine.filter((r) => r.templateKey !== TEMPLATE_KEYS.LIKE_BATCHED).length;
    return {
      // Matches the SQL: the summary is authoritative once it exists.
      likesInWindow: summary === undefined ? individual : summary.batchCount,
      summaryId: summary?.id ?? null,
      summaryCount: summary?.batchCount ?? 0,
    };
  }

  async extendSummary(id: string, total: number, params: Record<string, string | number>) {
    const row = this.rows.find((r) => r.id === id);
    if (row === undefined) return;
    row.batchCount = total;
    row.params = params;
    row.readAt = null;
    row.createdAt = this.clock();
  }

  async pruneOlderThan(cutoff: Date) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.createdAt >= cutoff);
    return before - this.rows.length;
  }

  async preferencesFor(userId: string) {
    return this.prefs.get(userId) ?? {};
  }

  async setPreference(userId: string, key: PreferenceKey, pushEnabled: boolean) {
    const current = this.prefs.get(userId) ?? {};
    current[key] = pushEnabled;
    this.prefs.set(userId, current);
  }

  async registerDevice(input: {
    id: string;
    userId: string;
    token: string;
    platform: string;
    language: Locale;
  }) {
    const existing = this.devices.find((d) => d.token === input.token);
    if (existing !== undefined) {
      existing.userId = input.userId;
      existing.language = input.language;
      existing.invalidatedAt = null;
      return;
    }
    this.devices.push({ ...input, invalidatedAt: null });
  }

  async removeDevice(userId: string, token: string) {
    const i = this.devices.findIndex((d) => d.userId === userId && d.token === token);
    if (i === -1) return false;
    this.devices.splice(i, 1);
    return true;
  }

  async invalidateDevice(token: string, at: Date) {
    const d = this.devices.find((x) => x.token === token);
    if (d !== undefined) d.invalidatedAt = at;
  }

  async liveDevicesFor(userId: string) {
    return this.devices.filter((d) => d.userId === userId && d.invalidatedAt === null);
  }

  async languageFor(userId: string) {
    return this.languages.get(userId) ?? null;
  }
}

const NOW = new Date('2026-09-05T12:00:00.000Z');

function build() {
  const repo = new InMemoryNotifications();
  const clock = new FixedClock(NOW);
  repo.clock = () => clock.now();
  const push = new FakePushSender();
  const logs: string[] = [];

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
    query: async () => ({ rows: [] }),
  } as unknown as DatabaseService;

  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  return {
    service: new NotificationService(db, repo, push, clock, logger),
    repo,
    push,
    clock,
    logs,
  };
}

let ctx: ReturnType<typeof build>;
let recipient: string;
let actor: string;

beforeEach(() => {
  ctx = build();
  recipient = randomUUID();
  actor = randomUUID();
});

const withDevice = async (token = 'synthetic-device-token-1', language: Locale = 'en') => {
  await ctx.service.registerDevice(recipient, token, language);
  return token;
};

const like = (over: Partial<Parameters<NotificationService['deliver']>[0]> = {}) =>
  ctx.service.deliver({
    recipientId: recipient,
    actorId: actor,
    category: 'LIKE',
    targetType: 'POST',
    targetId: randomUUID(),
    templateKey: TEMPLATE_KEYS.LIKE,
    params: { actor: 'Ayesha Khan' },
    deepLink: '/posts/1',
    blockedEitherWay: false,
    ...over,
  });

describe('NotificationService.deliver — the record comes first (ADR-014)', () => {
  it('writes the record and pushes when everything allows it', async () => {
    const token = await withDevice();
    const outcome = await like();

    expect(outcome.notificationId).not.toBeNull();
    expect(outcome.pushesSent).toBe(1);
    expect(ctx.push.to(token)).toHaveLength(1);
  });

  it('WRITES THE RECORD EVEN WITH NO DEVICE (NOTIF-FR-001 AC)', async () => {
    const outcome = await like();

    // "GIVEN a user who denied the push permission, WHEN someone comments on
    // their post, THEN the notification is present in the in-app centre."
    expect(outcome.notificationId).not.toBeNull();
    expect(outcome.pushesSent).toBe(0);
    expect(await ctx.service.unreadCount(recipient)).toBe(1);
  });

  it('WRITES THE RECORD WHEN THE CATEGORY IS MUTED (NOTIF-FR-007 AC)', async () => {
    await withDevice();
    await ctx.service.setPreference(recipient, 'LIKE', false);

    const outcome = await like();
    expect(outcome.notificationId).not.toBeNull();
    expect(outcome.pushesSent).toBe(0);
    expect(ctx.push.all()).toHaveLength(0);

    const centre = await ctx.service.list(recipient, 'en');
    expect(centre.notifications).toHaveLength(1);
  });

  it('WRITES NOTHING ACROSS A BLOCK', async () => {
    await withDevice();
    const outcome = await like({ blockedEitherWay: true });

    expect(outcome.notificationId).toBeNull();
    expect(await ctx.service.unreadCount(recipient)).toBe(0);
    expect(ctx.push.all()).toHaveLength(0);
  });

  it('writes nothing for a user’s own action', async () => {
    await withDevice();
    const outcome = await like({ actorId: recipient });
    expect(outcome.notificationId).toBeNull();
  });

  it('a MESSAGE REQUEST records and stays silent (BR-027)', async () => {
    await withDevice();
    const outcome = await ctx.service.deliver({
      recipientId: recipient,
      actorId: actor,
      category: 'MESSAGE',
      targetType: 'CONVERSATION',
      targetId: randomUUID(),
      templateKey: TEMPLATE_KEYS.MESSAGE,
      params: { actor: 'Ayesha Khan', preview: 'salaam' },
      deepLink: '/conversations/1',
      blockedEitherWay: false,
      isMessageRequest: true,
    });

    expect(outcome.notificationId).not.toBeNull();
    expect(ctx.push.all()).toHaveLength(0);
  });
});

describe('NotificationService — language (LOCALE-FR-006)', () => {
  it('renders the CENTRE in the language the reader asks for', async () => {
    await like();
    const english = await ctx.service.list(recipient, 'en');
    const urdu = await ctx.service.list(recipient, 'ur');

    expect(english.notifications[0]?.text).toBe('Ayesha Khan liked your post');
    expect(urdu.notifications[0]?.text).toContain('Ayesha Khan');
    expect(urdu.notifications[0]?.text).not.toBe(english.notifications[0]?.text);
  });

  it('NEVER TRANSLATES THE USER-GENERATED PART (AC)', async () => {
    // "GIVEN a user whose preference is Urdu, WHEN they receive a like
    // notification, THEN the template text is Urdu and THE OTHER USER'S NAME IS
    // UNALTERED."
    await like({ params: { actor: 'عائشہ خان' } });
    const urdu = await ctx.service.list(recipient, 'ur');
    const english = await ctx.service.list(recipient, 'en');

    expect(urdu.notifications[0]?.text).toContain('عائشہ خان');
    expect(english.notifications[0]?.text).toContain('عائشہ خان');
  });

  it('the SAME record renders differently after a language switch', async () => {
    // LOCALE-FR-002: "the entire interface updates without reinstall". A centre
    // of pre-rendered text could not do this, which is why the row stores a
    // template key.
    await like();
    const before = (await ctx.service.list(recipient, 'en')).notifications[0];
    const after = (await ctx.service.list(recipient, 'ur')).notifications[0];
    expect(before?.id).toBe(after?.id);
    expect(before?.text).not.toBe(after?.text);
  });

  it('PUSHES IN THE DEVICE’S OWN LANGUAGE when the user has stored none (BR-040)', async () => {
    // BR-040: no default is pre-selected, so a user may genuinely have no
    // server-side language. The device recorded its first-launch choice, and
    // using it is what stops a push arriving in a script nobody picked.
    const token = await withDevice('synthetic-device-urdu', 'ur');
    await like();

    const sent = ctx.push.to(token)[0];
    expect(sent?.body).toContain('پسند');
  });

  it('the user’s STORED preference wins over the device', async () => {
    const token = await withDevice('synthetic-device-urdu', 'ur');
    ctx.repo.languages.set(recipient, 'en');
    await like();

    expect(ctx.push.to(token)[0]?.body).toBe('Ayesha Khan liked your post');
  });
});

describe('NotificationService — push failure never costs the record (ADR-014)', () => {
  it('keeps the record when the push is rejected', async () => {
    await withDevice('synthetic-device-flaky');
    const outcome = await like();

    expect(outcome.notificationId).not.toBeNull();
    expect(outcome.pushesSent).toBe(0);
  });

  it('INVALIDATES A DEAD TOKEN rather than retrying it forever', async () => {
    const token = await withDevice('synthetic-device-invalid');
    await like();

    expect(await ctx.repo.liveDevicesFor(recipient)).toHaveLength(0);
    const record = ctx.repo.devices.find((d) => d.token === token);
    expect(record?.invalidatedAt).toBeInstanceOf(Date);
  });

  it('pushes to every live device', async () => {
    await withDevice('synthetic-device-a');
    await withDevice('synthetic-device-b');
    const outcome = await like();
    expect(outcome.pushesSent).toBe(2);
  });

  it('a dead token does not stop the others', async () => {
    await withDevice('synthetic-device-invalid');
    await withDevice('synthetic-device-good');
    const outcome = await like();
    expect(outcome.pushesSent).toBe(1);
  });
});

describe('NotificationService.deliverLike — batching (NOTIF-FR-003)', () => {
  const postId = randomUUID();

  const oneLike = (name = 'Ayesha Khan') =>
    ctx.service.deliverLike({
      recipientId: recipient,
      actorId: randomUUID(),
      postId,
      actorName: name,
      deepLink: `/posts/${postId}`,
      blockedEitherWay: false,
    });

  it('TWELVE LIKES PRODUCE A SUMMARY, NOT TWELVE ALERTS (AC)', async () => {
    await withDevice();
    for (let i = 0; i < 12; i += 1) await oneLike();

    const centre = await ctx.service.list(recipient, 'en', 50);
    // Five individual notifications plus one summary.
    expect(centre.notifications).toHaveLength(6);

    const summary = centre.notifications.find((n) => n.batchCount > 1);
    expect(summary?.batchCount).toBe(12);
    expect(summary?.text).toContain('11 others');
  });

  it('pushes SIX times, not twelve', async () => {
    const token = await withDevice();
    for (let i = 0; i < 12; i += 1) await oneLike();

    // The summary buzzes once when it starts. Buzzing again for every like
    // after the sixth would recreate the fatigue the batching exists to stop.
    expect(ctx.push.to(token)).toHaveLength(6);
  });

  it('a blocked liker does not even bump the count', async () => {
    await withDevice();
    for (let i = 0; i < 6; i += 1) await oneLike();

    const before = (await ctx.service.list(recipient, 'en', 50)).notifications.find(
      (n) => n.batchCount > 1,
    );
    await ctx.service.deliverLike({
      recipientId: recipient,
      actorId: randomUUID(),
      postId,
      actorName: 'Blocked Person',
      deepLink: `/posts/${postId}`,
      blockedEitherWay: true,
    });
    const after = (await ctx.service.list(recipient, 'en', 50)).notifications.find(
      (n) => n.batchCount > 1,
    );

    // The number itself would be a signal - "somebody you cannot see liked
    // this" is still information about them.
    expect(after?.batchCount).toBe(before?.batchCount);
  });

  it('a summary that grows becomes UNREAD again', async () => {
    await withDevice();
    for (let i = 0; i < 6; i += 1) await oneLike();
    await ctx.service.markAllRead(recipient);
    expect(await ctx.service.unreadCount(recipient)).toBe(0);

    await oneLike();
    // A summary read at 6 that now covers 7 is new information; leaving it read
    // and buried would silently swallow the rest.
    expect(await ctx.service.unreadCount(recipient)).toBe(1);
  });
});

describe('NotificationService — the centre (NOTIF-FR-002)', () => {
  it('counts unread and marks read', async () => {
    await like();
    await like();
    expect(await ctx.service.unreadCount(recipient)).toBe(2);

    const page = await ctx.service.list(recipient, 'en');
    const first = page.notifications[0];
    expect(first).toBeDefined();
    await ctx.service.markRead(recipient, [first!.id]);
    expect(await ctx.service.unreadCount(recipient)).toBe(1);
  });

  it('cannot mark somebody else’s notification read', async () => {
    await like();
    const page = await ctx.service.list(recipient, 'en');
    const stranger = randomUUID();
    expect(await ctx.service.markRead(stranger, [page.notifications[0]!.id])).toBe(0);
    expect(await ctx.service.unreadCount(recipient)).toBe(1);
  });

  it('prunes at 90 days', async () => {
    await like();
    ctx.clock.advance(91 * 24 * 60 * 60 * 1000);
    expect(await ctx.service.pruneExpired()).toBe(1);
    expect(await ctx.service.unreadCount(recipient)).toBe(0);
  });

  it('reports every preference switch, defaulting to enabled', async () => {
    const prefs = await ctx.service.preferences(recipient);
    expect(Object.values(prefs).every((v) => v === true)).toBe(true);

    await ctx.service.setPreference(recipient, 'LIKE', false);
    expect((await ctx.service.preferences(recipient)).LIKE).toBe(false);
    expect((await ctx.service.preferences(recipient)).COMMENT).toBe(true);
  });
});

describe('NotificationService — device tokens', () => {
  it('REASSIGNS a token that moves to another account', async () => {
    const other = randomUUID();
    await ctx.service.registerDevice(recipient, 'synthetic-shared-handset', 'en');
    await ctx.service.registerDevice(other, 'synthetic-shared-handset', 'ur');

    // A handset that changes hands must stop delivering the previous user's
    // notifications.
    expect(await ctx.repo.liveDevicesFor(recipient)).toHaveLength(0);
    expect(await ctx.repo.liveDevicesFor(other)).toHaveLength(1);
  });

  it('unregistering is idempotent', async () => {
    await withDevice();
    expect(await ctx.service.removeDevice(recipient, 'synthetic-device-token-1')).toBe(true);
    expect(await ctx.service.removeDevice(recipient, 'synthetic-device-token-1')).toBe(false);
  });
});

describe('NotificationService — what is never logged', () => {
  it('logs no user id, no device token and no rendered text', async () => {
    await withDevice('secret-device-token');
    await like({ params: { actor: 'Ayesha Khan' } });
    await ctx.service.setPreference(recipient, 'LIKE', false);

    for (const line of ctx.logs) {
      expect(line).not.toContain(recipient);
      expect(line).not.toContain(actor);
      expect(line).not.toContain('secret-device-token');
      expect(line).not.toContain('Ayesha Khan');
    }
  });
});
