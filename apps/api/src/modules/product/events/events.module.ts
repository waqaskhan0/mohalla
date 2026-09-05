import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { EVENT_REPOSITORY } from './repositories/event.repository.port.js';
import { PgEventRepository } from './repositories/pg-event.repository.js';
import { EventService } from './application/event.service.js';
import { EventController } from './transport/event.controller.js';

/**
 * `events` — product tier. EPIC-10.
 *
 * Owns `events` and `event_rsvps`.
 *
 * Only two dependencies, which is unusual for a product module and worth
 * noting: `safety` for the block predicate every read path consults, and
 * `identity` for the session guard. Events do not depend on `social-graph`,
 * because BR-043 puts no relationship condition on creating or attending one —
 * a neighbourhood meeting is open to the neighbourhood, not to a follower list.
 *
 * `EventService` is exported for `search` (SEARCH-FR-004, which EPIC-08
 * deferred here because this module owns the table) and for EPIC-11, whose
 * reminder job addresses `attendeeIdsForNotice`.
 */
@Module({
  imports: [IdentityModule, SafetyModule],
  controllers: [EventController],
  providers: [
    PgEventRepository,
    { provide: EVENT_REPOSITORY, useExisting: PgEventRepository },
    EventService,
  ],
  exports: [EventService, EVENT_REPOSITORY],
})
export class EventsModule {}
