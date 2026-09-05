import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  isReadOnlyBecauseOfCounterpart,
  orderPair,
  otherParticipant,
  type CounterpartState,
} from './conversation-pair.js';
import { checkMessageBody, normalizeMessageBody } from './message-body.js';

describe('orderPair (BR-024, MSG-FR-001)', () => {
  it('produces the SAME pair whichever way round it is asked', () => {
    // This is the whole of BR-024's "exactly one conversation per pair". Both
    // people tapping Message on each other's profile must resolve to one row,
    // and they do because there is only one way to write the pair.
    const a = randomUUID();
    const b = randomUUID();
    expect(orderPair(a, b)).toEqual(orderPair(b, a));
  });

  it('puts the smaller id first, matching the database CHECK', () => {
    const pair = orderPair(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(pair).toEqual({
      lowId: '11111111-1111-4111-8111-111111111111',
      highId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('refuses a conversation with yourself', () => {
    // MSG-FR-001: "a user cannot message themselves". Refused here rather than
    // left to the CHECK, so the caller learns which rule they broke instead of
    // receiving a constraint violation.
    const a = randomUUID();
    expect(orderPair(a, a)).toBe('CANNOT_MESSAGE_SELF');
  });

  it('is stable across many random pairs', () => {
    for (let i = 0; i < 200; i += 1) {
      const a = randomUUID();
      const b = randomUUID();
      const forward = orderPair(a, b);
      const backward = orderPair(b, a);
      expect(forward).toEqual(backward);
      if (forward !== 'CANNOT_MESSAGE_SELF') {
        expect(forward.lowId < forward.highId).toBe(true);
      }
    }
  });
});

describe('otherParticipant', () => {
  it('returns the person who is not the viewer', () => {
    const pair = { lowId: 'a', highId: 'b' };
    expect(otherParticipant(pair, 'a')).toBe('b');
    expect(otherParticipant(pair, 'b')).toBe('a');
  });
});

describe('isReadOnlyBecauseOfCounterpart (EDGE-022, MSG-FR-001 error case)', () => {
  it('a banned or deleted counterpart closes the thread', () => {
    expect(isReadOnlyBecauseOfCounterpart('BANNED')).toBe(true);
    expect(isReadOnlyBecauseOfCounterpart('DELETED')).toBe(true);
  });

  it('A SUSPENSION DOES NOT — it is temporary, and the thread resumes', () => {
    // What a suspension stops is that user's own writing, which is their
    // session's capability (BR-034), not a property of this conversation. If it
    // closed the thread, the other person would be locked out of a
    // conversation that is about to come back.
    expect(isReadOnlyBecauseOfCounterpart('SUSPENDED')).toBe(false);
  });

  it('nor does an account merely pending deletion', () => {
    // PENDING_DELETION is reversible for 30 days (ADR-019). Closing the thread
    // early would make the restore incomplete.
    expect(isReadOnlyBecauseOfCounterpart('PENDING_DELETION')).toBe(false);
  });

  it('is decided only by the states that are permanent', () => {
    const states: CounterpartState[] = [
      'ACTIVE',
      'UNVERIFIED',
      'SUSPENDED',
      'BANNED',
      'PENDING_DELETION',
      'DELETED',
    ];
    const readOnly = states.filter(isReadOnlyBecauseOfCounterpart);
    expect(readOnly).toEqual(['BANNED', 'DELETED']);
  });
});

describe('checkMessageBody (MSG-FR-002)', () => {
  const noAttachment = { hasAttachment: false };
  const withAttachment = { hasAttachment: true };

  it('accepts ordinary text', () => {
    expect(checkMessageBody('salaam, kya haal hai', noAttachment)).toBeNull();
  });

  it('refuses empty and whitespace-only text', () => {
    expect(checkMessageBody('', noAttachment)).toBe('EMPTY');
    expect(checkMessageBody('   \n\t ', noAttachment)).toBe('EMPTY');
    expect(checkMessageBody(null, noAttachment)).toBe('EMPTY');
  });

  it('AN IMAGE WITH NO CAPTION IS A MESSAGE (MSG-FR-008)', () => {
    // A photo of a broken street light is a complete thing to send. So the rule
    // is "text OR an attachment", which is also exactly what the database CHECK
    // says - the two cannot drift.
    expect(checkMessageBody(null, withAttachment)).toBeNull();
    expect(checkMessageBody('   ', withAttachment)).toBeNull();
  });

  it('allows exactly 2,000 characters and refuses 2,001', () => {
    expect(checkMessageBody('a'.repeat(2000), noAttachment)).toBeNull();
    expect(checkMessageBody('a'.repeat(2001), noAttachment)).toBe('TOO_LONG');
  });

  it('COUNTS GRAPHEME CLUSTERS, so Urdu is not charged for diacritics (BR-012)', () => {
    // ONE character to a reader, TWO code points in memory: the letter kaf plus
    // the zabar that sits above it. A code-point count would charge an Urdu
    // writer double for a mark a reader sees as part of the letter, so the same
    // sentence would cost more in Urdu than in English - on a platform whose
    // point is that Urdu is a first-class language.
    const withDiacritic = 'کَ';
    expect(withDiacritic.length).toBe(2);
    expect([...withDiacritic]).toHaveLength(2);

    expect(checkMessageBody(withDiacritic.repeat(2000), noAttachment)).toBeNull();
    expect(checkMessageBody(withDiacritic.repeat(2001), noAttachment)).toBe('TOO_LONG');
  });

  it('and two separate LETTERS are two characters, as they should be', () => {
    // The counterpart to the test above, so "counts graphemes" is not mistaken
    // for "counts Urdu leniently". کھ is kaf followed by do-chashmi he - two
    // letters a reader sees as two, and they cost two.
    expect(checkMessageBody('کھ'.repeat(1000), noAttachment)).toBeNull();
    expect(checkMessageBody('کھ'.repeat(1001), noAttachment)).toBe('TOO_LONG');
  });

  it('refuses a non-string', () => {
    expect(checkMessageBody(42, noAttachment)).toBe('NOT_A_STRING');
  });
});

describe('normalizeMessageBody', () => {
  it('trims', () => {
    expect(normalizeMessageBody('  hello  ')).toBe('hello');
  });

  it('returns NULL for an attachment-only message, not an empty string', () => {
    // The column is nullable and the CHECK distinguishes the two: an empty
    // string satisfies NOT NULL while meaning nothing, which is precisely the
    // state the constraint exists to forbid.
    expect(normalizeMessageBody('   ')).toBeNull();
    expect(normalizeMessageBody(null)).toBeNull();
    expect(normalizeMessageBody(undefined)).toBeNull();
  });
});
