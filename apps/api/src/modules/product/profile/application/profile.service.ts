import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { isPubliclyVisible } from '../../../platform/identity/domain/user-state.js';
import {
  checkBio,
  checkCity,
  checkDisplayName,
  normalizeOptionalText,
} from '../domain/profile-fields.js';
import { checkUsername, type UsernameRejection } from '../domain/username.js';
import {
  toOwnProfile,
  toPublicProfile,
  type OwnProfile,
  type PublicProfile,
} from '../domain/public-profile.js';
import { BLOCK_CHECK, type BlockCheck } from '../ports/block-check.port.js';
import {
  PROFILE_REPOSITORY,
  type CategoryRow,
  type ProfileRepository,
} from '../repositories/profile.repository.port.js';

export interface ClaimUsernameCommand {
  userId: string;
  username: string;
}

export interface CompleteProfileCommand {
  userId: string;
  displayName: string;
  city?: string | null;
  bio?: string | null;
  photoMediaId?: string | null;
}

export interface UpdateProfileCommand {
  userId: string;
  displayName?: string;
  city?: string | null;
  bio?: string | null;
  photoMediaId?: string | null;
}

export type ProfileField = 'username' | 'displayName' | 'city' | 'bio';

export type ClaimUsernameResult =
  | { status: 'CLAIMED'; profile: OwnProfile }
  | { status: 'USERNAME_UNAVAILABLE' }
  | { status: 'ALREADY_CLAIMED' }
  | { status: 'INVALID_INPUT'; field: 'username'; reason: UsernameRejection };

export type CompleteProfileResult =
  | { status: 'CREATED'; profile: OwnProfile }
  | { status: 'USERNAME_REQUIRED' }
  | { status: 'INVALID_INPUT'; field: ProfileField; reason: string };

export type UpdateProfileResult =
  | { status: 'UPDATED'; profile: OwnProfile }
  | { status: 'NOT_FOUND' }
  | { status: 'INVALID_INPUT'; field: ProfileField; reason: string };

/**
 * `NOT_AVAILABLE` is ONE state covering several causes (PROFILE-FR-005,
 * BR-025, UX-STATE-001): the profile does not exist, the account is banned or
 * deleted, or there is a block in either direction.
 *
 * Collapsing them is the requirement, not a simplification. "This account is
 * blocked" tells the viewer they were blocked, which turns a private safety
 * decision into a notification; "no such user" versus "banned user" would let
 * anyone audit who has been removed. The SRS asks for "one neutral
 * not-available state that does not distinguish the two".
 */
export type ViewProfileResult =
  { status: 'FOUND'; profile: PublicProfile } | { status: 'NOT_AVAILABLE' };

