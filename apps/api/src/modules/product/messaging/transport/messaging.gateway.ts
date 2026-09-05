import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import {
  SessionService,
  type AuthenticatedPrincipal,
} from '../../../platform/identity/application/session.service.js';
import { MessagingService, type MessageView } from '../application/messaging.service.js';
import { MESSAGE_BODY_MAX_LENGTH } from '../domain/message-body.js';

const sendEvent = z
  .object({
    conversationId: z.string().uuid().optional(),
    recipientId: z.string().uuid().optional(),
    clientMessageId: z.string().uuid(),
    body: z
      .string()
      .max(MESSAGE_BODY_MAX_LENGTH * 4)
      .nullish(),
    mediaId: z.string().uuid().nullish(),
  })
  .strict();

const conversationEvent = z.object({ conversationId: z.string().uuid() }).strict();

/** One room per user id. Multiple devices join the same room (ADR-009). */
const roomFor = (userId: string): string => `user:${userId}`;

/**
 * Realtime messaging (ADR-009 · MSG-FR-004 · NFR-PERF-007 · BR-035).
 *
 * REST IS THE SOURCE OF TRUTH AND THIS IS AN ACCELERATOR. Every handler here
 * calls the same `MessagingService` the controller calls, so there is no second
 * implementation of any rule — the block check, the request logic, the
 * idempotency and the read-receipt suppression are the ones already written and
 * tested, reached through a different door. A client with the socket switched
 * off loses latency and nothing else.
 *
 * TWO AUTHENTICATION POINTS, AND BOTH ARE REQUIRED.
 *
 * ADR-009's security note names the classic WebSocket bypass: connect is
 * checked and messages are not, so a socket opened with a valid session keeps
 * working after that session is revoked. A revoked session has to stop working
 * mid-stream (BR-035), and a long-lived connection is exactly where "revoked"
 * and "still connected" can diverge for hours.
 *
 *   1. HANDSHAKE — an invalid or missing token is refused before a connection
 *      exists at all. This lives in Socket.IO MIDDLEWARE rather than in
 *      `handleConnection`, and the difference is not cosmetic: NestJS calls
 *      `handleConnection` AFTER the socket has connected, so an anonymous
 *      client there gets a `connect` event and only then a disconnect. It had
 *      a live connection, however briefly. Middleware rejects during the
 *      handshake, so the client sees `connect_error` and the connection is
 *      never established. The smoke test caught this: it reported an
 *      unauthenticated socket as `connected`, which was accurate.
 *   2. EVERY EVENT — the token is re-resolved before the handler runs, and a
 *      session that has since been revoked, expired, banned or suspended is
 *      disconnected there and then.
 *
 * The second costs a session lookup per event. That is the same lookup every
 * REST request already pays, and the alternative is a socket whose authority is
 * frozen at connect time.
 *
 * A SEPARATE NAMESPACE from the foundation ping, which is deliberately
 * unauthenticated and carries no data. Sharing one namespace would mean either
 * authenticating the ping (breaking the transport probe that has to work before
 * a session exists) or leaving this one open.
 */
