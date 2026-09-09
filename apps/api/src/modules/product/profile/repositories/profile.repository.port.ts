import type { PoolClient } from 'pg';
import type { ProfileRow, ProfileUserFacts } from '../domain/public-profile.js';

export const PROFILE_REPOSITORY = Symbol.for('mohalla.profile.repository');

export interface CreateProfileInput {
  userId: string;
  username: string;
  displayName: string;
  city: string | null;
  bio: string | null;
  photoMediaId: string | null;
}

export interface UpdateProfileInput {
  displayName?: string;
  city?: string | null;
  bio?: string | null;
  photoMediaId?: string | null;
}

export interface CategoryRow {
  id: string;
  slug: string;
  nameEn: string;
  nameUr: string;
  sortOrder: number;
}

/** A profile plus the few user facts the projection needs. */
export interface ProfileWithUser {
  profile: ProfileRow;
  user: ProfileUserFacts;
}

export interface ProfileRepository {
  /**
   * Is this username already held?
   *
   * Case-insensitive, because the column is `citext`. An advisory check only —
   * the answer can be stale by the time the caller acts on it, and the UNIQUE
   * index is what actually decides (EDGE-007).
   */
  isUsernameTaken(username: string, client?: PoolClient): Promise<boolean>;

  /**
   * Create the profile, claiming the username.
   *
   * @returns `null` when the UNIQUE index rejects the username — i.e. someone
   * else claimed it first (EDGE-007). Null rather than throwing, because
   * "someone got there first" is an ordinary outcome the caller must handle,
   * not an exception.
   */
  create(input: CreateProfileInput, client: PoolClient): Promise<ProfileRow | null>;

  findByUserId(userId: string, client?: PoolClient): Promise<ProfileWithUser | null>;

  findByUsername(username: string, client?: PoolClient): Promise<ProfileWithUser | null>;

  /**
   * Apply a partial update.
   *
   * The username is deliberately not updatable through this interface (BR-005),
   * and the database has a trigger in case a future caller tries anyway.
   *
   * Last write wins (PROFILE-FR-003 error case: "concurrent edit from two
   * devices → last write wins with no corruption"). No optimistic version, on
   * purpose: a profile edit is one person editing their own single row, and a
   * version conflict would ask them to resolve a collision with themselves.
   */
  update(userId: string, input: UpdateProfileInput, client: PoolClient): Promise<ProfileRow | null>;

  // ---- interests (PROFILE-FR-011) --------------------------------------
  listCategories(client?: PoolClient): Promise<CategoryRow[]>;

  /** Category slugs this user selected. Empty when none. */
  listInterests(userId: string, client?: PoolClient): Promise<string[]>;

  /**
   * Replace the interest set wholesale.
   *
   * @returns the slugs that were unrecognised, so the caller can reject the
   * request rather than silently storing a subset — a client that sends a
   * misspelled slug should learn that, not discover later that a topic never
   * saved.
   */
  replaceInterests(
    userId: string,
    slugs: readonly string[],
    client: PoolClient,
  ): Promise<{ unknownSlugs: string[] }>;
}
