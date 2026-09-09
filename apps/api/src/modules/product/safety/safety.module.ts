import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { BLOCK_REPOSITORY } from './repositories/block.repository.port.js';
import { PgBlockRepository } from './repositories/pg-block.repository.js';
import { FOLLOW_REMOVAL } from './ports/follow-removal.port.js';
import { CONVERSATION_HIDING } from './ports/conversation-hiding.port.js';
import { ConversationHidingAdapter } from '../messaging/adapters/conversation-hiding.adapter.js';
import { MESSAGING_REPOSITORY } from '../messaging/repositories/messaging.repository.port.js';
import { PgMessagingRepository } from '../messaging/repositories/pg-messaging.repository.js';
import { FollowRemovalAdapter } from '../social-graph/adapters/follow-removal.adapter.js';
import { FOLLOW_REPOSITORY } from '../social-graph/repositories/follow.repository.port.js';
import { PgFollowRepository } from '../social-graph/repositories/pg-follow.repository.js';
import { AuditModule } from '../../platform/audit/audit.module.js';
import { REPORT_REPOSITORY } from './repositories/report.repository.port.js';
import { PgReportRepository } from './repositories/pg-report.repository.js';
import { ReportService } from './application/report.service.js';
import { ReportController } from './transport/report.controller.js';
import { BlockService } from './application/block.service.js';
import { BlockController } from './transport/block.controller.js';

/**
 * `safety` — product tier. Blocking (EPIC-05) and reporting, the auto-hide
 * threshold and moderation cases (EPIC-12).
 *
 * Owns `blocks` and the SHARED block predicate (§165), which every read path in
 * the product consults. One implementation, because there are nine read paths
 * and a block that leaks on any one of them leaks entirely.
 *
 * Also owns `reports`, `moderation_cases` and `enforcement_actions`. The
 * threshold that hides content lives here rather than in the modules that own
 * the content, because it is ONE rule with per-type numbers - and a copy in
 * posts, another in comments and a third in events would be three chances to
 * get BR-032 wrong in the permissive direction.
 *
 * `AuditModule` is imported because every auto-hide and every moderation
 * decision is audited IN THE SAME TRANSACTION as the act. An audit row for a
 * hide that rolled back is a false record; a hide with no audit row is an
 * invisible act of moderation. Both are worse than either being late.
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
  imports: [IdentityModule, AuditModule],
  controllers: [BlockController, ReportController],
  providers: [
    PgBlockRepository,
    { provide: BLOCK_REPOSITORY, useExisting: PgBlockRepository },

    // Follow removal for BR-024. See the class comment for why the edge is
    // inverted rather than resolved with forwardRef.
    PgFollowRepository,
    { provide: FOLLOW_REPOSITORY, useExisting: PgFollowRepository },
    FollowRemovalAdapter,
    { provide: FOLLOW_REMOVAL, useExisting: FollowRemovalAdapter },

    // Conversation hiding for MSG-FR-003 / EDGE-019, bound the same way and for
    // the same reason: `conversation_participants` keeps one writer, and the
    // hide has to commit with the block.
    PgMessagingRepository,
    { provide: MESSAGING_REPOSITORY, useExisting: PgMessagingRepository },
    ConversationHidingAdapter,
    { provide: CONVERSATION_HIDING, useExisting: ConversationHidingAdapter },

    BlockService,

    // EPIC-12. Reporting, the auto-hide threshold and moderation cases.
    PgReportRepository,
    { provide: REPORT_REPOSITORY, useExisting: PgReportRepository },
    ReportService,
  ],
  // `BlockService` is the block predicate for the rest of the product. The
  // repository is not exported: nothing outside safety reads or writes `blocks`
  // directly, so "who blocked whom" has exactly one gatekeeper.
  exports: [BlockService, ReportService],
})
export class SafetyModule {}
