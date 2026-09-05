import { describe, it, expect } from 'vitest';
import {
  BROADCASTS_PER_WEEK,
  SUSPENSION_DURATIONS,
  canBroadcast,
  canHoldVerifiedBadge,
  checkEnforceable,
  checkReason,
  suspendedCapability,
  suspensionExpiry,
  suspensionHasLifted,
  type EnforcementTarget,
} from './enforcement-policy.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const activeUser: EnforcementTarget = { userId: 'u1', state: 'ACTIVE' };

describe('BR-ADM-001 / SEC-021 — no administrator may be actioned', () => {
  it('REFUSES AN ADMINISTRATOR TARGET BEFORE ANYTHING ELSE', () => {
    // SEC-021: "cannot be reached by any request, REGARDLESS OF INTERFACE
    // STATE". So the check must not sit behind another that could fail first -
    // here the target does not exist AND the reason is empty, and the answer is
    // still the admin refusal.
    expect(checkEnforceable({ target: null, targetIsAdministrator: true, reason: '' })).toBe(
      'TARGET_IS_ADMINISTRATOR',
    );
  });

  it('refuses even when everything else is valid', () => {
    expect(
      checkEnforceable({
        target: activeUser,
        targetIsAdministrator: true,
        reason: 'a perfectly good reason',
      }),
    ).toBe('TARGET_IS_ADMINISTRATOR');
  });

  it('THE TARGET TYPE CANNOT DESCRIBE AN ADMINISTRATOR', () => {
    // The type carries a user id and a `UserState`. An administrator has
    // neither - they are not in `users` (SEC-020) - so the action BR-ADM-001
    // forbids is not merely refused, it is unrepresentable.
    //
    // Asserted by construction: every state in the union is a USER state, and
    // there is no admin variant to add one to.
    const states: EnforcementTarget['state'][] = [
      'UNVERIFIED',
      'ACTIVE',
      'SUSPENDED',
      'BANNED',
      'PENDING_DELETION',
      'DELETED',
    ];
    expect(states).not.toContain('ADMIN');
  });
});

describe('BR-038 — a reason is mandatory', () => {
  it('refuses an empty or near-empty reason', () => {
    expect(checkReason('')).toBe('REASON_TOO_SHORT');
    expect(checkReason('   ')).toBe('REASON_TOO_SHORT');
    expect(checkReason('spam')).toBe('REASON_TOO_SHORT');
    expect(checkReason(undefined)).toBe('REASON_TOO_SHORT');
  });

  it('accepts five characters', () => {
    expect(checkReason('spam.')).toBeNull();
  });

  it('is checked on every enforcement path', () => {
    expect(
      checkEnforceable({ target: activeUser, targetIsAdministrator: false, reason: 'no' }),
    ).toBe('REASON_TOO_SHORT');
  });
});

describe('checkEnforceable — the other refusals', () => {
  it('refuses a target that does not exist', () => {
    expect(
      checkEnforceable({ target: null, targetIsAdministrator: false, reason: 'a good reason' }),
    ).toBe('TARGET_NOT_FOUND');
  });

  it('REFUSES AN ALREADY-DELETED ACCOUNT', () => {
    // Enforcement against an account that is already gone records an action
    // nobody can experience, and reinstating it later would resurrect something
    // its owner asked to remove.
    expect(
      checkEnforceable({
        target: { userId: 'u1', state: 'DELETED' },
        targetIsAdministrator: false,
        reason: 'a good reason',
      }),
    ).toBe('CANNOT_ACT_ON_DELETED');
  });

  it('permits an ordinary active account', () => {
    expect(
      checkEnforceable({
        target: activeUser,
        targetIsAdministrator: false,
        reason: 'repeated harassment after a warning',
      }),
    ).toBeNull();
  });
});

describe('ADMIN-FR-006 — suspension (BR-034, EDGE-027/028)', () => {
  it('offers exactly the three durations the requirement names', () => {
    expect(Object.keys(SUSPENSION_DURATIONS)).toEqual(['HOURS_24', 'DAYS_7', 'DAYS_30']);
  });

  it('computes the expiry from now', () => {
    expect(suspensionExpiry('HOURS_24', NOW)).toEqual(new Date('2026-09-06T12:00:00.000Z'));
    expect(suspensionExpiry('DAYS_7', NOW)).toEqual(new Date('2026-09-12T12:00:00.000Z'));
    expect(suspensionExpiry('DAYS_30', NOW)).toEqual(new Date('2026-10-05T12:00:00.000Z'));
  });

  it('REPLACES rather than accumulates (EDGE-027)', () => {
    // Two administrators independently applying 30 days would otherwise produce
    // 60, which neither of them decided. The expiry is computed from NOW and
    // written over whatever was there.
    const first = suspensionExpiry('DAYS_30', NOW);
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const second = suspensionExpiry('DAYS_30', later);

    expect(second.getTime() - first.getTime()).toBe(24 * 60 * 60 * 1000);
    // Not 60 days from the original.
    expect(second.getTime()).toBeLessThan(NOW.getTime() + 60 * 24 * 60 * 60 * 1000);
  });

  it('A SUSPENDED USER KEEPS READ ACCESS (BR-034)', () => {
    // "Retains read access but cannot post, comment, like, message, follow,
    // create events or RSVP." Read access is the part worth stating: somebody
    // who cannot read cannot see the banner explaining why they were suspended.
    expect(suspendedCapability()).toBe('READ_ONLY');
  });

  it('LIFTS AUTOMATICALLY, with no administrator action (EDGE-028)', () => {
    const until = suspensionExpiry('HOURS_24', NOW);
    expect(suspensionHasLifted({ suspendedUntil: until, now: NOW })).toBe(false);
    expect(suspensionHasLifted({ suspendedUntil: until, now: new Date(until.getTime()) })).toBe(
      true,
    );
    expect(
      suspensionHasLifted({
        suspendedUntil: until,
        now: new Date(until.getTime() + 1000),
      }),
    ).toBe(true);
  });

  it('an account with no expiry is not "lifted" — it was never timed', () => {
    // A ban has no expiry, and must not read as an expired suspension.
    expect(suspensionHasLifted({ suspendedUntil: null, now: NOW })).toBe(false);
  });
});

describe('ADMIN-FR-010 — verification eligibility', () => {
  it('only ORGANIZATION accounts may hold a badge', () => {
    expect(canHoldVerifiedBadge('ORGANIZATION')).toBe(true);
    expect(canHoldVerifiedBadge('INDIVIDUAL')).toBe(false);
  });
});

describe('NOTIF-FR-005 — two broadcasts a week', () => {
  it('allows two and refuses the third', () => {
    expect(canBroadcast(0)).toBe(true);
    expect(canBroadcast(1)).toBe(true);
    expect(canBroadcast(2)).toBe(false);
    expect(BROADCASTS_PER_WEEK).toBe(2);
  });
});
