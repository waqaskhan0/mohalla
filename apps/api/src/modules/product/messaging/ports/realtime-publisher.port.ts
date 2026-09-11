import type { MessageView } from '../application/messaging.service.js';

/**
 * "This message was just created — tell whoever is listening."
 *
 * WHY THE FAN-OUT MOVED HERE (INTEGRATION-009).
 *
 * It used to live in `MessagingGateway.onSend`, which meant a message reached a
 * connected socket only if the SENDER happened to be on a socket too. Measured:
 * `POST /conversations/{id}/messages` returned 201 while a live, connected
 * recipient received **nothing in five seconds**, and the same message sent
 * over the socket arrived in under one.
 *
 * That is the wrong shape. `12-messaging-notifications.md` says "REST is the
 * source of truth. Realtime is an accelerator" — an accelerator for MESSAGES,
 * not for messages-sent-a-particular-way. Whether the recipient's phone
 * lights up should not depend on which transport the sender's client chose,
 * and it certainly should not depend on it silently.
 *
 * So the fan-out belongs with the WRITE, which is the one place that knows a
 * row was genuinely created. Both transports call the same `send`, so both now
 * accelerate identically and the `created` guard lives in one place.
 *
 * A PORT RATHER THAN AN IMPORT, because the gateway already imports the
 * service. This is the same inversion the module comment describes for
 * `conversation-hiding` and `request-promotion`: the edge that fires
 * occasionally becomes the port, the import graph stays a statement about
 * layering, and nothing reaches for `forwardRef`.
 */
export const REALTIME_PUBLISHER = Symbol.for('mohalla.messaging.realtimePublisher');

export interface RealtimePublisher {
  /**
   * Deliver a newly created message to the recipient and to the sender's other
   * devices.
   *
   * CALLED ONLY WHEN A ROW WAS CREATED, and only after the transaction has
   * committed. A retry that resolved to an existing message must not be
   * delivered twice — EDGE-021 says a duplicate renders once — and a delivery
   * emitted inside the transaction would announce a message that could still
   * roll back.
   *
   * FIRE AND FORGET. Realtime is the accelerator, not the record: a socket
   * failure must never fail a send that is already committed and already
   * readable over REST.
   *
   * @param excludeSocketId the socket that made this request, if any. It
   *   already has the acknowledgement, so echoing to it would render the same
   *   message twice by two routes. A REST send has no socket to exclude.
   */
  messageCreated(input: {
    message: MessageView;
    senderId: string;
    recipientId: string;
    isRequest: boolean;
    excludeSocketId?: string | undefined;
  }): void;
}
