import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { TEMPLATE_KEYS } from '../domain/notification-category.js';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
  type OutboxRow,
} from '../repositories/notification.repository.port.js';
import { NotificationService, type DeliveryOutcome } from './notification.service.js';
import { BLOCK_CHECK, type BlockCheck } from '../ports/block-check.port.js';
import { ACTOR_NAMES, type ActorNames } from '../ports/actor-names.port.js';

/**
 * How many attempts before a row is abandoned.
 *
 * Matches the worker's own retry policy. A row that has failed this many times
 * is failing for a reason retrying will not fix — a deleted target, a payload
 * shape from an older deploy — and leaving it in the queue makes every drain
 * slower forever while hiding the newer rows behind it.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** How many rows one drain claims. Bounded so a backlog cannot stall a tick. */
export const OUTBOX_BATCH_SIZE = 50;

export interface DrainResult {
  claimed: number;
  processed: number;
  failed: number;
  deliveries: DeliveryOutcome[];
}

/**
 * The consumer half of ADR-014.
 *
 * Reads outbox rows, turns each into one or more notification deliveries, and
 * marks the row processed. Runs in the worker.
 *
 * THIS IS WHERE "WHO GETS NOTIFIED" IS DECIDED, and it is the only place.
 * Producers state what happened — a like, a follow, a message — and say nothing
 * about eligibility. That separation is what keeps ADR-014's six rules in one
 * implementation instead of five modules each getting rule 2 slightly wrong.
 *
 * A FAILED ROW IS RETRIED, NOT DROPPED. The row stays unprocessed and its
 * attempt count rises; after OUTBOX_MAX_ATTEMPTS it is marked processed with the
 * error retained, which is a dead-letter rather than a deletion — the payload
 * is still there to inspect.
 *
 * EACH ROW IS ITS OWN TRANSACTION. One malformed payload must not roll back the
 * forty-nine rows either side of it.
 */
