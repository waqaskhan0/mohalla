import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { ProfileService } from '../application/profile.service.js';
import { UsernameService } from '../application/username.service.js';
import {
  claimUsernameBody,
  createProfileBody,
  setInterestsBody,
  updateProfileBody,
  userIdParam,
  usernameQuery,
  type ClaimUsernameBody,
  type CreateProfileBody,
  type SetInterestsBody,
  type UpdateProfileBody,
  type UserIdParam,
  type UsernameQuery,
} from './profile.dto.js';

/**
 * Profile transport (PROF-API-001…009).
 *
 * THE OWNERSHIP RULE IS EXPRESSED BY WHAT THIS CONTROLLER CANNOT SAY.
 *
 * Every write route is mounted under `/me` and passes
 * `principal.userId` — no route accepts a target user id for a write, so
 * PROFILE-FR-003's "user A edits user B → 403 regardless of the interface"
 * holds because the request is unrepresentable, not because a check catches
 * it. There is deliberately no `PATCH /users/{id}/profile`, for an
 * administrator or anyone else (§161: an admin may not edit a profile).
 *
 * `@RequiresWrite()` on the mutating routes, so a SUSPENDED account is refused
 * by the guard with `ACCOUNT_SUSPENDED` and its end date (BR-034) rather than
 * by a check here. A suspended user may still READ profiles, which is why the
 * read routes do not carry it.
 *
 * STATUS MAPPING, and where disclosure would creep in:
 *
 *   /username/available -> 200 with `available: false` for taken AND reserved.
 *                          Never a reason (SRS A2: "without explaining why").
 *   GET /users/{id}     -> 404 RESOURCE_UNAVAILABLE for missing, banned,
 *                          deleted and blocked alike (BR-025, UX-STATE-001).
 *                          A 403 for "blocked" would tell the viewer they were
 *                          blocked, which is the one thing a block must not do.
 */
