import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { BLOCK_REPOSITORY } from './repositories/block.repository.port.js';
import { PgBlockRepository } from './repositories/pg-block.repository.js';
import { FOLLOW_REMOVAL } from './ports/follow-removal.port.js';
import { FollowRemovalAdapter } from '../social-graph/adapters/follow-removal.adapter.js';
import { FOLLOW_REPOSITORY } from '../social-graph/repositories/follow.repository.port.js';
import { PgFollowRepository } from '../social-graph/repositories/pg-follow.repository.js';
import { BlockService } from './application/block.service.js';
import { BlockController } from './transport/block.controller.js';

/**
 * `safety` — product tier. Blocking half of EPIC-05; reports and moderation
 * cases follow in EPIC-12.
 *
 * Owns `blocks` and the SHARED block predicate (§165), which every read path in
 * the product consults. One implementation, because there are nine read paths
 * and a block that leaks on any one of them leaks entirely.
 *
 * WHY THIS MODULE WIRES SOCIAL-GRAPH'S REPOSITORY.
 *
 * BR-024 requires blocking to remove follows in the same transaction, and the
 * design lists safety → social-graph for exactly that. It also lists
 * social-graph → safety for the block predicate. As NestJS module imports those
 * two are a cycle, so `FollowRemoval` is a port and its adapter is bound here.
 *
 * That binding names social-graph's repository class, which is DI plumbing
 * rather than a layering violation: the SQL against `follows` still has exactly
 * one implementation, owned by social-graph. What matters is that no second
 * place writes that table, and none does. The repository has no module
 * dependencies of its own — `DatabaseService` is global — so binding it here
 * creates no import edge back into `SocialGraphModule`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [BlockController],
  providers: [
    PgBlockRepository,
    { provide: BLOCK_REPOSITORY, useExisting: PgBlockRepository },

    // Follow removal for BR-024. See the class comment for why the edge is
    // inverted rather than resolved with forwardRef.
    PgFollowRepository,
    { provide: FOLLOW_REPOSITORY, useExisting: PgFollowRepository },
    FollowRemovalAdapter,
    { provide: FOLLOW_REMOVAL, useExisting: FollowRemovalAdapter },

    BlockService,
  ],
  // `BlockService` is the block predicate for the rest of the product. The
  // repository is not exported: nothing outside safety reads or writes `blocks`
  // directly, so "who blocked whom" has exactly one gatekeeper.
  exports: [BlockService],
})
export class SafetyModule {}
