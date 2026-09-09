import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StructuredLogger } from './structured.logger.js';

/**
 * REDACTION IS TESTED AT THE POINT OF WRITE, not at the redactor.
 *
 * `@mohalla/observability` already proves the rules are right. What that cannot
 * prove is that this logger APPLIES them — and the failure mode of forgetting
 * to is invisible: every call site still compiles, every test still passes, and
 * the only symptom is a phone number in somebody else's log aggregator.
 *
 * So these assertions read stdout, which is where the guarantee actually has to
 * hold. NFR-OBS-001: "never with personal data".
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

const lines = () => written.map((l) => JSON.parse(l) as Record<string, unknown>);
const raw = () => written.join('');

describe('nothing on §15.4’s forbidden list reaches stdout', () => {
  it('MASKS A PHONE NUMBER INSIDE A STRINGIFIED MESSAGE', () => {
    // The shape most call sites in this codebase actually use: a JSON string,
    // by which point the structure is gone and only the shape rules can help.
    new StructuredLogger('test').log(
      JSON.stringify({ event: 'otp_sent', to: '+923001234567' }),
      'identity',
    );

    expect(raw()).not.toContain('923001234567');
    expect(raw()).toContain('[REDACTED]');
    // And the diagnostic half survives - a redactor that ate the event name
    // would be one somebody turns off.
    expect(raw()).toContain('otp_sent');
  });

  it('drops a sensitive FIELD when the message is an object', () => {
    new StructuredLogger('test').log({ event: 'login', password: 'synthetic-Passw0rd' });

    expect(raw()).not.toContain('synthetic-Passw0rd');
    expect(raw()).toContain('login');
  });

  it('MASKS THE STACK TRACE, where unanticipated values end up', () => {
    const error = new Error('could not deliver to +923009999999');
    new StructuredLogger('test').error('delivery_failed', error.stack, 'notifications');

    expect(raw()).not.toContain('923009999999');
    // The frames themselves are still there: the point is to diagnose the
    // error, not to lose it.
    expect(String(lines()[0]?.stack)).toContain('structured.logger.spec');
  });

  it('masks an email address wherever it appears', () => {
    new StructuredLogger('test').warn('bounce from neighbour@example.invalid');
    expect(raw()).not.toContain('neighbour@example.invalid');
  });
});

describe('the line stays usable', () => {
  it('LEAVES THE TIMESTAMP ALONE', () => {
    // `time` is set after redaction and never passes through it. A shape rule
    // for dates would have masked this, which is why there is not one.
    new StructuredLogger('test').log('hello');

    expect(String(lines()[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps ordinary diagnostics verbatim', () => {
    new StructuredLogger('test').log('connection reset after 1200ms, attempt 2 of 3');

    expect(lines()[0]?.message).toBe('connection reset after 1200ms, attempt 2 of 3');
  });

  it('still emits one JSON object per line', () => {
    const logger = new StructuredLogger('test');
    logger.log('one');
    logger.warn('two');

    expect(written).toHaveLength(2);
    for (const line of written) {
      expect(line.endsWith('\n')).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('respects the level floor, so redaction never becomes an excuse to log more', () => {
    new StructuredLogger('test', 'warn').log('should not appear');
    expect(written).toHaveLength(0);
  });
});
