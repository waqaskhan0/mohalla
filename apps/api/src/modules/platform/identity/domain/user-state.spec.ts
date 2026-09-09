import { describe, it, expect } from 'vitest';
import {
  authOutcomeFor,
  canTransition,
  canWrite,
  isPubliclyVisible,
  transitionRevokesSessions,
  type UserState,
} from './user-state.js';

describe('authOutcomeFor', () => {
  it('allows an active account', () => {
    expect(authOutcomeFor('ACTIVE', null)).toEqual({ kind: 'ALLOW' });
  });

  it('gives a suspended account READ-ONLY access (BR-034)', () => {
    const until = new Date();
    expect(authOutcomeFor('SUSPENDED', until)).toEqual({ kind: 'READ_ONLY', until });
  });

  it('lets a pending-deletion account in only to restore', () => {
    expect(authOutcomeFor('PENDING_DELETION', null)).toEqual({ kind: 'RESTORE_ONLY' });
  });

  it('sends an unverified account back to OTP verification', () => {
    expect(authOutcomeFor('UNVERIFIED', null)).toEqual({ kind: 'VERIFY_REQUIRED' });
  });

  it.each<UserState>(['BANNED', 'DELETED'])(
    'denies %s with the SAME neutral outcome, so it cannot be used as an oracle (SEC-006)',
    (state) => {
      expect(authOutcomeFor(state, null)).toEqual({ kind: 'DENY_NEUTRAL' });
    },
  );

  it('makes banned and deleted indistinguishable from each other', () => {
    expect(authOutcomeFor('BANNED', null)).toEqual(authOutcomeFor('DELETED', null));
  });
});

describe('canWrite', () => {
  it('permits only ACTIVE', () => {
    expect(canWrite('ACTIVE')).toBe(true);
    for (const s of ['UNVERIFIED', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED'] as const) {
      expect(canWrite(s)).toBe(false);
    }
  });
});

describe('isPubliclyVisible', () => {
  it('keeps a suspended profile visible but hides banned and deleted', () => {
    expect(isPubliclyVisible('ACTIVE')).toBe(true);
    expect(isPubliclyVisible('SUSPENDED')).toBe(true);
    expect(isPubliclyVisible('BANNED')).toBe(false);
    expect(isPubliclyVisible('DELETED')).toBe(false);
    expect(isPubliclyVisible('PENDING_DELETION')).toBe(false);
  });
});

describe('canTransition', () => {
  it('permits the approved lifecycle moves', () => {
    expect(canTransition('UNVERIFIED', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'PENDING_DELETION')).toBe(true);
    expect(canTransition('PENDING_DELETION', 'ACTIVE')).toBe(true); // grace-period restore
    expect(canTransition('PENDING_DELETION', 'DELETED')).toBe(true);
  });

  it('treats DELETED as terminal', () => {
    for (const s of ['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'UNVERIFIED'] as const) {
      expect(canTransition('DELETED', s)).toBe(false);
    }
  });

  it('does not allow an unverified account to be suspended or banned directly', () => {
    expect(canTransition('UNVERIFIED', 'SUSPENDED')).toBe(false);
    expect(canTransition('UNVERIFIED', 'BANNED')).toBe(false);
  });
});

describe('transitionRevokesSessions (SEC-005)', () => {
  it.each(['SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED'] as const)(
    'revokes every session on transition to %s',
    (to) => {
      expect(transitionRevokesSessions(to)).toBe(true);
    },
  );

  it('does not revoke on reinstatement to ACTIVE', () => {
    expect(transitionRevokesSessions('ACTIVE')).toBe(false);
  });
});
