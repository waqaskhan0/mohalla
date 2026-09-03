import { describe, it, expect, beforeEach } from 'vitest';
import {
  FAKE_PERMANENT_FAILURE_SUFFIX,
  FAKE_RETRYABLE_FAILURE_SUFFIX,
  FakeSmsProvider,
} from './fake-sms-provider.js';

describe('FakeSmsProvider', () => {
  let sms: FakeSmsProvider;
  beforeEach(() => {
    sms = new FakeSmsProvider();
  });

  it('records a message instead of sending one anywhere', async () => {
    const r = await sms.send({ to: '+923001234567', body: 'code 123456', correlationId: 'c1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providerMessageId).toMatch(/^fake-/);

    // Nothing left the process - the addendum forbids real delivery from CI.
    expect(sms.all()).toHaveLength(1);
    expect(sms.lastTo('+923001234567')?.body).toBe('code 123456');
  });

  it('reports a permanent failure deterministically, driven by the number', async () => {
    const r = await sms.send({ to: `+92300123${FAKE_PERMANENT_FAILURE_SUFFIX}`, body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(false); // must NOT be retried forever
    expect(sms.all()).toHaveLength(0);
  });

  it('reports a retryable failure deterministically', async () => {
    const r = await sms.send({ to: `+92300123${FAKE_RETRYABLE_FAILURE_SUFFIX}`, body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });

  it('separates permanent from retryable so job retry logic is testable', async () => {
    const perm = await sms.send({ to: `+92300000${FAKE_PERMANENT_FAILURE_SUFFIX}`, body: 'x' });
    const temp = await sms.send({ to: `+92300000${FAKE_RETRYABLE_FAILURE_SUFFIX}`, body: 'x' });
    expect(perm.ok).toBe(false);
    expect(temp.ok).toBe(false);
    if (!perm.ok && !temp.ok) expect(perm.retryable).not.toBe(temp.retryable);
  });

  it('returns the most recent message for a recipient', async () => {
    await sms.send({ to: '+923001234567', body: 'first' });
    await sms.send({ to: '+923001234567', body: 'second' });
    expect(sms.lastTo('+923001234567')?.body).toBe('second');
    expect(sms.lastTo('+923009999999')).toBeUndefined();
  });

  it('resets between tests', async () => {
    await sms.send({ to: '+923001234567', body: 'x' });
    sms.reset();
    expect(sms.all()).toHaveLength(0);
  });

  it('identifies itself as fake, so a real provider is never assumed', () => {
    expect(sms.name).toBe('fake');
  });
});