/**
 * Profiles (PROFILE-FR-001/003/004/005/011 · BR-005/010/011 · PRIV-003/004).
 *
 * WRITES ARE OWNER-ONLY, AND THAT IS ENFORCED BY SHAPE. Every write takes the
 * `userId` from the authenticated principal, and there is no parameter for
 * "whose profile". A cross-user edit is therefore not something this service
 * can be asked to do — PROFILE-FR-003's acceptance criterion ("user A edits
 * user B's profile → 403 regardless of the interface") holds because the
 * request cannot be expressed, rather than because a check catches it.
 *
 * An administrator cannot edit a profile either (§161). The badge is the sole
 * admin-writable field and belongs to `admin-ops` (ADMIN-FR-010).
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PROFILE_REPOSITORY) private readonly repo: ProfileRepository,
    @Inject(BLOCK_CHECK) private readonly blocks: BlockCheck,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * PROF-API-002 — claim the username (PROFILE-FR-002).
   *
   * The SRS is specific about the sequence: "Username is stored and the user
   * proceeds to profile creation". So this is a WRITE, not a reservation — the
   * handle is held the moment the row exists, which is what makes E4 ("network
   * failure → no username reserved, retry is safe") true. There is no
   * reservation table to leak half-claimed handles, and nothing to expire.
   *
   * `display_name` is NOT NULL, so the row is created with the username as a
   * provisional display name. That is a deliberate choice over the
   * alternatives: a nullable display name would push "is this profile
   * finished?" into every read path, and a separate reservation table would
   * need its own expiry, its own uniqueness rule, and a reconciliation job.
   * A user who claims a handle and stops has a usable profile showing their
   * own handle — which is honest, and is what PROFILE-FR-001's precondition
   * ("Pre: username assigned") describes.
   */
  async claimUsername(cmd: ClaimUsernameCommand): Promise<ClaimUsernameResult> {
    const verdict = checkUsername(cmd.username);
    if (verdict.status === 'MALFORMED') {
      return { status: 'INVALID_INPUT', field: 'username', reason: verdict.reason };
    }
    // Reserved. Reported exactly as taken is (SRS A2: "without explaining why").
    if (verdict.status === 'UNAVAILABLE') return { status: 'USERNAME_UNAVAILABLE' };

    return this.db.withTransaction(async (client) => {
      const existing = await this.repo.findByUserId(cmd.userId, client);
      if (existing !== null) {
        // BR-005: immutable. Re-claiming would be the one way to change it, so
        // this is refused even when the caller asks for the same handle.
        this.log('username_already_claimed', cmd.userId);
        return { status: 'ALREADY_CLAIMED' } as const;
      }

      const created = await this.repo.create(
        {
          userId: cmd.userId,
          username: cmd.username,
          // Provisional; PROF-API-003 replaces it. Always 3-20 characters, so
          // it satisfies the 2-50 display-name rule by construction.
          displayName: cmd.username,
          city: null,
          bio: null,
          photoMediaId: null,
        },
        client,
      );

      // EDGE-007 / E3: two people confirmed the same handle at once. The UNIQUE
      // index decided; the loser is asked to choose again.
      if (created === null) {
        this.log('username_race_lost', cmd.userId);
        return { status: 'USERNAME_UNAVAILABLE' } as const;
      }

      const withUser = await this.repo.findByUserId(cmd.userId, client);
      if (withUser === null) throw new Error('profile vanished within its own transaction');

      this.log('username_claimed', cmd.userId);
      return {
        status: 'CLAIMED',
        profile: toOwnProfile(withUser.profile, withUser.user, []),
      } as const;
    });
  }

  /**
   * PROF-API-003 — complete the profile (PROFILE-FR-001).
   *
   * Requires the username to have been claimed already, which is the
   * requirement's own precondition. Refusing rather than claiming one
   * implicitly matters: the username is permanent, and PROFILE-FR-002 says the
   * user confirms it "having been warned the choice is permanent". Deriving a
   * handle from a display name here would hand someone an irreversible
   * identifier they never chose.
   */
  async completeProfile(cmd: CompleteProfileCommand): Promise<CompleteProfileResult> {
    const nameProblem = checkDisplayName(cmd.displayName);
    if (nameProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'displayName', reason: nameProblem };
    }

    const city = normalizeOptionalText(cmd.city);
    const cityProblem = checkCity(city);
    if (cityProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'city', reason: cityProblem };
    }

    const bio = normalizeOptionalText(cmd.bio);
    const bioProblem = checkBio(bio);
    if (bioProblem !== null) {
      return { status: 'INVALID_INPUT', field: 'bio', reason: bioProblem };
    }

    return this.db.withTransaction(async (client) => {
      const existing = await this.repo.findByUserId(cmd.userId, client);
      if (existing === null) return { status: 'USERNAME_REQUIRED' } as const;

      const updated = await this.repo.update(
        cmd.userId,
        {
          displayName: cmd.displayName,
          city,
          bio,
          photoMediaId: cmd.photoMediaId ?? null,
        },
        client,
      );
      if (updated === null) return { status: 'USERNAME_REQUIRED' } as const;

      const withUser = await this.repo.findByUserId(cmd.userId, client);
      if (withUser === null) throw new Error('profile vanished within its own transaction');
      const interests = await this.repo.listInterests(cmd.userId, client);

      this.log('profile_created', cmd.userId);
      return {
        status: 'CREATED',
        profile: toOwnProfile(withUser.profile, withUser.user, interests),
      } as const;
    });
  }

  /** PROF-API-004 — the owner's own profile. */
  async getOwn(userId: string): Promise<OwnProfile | null> {
    const found = await this.repo.findByUserId(userId);
    if (found === null) return null;
    const interests = await this.repo.listInterests(userId);
    return toOwnProfile(found.profile, found.user, interests);
  }

  /**
   * PROF-API-006 — view somebody else's profile.
   *
   * Three checks, in this order, all collapsing to one answer:
   *   1. does a profile exist;
   *   2. is the account publicly visible (suspended yes, banned/deleted no);
   *   3. is there a block in either direction (BR-025).
   *
   * A viewer looking at their OWN id through this path still gets the public
   * projection rather than the owner view — the caller asked for the public
   * profile, and quietly returning more would make the two paths differ by
   * accident.
   */
  async viewByUserId(viewerId: string, targetUserId: string): Promise<ViewProfileResult> {
    return this.view(viewerId, () => this.repo.findByUserId(targetUserId));
  }

  /** The same rules, resolved by handle rather than id. */
  async viewByUsername(viewerId: string, username: string): Promise<ViewProfileResult> {
    // Shape-checked first so a malformed handle is a cheap miss rather than a
    // query - and so it produces the same NOT_AVAILABLE as a real absence,
    // never a validation error that hints at what a valid handle looks like.
    if (checkUsername(username).status === 'MALFORMED') return { status: 'NOT_AVAILABLE' };
    return this.view(viewerId, () => this.repo.findByUsername(username));
  }

  private async view(
    viewerId: string,
    load: () => Promise<Awaited<ReturnType<ProfileRepository['findByUserId']>>>,
  ): Promise<ViewProfileResult> {
    const found = await load();
    if (found === null) return { status: 'NOT_AVAILABLE' };

    // A suspended profile stays visible; banned and deleted do not
    // (PROFILE-FR-005).
    if (!isPubliclyVisible(found.user.state)) return { status: 'NOT_AVAILABLE' };

    // BR-025, in BOTH directions. Asked symmetrically, so no caller has to
    // remember which way round the block was created.
    if (
      found.profile.userId !== viewerId &&
      (await this.blocks.isBlockedEitherWay(viewerId, found.profile.userId))
    ) {
      return { status: 'NOT_AVAILABLE' };
    }

    return { status: 'FOUND', profile: toPublicProfile(found.profile, found.user) };
  }

  /**
   * PROF-API-005 — edit own profile.
   *
   * `username` is absent from the command type, so BR-005 is expressed as an
   * absence rather than a rejection. The database also has a trigger, because
   * this is a rule and not a convention.
   */
  async update(cmd: UpdateProfileCommand): Promise<UpdateProfileResult> {
    if (cmd.displayName !== undefined) {
      const problem = checkDisplayName(cmd.displayName);
      if (problem !== null) {
        return { status: 'INVALID_INPUT', field: 'displayName', reason: problem };
      }
    }

    // `'city' in cmd` distinguishes "clear it" from "leave it alone": null is
    // a meaningful value, so a truthiness test would make clearing impossible.
    const city = 'city' in cmd ? normalizeOptionalText(cmd.city) : undefined;
    if (city !== undefined) {
      const problem = checkCity(city);
      if (problem !== null) return { status: 'INVALID_INPUT', field: 'city', reason: problem };
    }

    const bio = 'bio' in cmd ? normalizeOptionalText(cmd.bio) : undefined;
    if (bio !== undefined) {
      const problem = checkBio(bio);
      if (problem !== null) return { status: 'INVALID_INPUT', field: 'bio', reason: problem };
    }

    return this.db.withTransaction(async (client) => {
      const updated = await this.repo.update(
        cmd.userId,
        {
          ...(cmd.displayName !== undefined ? { displayName: cmd.displayName } : {}),
          ...('city' in cmd ? { city: city ?? null } : {}),
          ...('bio' in cmd ? { bio: bio ?? null } : {}),
          ...('photoMediaId' in cmd ? { photoMediaId: cmd.photoMediaId ?? null } : {}),
        },
        client,
      );
      if (updated === null) return { status: 'NOT_FOUND' } as const;

      const withUser = await this.repo.findByUserId(cmd.userId, client);
      if (withUser === null) return { status: 'NOT_FOUND' } as const;
      const interests = await this.repo.listInterests(cmd.userId, client);

      this.log('profile_updated', cmd.userId);
      return {
        status: 'UPDATED',
        profile: toOwnProfile(withUser.profile, withUser.user, interests),
      } as const;
    });
  }

  // ---- interests (PROFILE-FR-011, Could) --------------------------------
  async listCategories(): Promise<CategoryRow[]> {
    return this.repo.listCategories();
  }

  /**
   * PROF-API-009 — replace the interest set.
   *
   * Optional by requirement: "skipping degrades no other function". An empty
   * array is therefore a valid request meaning "none", not a malformed one.
   */
  async setInterests(
    userId: string,
    slugs: readonly string[],
  ): Promise<
    | { status: 'UPDATED'; interests: string[] }
    | { status: 'UNKNOWN_CATEGORY'; unknownSlugs: string[] }
  > {
    return this.db.withTransaction(async (client) => {
      const result = await this.repo.replaceInterests(userId, slugs, client);
      if (result.unknownSlugs.length > 0) {
        // Reported rather than ignored: a client sending a misspelled slug
        // should learn that now, not discover later that a topic never saved.
        return { status: 'UNKNOWN_CATEGORY', unknownSlugs: result.unknownSlugs } as const;
      }
      const interests = await this.repo.listInterests(userId, client);
      return { status: 'UPDATED', interests } as const;
    });
  }

  private log(event: string, userId: string): void {
    // A user id is fine here; a display name, city or bio is user content and
    // does not belong in an operational log.
    this.logger.log(JSON.stringify({ event, userId }), 'profile');
  }
}
