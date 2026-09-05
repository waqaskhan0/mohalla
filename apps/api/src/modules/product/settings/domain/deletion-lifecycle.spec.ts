import { describe, it, expect } from 'vitest';
import {
  DELETION_CONSEQUENCE_KEYS,
  DELETION_GRACE_DAYS,
  canRequestDeletion,
  canRestore,
  erasureDueAt,
  isDueForErasure,
} from './deletion-lifecycle.js';

const REQUESTED = new Date('2026-09-05T12:00:00.000Z');
const DUE = erasureDueAt(REQUESTED);

describe('who may delete (BR-008)', () => {
  it('LETS A SUSPENDED USER LEAVE', () => {
    // The clause worth a test of its own: "in any state except
    // already-deleted, INCLUDING WHILE SUSPENDED". An account that cannot
    // leave while it is being punished is a hostage.
    expect(canRequestDeletion('SUSPENDED')).toBeNull();
  });

  it('lets a banned user leave too', () => {
    // A banned account has already lost the product. Keeping their data
    // because they misbehaved would be retention for the platform's
    // convenience rather than for any stated purpose.
    expect(canRequestDeletion('BANNED')).toBeNull();
  });

  it('lets an unverified and an active user leave', () => {
    expect(canRequestDeletion('ACTIVE')).toBeNull();
    expect(canRequestDeletion('UNVERIFIED')).toBeNull();
  });

  it('refuses an account that is already gone', () => {
    expect(canRequestDeletion('DELETED')).toBe('ALREADY_DELETED');
  });

  it('refuses a second request while one is open', () => {
    // Not a failure so much as a fact: somebody who taps twice should learn
    // their account IS being deleted, not that something broke.
    expect(canRequestDeletion('PENDING_DELETION')).toBe('ALREADY_PENDING');
  });
});

describe('the grace period (SET-FR-005 · S2-CR-004)', () => {
  it('is thirty days from the request', () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(DUE.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('restores on day 29', () => {
    const now = new Date(REQUESTED.getTime() + 29 * 24 * 60 * 60 * 1000);
    expect(canRestore({ scheduledErasureAt: DUE, restoredAt: null, completedAt: null, now })).toBe(
      true,
    );
    expect(
      isDueForErasure({ scheduledErasureAt: DUE, restoredAt: null, completedAt: null, now }),
    ).toBe(false);
  });

  it('RESTORE AND ERASURE ARE EXACTLY COMPLEMENTARY AT EVERY INSTANT', () => {
    // The two predicates drive opposite, irreversible outcomes, so an instant
    // where both are true would be a race the domain invited, and an instant
    // where neither is would be an account stuck forever in PENDING_DELETION.
    for (const offsetHours of [0, 1, 24, 29 * 24, 30 * 24 - 1, 30 * 24, 30 * 24 + 1, 400 * 24]) {
      const now = new Date(REQUESTED.getTime() + offsetHours * 60 * 60 * 1000);
      const facts = { scheduledErasureAt: DUE, restoredAt: null, completedAt: null, now };
      expect(canRestore(facts)).toBe(!isDueForErasure(facts));
    }
  });

  it('closes AT the boundary, not after it — "exactly 30 days"', () => {
    const facts = { scheduledErasureAt: DUE, restoredAt: null, completedAt: null, now: DUE };
    expect(canRestore(facts)).toBe(false);
    expect(isDueForErasure(facts)).toBe(true);
  });

  it('refuses to restore what has already been erased, whatever the clock says', () => {
    // Belt and braces against a clock that runs backwards: an erased account
    // is terminal, and the date is not what makes it so.
    const now = new Date(REQUESTED.getTime() + 60 * 1000);
    expect(canRestore({ scheduledErasureAt: DUE, restoredAt: null, completedAt: now, now })).toBe(
      false,
    );
  });

  it('refuses to erase what has already been restored, whatever the clock says', () => {
    const now = new Date(DUE.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isDueForErasure({ scheduledErasureAt: DUE, restoredAt: REQUESTED, completedAt: null, now }),
    ).toBe(false);
  });

  it('does not restore twice', () => {
    const now = new Date(REQUESTED.getTime() + 60 * 1000);
    expect(canRestore({ scheduledErasureAt: DUE, restoredAt: now, completedAt: null, now })).toBe(
      false,
    );
  });
});

describe('what the user is told before confirming (PRIV-006)', () => {
  it('PUTS THE SURPRISING CONSEQUENCE SECOND, WHERE IT IS READ', () => {
    // PRIV-006: posts remain, anonymised, and users "must be told this clearly
    // before confirming, because it differs from the erasure many will
    // assume". Last in a list is where a line goes to be skipped.
    expect(DELETION_CONSEQUENCE_KEYS[1]).toBe('deletion.consequence.postsRemainAnonymised');
  });

  it('names the retention that surprises people and the finality that follows', () => {
    expect(DELETION_CONSEQUENCE_KEYS).toContain(
      'deletion.consequence.messagesRemainForTheOtherPerson',
    );
    expect(DELETION_CONSEQUENCE_KEYS).toContain('deletion.consequence.restorableForThirtyDays');
    expect(DELETION_CONSEQUENCE_KEYS).toContain('deletion.consequence.permanentAfterThirtyDays');
  });

  it('has no duplicates, so no consequence is stated twice and none crowds another out', () => {
    expect(new Set(DELETION_CONSEQUENCE_KEYS).size).toBe(DELETION_CONSEQUENCE_KEYS.length);
  });
});
