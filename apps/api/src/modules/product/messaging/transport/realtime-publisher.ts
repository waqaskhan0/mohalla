import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import type { MessageView } from '../application/messaging.service.js';
import type { RealtimePublisher } from '../ports/realtime-publisher.port.js';

/** One room per user id — the same convention the gateway joins on connect. */
const roomFor = (userId: string): string => `user:${userId}`;

/**
 * The `REALTIME_PUBLISHER` adapter (INTEGRATION-009).
 *
 * WHY THIS IS NOT THE GATEWAY ITSELF, which was the obvious first answer.
 *
 * The gateway depends on `MessagingService` — that is its whole job. Making the
 * service depend back on the gateway is a genuine DI cycle, and Nest does not
 * paper over it: the module simply never initialises, and the process exits
 * with an unsettled top-level await rather than an error naming the cycle. That
 * is what happened on the first attempt.
 *
 * `forwardRef` would resolve it and is what this repository consistently
 * refuses — `follow-removal.port.ts`, `conversation-hiding.port.ts` and
 * `request-promotion.port.ts` all invert an edge instead, so the import graph
 * stays a statement about layering.
 *
 * So the dependency is removed rather than deferred. The only thing the
 * fan-out actually needs is the Socket.IO namespace, not the gateway's
 * behaviour — so this holds the namespace and nothing else. The gateway hands
 * it over in `afterInit`, and the arrows run one way:
 *
 *     gateway  →  service        (drives sends)
 *     gateway  →  publisher      (hands over the namespace)
 *     service  →  publisher      (announces a created message)
 *
 * No cycle, no `forwardRef`, and the fan-out is reachable from the one place
 * that knows a row was written.
 */
@Injectable()
export class MessagingRealtimePublisher implements RealtimePublisher {
  private server: Namespace | null = null;

  constructor(private readonly logger: StructuredLogger) {}

  /** Called by the gateway once Socket.IO has built the namespace. */
  attach(server: Namespace): void {
    this.server = server;
  }

  messageCreated(input: {
    message: MessageView;
    senderId: string;
    recipientId: string;
    isRequest: boolean;
    excludeSocketId?: string | undefined;
  }): void {
    // NULL UNTIL THE GATEWAY HAS INITIALISED, and that is a normal state
    // rather than a fault: the API accepts REST traffic before the namespace
    // exists, and a send in that window is still written, still notified
    // through the outbox, and still readable. Realtime is the accelerator.
    if (this.server === null) return;

    try {
      const payload = serialize(input.message);

      // BR-027: the pipeline drops push for a request. The flag rides along so
      // the client can route it to the request area rather than the inbox.
      this.server
        .to(roomFor(input.recipientId))
        .emit('message:new', { ...payload, isRequest: input.isRequest });

      // The sender's OTHER devices, so a message typed on a phone appears on a
      // tablet. `except` rather than the gateway's old `client.broadcast`,
      // because a REST send has no socket of its own — it excludes nothing and
      // reaches every device the sender has.
      const toSender =
        input.excludeSocketId === undefined
          ? this.server.to(roomFor(input.senderId))
          : this.server.to(roomFor(input.senderId)).except(input.excludeSocketId);
      toSender.emit('message:new', { ...payload, isRequest: false });
    } catch {
      // FIRE AND FORGET. The message is committed and readable over REST; a
      // socket problem must not turn a successful send into a failure. No ids
      // in the line — SEC-028.
      this.logger.warn(JSON.stringify({ event: 'realtime_fanout_failed' }), 'messaging');
    }
  }
}

/** The wire shape, unchanged from the gateway's own. */
function serialize(m: MessageView): Record<string, unknown> {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    mediaId: m.mediaId,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  };
}
