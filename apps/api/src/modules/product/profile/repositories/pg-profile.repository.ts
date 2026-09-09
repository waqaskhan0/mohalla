import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../../../database/database.service.js';
import type { ProfileRow, ProfileUserFacts } from '../domain/public-profile.js';
import type {
  CategoryRow,
  CreateProfileInput,
  ProfileRepository,
  ProfileWithUser,
  UpdateProfileInput,
} from './profile.repository.port.js';

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

interface JoinedRow {
  user_id: string;
  username: string;
  display_name: string;
  city: string | null;
  bio: string | null;
  photo_media_id: string | null;
  verified_badge: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: Date;
  updated_at: Date;
  account_type: 'INDIVIDUAL' | 'ORGANIZATION';
  state: ProfileUserFacts['state'];
  suspended_until: Date | null;
}

/**
 * The columns every profile read selects.
 *
 * Written out rather than `SELECT *` deliberately. `users` holds the password
 * hash and the date of birth, and this query joins to it — a `*` here would
 * pull both into the row object, one careless spread away from a response. The
 * projection layer would still filter them, but defence should not depend on a
 * single later step.
 */
const PROFILE_COLUMNS = `
  p.user_id, p.username::text AS username, p.display_name, p.city, p.bio,
  p.photo_media_id, p.verified_badge,
  p.follower_count, p.following_count, p.post_count,
  p.created_at, p.updated_at,
  u.account_type, u.state, u.suspended_until`;

