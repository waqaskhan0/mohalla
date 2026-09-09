/**
 * SMS delivery port.
 *
 * DEP-002 - the real provider is selected only after Pakistani network coverage
 * testing, and OD-021 Option C made that the single most important external
 * dependency in the project: removing email registration removed the fallback
 * that RSK-007 relied on. Until a provider exists, everything runs against the
 * deterministic fake.
 *
 * The port carries a MESSAGE, never an OTP-specific shape, so the adapter layer
 * never learns what a code means.
 */
export const SMS_PROVIDER = Symbol.for('mohalla.identity.smsProvider');

export interface SmsMessage {
  /** Canonical E.164. Normalize BEFORE calling - adapters do not normalize. */
  readonly to: string;
  readonly body: string;
  /**
   * Ties delivery back to the request that caused it.
   *
   * Explicitly `| undefined` because `exactOptionalPropertyTypes` is enabled:
   * the caller genuinely may pass an absent correlation id, and the port should
   * say so rather than the strictness being relaxed to hide it.
   */
  readonly correlationId?: string | undefined;
}

export type SmsSendResult =
  | { ok: true; providerMessageId: string }
  /**
   * Delivery failed. `retryable` drives the job's retry decision; a permanently
   * invalid number must not be retried forever.
   */
  | { ok: false; retryable: boolean; reason: string };

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}
