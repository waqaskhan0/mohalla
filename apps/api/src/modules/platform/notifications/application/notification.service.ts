import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { LOCALES, render, type Locale } from '@mohalla/localization';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { CLOCK, type Clock } from '../../identity/ports/clock.port.js';
import { decideEligibility, type Suppression } from '../domain/eligibility.js';
import { LIKE_BATCH_WINDOW_MINUTES, planLikeNotification } from '../domain/like-batching.js';
import {
  PREFERENCE_KEYS,
  TEMPLATE_KEYS,
  type NotificationCategory,
  type NotificationTarget,
  type PreferenceKey,
} from '../domain/notification-category.js';
import { PUSH_SENDER, type PushSender } from '../ports/push-sender.port.js';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRecord,
  type NotificationRepository,
} from '../repositories/notification.repository.port.js';

/** ADR-014 retention. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * A notification as the centre renders it.
 *
 * `text` is rendered HERE, at read time, in the language the reader is using
 * now — which is what makes LOCALE-FR-002's "the entire interface updates
 * without reinstall" true for the notification centre as well as the rest of
 * the app.
 */
export interface NotificationView {
  id: string;
  category: NotificationCategory;
  actorId: string | null;
  targetType: NotificationTarget;
  targetId: string | null;
  text: string;
  batchCount: number;
  readAt: Date | null;
  createdAt: Date;
}

export interface DeliveryOutcome {
  recipientId: string;
  suppression: Suppression;
  notificationId: string | null;
  pushesSent: number;
}

