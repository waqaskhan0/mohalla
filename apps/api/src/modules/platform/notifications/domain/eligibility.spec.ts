import { describe, it, expect } from 'vitest';
import { decideEligibility, type EligibilityFacts } from './eligibility.js';
import {
  NOTIFICATION_CATEGORIES,
  PREFERENCE_KEYS,
  pushPreferenceFor,
} from './notification-category.js';
import { LIKE_BATCH_THRESHOLD, planLikeNotification } from './like-batching.js';

const base: EligibilityFacts = {
  recipientId: 'recipient',
  actorId: 'actor',
  category: 'LIKE',
  blockedEitherWay: false,
  isMessageRequest: false,
  pushPreferences: {},
  hasLiveDevice: true,
};

/**
 * ADR-014's eligibility rules, in the order it gives them.
 *
 * THE THING THESE TESTS EXIST TO PROTECT is the split between suppressing the
 * RECORD and suppressing only the PUSH. Both look like "don't notify", and
 * collapsing them into one boolean would satisfy a careless reading of every
 * requirement while breaking NOTIF-FR-001 and NOTIF-FR-007 — whose acceptance
 * criteria are both "no push, but the entry is in the centre".
 */

describe('rule 1 — never notify a user of their own action', () => {
  it('suppresses the record entirely', () => {
    expect(decideEligibility({ ...base, actorId: 'recipient' })).toEqual({
      record: false,
      push: false,
      reason: 'OWN_ACTION',
    });
  });

  it('applies even when everything else would allow it', () => {
    expect(
      decideEligibility({
        ...base,
        actorId: 'recipient',
        pushPreferences: { LIKE: true },
        hasLiveDevice: true,
      }).record,
    ).toBe(false);
  });
});

describe('rule 2 — never notify across a block', () => {
  it('SUPPRESSES THE RECORD, not merely the push', () => {
    // BR-025: neither party sees the other's activity. The notification centre
    // is a surface like any other, so a blocked user's like must not appear
    // there either - which is why this is `record: false` and the preference
    // rule below is not.
    expect(decideEligibility({ ...base, blockedEitherWay: true })).toEqual({
      record: false,
      push: false,
      reason: 'BLOCKED',
    });
  });

  it('beats an explicitly enabled preference', () => {
    expect(
      decideEligibility({
        ...base,
        blockedEitherWay: true,
        pushPreferences: { LIKE: true },
      }).record,
    ).toBe(false);
  });
});

describe('rule 3 — a Message Request produces no push (BR-027, NOTIF-FR-004)', () => {
  it('KEEPS THE RECORD AND DROPS THE PUSH', () => {
    // "GIVEN a message from a non-follower, WHEN it arrives, THEN no push
    // notification is delivered." The record survives because the recipient's
    // REQUEST COUNT still has to update - MSG-FR-005 is built on a stranger's
    // message being quiet, not on it being invisible.
    expect(decideEligibility({ ...base, category: 'MESSAGE', isMessageRequest: true })).toEqual({
      record: true,
      push: false,
      reason: 'MESSAGE_REQUEST',
    });
  });

  it('is still outranked by a block', () => {
    expect(
      decideEligibility({
        ...base,
        category: 'MESSAGE',
        isMessageRequest: true,
        blockedEitherWay: true,
      }).record,
    ).toBe(false);
  });
});

describe('rule 4 — preferences gate PUSH ONLY (NOTIF-FR-007, SET-FR-007)', () => {
  it('KEEPS THE RECORD when the category is disabled (AC)', () => {
    // "GIVEN like notifications are disabled, WHEN a like occurs, THEN no push
    // is sent BUT the entry appears in the in-app centre."
    expect(decideEligibility({ ...base, pushPreferences: { LIKE: false } })).toEqual({
      record: true,
      push: false,
      reason: 'PREFERENCE_OFF',
    });
  });

  it('treats an ABSENT preference as enabled', () => {
    // Defaulting to off would silently disable the product's main retention
    // mechanism for every user who never opens settings.
    expect(decideEligibility({ ...base, pushPreferences: {} }).push).toBe(true);
  });

  it('gates a REPLY on the COMMENT switch', () => {
    // Somebody who muted comment notifications wants the thread to stop
    // buzzing, and a reply is part of that thread. Honouring the letter of the
    // setting while still sending replies would be defensible and obviously
    // wrong.
    expect(pushPreferenceFor('REPLY')).toBe('COMMENT');
    expect(
      decideEligibility({ ...base, category: 'REPLY', pushPreferences: { COMMENT: false } }).push,
    ).toBe(false);
  });

  it('every category maps to one of the seven switches', () => {
    // NOTIF-FR-007 offers seven; NOTIF-FR-003 lists eight events. A category
    // with no switch would be a notification nobody can turn off.
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(PREFERENCE_KEYS).toContain(pushPreferenceFor(category));
    }
  });
});

