import { randomUUID } from 'node:crypto';
import type { PushMessage, PushSendResult, PushSender } from '../ports/push-sender.port.js';

/**
 * Deterministic in-memory push sender for local development, tests and PUBLIC CI.
 *
 * The security addendum forbids any CI test sending a real notification to a
 * real user, and DEP-003 means no FCM project is even provisioned yet. This
 * adapter delivers nothing: it records what WOULD have been sent, so a test can
 * assert on delivery — and, more importantly here, on NON-delivery — without a
 * network call or a real device.
 *
 * ASSERTING ABSENCE IS MOST OF WHAT THIS EPIC NEEDS. NOTIF-FR-004's criterion is
 * "no push notification is delivered"; NOTIF-FR-007's is "no push is sent but
 * the entry appears in the in-app centre"; NOTIF-FR-006's is "no reminder is
 * sent". A real provider makes those tests impossible to write honestly.
 *
 * Failure is triggered by the TOKEN, not by monkey-patching, so retry and
 * token-invalidation behaviour can be exercised deterministically. The
 * token-invalid case matters: ADR-014 requires such tokens to be removed rather
 * than retried, and that path needs a way to fire in a test.
 */
export const FAKE_PUSH_INVALID_TOKEN_SUFFIX = '-invalid';
export const FAKE_PUSH_RETRYABLE_SUFFIX = '-flaky';

export interface RecordedPush {
  token: string;
  title: string;
  body: string;
  deepLink: string;
  correlationId: string | undefined;
  sentAt: Date;
}

export class FakePushSender implements PushSender {
  readonly name = 'fake';

  private readonly sent: RecordedPush[] = [];

  async send(message: PushMessage): Promise<PushSendResult> {
    if (message.token.endsWith(FAKE_PUSH_INVALID_TOKEN_SUFFIX)) {
      return {
        ok: false,
        retryable: false,
        tokenInvalid: true,
        reason: 'fake: registration token is no longer valid',
      };
    }
    if (message.token.endsWith(FAKE_PUSH_RETRYABLE_SUFFIX)) {
      return {
        ok: false,
        retryable: true,
        tokenInvalid: false,
        reason: 'fake: temporary provider error',
      };
    }

    this.sent.push({
      token: message.token,
      title: message.title,
      body: message.body,
      deepLink: message.deepLink,
      correlationId: message.correlationId,
      sentAt: new Date(),
    });
    return { ok: true, providerMessageId: `fake-${randomUUID()}` };
  }

  /** Everything "delivered" so far. Test-only. */
  all(): readonly RecordedPush[] {
    return this.sent;
  }

  /** Every push aimed at a token. Test-only. */
  to(token: string): RecordedPush[] {
    return this.sent.filter((m) => m.token === token);
  }

  reset(): void {
    this.sent.length = 0;
  }
}
