import type { ProfileRow, ProfileUserFacts } from '../domain/public-profile.js';
import type {
  CategoryRow,
  CreateProfileInput,
  ProfileRepository,
  ProfileWithUser,
  UpdateProfileInput,
} from '../repositories/profile.repository.port.js';

/**
 * In-memory `ProfileRepository` for service tests.
 *
 * A fake, not a mock: it enforces what the real schema enforces — the username
 * is unique CASE-INSENSITIVELY and cannot be changed once set — so a service
 * test that passes here is testing behaviour rather than call order.
 *
 * The case-insensitivity is the important part. A fake that compared usernames
 * case-sensitively would let a test prove EDGE-008 was handled when it was not.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  now: () => Date = () => new Date();

  /** userId -> row */
  readonly profiles = new Map<string, ProfileRow>();
  /** userId -> the user facts the projection needs */
  readonly users = new Map<string, ProfileUserFacts>();
  /** userId -> selected slugs */
  readonly interests = new Map<string, string[]>();

  /** Set to make the next create lose the uniqueness race (EDGE-007). */
  loseUsernameRace = false;

  readonly categories: CategoryRow[] = [
    {
      id: 'c1',
      slug: 'environment-climate',
      nameEn: 'Environment & Climate',
      nameUr: 'ماحول',
      sortOrder: 1,
    },
    { id: 'c2', slug: 'education', nameEn: 'Education', nameUr: 'تعلیم', sortOrder: 2 },
    { id: 'c3', slug: 'health', nameEn: 'Health', nameUr: 'صحت', sortOrder: 3 },
    { id: 'c4', slug: 'general', nameEn: 'General', nameUr: 'عمومی', sortOrder: 4 },
  ];

  /** Test helper: register the user facts a profile will be projected with. */
  setUser(userId: string, facts: Partial<ProfileUserFacts> = {}): void {
    this.users.set(userId, {
      accountType: facts.accountType ?? 'INDIVIDUAL',
      state: facts.state ?? 'ACTIVE',
      suspendedUntil: facts.suspendedUntil ?? null,
    });
  }

  private withUser(row: ProfileRow): ProfileWithUser {
    return {
      profile: row,
      user: this.users.get(row.userId) ?? {
        accountType: 'INDIVIDUAL',
        state: 'ACTIVE',
        suspendedUntil: null,
      },
    };
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const wanted = username.toLowerCase();
    for (const p of this.profiles.values()) {
      if (p.username.toLowerCase() === wanted) return true;
    }
    return false;
  }

  async create(input: CreateProfileInput): Promise<ProfileRow | null> {
    // Mirrors the UNIQUE index on a citext column: the check and the insert are
    // one step, so the fake cannot pass a test real PostgreSQL would fail.
    if (this.loseUsernameRace || (await this.isUsernameTaken(input.username))) return null;
    if (this.profiles.has(input.userId)) return null;

    const row: ProfileRow = {
      userId: input.userId,
      username: input.username,
      displayName: input.displayName,
      city: input.city,
      bio: input.bio,
      photoMediaId: input.photoMediaId,
      verifiedBadge: false,
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.profiles.set(row.userId, row);
    if (!this.users.has(row.userId)) this.setUser(row.userId);
    return row;
  }

  async findByUserId(userId: string): Promise<ProfileWithUser | null> {
    const row = this.profiles.get(userId);
    return row === undefined ? null : this.withUser(row);
  }

  async findByUsername(username: string): Promise<ProfileWithUser | null> {
    const wanted = username.toLowerCase();
    for (const row of this.profiles.values()) {
      if (row.username.toLowerCase() === wanted) return this.withUser(row);
    }
    return null;
  }

  async update(userId: string, input: UpdateProfileInput): Promise<ProfileRow | null> {
    const row = this.profiles.get(userId);
    if (row === undefined) return null;

    const next: ProfileRow = {
      ...row,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...('city' in input ? { city: input.city ?? null } : {}),
      ...('bio' in input ? { bio: input.bio ?? null } : {}),
      ...('photoMediaId' in input ? { photoMediaId: input.photoMediaId ?? null } : {}),
      updatedAt: this.now(),
      // The username is NOT settable here, exactly as the trigger enforces.
      username: row.username,
    };
    this.profiles.set(userId, next);
    return next;
  }

  async listCategories(): Promise<CategoryRow[]> {
    return [...this.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listInterests(userId: string): Promise<string[]> {
    const slugs = this.interests.get(userId) ?? [];
    const order = new Map(this.categories.map((c) => [c.slug, c.sortOrder]));
    return [...slugs].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  async replaceInterests(
    userId: string,
    slugs: readonly string[],
  ): Promise<{ unknownSlugs: string[] }> {
    const wanted = [...new Set(slugs)];
    const known = new Set(this.categories.map((c) => c.slug));
    const unknownSlugs = wanted.filter((s) => !known.has(s));

    // Resolved BEFORE anything is written, so a typo cannot wipe the existing
    // selection and then fail - same ordering as the SQL adapter.
    if (unknownSlugs.length > 0) return { unknownSlugs };

    this.interests.set(userId, wanted);
    return { unknownSlugs: [] };
  }
}