/**
 * Notifications (NOTIF-FR-001…007 · LOCALE-FR-006 · ADR-014 · PRIV-015).
 *
 * TWO SYSTEMS, AND THE ORDER BETWEEN THEM IS THE DESIGN. A durable in-app
 * record is the source of truth; push is a best-effort projection of it. The
 * requirement that forces this is NOTIF-FR-001: a user who declines the OS push
 * permission must lose nothing but push, and PRIV-015 says declining degrades no
 * other function. So the record is written first and unconditionally, and a
 * failure to push never unwinds it.
 *
 * THE ELIGIBILITY RULES ARE APPLIED IN ONE PLACE, in the order ADR-014 gives.
 * Two of them suppress the record entirely (own action, blocked); two suppress
 * only the push (message request, preference off). Collapsing those into a
 * single "should we notify" boolean is the mistake `domain/eligibility.ts`
 * exists to prevent — and NOTIF-FR-007's acceptance criterion is precisely the
 * distinction: "no push is sent BUT the entry appears in the in-app centre".
 *
 * A PUSH FAILURE NEVER FAILS ANYTHING ELSE. ADR-014: "a push failure never
 * fails the originating business transaction", and by the time this runs the
 * transaction is long committed. An FCM outage is invisible to the user;
 * records accumulate in the centre and they lose nothing but the buzz.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly logger: StructuredLogger,
  ) {}

  // ---------------------------------------------------- the in-app centre
  /**
   * NOTIF-FR-002 — the centre, newest first, rendered in the reader's language.
   *
   * `locale` comes from the CALLER because the reader is making this request
   * and their client knows what language it is displaying. Their stored
   * preference is the fallback, and English is the last resort — reached only
   * when a user has never chosen and their client did not say, which BR-040
   * makes possible.
   */
  async list(
    recipientId: string,
    locale: Locale | null,
    limit = 20,
    cursor?: { createdAt: Date; id: string },
  ): Promise<{
    notifications: NotificationView[];
    nextCursor: { createdAt: Date; id: string } | null;
  }> {
    const language = locale ?? (await this.repo.languageFor(recipientId)) ?? 'en';
    const page = await this.repo.list(recipientId, clampLimit(limit), cursor);
    return {
      notifications: page.notifications.map((n) => this.toView(n, language)),
      nextCursor: page.nextCursor,
    };
  }

  async unreadCount(recipientId: string): Promise<number> {
    return this.repo.countUnread(recipientId);
  }

  async markRead(recipientId: string, ids: readonly string[]): Promise<number> {
    return this.db.withTransaction(async (client) =>
      this.repo.markRead(recipientId, ids, this.clock.now(), client),
    );
  }

  async markAllRead(recipientId: string): Promise<number> {
    return this.db.withTransaction(async (client) =>
      this.repo.markAllRead(recipientId, this.clock.now(), client),
    );
  }

  // ---------------------------------------------------------- preferences
  async preferences(userId: string): Promise<Record<PreferenceKey, boolean>> {
    const stored = await this.repo.preferencesFor(userId);
    // Every switch is reported, with ENABLED as the default for any the user
    // has never touched — so the settings screen shows the truth rather than
    // an empty list that looks like everything is off.
    const out = {} as Record<PreferenceKey, boolean>;
    for (const key of PREFERENCE_KEYS) out[key] = stored[key] ?? true;
    return out;
  }

  async setPreference(userId: string, key: PreferenceKey, pushEnabled: boolean): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await this.repo.setPreference(userId, key, pushEnabled, client);
    });
    // No user id: which categories somebody has muted is a small behavioural
    // fact about them, and the row already records it under access control.
    this.logger.log(JSON.stringify({ event: 'notification_preference_set', key }), 'notifications');
  }

  // -------------------------------------------------------- device tokens
  async registerDevice(
    userId: string,
    token: string,
    language: Locale,
    platform = 'ANDROID',
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await this.repo.registerDevice(
        { id: randomUUID(), userId, token, platform, language },
        client,
      );
    });
    // The token itself is never logged. It is a delivery credential for a
    // specific handset, and a log line carrying one is a log line that can push
    // to somebody's phone.
    this.logger.log(JSON.stringify({ event: 'device_registered', platform }), 'notifications');
  }

  async removeDevice(userId: string, token: string): Promise<boolean> {
    return this.db.withTransaction(async (client) => this.repo.removeDevice(userId, token, client));
  }

  // ------------------------------------------------------------- delivery
  /**
   * Create the record, then try to push. Called by the worker, per recipient.
   *
   * THE ORDER IS THE GUARANTEE. The record is written and committed before a
   * single byte goes to FCM, so an outage, a dead token or a crash mid-fan-out
   * cannot cost the user the notification — only the buzz.
   */
  async deliver(
    input: {
      recipientId: string;
      actorId: string | null;
      category: NotificationCategory;
      targetType: NotificationTarget;
      targetId: string | null;
      templateKey: string;
      params: Record<string, string | number>;
      deepLink: string;
      blockedEitherWay: boolean;
      isMessageRequest?: boolean;
    },
    client?: PoolClient,
  ): Promise<DeliveryOutcome> {
    const preferences = await this.repo.preferencesFor(input.recipientId, client);
    const devices = await this.repo.liveDevicesFor(input.recipientId, client);

    const suppression = decideEligibility({
      recipientId: input.recipientId,
      actorId: input.actorId,
      category: input.category,
      blockedEitherWay: input.blockedEitherWay,
      isMessageRequest: input.isMessageRequest ?? false,
      pushPreferences: preferences,
      hasLiveDevice: devices.length > 0,
    });

    if (!suppression.record) {
      this.log('notification_suppressed', { reason: suppression.reason });
      return {
        recipientId: input.recipientId,
        suppression,
        notificationId: null,
        pushesSent: 0,
      };
    }

    const record = await this.write(input, client);

    if (!suppression.push) {
      // The record stands and the phone stays quiet. This is the NOTIF-FR-007
      // and BR-027 case, and it is a SUCCESS rather than a partial failure.
      this.log('notification_recorded_no_push', {
        reason: suppression.reason,
        category: input.category,
      });
      return {
        recipientId: input.recipientId,
        suppression,
        notificationId: record.id,
        pushesSent: 0,
      };
    }

    const pushesSent = await this.fanOut(input, devices, record);
    return {
      recipientId: input.recipientId,
      suppression,
      notificationId: record.id,
      pushesSent,
    };
  }

  /**
   * NOTIF-FR-003's batching, which is the one delivery path that does not
   * always create a row.
   *
   * "GIVEN a post receives 12 likes within one hour... the user receives a
   * summary rather than 12 separate alerts." The sixth like converts to a
   * summary; the seventh onwards bump it. Earlier individual notifications are
   * left alone — reaching back to delete five the user may already have read
   * would be worse than the duplication it tidies.
   */
  async deliverLike(
    input: {
      recipientId: string;
      actorId: string;
      postId: string;
      actorName: string;
      deepLink: string;
      blockedEitherWay: boolean;
    },
    client?: PoolClient,
  ): Promise<DeliveryOutcome> {
    const since = new Date(this.clock.now().getTime() - LIKE_BATCH_WINDOW_MINUTES * 60 * 1000);

    const state = await this.db.withTransaction(async (tx) =>
      this.repo.likeBatchState(input.recipientId, input.postId, since, tx),
    );

    const plan = planLikeNotification({
      likesInWindow: state.likesInWindow,
      summaryExists: state.summaryId !== null,
    });

    if (plan.kind === 'EXTEND_SUMMARY' && state.summaryId !== null) {
      // Suppression still applies: a blocked liker must not bump the count
      // either, or the number itself becomes a signal.
      const preferences = await this.repo.preferencesFor(input.recipientId, client);
      const devices = await this.repo.liveDevicesFor(input.recipientId, client);
      const suppression = decideEligibility({
        recipientId: input.recipientId,
        actorId: input.actorId,
        category: 'LIKE',
        blockedEitherWay: input.blockedEitherWay,
        isMessageRequest: false,
        pushPreferences: preferences,
        hasLiveDevice: devices.length > 0,
      });
      if (!suppression.record) {
        return {
          recipientId: input.recipientId,
          suppression,
          notificationId: null,
          pushesSent: 0,
        };
      }

      await this.db.withTransaction(async (tx) => {
        await this.repo.extendSummary(
          state.summaryId as string,
          plan.total,
          { actor: input.actorName, others: plan.total - 1 },
          tx,
        );
      });

      // NO PUSH ON AN EXTENSION. The summary already buzzed once; buzzing again
      // for every like after the sixth would recreate exactly the fatigue the
      // batching exists to prevent.
      this.log('like_summary_extended', { total: plan.total });
      return {
        recipientId: input.recipientId,
        suppression: { record: true, push: false, reason: 'PREFERENCE_OFF' },
        notificationId: state.summaryId,
        pushesSent: 0,
      };
    }

    const batched = plan.kind === 'START_SUMMARY';
    return this.deliver(
      {
        recipientId: input.recipientId,
        actorId: input.actorId,
        category: 'LIKE',
        targetType: 'POST',
        targetId: input.postId,
        templateKey: batched ? TEMPLATE_KEYS.LIKE_BATCHED : TEMPLATE_KEYS.LIKE,
        params: batched
          ? { actor: input.actorName, others: plan.total - 1 }
          : { actor: input.actorName },
        deepLink: input.deepLink,
        blockedEitherWay: input.blockedEitherWay,
      },
      client,
    );
  }

  /** ADR-014 retention — a daily job prunes rows older than 90 days. */
  async pruneExpired(): Promise<number> {
    const cutoff = new Date(
      this.clock.now().getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const pruned = await this.db.withTransaction(async (client) =>
      this.repo.pruneOlderThan(cutoff, client),
    );
    if (pruned > 0) this.log('notifications_pruned', { pruned });
    return pruned;
  }

  // ------------------------------------------------------------ internals
  private async write(
    input: {
      recipientId: string;
      actorId: string | null;
      category: NotificationCategory;
      targetType: NotificationTarget;
      targetId: string | null;
      templateKey: string;
      params: Record<string, string | number>;
    },
    client?: PoolClient,
  ): Promise<NotificationRecord> {
    const create = async (tx: PoolClient): Promise<NotificationRecord> =>
      this.repo.create(
        {
          id: randomUUID(),
          recipientId: input.recipientId,
          category: input.category,
          actorId: input.actorId,
          targetType: input.targetType,
          targetId: input.targetId,
          templateKey: input.templateKey,
          params: input.params,
          batchCount: Number(input.params.others ?? 0) + 1,
        },
        tx,
      );

    return client === undefined ? this.db.withTransaction(create) : create(client);
  }

  /**
   * Push to every live device, each in ITS OWN language.
   *
   * The recipient's stored preference wins where they have one; the language
   * the DEVICE recorded at registration is the fallback. BR-040 says no default
   * is pre-selected server-side, so without the device's answer there would be
   * nothing to fall back to but a guess — and a push in the wrong script is
   * worse than a plain one.
   *
   * A failure here is logged and swallowed. ADR-014: an FCM outage is invisible
   * to the user, because the record already exists.
   */
  private async fanOut(
    input: { templateKey: string; params: Record<string, string | number>; deepLink: string },
    devices: readonly { token: string; language: Locale }[],
    record: NotificationRecord,
  ): Promise<number> {
    const stored = await this.repo.languageFor(record.recipientId);
    let sent = 0;

    for (const device of devices) {
      const language = stored ?? device.language;
      const body = render(language, input.templateKey, input.params);

      try {
        const result = await this.push.send({
          token: device.token,
          // ADR-014: the payload carries the minimum needed for the deep link.
          // The app name as the title keeps the notification identifiable on a
          // lock screen without adding a second piece of content to it.
          title: render(language, 'foundation.appName'),
          body,
          deepLink: input.deepLink,
        });

        if (result.ok) {
          sent += 1;
          continue;
        }

        if (result.tokenInvalid) {
          // ADR-014: "removed automatically when FCM reports them invalid".
          // Retrying an uninstalled app forever would fill the dead-letter
          // queue with devices that no longer exist.
          await this.repo.invalidateDevice(device.token, this.clock.now());
          this.log('device_token_invalidated', {});
          continue;
        }

        this.log('push_failed', { retryable: result.retryable, reason: result.reason });
      } catch (e) {
        // Swallowed on purpose. The record is already durable; letting this
        // throw would fail an outbox row that has nothing left to do and cause
        // the notification to be created twice on the retry.
        this.logger.warn(
          JSON.stringify({
            event: 'push_threw',
            message: e instanceof Error ? e.message : String(e),
          }),
          'notifications',
        );
      }
    }

    return sent;
  }

  private toView(n: NotificationRecord, locale: Locale): NotificationView {
    return {
      id: n.id,
      category: n.category,
      actorId: n.actorId,
      targetType: n.targetType,
      targetId: n.targetId,
      // LOCALE-FR-006: the TEMPLATE is translated; the parameters are not. A
      // display name inside a notification is data, not copy.
      text: render(locale, n.templateKey, n.params),
      batchCount: n.batchCount,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No user ids, no tokens, no rendered text. A notification log line pairing
    // an actor with a recipient is a record of who is interacting with whom,
    // and a rendered line can contain a message preview.
    this.logger.log(JSON.stringify({ event, ...extra }), 'notifications');
  }
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function clampLimit(limit: number, max = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}
