import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../repositories/notification.repository.port.js';

/**
 * The domain events a producer may emit.
 *
 * A CLOSED UNION, not a string. Every topic here has a handler in the delivery
 * pipeline, and adding one without the other stops compiling — which is the
 * whole reason this is a type rather than a convention. An outbox full of rows
 * nobody consumes is indistinguishable from a working system until somebody
 * asks why they never get notified.
 */
export type DomainEvent =
  | { topic: 'engagement.liked'; postId: string; postAuthorId: string; actorId: string }
  | {
      topic: 'engagement.commented';
      postId: string;
      postAuthorId: string;
      commentId: string;
      actorId: string;
    }
  | {
      topic: 'engagement.replied';
      postId: string;
      parentAuthorId: string;
      commentId: string;
      actorId: string;
    }
  | { topic: 'social.followed'; followeeId: string; actorId: string }
  | {
      topic: 'message.sent';
      conversationId: string;
      recipientId: string;
      actorId: string;
      /** BR-027 — the pipeline drops push when this is true. */
      isRequest: boolean;
      preview: string;
    }
  | { topic: 'event.rsvp'; eventId: string; creatorId: string; actorId: string }
  | { topic: 'event.changed'; eventId: string; recipientIds: string[] }
  | { topic: 'event.cancelled'; eventId: string; recipientIds: string[] }
  | {
      topic: 'announcement.broadcast';
      announcementId: string;
      titleEn: string;
      titleUr: string;
    };

export type DomainTopic = DomainEvent['topic'];

/**
 * The producer half of ADR-014.
 *
 * ONE METHOD, AND IT REQUIRES A TRANSACTION CLIENT. That signature is the
 * durability guarantee made unavoidable: the outbox row commits or rolls back
 * with the like, comment or message it describes. An overload that accepted no
 * client would be the easy one to call, and the failure it permits — a
 * notification lost when the process dies between commit and enqueue — leaves
 * nothing behind to debug.
 *
 * PRODUCERS DO NOT DECIDE WHO IS NOTIFIED. They state what happened; the
 * delivery pipeline applies the block check, the preferences and the batching.
 * That is what keeps ADR-014's eligibility rules in ONE place rather than
 * re-derived in five modules, each of which would get rule 2 slightly wrong.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository) {}

  async emit(event: DomainEvent, client: PoolClient): Promise<void> {
    const { topic, ...payload } = event;
    await this.repo.enqueue({ id: randomUUID(), topic, payload }, client);
  }
}
