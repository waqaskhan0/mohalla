import { describe, it, expect } from 'vitest';
import {
  MAX_NEW_REQUESTS_PER_DAY,
  countsAgainstRequestQuota,
  initialRecipientState,
  promotesOnFollow,
  pushAllowedToRecipient,
  receiptsVisibleToSender,
  type RequestState,
} from './request-policy.js';

const STATES: RequestState[] = ['ACCEPTED', 'PENDING', 'DECLINED'];

/**
 * MSG-FR-005 / BR-027 / BR-028 — the rules behind Message Requests.
 *
 * Most of these assert an ABSENCE, which is unusual enough to say why. The
 * feature is defined by what does not happen: no push, no read receipt, no
 * signal on decline. A test that only checked the happy path would pass against
 * an implementation that told the sender everything.
 */

describe('initialRecipientState (BR-027)', () => {
  it('a non-follower starts as a request', () => {
    expect(initialRecipientState({ recipientFollowsSender: false })).toBe('PENDING');
  });

  it('someone the recipient already follows goes straight to the inbox', () => {
    expect(initialRecipientState({ recipientFollowsSender: true })).toBe('ACCEPTED');
  });

  it('THE TEST IS THE RECIPIENT FOLLOWING THE SENDER, not the reverse', () => {
    // Stated as its own test because getting it backwards is the whole failure:
    // anyone could bypass the request area by following their target first,
    // which is exactly what unwanted contact would do. The function takes only
    // that one fact, so there is nothing else it could be reading.
    expect(initialRecipientState({ recipientFollowsSender: false })).toBe('PENDING');
  });
});

describe('receiptsVisibleToSender (MSG-FR-009)', () => {
  it('an accepted conversation shows read receipts', () => {
    expect(receiptsVisibleToSender('ACCEPTED')).toBe(true);
  });

  it('A REQUEST NEVER DOES — reading a stranger signals nothing', () => {
    // "GIVEN a message in Message Requests, WHEN the recipient opens it, THEN
    // the sender does not see a read state."
    expect(receiptsVisibleToSender('PENDING')).toBe(false);
  });

  it('and a DECLINED thread does not either', () => {
    // A declined sender learning their message was read would tell them a
    // person is there and did read it - the signal BR-028 exists to withhold.
    expect(receiptsVisibleToSender('DECLINED')).toBe(false);
  });
});

describe('pushAllowedToRecipient (BR-027, NOTIF-FR-004)', () => {
  it('NEVER PUSHES FOR A REQUEST', () => {
    // NOTIF-FR-004's own criterion: "GIVEN a message from a non-follower, WHEN
    // it arrives, THEN no push notification is delivered." A push is a contact;
    // if a stranger's message buzzes the phone, the request area has failed at
    // the only moment that mattered.
    expect(pushAllowedToRecipient('PENDING')).toBe(false);
    expect(pushAllowedToRecipient('DECLINED')).toBe(false);
  });

  it('pushes for an accepted conversation', () => {
    expect(pushAllowedToRecipient('ACCEPTED')).toBe(true);
  });

  it('agrees with the read-receipt rule for every state', () => {
    // The two rules answer the same question about the same fact. If they ever
    // disagree, one of them has been changed without the other - which is the
    // reason they live in one file.
    for (const s of STATES) {
      expect(pushAllowedToRecipient(s)).toBe(receiptsVisibleToSender(s));
    }
  });
});

describe('countsAgainstRequestQuota (MSG-FR-005 E3)', () => {
  it('a genuinely new request counts', () => {
    expect(
      countsAgainstRequestQuota({ conversationExisted: false, recipientState: 'PENDING' }),
    ).toBe(true);
  });

  it('continuing an existing thread does not', () => {
    expect(
      countsAgainstRequestQuota({ conversationExisted: true, recipientState: 'PENDING' }),
    ).toBe(false);
  });

  it('a message into a DECLINED thread raises no new request', () => {
    // MSG-FR-005 A1: "further messages from that sender go to the same
    // suppressed state rather than generating new requests".
    expect(
      countsAgainstRequestQuota({ conversationExisted: true, recipientState: 'DECLINED' }),
    ).toBe(false);
  });

  it('messaging a follower is not a request at all', () => {
    expect(
      countsAgainstRequestQuota({ conversationExisted: false, recipientState: 'ACCEPTED' }),
    ).toBe(false);
  });

  it('the limit is generous, because a false positive silences a neighbour', () => {
    expect(MAX_NEW_REQUESTS_PER_DAY).toBe(10);
  });
});

describe('promotesOnFollow (MSG-FR-005 A3)', () => {
  it('promotes a pending request', () => {
    expect(promotesOnFollow('PENDING')).toBe(true);
  });

  it('DOES NOT REVIVE A DECLINED ONE', () => {
    // A decline was a decision too. A follow is a statement about wanting to
    // see someone's posts, and reading it as "undo my decline" would put a
    // message back in front of somebody who removed it.
    expect(promotesOnFollow('DECLINED')).toBe(false);
  });

  it('leaves an accepted thread alone', () => {
    expect(promotesOnFollow('ACCEPTED')).toBe(false);
  });
});