function toProfile(row: JoinedRow): ProfileWithUser {
  const profile: ProfileRow = {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    city: row.city,
    bio: row.bio,
    photoMediaId: row.photo_media_id,
    verifiedBadge: row.verified_badge,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    postCount: row.post_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return {
    profile,
    user: {
      accountType: row.account_type,
      state: row.state,
      suspendedUntil: row.suspended_until,
    },
  };
}

@Injectable()
export class PgProfileRepository implements ProfileRepository {
  constructor(private readonly db: DatabaseService) {}

  private q<Row extends QueryResultRow>(
    client: PoolClient | undefined,
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<Row>> {
    return client === undefined ? this.db.query<Row>(sql, params) : client.query<Row>(sql, params);
  }

  async isUsernameTaken(username: string, client?: PoolClient): Promise<boolean> {
    // The comparison is case-insensitive because `username` is citext; no
    // lower() is needed and adding one would defeat the index.
    const r = await this.q<{ taken: boolean }>(
      client,
      'SELECT EXISTS (SELECT 1 FROM profiles WHERE username = $1) AS taken',
      [username],
    );
    return r.rows[0]?.taken === true;
  }

  async create(input: CreateProfileInput, client: PoolClient): Promise<ProfileRow | null> {
    try {
      const r = await client.query<JoinedRow>(
        `WITH inserted AS (
           INSERT INTO profiles (user_id, username, display_name, city, bio, photo_media_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *
         )
         SELECT ${PROFILE_COLUMNS}
           FROM inserted p JOIN users u ON u.id = p.user_id`,
        [
          input.userId,
          input.username,
          input.displayName,
          input.city,
          input.bio,
          input.photoMediaId,
        ],
      );
      const row = r.rows[0];
      return row ? toProfile(row).profile : null;
    } catch (e) {
      // EDGE-007: someone claimed the username first. An ordinary outcome, so
      // it is reported as null rather than raised - the caller must handle it
      // either way, and a thrown error invites a catch that swallows more.
      if (isUniqueViolation(e)) return null;
      throw e;
    }
  }

  async findByUserId(userId: string, client?: PoolClient): Promise<ProfileWithUser | null> {
    const r = await this.q<JoinedRow>(
      client,
      `SELECT ${PROFILE_COLUMNS}
         FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = $1`,
      [userId],
    );
    const row = r.rows[0];
    return row ? toProfile(row) : null;
  }

  async findByUsername(username: string, client?: PoolClient): Promise<ProfileWithUser | null> {
    const r = await this.q<JoinedRow>(
      client,
      `SELECT ${PROFILE_COLUMNS}
         FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.username = $1`,
      [username],
    );
    const row = r.rows[0];
    return row ? toProfile(row) : null;
  }

  async update(
    userId: string,
    input: UpdateProfileInput,
    client: PoolClient,
  ): Promise<ProfileRow | null> {
    // Built from the keys actually PRESENT, so omitting a field leaves it
    // alone while explicitly sending null clears it. `'bio' in input` rather
    // than a truthiness test, because null is a meaningful value here and
    // "clear my bio" must not be indistinguishable from "don't touch my bio".
    const sets: string[] = [];
    const values: unknown[] = [userId];

    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (input.displayName !== undefined) push('display_name', input.displayName);
    if ('city' in input) push('city', input.city ?? null);
    if ('bio' in input) push('bio', input.bio ?? null);
    if ('photoMediaId' in input) push('photo_media_id', input.photoMediaId ?? null);

    if (sets.length === 0) {
      // Nothing to change. Return the current row rather than writing an empty
      // UPDATE, so a no-op request is not recorded as an edit.
      const current = await this.findByUserId(userId, client);
      return current?.profile ?? null;
    }

    sets.push('updated_at = now()');

    const r = await client.query<JoinedRow>(
      `WITH updated AS (
         UPDATE profiles SET ${sets.join(', ')} WHERE user_id = $1 RETURNING *
       )
       SELECT ${PROFILE_COLUMNS}
         FROM updated p JOIN users u ON u.id = p.user_id`,
      values,
    );
    const row = r.rows[0];
    return row ? toProfile(row).profile : null;
  }

  // ---- interests ---------------------------------------------------------
  async listCategories(client?: PoolClient): Promise<CategoryRow[]> {
    const r = await this.q<{
      id: string;
      slug: string;
      name_en: string;
      name_ur: string;
      sort_order: number;
    }>(
      client,
      'SELECT id, slug, name_en, name_ur, sort_order FROM categories ORDER BY sort_order',
      [],
    );

    return r.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      nameEn: row.name_en,
      nameUr: row.name_ur,
      sortOrder: row.sort_order,
    }));
  }

  async listInterests(userId: string, client?: PoolClient): Promise<string[]> {
    const r = await this.q<{ slug: string }>(
      client,
      `SELECT c.slug
         FROM profile_interests pi JOIN categories c ON c.id = pi.category_id
        WHERE pi.user_id = $1
        ORDER BY c.sort_order`,
      [userId],
    );
    return r.rows.map((row) => row.slug);
  }

  async replaceInterests(
    userId: string,
    slugs: readonly string[],
    client: PoolClient,
  ): Promise<{ unknownSlugs: string[] }> {
    const wanted = [...new Set(slugs)];

    // Resolve slugs to ids FIRST, so an unrecognised slug is reported before
    // anything is deleted. Otherwise a typo would wipe the existing selection
    // and then fail.
    const found = await client.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM categories WHERE slug = ANY($1::text[])',
      [wanted],
    );
    const known = new Set(found.rows.map((r) => r.slug));
    const unknownSlugs = wanted.filter((s) => !known.has(s));
    if (unknownSlugs.length > 0) return { unknownSlugs };

    // Replace wholesale: the client sends the complete desired set, which
    // makes deselection expressible. A merge would make removing an interest
    // impossible without a second endpoint.
    await client.query('DELETE FROM profile_interests WHERE user_id = $1', [userId]);
    if (found.rows.length > 0) {
      await client.query(
        `INSERT INTO profile_interests (user_id, category_id)
         SELECT $1, id FROM categories WHERE id = ANY($2::uuid[])`,
        [userId, found.rows.map((r) => r.id)],
      );
    }
    return { unknownSlugs: [] };
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
}