@WebSocketGateway({
  namespace: 'messaging',
  path: process.env.SOCKET_IO_PATH ?? '/realtime',
  cors: {
    origin: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
})
export class MessagingGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly sessions: SessionService,
    private readonly messaging: MessagingService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Authentication point 1 — the handshake.
   *
   * Registered as namespace middleware so an unauthenticated client is turned
   * away DURING the handshake and never holds a connection. Calling `next` with
   * an error is what makes the client see `connect_error` instead of `connect`.
   *
   * One message for missing, malformed, unknown, expired and revoked, matching
   * the REST guard: which one it was is not information the caller is owed.
   */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.principalOf(socket).then((principal) => {
        if (principal === null) {
          next(new Error('AUTHENTICATION_REQUIRED'));
          return;
        }
        next();
      }, next);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    // Reached only for a socket the middleware admitted. Re-resolved rather
    // than carried over from the handshake, because a session can be revoked
    // between the two and this is the first point at which the socket joins a
    // room that will receive other people's messages.
    const principal = await this.principalOf(client);
    if (principal === null) {
      client.disconnect(true);
      return;
    }

    await client.join(roomFor(principal.userId));
    this.logger.debug(JSON.stringify({ event: 'messaging_socket_connected' }), 'messaging');
  }

  /**
   * Send a message over the socket (MSG-FR-002/004).
   *
   * The SAME service call the REST route makes, carrying the SAME
   * client-generated id — which is what makes ADR-009 step 6 true: "the polling
   * fallback reuses the identical id, so switching transport cannot duplicate".
   * A client that gives up on the socket mid-send and retries over REST gets
   * the original message back, not a second one.
   */
  @SubscribeMessage('message:send')
  async onSend(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; message: MessageView } | { ok: false; error: string }> {
    const principal = await this.reauthorize(client);
    if (principal === null) return { ok: false, error: 'AUTHENTICATION_REQUIRED' };

    const parsed = sendEvent.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

    const result = await this.messaging.send(principal.userId, {
      conversationId: parsed.data.conversationId,
      recipientId: parsed.data.recipientId,
      clientMessageId: parsed.data.clientMessageId,
      body: parsed.data.body ?? null,
      mediaId: parsed.data.mediaId ?? null,
    });

    if (result.status !== 'SENT') return { ok: false, error: result.status };

    // Fan out only when this call actually created the message. A retry that
    // resolved to an existing row must not deliver it a second time — EDGE-021
    // says a duplicate renders once, and the cheapest way to honour that is not
    // to send the duplicate.
    if (result.created) {
      this.server.to(roomFor(result.recipientId)).emit('message:new', {
        ...serialize(result.message),
        // BR-027: the notification pipeline drops push for a request. The flag
        // rides along so the client can also route it to the request area
        // rather than the inbox.
        isRequest: result.isRequest,
      });
      // Back to the sender's OTHER devices, so a message typed on a phone
      // appears on a tablet. Not to the originating socket - it already has the
      // acknowledgement, and echoing would make the same message arrive twice
      // by two routes.
      client.broadcast.to(roomFor(principal.userId)).emit('message:new', {
        ...serialize(result.message),
        isRequest: false,
      });
    }

    return { ok: true, message: result.message };
  }

  /**
   * Mark read, and tell the sender — unless the thread is a request.
   *
   * MSG-FR-009's acceptance criterion is the negative case, and it is enforced
   * where it cannot be forgotten: the service returns WHO may be told, and for
   * a Message Request that is nobody. This handler has no rule of its own to
   * remember - with no address, there is nothing it could emit.
   */
  @SubscribeMessage('message:read')
  async onRead(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const principal = await this.reauthorize(client);
    if (principal === null) return { ok: false };

    const parsed = conversationEvent.safeParse(body);
    if (!parsed.success) return { ok: false };

    const result = await this.messaging.markRead(principal.userId, parsed.data.conversationId);
    if (result.status !== 'DONE') return { ok: false };

    // `notify` is null whenever a receipt must not be emitted - a Message
    // Request, a declined thread, or nothing new to report. The rule lives in
    // the service, so this handler cannot leak a receipt by forgetting it;
    // there is simply no address to send one to.
    if (result.notify !== null) {
      this.server.to(roomFor(result.notify.userId)).emit('message:read', {
        conversationId: parsed.data.conversationId,
        readAt: result.notify.readAt.toISOString(),
      });
    }

    return { ok: true };
  }

  /**
   * Reconcile after a reconnect (MSG-FR-004 E1).
   *
   * The client sends the server timestamp of the last message it holds and gets
   * everything after it. "Without gaps or duplicates": no gaps because the
   * server timestamp is total order, no duplicates because the boundary is
   * strict — and harmless even if it were not, because every message carries
   * its client id.
   */
  @SubscribeMessage('conversation:since')
  async onSince(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; messages: MessageView[] } | { ok: false }> {
    const principal = await this.reauthorize(client);
    if (principal === null) return { ok: false };

    const parsed = conversationEvent.extend({ since: z.string().datetime() }).safeParse(body);
    if (!parsed.success) return { ok: false };

    const messages = await this.messaging.listMessagesSince(
      principal.userId,
      parsed.data.conversationId,
      new Date(parsed.data.since),
    );
    if (messages === null) return { ok: false };
    return { ok: true, messages };
  }

  // ---------------------------------------------------------------- internals
  /**
   * Re-resolve the session, and disconnect if it no longer holds.
   *
   * This is authentication point 2. It runs before every handler body, and it
   * DISCONNECTS rather than merely refusing — BR-035 says a revoked session
   * stops working, and leaving the socket up would let a client keep trying.
   */
  private async reauthorize(client: Socket): Promise<AuthenticatedPrincipal | null> {
    const principal = await this.principalOf(client);
    if (principal === null) {
      this.logger.debug(
        JSON.stringify({ event: 'messaging_socket_revoked_mid_stream' }),
        'messaging',
      );
      client.disconnect(true);
      return null;
    }
    // Suspended and pending-deletion accounts may READ but not write (BR-034).
    // The service enforces object access; capability is this layer's job, the
    // same way `@RequiresWrite()` is on the REST side.
    return principal;
  }

  private async principalOf(client: Socket): Promise<AuthenticatedPrincipal | null> {
    const token = tokenFrom(client);
    if (token === null) return null;
    const result = await this.sessions.resolve(token);
    return result.status === 'AUTHENTICATED' ? result.principal : null;
  }
}

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

/**
 * Read the session token from the handshake.
 *
 * `auth` first, which is where socket.io-client puts credentials and where they
 * do not end up in a URL. The `Authorization` header is accepted too, for
 * parity with REST. A QUERY STRING IS NOT ACCEPTED, for the same reason the
 * REST guard refuses one: tokens in a query string end up in access logs,
 * browser history and referrer headers.
 */
function tokenFrom(client: Socket): string | null {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.length > 0) return auth.token;

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer (.+)$/i.exec(header.trim());
    const token = match?.[1];
    if (token !== undefined && token.length > 0) return token;
  }
  return null;
}
