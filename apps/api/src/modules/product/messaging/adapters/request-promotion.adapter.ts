import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { RequestPromotion } from '../../social-graph/ports/request-promotion.port.js';
import {
  MESSAGING_REPOSITORY,
  type MessagingRepository,
} from '../repositories/messaging.repository.port.js';

/**
 * Supplies `social-graph` with request promotion for MSG-FR-005 A3, without
 * `social-graph` writing this module's table.
 *
 * See `social-graph/ports/request-promotion.port.ts` for why the edge is
 * inverted.
 */
@Injectable()
export class RequestPromotionAdapter implements RequestPromotion {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository) {}

  async promotePendingRequest(
    followerId: string,
    followeeId: string,
    client: PoolClient,
  ): Promise<boolean> {
    // The FOLLOWER is the one who holds the pending request, and the FOLLOWEE
    // is the sender whose message is waiting. Getting this pair the wrong way
    // round would promote nothing and fail silently, which is why the port
    // names them by their role in the follow rather than by "recipient" and
    // "sender".
    return this.repo.promotePendingRequest(followerId, followeeId, client);
  }
}
