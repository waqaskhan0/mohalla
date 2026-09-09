import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FollowRemoval } from '../../safety/ports/follow-removal.port.js';
import {
  FOLLOW_REPOSITORY,
  type FollowRepository,
} from '../repositories/follow.repository.port.js';

/**
 * Supplies `safety` with follow removal for BR-024, without `safety` writing
 * this module's table.
 *
 * This is the inverted edge described in `follow-removal.port.ts`: the design
 * lists safety → social-graph and social-graph → safety, which together are a
 * cycle. Rather than reach for `forwardRef` and leave the import graph
 * meaningless, the lighter direction became a port and this class is its
 * adapter. `follows` therefore has exactly one writer — its owner.
 */
@Injectable()
export class FollowRemovalAdapter implements FollowRemoval {
  constructor(@Inject(FOLLOW_REPOSITORY) private readonly repo: FollowRepository) {}

  async removeBothDirections(userA: string, userB: string, client: PoolClient): Promise<number> {
    return this.repo.removeBothDirections(userA, userB, client);
  }
}
