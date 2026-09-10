import type { PoolClient } from 'pg';
import type { Locale } from '@mohalla/localization';
import type {
  NotificationCategory,
  NotificationTarget,
  PreferenceKey,
} from '../domain/notification-category.js';

export const NOTIFICATION_REPOSITORY = Symbol.for('mohalla.notifications.repository');

export interface NotificationRecord {
  id: string;
  recipientId: string;
  category: NotificationCategory;
  actorId: string | null;
  targetType: NotificationTarget;
  targetId: string | null;
  templateKey: string;
  params: Record<string, string | number>;
  batchCount: number;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  notifications: NotificationRecord[];
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  token: string;
  platform: string;
  language: Locale;
  invalidatedAt: Date | null;
}

export interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

export interface NotificationRepository {
  // ---- the outbox (written inside the caller's business transaction) ------
  /**
   * ADR-014's durability boundary.
   *
   * `client` is REQUIRED, not optional, and that is the whole point: the row
   * must commit or roll back with the change it describes. An optional client
   * would make the unsafe call the easy one to write, and the failure — a
   * notification silently lost when the process dies between commit and
   * enqueue — leaves no trace to debug.
   */
  enqueue(
    input: { id: string; topic: string; payload: Record<string, unknown> },
    client: PoolClient,
  ): Promise<void>;

  /**
   * Claim a batch of unprocessed rows for this worker.
   *
   * `FOR UPDATE SKIP LOCKED`, so two workers never process the same row and
   * neither blocks on the other. Oldest first, so notifications arrive in the
   * order the things that caused them happened.
   */
  claimOutbox(limit: number, client: PoolClient): Promise<OutboxRow[]>;

  markProcessed(id: string, client: PoolClient): Promise<void>;
  markFailed(id: string, error: string, client: PoolClient): Promise<void>;

  // ---- notification records ---------------------------------------------
  create(
    input: {
      id: string;
      recipientId: string;
      category: NotificationCategory;
      actorId: string | null;
      targetType: NotificationTarget;
      targetId: string | null;
      templateKey: string;
      params: Record<string, string | number>;
      batchCount?: number;
    },
    client: PoolClient,
  ): Promise<NotificationRecord>;

  /**
   * NOTIF-FR-002 — the centre, newest first.
   *
   * `excludeActorIds` carries BR-025 into this read path: notifications caused
   * by somebody the reader has a block with are not shown. Applied in SQL
   * rather than after the fetch, so a page emptied by blocks still pages
   * correctly instead of returning short.
   */
  list(
    recipientId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | undefined,
    excludeActorIds: readonly string[],
    client?: PoolClient,
  ): Promise<NotificationPage>;

  /** The same exclusion, so the badge cannot count what the centre will not show. */
  countUnread(
    recipientId: string,
    excludeActorIds: readonly string[],
    client?: PoolClient,
  ): Promise<number>;

  markRead(
    recipientId: string,
    ids: readonly string[],
    at: Date,
    client: PoolClient,
  ): Promise<number>;
  markAllRead(recipientId: string, at: Date, client: PoolClient): Promise<number>;

  /**
   * NOTIF-FR-003 — how many likes on this post the recipient has been told
   * about inside the window, and whether a summary already covers them.
   *
   * `likesInWindow` COUNTS EACH LIKE ONCE. Once a summary exists it is
   * authoritative for the window and the individual rows before it are not
   * added again — they are the same likes, already inside its total. Summing
   * every row's `batch_count` instead compounds: the summary's own count would
   * be added to the five individual notifications it supersedes, and by the
   * twelfth like the total reads 42.
   */
  likeBatchState(
    recipientId: string,
    postId: string,
    since: Date,
    client: PoolClient,
  ): Promise<{ likesInWindow: number; summaryId: string | null; summaryCount: number }>;

  /** Bump an existing summary rather than adding another row. */
  extendSummary(
    id: string,
    total: number,
    params: Record<string, string | number>,
    client: PoolClient,
  ): Promise<void>;

  /** ADR-014 retention: 90 days. @returns how many rows were pruned. */
  pruneOlderThan(cutoff: Date, client: PoolClient): Promise<number>;

  // ---- preferences -------------------------------------------------------
  /**
   * The recipient's push switches.
   *
   * An ABSENT row means ENABLED. Defaulting to off would silently disable the
   * product's main retention mechanism for every user who never opens settings.
   */
  preferencesFor(
    userId: string,
    client?: PoolClient,
  ): Promise<Partial<Record<PreferenceKey, boolean>>>;

  setPreference(
    userId: string,
    key: PreferenceKey,
    pushEnabled: boolean,
    client: PoolClient,
  ): Promise<void>;

  // ---- device tokens -----------------------------------------------------
  /**
   * Register or re-register a token.
   *
   * REASSIGNS on conflict rather than inserting a second row. A token that
   * moves to another account — a shared phone, a reinstall after a handover —
   * must stop delivering the previous user's notifications, and a UNIQUE
   * constraint plus an upsert is what makes that automatic.
   */
  registerDevice(
    input: { id: string; userId: string; token: string; platform: string; language: Locale },
    client: PoolClient,
  ): Promise<void>;

  /** On logout, and on an explicit unregister. */
  removeDevice(userId: string, token: string, client: PoolClient): Promise<boolean>;

  /** ADR-014: set when FCM reports the token invalid. */
  invalidateDevice(token: string, at: Date, client?: PoolClient): Promise<void>;

  liveDevicesFor(userId: string, client?: PoolClient): Promise<DeviceTokenRecord[]>;

  // ---- recipient facts the worker needs ----------------------------------
  /**
   * The recipient's stored language, or null when they have never synced one.
   *
   * NULL is a real answer, not a missing one: BR-040 says no default is
   * pre-selected, so the push renderer falls back to the language the DEVICE
   * recorded rather than to a server-chosen guess.
   */
  languageFor(userId: string, client?: PoolClient): Promise<Locale | null>;
}
