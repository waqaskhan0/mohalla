import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StructuredLogger } from './structured.logger.js';

/**
 * THE WORKER REDACTS TOO, and this exists because that is the half most likely
 * to be forgotten.
 *
 * The API's logger is exercised by every request in the smoke suite. The
 * worker's runs in a separate process that nothing watches as closely, handling
 * outbox rows that carry the recipient of a message and the account being
 * erased. A redaction rule that holds in one process and not the other is not a
 * duplicated utility — it is a safety property with a hole in the half nobody
 * looks at.
 */

let written: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  written = [];
  spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  spy.mockRestore();
});

const raw = () => written.join('');

describe('nothing on §15.4’s forbidden list reaches the worker’s stdout', () => {
  it('DROPS A SENSITIVE FIELD BY NAME', () => {
    new StructuredLogger('worker').info({ event: 'push_sent', token: 'synthetic-device-token-x' });

    expect(raw()).not.toContain('synthetic-device-token-x');
    expect(raw()).toContain('push_sent');
  });

  it('MASKS A PHONE NUMBER NESTED IN A JOB PAYLOAD', () => {
    // The shape a job actually logs: a result object with nested detail. The
    // API's logger mostly sees pre-stringified messages; this one sees
    // structures, so the walk matters more here.
    new StructuredLogger('worker').warn({
      event: 'sms_failed',
      result: { provider: 'fake', detail: 'rejected +923001234567' },
    });

    expect(raw()).not.toContain('923001234567');
    expect(raw()).toContain('sms_failed');
  });

  it('leaves the operational fields a heartbeat is made of', () => {
    new StructuredLogger('worker').info({
      event: 'notification_drain',
      jobId: 'job-1',
      claimed: 12,
      processed: 12,
      failed: 0,
    });

    const line = JSON.parse(written[0] ?? '{}') as Record<string, unknown>;
    expect(line.claimed).toBe(12);
    expect(line.jobId).toBe('job-1');
    expect(typeof line.time).toBe('string');
  });

  it('respects the level floor', () => {
    new StructuredLogger('worker', 'warn').debug({ event: 'noise' });
    expect(written).toHaveLength(0);
  });
});
