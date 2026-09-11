import { Injectable } from '@nestjs/common';
import type { BlockCheck } from '../../../platform/notifications/ports/block-check.port.js';
import { BlockService } from '../application/block.service.js';

/**
 * Supplies `notifications` with ADR-014's eligibility rule 2 — never notify
 * across a block, in either direction.
 *
 * The import runs PRODUCT → PLATFORM, which is the permitted direction; the
 * dependency it satisfies runs the other way, which is why it is a port. See
 * `platform/notifications/ports/block-check.port.ts`.
 *
 * This is a one-line delegation on purpose. The predicate has exactly one
 * implementation (§165), and anything cleverer here would be a second one.
 */
@Injectable()
export class BlockCheckAdapter implements BlockCheck {
  constructor(private readonly blocks: BlockService) {}

  async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    return this.blocks.isBlockedEitherWay(userA, userB);
  }

  async blockCounterparts(userId: string): Promise<string[]> {
    return this.blocks.blockCounterparts(userId);
  }
}