describe('no device — NOTIF-FR-001 is the whole point', () => {
  it('KEEPS THE RECORD for a user who declined push (AC)', () => {
    // "GIVEN a user who denied the push permission, WHEN someone comments on
    // their post, THEN the notification is present in the in-app centre."
    expect(decideEligibility({ ...base, hasLiveDevice: false })).toEqual({
      record: true,
      push: false,
      reason: 'NO_DEVICE',
    });
  });
});

describe('the split itself', () => {
  it('only OWN_ACTION, BLOCKED and NO_RECIPIENT ever suppress the record', () => {
    // Asserted across the whole matrix, because the failure this guards
    // against is a future rule being added to the wrong half. Everything else
    // costs the buzz and never the record.
    const recordSuppressing = new Set<string>();

    for (const actorId of ['actor', 'recipient']) {
      for (const blockedEitherWay of [true, false]) {
        for (const isMessageRequest of [true, false]) {
          for (const pref of [true, false]) {
            for (const hasLiveDevice of [true, false]) {
              for (const category of NOTIFICATION_CATEGORIES) {
                const d = decideEligibility({
                  recipientId: 'recipient',
                  actorId,
                  category,
                  blockedEitherWay,
                  isMessageRequest,
                  pushPreferences: { [pushPreferenceFor(category)]: pref },
                  hasLiveDevice,
                });
                if (!d.record) recordSuppressing.add(d.reason);
              }
            }
          }
        }
      }
    }

    expect([...recordSuppressing].sort()).toEqual(['BLOCKED', 'OWN_ACTION']);
  });

  it('a push is never sent without a record', () => {
    for (const blockedEitherWay of [true, false]) {
      for (const isMessageRequest of [true, false]) {
        const d = decideEligibility({ ...base, blockedEitherWay, isMessageRequest });
        if (d.push) expect(d.record).toBe(true);
      }
    }
  });

  it('refuses a notification with no recipient', () => {
    expect(decideEligibility({ ...base, recipientId: null })).toEqual({
      record: false,
      push: false,
      reason: 'NO_RECIPIENT',
    });
  });
});

describe('like batching (NOTIF-FR-003)', () => {
  it('sends individual notifications up to the threshold', () => {
    for (let n = 0; n < LIKE_BATCH_THRESHOLD; n += 1) {
      expect(planLikeNotification({ likesInWindow: n, summaryExists: false })).toEqual({
        kind: 'INDIVIDUAL',
      });
    }
  });

  it('SUMMARISES FROM THE SIXTH LIKE', () => {
    expect(
      planLikeNotification({ likesInWindow: LIKE_BATCH_THRESHOLD, summaryExists: false }),
    ).toEqual({ kind: 'START_SUMMARY', total: 6 });
  });

  it('EXTENDS an existing summary rather than adding rows', () => {
    expect(planLikeNotification({ likesInWindow: 11, summaryExists: true })).toEqual({
      kind: 'EXTEND_SUMMARY',
      total: 12,
    });
  });

  it('TWELVE LIKES IN AN HOUR PRODUCE A SUMMARY, NOT TWELVE ALERTS (AC)', () => {
    // The acceptance criterion, played through: five individual notifications,
    // then one summary that absorbs the rest.
    let individual = 0;
    let summaries = 0;
    let summaryExists = false;
    let likesInWindow = 0;

    for (let like = 1; like <= 12; like += 1) {
      const plan = planLikeNotification({ likesInWindow, summaryExists });
      if (plan.kind === 'INDIVIDUAL') {
        individual += 1;
        likesInWindow += 1;
      } else if (plan.kind === 'START_SUMMARY') {
        summaries += 1;
        summaryExists = true;
        likesInWindow = plan.total;
      } else {
        likesInWindow = plan.total;
      }
    }

    expect(individual).toBe(5);
    expect(summaries).toBe(1);
    expect(likesInWindow).toBe(12);
    // Six alerts rather than twelve - and only ONE of them after the fifth.
    expect(individual + summaries).toBe(6);
  });
});
