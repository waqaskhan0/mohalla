import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ConversationHiding } from '../../safety/ports/conversation-hiding.port.js';
import {
  MESSAGING_REPOSITORY,
  type MessagingRepository,
} from '../repositories/messaging.repository.port.js';

/**
 * Supplies `safety` with conversation hiding for MSG-FR-003 / EDGE-019, without
 * `safety` writing this module's table.
 *
 * See `safety/ports/conversation-hiding.port.ts` for why the edge is inverted.
 * `conversation_participants` keeps exactly one writer — this module.
 */
@Injectable()
export class ConversationHidingAdapter implements ConversationHiding {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository) {}

  async setHiddenForBlocker(
    blockerId: string,
    blockedId: string,
    hiddenAt: Date | null,
    client: PoolClient,
  ): Promise<number> {
    return this.repo.setHiddenForBlocker(blockerId, blockedId, hiddenAt, client);
  }
}