@ApiTags('profile')
@Controller()
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly usernames: UsernameService,
  ) {}

  // ------------------------------------------------------------- usernames
  @Get('username/available')
  @ApiOperation({
    summary: 'Is a username available? (PROF-API-001)',
    description:
      'A taken handle and a RESERVED handle both report `available: false` with no reason. ' +
      'Availability is advisory - the UNIQUE index decides when the handle is claimed ' +
      "(EDGE-007). A malformed handle reports its reason, since that is the caller's own input.",
  })
  async usernameAvailable(@Query(new ZodValidationPipe(usernameQuery)) query: UsernameQuery) {
    const result = await this.usernames.check(query.u);

    if (result.status === 'MALFORMED') {
      return { available: false, malformed: true, reason: result.reason };
    }
    if (result.status === 'UNAVAILABLE') {
      // Suggestions only for a well-formed handle somebody already holds -
      // there is nothing helpful to suggest for a malformed one.
      return {
        available: false,
        malformed: false,
        suggestions: await this.usernames.suggest(query.u),
      };
    }
    return { available: true, malformed: false };
  }

  @Post('me/username')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Claim the username. Permanent (PROF-API-002, BR-005).',
    description:
      'Stores the handle, so it is held the moment this succeeds - there is no reservation to ' +
      'expire, which is what makes a failed request safe to retry. IMMUTABLE afterwards: a ' +
      'second claim is refused even for the same handle.',
  })
  async claimUsername(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(claimUsernameBody)) body: ClaimUsernameBody,
  ) {
    const result = await this.profiles.claimUsername({
      userId: principal.userId,
      username: body.username,
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'USERNAME_UNAVAILABLE') {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'That username is taken. Try another.',
      });
    }
    if (result.status === 'ALREADY_CLAIMED') {
      throw new ConflictException({
        code: 'USERNAME_ALREADY_SET',
        message: 'Your username has already been set and cannot be changed.',
      });
    }
    return result.profile;
  }

  // -------------------------------------------------------------- profiles
  @Post('me/profile')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the profile (PROF-API-003, PROFILE-FR-001).',
    description: 'Requires a claimed username. A display name alone is sufficient.',
  })
  async createProfile(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createProfileBody)) body: CreateProfileBody,
  ) {
    const result = await this.profiles.completeProfile({
      userId: principal.userId,
      displayName: body.displayName,
      city: body.city ?? null,
      bio: body.bio ?? null,
      photoMediaId: body.photoMediaId ?? null,
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'USERNAME_REQUIRED') {
      throw new ConflictException({
        code: 'USERNAME_REQUIRED',
        message: 'Choose a username before creating your profile.',
      });
    }
    return result.profile;
  }

  @Get('me')
  @ApiOperation({
    summary: "The owner's own profile (PROF-API-004, PROFILE-FR-004).",
    description:
      'A superset of the public projection: adds account state, suspension expiry and chosen ' +
      'interests. Still carries NO phone number and no date of birth (PRIV-003).',
  })
  async me(@Principal() principal: AuthenticatedPrincipal) {
    const own = await this.profiles.getOwn(principal.userId);
    if (own === null) {
      // Authenticated but with no profile yet - the onboarding flow has not
      // finished. Distinct from "not available", because this is the caller's
      // OWN account and telling them the truth reveals nothing.
      throw new NotFoundException({
        code: 'PROFILE_NOT_CREATED',
        message: 'Your profile has not been created yet.',
      });
    }
    return own;
  }

  @Patch('me/profile')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Edit own profile (PROF-API-005, PROFILE-FR-003).',
    description:
      'Owner only, and there is no route that edits anyone else - not even for an ' +
      'administrator (§161). `username` is rejected rather than ignored (BR-005). Send null to ' +
      'clear an optional field; omit it to leave it alone. Last write wins.',
  })
  async updateProfile(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(updateProfileBody)) body: UpdateProfileBody,
  ) {
    const result = await this.profiles.update({
      userId: principal.userId,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...('city' in body ? { city: body.city ?? null } : {}),
      ...('bio' in body ? { bio: body.bio ?? null } : {}),
      ...('photoMediaId' in body ? { photoMediaId: body.photoMediaId ?? null } : {}),
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.field, result.reason);
    if (result.status === 'NOT_FOUND') {
      throw new NotFoundException({
        code: 'PROFILE_NOT_CREATED',
        message: 'Your profile has not been created yet.',
      });
    }
    return result.profile;
  }

  @Get('users/:id')
  @ApiOperation({
    summary: "View another person's profile (PROF-API-006, PROFILE-FR-005).",
    description:
      'Returns 404 RESOURCE_UNAVAILABLE for a missing, banned, deleted OR blocked profile - ' +
      'one neutral state that does not distinguish them (BR-025, UX-STATE-001). A suspended ' +
      'profile IS visible, because a suspension is temporary and hiding it would break ' +
      'existing conversations.',
  })
  async viewUser(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(userIdParam)) params: UserIdParam,
  ) {
    const result = await this.profiles.viewByUserId(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return result.profile;
  }

  // ------------------------------------------------------------- interests
  @Get('categories')
  @ApiOperation({
    summary: 'The fixed category taxonomy (BR-017).',
    description:
      'Eleven seeded rows, not user-extensible. Both language names are returned so the ' +
      'client renders either without a second call.',
  })
  async categories() {
    const rows = await this.profiles.listCategories();
    return {
      categories: rows.map((c) => ({
        slug: c.slug,
        nameEn: c.nameEn,
        nameUr: c.nameUr,
        sortOrder: c.sortOrder,
      })),
    };
  }

  @Put('me/interests')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Replace the interest selection (PROF-API-009, PROFILE-FR-011).',
    description:
      'PUT because the client sends the COMPLETE desired set - that is what makes ' +
      'deselection expressible. An empty array is valid: interests are optional and skipping ' +
      'them degrades nothing.',
  })
  async setInterests(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(setInterestsBody)) body: SetInterestsBody,
  ) {
    const result = await this.profiles.setInterests(principal.userId, body.slugs);

    if (result.status === 'UNKNOWN_CATEGORY') {
      // Reported rather than ignored: a client sending a misspelled slug
      // should learn now, not discover later that a topic never saved.
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'One or more categories are not recognised.',
        details: result.unknownSlugs.map((slug) => ({ path: 'slugs', message: slug })),
      });
    }
    return { interests: result.interests };
  }
}

/**
 * 404 for missing, banned, deleted and blocked alike.
 *
 * `RESOURCE_UNAVAILABLE` is the catalogue's own code for
 * "deleted · auto-hidden · blocked · banned · never existed" (BR-025). A 403
 * for the blocked case would tell the viewer they had been blocked, turning a
 * private safety decision into a notification.
 */
function resourceUnavailable(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}

/** Field-level error for the caller's own input. Reveals nothing about others. */
function fieldError(field: string, reason: string): BadRequestException {
  return new BadRequestException({
    code: FoundationErrorCode.VALIDATION_FAILED,
    message: 'Please check the highlighted fields.',
    details: [{ path: field, message: reason }],
  });
}
