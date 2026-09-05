/**
 * Push delivery port (DEP-003 · ADR-014).
 *
 * DEP-003 names the push service as an EXTERNAL dependency with a technical
 * owner still to be assigned, and states the consequence plainly: without it
 * "NOTIF-FR-001 fails. Retention collapses — push is the mechanism that brings
 * users back."
 *
 * Until a real FCM project exists, everything runs against the deterministic
 * fake — the same arrangement DEP-002 forced for SMS. Stage 6's boundary
 * forbids sending a real notification to a real device, so the fake is not a
 * placeholder to be tidied away later: it is what CI must keep using.
 *
 * THE PORT CARRIES A RENDERED MESSAGE, never a template key or a category. The
 * adapter has no business knowing what a notification is about, and keeping the
 * shape this narrow is what stops delivery code growing product rules.
 */
export const PUSH_SENDER = Symbol.for('mohalla.notifications.pushSender');

export interface PushMessage {
  /** The device registration token. Opaque, and never logged. */
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /**
   * Where tapping it should land — a deep link path, not a URL.
   *
   * ADR-014: "push payloads carry the minimum needed for the deep link." The
   * body already appears on a lock screen (NOTIF-FR-004's accepted residual
   * risk); adding anything else to the payload would widen that exposure for
   * no gain.
   */
  readonly deepLink: string;
  readonly correlationId?: string | undefined;
}

export type PushSendResult =
  | { ok: true; providerMessageId: string }
  /**
   * `tokenInvalid` is separate from `retryable` on purpose.
   *
   * ADR-014 requires invalid tokens to be REMOVED when FCM reports them —
   * an uninstalled app produces a permanent failure, and retrying it forever
   * would fill the dead-letter queue with devices that no longer exist.
   */
  | { ok: false; retryable: boolean; tokenInvalid: boolean; reason: string };

export interface PushSender {
  readonly name: string;
  send(message: PushMessage): Promise<PushSendResult>;
}
