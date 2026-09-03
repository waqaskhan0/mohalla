import { randomUUID } from 'node:crypto';
import type { SmsMessage, SmsProvider, SmsSendResult } from '../ports/sms-provider.port.js';

/**
 * Deterministic in-memory SMS provider for local development, tests and PUBLIC CI.
 *
 * The addendum forbids any CI test sending a real message, and DEP-002 means no
 * real provider is even selected yet. This adapter sends nothing anywhere: it
 * records what WOULD have been sent so a test can assert on delivery without a
 * network call, a paid request, or a real recipient.
 *
 * Failure is triggered by the RECIPIENT NUMBER rather than by monkey-patching,
 * so retry and dead-job behaviour can be exercised deterministically:
 *
 *   +92300000FAIL-equivalent -> see FAIL_SUFFIX / RETRYABLE_SUFFIX below.
 */
export const FAKE_PERMANENT_FAILURE_SUFFIX = '0000';
export const FAKE_RETRYABLE_FAILURE_SUFFIX = '9999';

export interface RecordedSms {
  to: string;
  body: string;
  correlationId: string | undefined;
  sentAt: Date;
}

export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';

  private readonly sent: RecordedSms[] = [];

  async send(message: SmsMessage): Promise<SmsSendResult> {
    if (message.to.endsWith(FAKE_PERMANENT_FAILURE_SUFFIX)) {
      return { ok: false, retryable: false, reason: 'fake: permanently undeliverable' };
    }
    if (message.to.endsWith(FAKE_RETRYABLE_FAILURE_SUFFIX)) {
      return { ok: false, retryable: true, reason: 'fake: temporary provider error' };
    }

    this.sent.push({
      to: message.to,
      body: message.body,
      correlationId: message.correlationId,
      sentAt: new Date(),
    });
    return { ok: true, providerMessageId: `fake-${randomUUID()}` };
  }

  /** Everything "delivered" so far. Test-only. */
  all(): readonly RecordedSms[] {
    return this.sent;
  }

  /** The most recent message for a recipient, or undefined. Test-only. */
  lastTo(to: string): RecordedSms | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }

  reset(): void {
    this.sent.length = 0;
  }
}
