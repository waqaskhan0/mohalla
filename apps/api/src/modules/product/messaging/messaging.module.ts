import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { MediaModule } from '../../platform/media/media.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { SocialGraphModule } from '../social-graph/social-graph.module.js';
import { MESSAGING_REPOSITORY } from './repositories/messaging.repository.port.js';
import { PgMessagingRepository } from './repositories/pg-messaging.repository.js';
import { MessagingService } from './application/messaging.service.js';
import { MessagingController } from './transport/messaging.controller.js';
import { MessagingGateway } from './transport/messaging.gateway.js';

/**
 * `messaging` — product tier. EPIC-09.
 *
 * Owns `conversations`, `conversation_participants` and `messages`.
 *
 * ITS THREE DEPENDENCIES ARE THE THREE QUESTIONS EVERY SEND ASKS.
 *
 *   `safety`       — is there a block between these two? (BR-025)
 *   `social-graph` — does the recipient follow the sender? (BR-027)
 *   `media`        — may this attachment be served to this viewer? (MSG-FR-008)
 *
 * The first two also need to call BACK into messaging: a block hides
 * conversations, and a follow promotes a pending request. Both of those are
 * inverted through ports and bound in the modules that consume them
 * (`safety/ports/conversation-hiding.port.ts`,
 * `social-graph/ports/request-promotion.port.ts`), so the import graph stays a
 * statement about layering rather than a `forwardRef`. This is the same trade
 * `safety` already made with `social-graph` over follow removal, and made the
 * same way round: the edge consulted on every request stays a plain import, and
 * the one that fires occasionally becomes the port.
 *
 * THE GATEWAY IS REGISTERED HERE, not in `RealtimeModule`. `RealtimeModule`
 * owns the unauthenticated foundation ping, which has to work before a session
 * exists; this gateway authenticates at handshake and re-authorises on every
 * event, and it needs `MessagingService` and `SessionService`. Keeping it
 * beside the service it drives is what makes "REST and realtime share one
 * implementation" (ADR-009) visible rather than merely intended.
 *
 * `IdentityModule` is imported for `SessionService`, which the gateway uses
 * directly — a socket has no HTTP request for the global guard to inspect, so
 * the two authentication points are explicit in the gateway rather than
 * inherited.
 */
@Module({
  imports: [IdentityModule, MediaModule, SafetyModule, SocialGraphModule],
  controllers: [MessagingController],
  providers: [
    PgMessagingRepository,
    { provide: MESSAGING_REPOSITORY, useExisting: PgMessagingRepository },
    MessagingService,
    MessagingGateway,
  ],
  // Exported for EPIC-11 (notifications need `isRequest` to drop push for a
  // Message Request) and EPIC-12 (a reported conversation's excerpt).
  exports: [MessagingService],
})
export class MessagingModule {}
