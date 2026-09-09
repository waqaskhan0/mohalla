import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { checkUsername, type UsernameRejection } from '../domain/username.js';
import {
  PROFILE_REPOSITORY,
  type ProfileRepository,
} from '../repositories/profile.repository.port.js';

export type UsernameAvailability =
  | { status: 'AVAILABLE' }
  | { status: 'UNAVAILABLE' }
  | { status: 'MALFORMED'; reason: UsernameRejection };

/**
 * Username availability and claiming (PROFILE-FR-002 · BR-005 · EDGE-007/008).
 *
 * TWO RULES SHAPE EVERY METHOD HERE.
 *
 * 1. `UNAVAILABLE` MEANS UNAVAILABLE, WITH NO REASON. A handle that is taken
 *    and a handle that is reserved return the identical answer, because the SRS
 *    requires a reserved handle to be refused "without explaining why". Two
 *    reasons for one refusal would also be a small enumeration surface: it
 *    would let anyone map the reserved list, and separately confirm which
 *    handles are held by real accounts.
 *
 * 2. AVAILABILITY IS ADVISORY. `check` answers about a moment that has already
 *    passed by the time the client reads it. The authority is the UNIQUE index
 *    inside the claiming transaction (EDGE-007): two people confirming the same
 *    handle simultaneously both see AVAILABLE, and exactly one claim succeeds.
 *    Anything else — a lock, a reservation table, a pre-check — either
 *    serialises registration or leaves a window, and the index has neither
 *    problem.
 */
@Injectable()
export class UsernameService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PROFILE_REPOSITORY) private readonly repo: ProfileRepository,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Is this handle worth trying? (PROF-API-001)
   *
   * Called as the user types, so it is a single indexed existence check and
   * nothing more. A malformed handle is reported with its reason — that is the
   * user's own input and says nothing about anyone else.
   */
  async check(username: unknown): Promise<UsernameAvailability> {
    const verdict = checkUsername(username);

    if (verdict.status === 'MALFORMED') {
      return { status: 'MALFORMED', reason: verdict.reason };
    }
    // Reserved. Reported exactly as "taken" is.
    if (verdict.status === 'UNAVAILABLE') return { status: 'UNAVAILABLE' };

    const taken = await this.repo.isUsernameTaken(username as string);
    return taken ? { status: 'UNAVAILABLE' } : { status: 'AVAILABLE' };
  }

  /**
   * Would this handle be accepted, ignoring the database?
   *
   * Exposed so the profile-creation path can validate shape and reservation
   * without a second round trip, then let its own transaction decide
   * uniqueness.
   */
  screen(username: unknown): UsernameAvailability {
    const verdict = checkUsername(username);
    if (verdict.status === 'MALFORMED') return { status: 'MALFORMED', reason: verdict.reason };
    if (verdict.status === 'UNAVAILABLE') return { status: 'UNAVAILABLE' };
    return { status: 'AVAILABLE' };
  }

  /**
   * Suggest alternatives for a taken handle (PROFILE-FR-002 A1).
   *
   * Deterministic and cheap: the user is waiting, and this runs right after a
   * refusal. Suffixes are numeric because they stay inside the character set
   * and keep the original handle readable — `ayesha_k2` is recognisably the
   * same person's choice, where a generated handle is not.
   *
   * Only suggestions that are actually free are returned. Offering a taken
   * alternative would send the user straight back into the same refusal.
   */
  async suggest(username: string, limit = 3): Promise<string[]> {
    if (this.screen(username).status === 'MALFORMED') return [];

    const base = username.slice(0, 17); // room for up to three digits
    const candidates: string[] = [];
    for (let n = 1; n <= 9 && candidates.length < limit * 3; n += 1) {
      candidates.push(`${base}${n}`);
    }
    for (let n = 10; n <= 99 && candidates.length < limit * 3; n += 7) {
      candidates.push(`${base}${n}`);
    }

    const free: string[] = [];
    for (const candidate of candidates) {
      if (free.length >= limit) break;
      if (this.screen(candidate).status !== 'AVAILABLE') continue;
      if (!(await this.repo.isUsernameTaken(candidate))) free.push(candidate);
    }
    return free;
  }
}