@Injectable()
export class OutboxDrainService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    private readonly notifications: NotificationService,
    @Inject(BLOCK_CHECK) private readonly blocks: BlockCheck,
    @Inject(ACTOR_NAMES) private readonly names: ActorNames,
    private readonly logger: StructuredLogger,
  ) {}

  async drain(batchSize = OUTBOX_BATCH_SIZE): Promise<DrainResult> {
    const result: DrainResult = { claimed: 0, processed: 0, failed: 0, deliveries: [] };

    // Claimed in its own transaction, and released immediately. Holding the
    // claim lock across the delivery work would serialise every worker behind
    // the slowest push.
    const rows = await this.db.withTransaction(async (client) =>
      this.repo.claimOutbox(batchSize, client),
    );
    result.claimed = rows.length;

    for (const row of rows) {
      try {
        const deliveries = await this.handle(row);
        result.deliveries.push(...deliveries);
        await this.db.withTransaction(async (client) => {
          await this.repo.markProcessed(row.id, client);
        });
        result.processed += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.failed += 1;

        await this.db.withTransaction(async (client) => {
          if (row.attempts + 1 >= OUTBOX_MAX_ATTEMPTS) {
            // DEAD-LETTERED, not deleted: the payload and the error stay for
            // inspection. Marking it processed is what stops it slowing every
            // future drain.
            await this.repo.markFailed(row.id, message, client);
            await this.repo.markProcessed(row.id, client);
            this.logger.error(
              JSON.stringify({
                event: 'outbox_dead',
                topic: row.topic,
                attempts: row.attempts + 1,
              }),
              message,
              'notifications',
            );
          } else {
            await this.repo.markFailed(row.id, message, client);
            this.logger.warn(
              JSON.stringify({
                event: 'outbox_failed_will_retry',
                topic: row.topic,
                attempts: row.attempts + 1,
              }),
              'notifications',
            );
          }
        });
      }
    }

    return result;
  }

  // ---------------------------------------------------------------- routing
  private async handle(row: OutboxRow): Promise<DeliveryOutcome[]> {
    const p = row.payload as Record<string, string | boolean | string[] | undefined>;

    switch (row.topic) {
      case 'engagement.liked':
        return [
          await this.notifications.deliverLike({
            recipientId: str(p.postAuthorId),
            actorId: str(p.actorId),
            postId: str(p.postId),
            actorName: await this.names.displayNameOf(str(p.actorId)),
            deepLink: `/posts/${str(p.postId)}`,
            blockedEitherWay: await this.blocked(str(p.actorId), str(p.postAuthorId)),
          }),
        ];

      case 'engagement.commented':
        return [
          await this.deliverOne({
            recipientId: str(p.postAuthorId),
            actorId: str(p.actorId),
            category: 'COMMENT',
            targetType: 'POST',
            targetId: str(p.postId),
            templateKey: TEMPLATE_KEYS.COMMENT,
            deepLink: `/posts/${str(p.postId)}#${str(p.commentId)}`,
          }),
        ];

      case 'engagement.replied':
        return [
          await this.deliverOne({
            recipientId: str(p.parentAuthorId),
            actorId: str(p.actorId),
            category: 'REPLY',
            targetType: 'COMMENT',
            targetId: str(p.commentId),
            templateKey: TEMPLATE_KEYS.REPLY,
            deepLink: `/posts/${str(p.postId)}#${str(p.commentId)}`,
          }),
        ];

      case 'social.followed':
        return [
          await this.deliverOne({
            recipientId: str(p.followeeId),
            actorId: str(p.actorId),
            category: 'FOLLOW',
            targetType: 'PROFILE',
            targetId: str(p.actorId),
            templateKey: TEMPLATE_KEYS.FOLLOW,
            deepLink: `/users/${str(p.actorId)}`,
          }),
        ];

      case 'message.sent':
        return [
          await this.deliverOne({
            recipientId: str(p.recipientId),
            actorId: str(p.actorId),
            category: 'MESSAGE',
            targetType: 'CONVERSATION',
            targetId: str(p.conversationId),
            templateKey: TEMPLATE_KEYS.MESSAGE,
            deepLink: `/conversations/${str(p.conversationId)}`,
            // BR-027 / NOTIF-FR-004. The flag rides the event rather than being
            // re-derived here: messaging already decided it, and deciding it
            // twice is how the two answers diverge.
            isMessageRequest: p.isRequest === true,
            // NOTIF-FR-004 asks for "the sender and a preview". ADR-014 records
            // the accepted residual risk that this appears on a lock screen.
            extraParams: { preview: str(p.preview) },
          }),
        ];

      case 'event.rsvp':
        return [
          await this.deliverOne({
            recipientId: str(p.creatorId),
            actorId: str(p.actorId),
            category: 'EVENT',
            targetType: 'EVENT',
            targetId: str(p.eventId),
            templateKey: TEMPLATE_KEYS.EVENT_RSVP,
            deepLink: `/events/${str(p.eventId)}`,
            extraParams: { event: await this.names.eventTitleOf(str(p.eventId)) },
          }),
        ];

      case 'event.changed':
      case 'event.cancelled': {
        const recipients = Array.isArray(p.recipientIds) ? p.recipientIds : [];
        const eventTitle = await this.names.eventTitleOf(str(p.eventId));
        const templateKey =
          row.topic === 'event.cancelled'
            ? TEMPLATE_KEYS.EVENT_CANCELLED
            : TEMPLATE_KEYS.EVENT_CHANGED;

        const out: DeliveryOutcome[] = [];
        for (const recipientId of recipients) {
          out.push(
            await this.deliverOne({
              recipientId,
              // No actor: this is the EVENT changing, not a person acting on
              // the recipient. A null actor is also what lets the recipient be
              // the event's own creator without tripping the self-notification
              // rule — an organiser who cancels does not notify themselves,
              // because they are not in the attendee list either.
              actorId: null,
              category: 'EVENT',
              targetType: 'EVENT',
              targetId: str(p.eventId),
              templateKey,
              deepLink: `/events/${str(p.eventId)}`,
              extraParams: { event: eventTitle },
            }),
          );
        }
        return out;
      }

      case 'announcement.broadcast':
        // NOTIF-FR-005 fans out to every user, which is a different shape from
        // everything else here and belongs with the admin epic that publishes
        // it. EPIC-13 owns ADMIN-FR-009; this leaves the topic recognised so an
        // unrouted row is a real error rather than a silent drop.
        this.logger.log(
          JSON.stringify({ event: 'announcement_broadcast_deferred', epic: 'EPIC-13' }),
          'notifications',
        );
        return [];

      default:
        // An unknown topic is a bug, not a transient failure — it means a
        // producer emitted something no consumer handles, and the row would
        // otherwise sit unprocessed forever looking like a slow queue.
        throw new Error(`no handler for outbox topic: ${row.topic}`);
    }
  }

  private async deliverOne(input: {
    recipientId: string;
    actorId: string | null;
    category: 'COMMENT' | 'REPLY' | 'FOLLOW' | 'MENTION' | 'MESSAGE' | 'EVENT' | 'ANNOUNCEMENT';
    targetType: 'POST' | 'COMMENT' | 'EVENT' | 'CONVERSATION' | 'PROFILE' | 'ANNOUNCEMENT';
    targetId: string | null;
    templateKey: string;
    deepLink: string;
    isMessageRequest?: boolean;
    extraParams?: Record<string, string | number>;
  }): Promise<DeliveryOutcome> {
    const actorName = input.actorId === null ? '' : await this.names.displayNameOf(input.actorId);

    return this.notifications.deliver({
      recipientId: input.recipientId,
      actorId: input.actorId,
      category: input.category,
      targetType: input.targetType,
      targetId: input.targetId,
      templateKey: input.templateKey,
      params: { actor: actorName, ...input.extraParams },
      deepLink: input.deepLink,
      blockedEitherWay:
        input.actorId === null ? false : await this.blocked(input.actorId, input.recipientId),
      ...(input.isMessageRequest === undefined ? {} : { isMessageRequest: input.isMessageRequest }),
    });
  }

  private async blocked(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    return this.blocks.isBlockedEitherWay(a, b);
  }
}

/**
 * Read a required string out of a payload.
 *
 * Throws rather than coercing, so a payload shape that changed under a deploy
 * fails the row loudly and retries, instead of quietly writing a notification
 * addressed to the string "undefined".
 */
function str(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('outbox payload is missing a required field');
  }
  return value;
}
