import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { EventsModule } from '../events/events.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { SEARCH_REPOSITORY } from './repositories/search.repository.port.js';
import { PgSearchRepository } from './repositories/pg-search.repository.js';
import { SearchService } from './application/search.service.js';
import { SearchController } from './transport/search.controller.js';

/**
 * `search` - product tier. EPIC-08.
 *
 * Owns no table. The cross-script matching lives in the DATABASE, as a
 * `search_key()` function and generated columns on `posts` and `profiles` -
 * so the index cannot disagree with the text it summarises, and a row written
 * by a migration or a repair script is normalised exactly like one written by
 * the API.
 *
 * SEARCH-FR-004 (events) arrived with EPIC-10, which owns the events table -
 * the generated column and its ordering rule live in migration 0017 beside the
 * table they summarise, and this module only asks the question.
 *
 * SEARCH-FR-005 (recent searches) has NO server-side component at all by
 * requirement: PRIV-011 says they are "stored on the device only and are never
 * transmitted or retained on the server".
 */
@Module({
  imports: [IdentityModule, ProfileModule, SafetyModule, EngagementModule, EventsModule],
  controllers: [SearchController],
  providers: [
    PgSearchRepository,
    { provide: SEARCH_REPOSITORY, useExisting: PgSearchRepository },
    SearchService,
  ],
  exports: [SearchService],
})
export class SearchModule {}
