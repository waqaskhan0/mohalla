/**
 * The conversation pair (BR-024 · MSG-FR-001).
 *
 * BR-024 is one sentence — "Exactly one conversation exists per pair of users,
 * for the lifetime of both accounts" — and it is the kind of rule that is easy
 * to satisfy in the happy path and easy to break everywhere else. The obvious
 * implementation, "look for a conversation between A and B, create one if
 * absent", has two ways to fail: it can miss the row stored the other way
 * round, and two simultaneous first messages can both find nothing and both
 * insert.
 *
 * ORDERING THE PAIR FIXES BOTH AT ONCE. A conversation is stored under the
 * lexicographically smaller id first, with a UNIQUE constraint on the pair. The
 * lookup then cannot miss a row because there is only one way to write it, and
 * the race cannot produce two rows because the database refuses the second.
 *
 * This module exists so the ordering is applied in exactly one place. A caller
 * that ordered the pair itself would be one `if` away from re-creating the bug.
 */

export type PairRejection = 'CANNOT_MESSAGE_SELF';

export interface ConversationPair {
  lowId: string;
  highId: string;
}

/**
 * Put two user ids into canonical order.
 *
 * String comparison rather than UUID-numeric comparison, and it must match the
 * database's `CHECK (user_low_id < user_high_id)`. Both are PostgreSQL `uuid`
 * columns compared as `uuid`, and JavaScript compares the canonical lowercase
 * text form — the two agree because the hyphenated hex form sorts identically
 * either way. Anything that changed the id format (ADR-007 fixes it at UUIDv7)
 * would need to revisit this pairing.
 */
export function orderPair(userA: string, userB: string): ConversationPair | PairRejection {
  // MSG-FR-001: "a user cannot message themselves". Refused here rather than at
  // the database, because the CHECK would report it as a constraint violation
  // and the caller deserves to know which rule it broke.
  if (userA === userB) return 'CANNOT_MESSAGE_SELF';

  return userA < userB ? { lowId: userA, highId: userB } : { lowId: userB, highId: userA };
}

/** The OTHER participant, given one of them. */
export function otherParticipant(pair: ConversationPair, userId: string): string {
  return pair.lowId === userId ? pair.highId : pair.lowId;
}

/**
 * Can this conversation still be written to?
 *
 * MSG-FR-001's error case and EDGE-022 say the same thing from two directions:
 * when the other participant is banned or has deleted their account, "the
 * conversation is read-only and clearly marked; existing history is retained".
 *
 * NOT hidden, and not deleted. Somebody's messages to a neighbour are their own
 * record of what was said, and losing them because the other person left would
 * be a second loss on top of the first. So the thread stays, marked, and the
 * compose box is closed.
 *
 * A SUSPENDED counterpart is deliberately NOT read-only here: a suspension is
 * temporary and the thread resumes when it lifts. What a suspension does block
 * is that user's own sending, which is the capability check on their session
 * (BR-034), not a property of this conversation.
 */
export type CounterpartState =
  'ACTIVE' | 'UNVERIFIED' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION' | 'DELETED';

export function isReadOnlyBecauseOfCounterpart(state: CounterpartState): boolean {
  return state === 'BANNED' || state === 'DELETED';
}
