/**
 * THE PUBLIC PROFILE PROJECTION (PRIV-003 · PRIV-004 · PROFILE-FR-005).
 *
 * `06-backend-modules.md` §162 is unusually direct about this file:
 *
 *   > **The public projection is defined here and used everywhere.** It contains
 *   > display name, username, photo, city, bio, badge and counts — and nothing
 *   > else. Phone, email and DOB are structurally absent (PRIV-003).
 *
 * "Structurally absent" is the requirement, and it is stronger than "not
 * included". A projection built by deleting fields from a row is one forgotten
 * `delete` away from leaking a phone number; a projection built by NAMING the
 * fields it wants cannot leak a field nobody named. So `toPublicProfile` takes
 * the internal row and constructs a new object explicitly. Adding a column to
 * `profiles` — or to `users` — can never widen what this returns.
 *
 * That property is worth more than the small duplication, because the failure
 * it prevents is unrecoverable: a phone number disclosed to the wrong
 * neighbour cannot be un-disclosed, and on this platform the consequence of
 * that is not embarrassment.
 *
 * Every surface that shows a person — profile, post author, comment author,
 * search result, message inbox, event host — renders THIS shape. One
 * definition means a badge revocation or a blocked relationship takes effect
 * everywhere at once (PROFILE-FR-007), rather than in the six places someone
 * remembered.
 */

/** What any authenticated viewer may see about another person. */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  /** Null when no photo is set; the client renders a placeholder avatar. */
  photoMediaId: string | null;
  city: string | null;
  bio: string | null;
  /** ADMIN-FR-010. An ORGANIZATION account type does NOT imply this. */
  verifiedBadge: boolean;
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  followerCount: number;
  followingCount: number;
  postCount: number;
}

/**
 * The owner's own view (PROFILE-FR-004).
 *
 * Everything public, plus the few things only the owner is entitled to. It is
 * deliberately a SUPERSET rather than a separate shape, so a client rendering
 * its own profile uses the same fields with additions — and so nothing that is
 * public here can be non-public there by accident.
 *
 * Note what is still absent: no phone number, no date of birth. The owner
 * already knows their own number, and a settings screen that needs to show it
 * masked asks identity for it explicitly (`maskForOwner`). Putting it here
 * would mean every profile response carried it, one serialisation bug away
 * from the public path.
 */
export interface OwnProfile extends PublicProfile {
  /** SET-FR / account state, so the client can show a suspension banner. */
  state: 'ACTIVE' | 'UNVERIFIED' | 'SUSPENDED' | 'PENDING_DELETION' | 'BANNED' | 'DELETED';
  suspendedUntil: string | null;
  /** Chosen interests, by category slug. Empty when none were selected. */
  interests: string[];
  createdAt: string;
}

/**
 * The internal row shape this module reads from the database.
 *
 * Named separately from `PublicProfile` on purpose: the compiler then treats
 * "return the row" as a type error rather than a working shortcut.
 */
export interface ProfileRow {
  userId: string;
  username: string;
  displayName: string;
  city: string | null;
  bio: string | null;
  photoMediaId: string | null;
  verifiedBadge: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The bits of the user record a profile needs. Nothing else is fetched. */
export interface ProfileUserFacts {
  accountType: 'INDIVIDUAL' | 'ORGANIZATION';
  state: OwnProfile['state'];
  suspendedUntil: Date | null;
}

/**
 * Build the public projection.
 *
 * Every field is named. Nothing is spread, nothing is deleted, nothing is
 * copied wholesale — see the file comment for why that is the whole point.
 */
export function toPublicProfile(row: ProfileRow, user: ProfileUserFacts): PublicProfile {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    photoMediaId: row.photoMediaId,
    city: row.city,
    bio: row.bio,
    verifiedBadge: row.verifiedBadge,
    accountType: user.accountType,
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    postCount: row.postCount,
  };
}

/** Build the owner's view: the public projection plus what only they may see. */
export function toOwnProfile(
  row: ProfileRow,
  user: ProfileUserFacts,
  interests: readonly string[],
): OwnProfile {
  return {
    ...toPublicProfile(row, user),
    state: user.state,
    suspendedUntil: user.suspendedUntil?.toISOString() ?? null,
    interests: [...interests],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The exact field set of the public projection.
 *
 * Exported so a test can assert it, which is the point: if someone widens
 * `PublicProfile`, a test fails and a human has to decide whether the new field
 * is genuinely public. A type alone would let the addition pass silently.
 */
export const PUBLIC_PROFILE_FIELDS = [
  'accountType',
  'bio',
  'city',
  'displayName',
  'followerCount',
  'followingCount',
  'photoMediaId',
  'postCount',
  'userId',
  'username',
  'verifiedBadge',
] as const;

/**
 * Fields that must NEVER appear in any profile response.
 *
 * Named explicitly so the test that checks for them reads as a statement of
 * intent rather than a list of strings someone happened to think of.
 */
export const FORBIDDEN_PROFILE_FIELDS = [
  'phone',
  'phoneNumber',
  'msisdn',
  'mobile',
  'email',
  'dateOfBirth',
  'dob',
  'passwordHash',
  'password',
  'valueNormalized',
  'valueHash',
  'identifierHash',
] as const;
