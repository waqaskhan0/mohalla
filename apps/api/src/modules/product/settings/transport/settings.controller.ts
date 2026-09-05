import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LOCALES } from '@mohalla/localization';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { DeletionService } from '../application/deletion.service.js';
import { SettingsService } from '../application/settings.service.js';

const languageBody = z.object({ language: z.enum(LOCALES) }).strict();
type LanguageBody = z.infer<typeof languageBody>;

const deleteBody = z
  .object({
    /**
     * SET-FR-004: "the user RE-ENTERS THEIR PASSWORD to confirm."
     *
     * The phone is already unlocked and in somebody's hand — a friend, a
     * relative, a partner. The password is the one thing that distinguishes the
     * account's owner from whoever is holding the device, and this is the only
     * irreversible action in the product.
     */
    password: z.string().min(1).max(200),
  })
  .strict();
type DeleteBody = z.infer<typeof deleteBody>;

/**
 * Settings and account deletion (SET-API-001…005).
 *
 * DELETION IS `DELETE /me`, and the confirmation is the password rather than a
 * typed phrase or a second endpoint. The consequences are a separate GET so the
 * confirmation screen cannot be built without them — PRIV-006 requires users to
 * be told, before confirming, that posts remain as "Deleted User", "BECAUSE IT
 * DIFFERS FROM THE ERASURE MANY WILL ASSUME", and a client that had to compose
 * that list itself would eventually omit the surprising line.
 *
 * RESTORATION IS NOT HERE. It happens through the login flow (SET-FR-005,
 * UX-AUTH-012): a user in PENDING_DELETION who logs in is offered it. Putting
 * it behind an authenticated Settings route would require a session, and the
 * whole point is that their sessions were revoked when they deleted.
 */
@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly deletion: DeletionService,
  ) {}

  @Put('me/language')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set the interface language (SET-API-001, SET-FR-001, LOCALE-FR-002).',
    description:
      "Stored on the ACCOUNT, not the device, which is what makes SET-FR-001's criterion " +
      'true: "GIVEN Urdu is selected on one device, WHEN the user logs in on another device, ' +
      'THEN Urdu is applied there too." BR-040 means no default is pre-selected, so an account ' +
      'that has never called this has no stored language and push falls back to whatever the ' +
      'DEVICE recorded at registration.',
  })
  async setLanguage(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(languageBody)) body: LanguageBody,
  ) {
    await this.settings.setLanguage(principal.userId, body.language);
  }

  @Get('me/settings')
  @ApiOperation({
    summary: 'The settings screen (SET-API-002).',
    description:
      'Language, notification preferences and the blocked-user count. Assembled here so the ' +
      'screen is one request rather than four, and so a client cannot render a partial screen ' +
      'when one of them is slow.',
  })
  async settingsScreen(@Principal() principal: AuthenticatedPrincipal) {
    return this.settings.screenFor(principal.userId);
  }

  @Get('me/deletion-consequences')
  @ApiOperation({
    summary: 'What deleting will do — BEFORE confirming (SET-FR-004, PRIV-006).',
    description:
      'PRIV-006: users "MUST BE TOLD THIS CLEARLY BEFORE CONFIRMING, because it differs from ' +
      'the erasure many will assume". Returned as localization KEYS so both languages say the ' +
      'same thing, and as its own endpoint so the confirmation screen cannot be built without ' +
      'them. The surprising line - that posts remain, attributed to "Deleted User" - is ' +
      'SECOND in the list, where it is read, rather than last where it is skipped. ' +
      'SERVES THE RESTORE SCREEN TOO (UX-AUTH-012). A session issued to a PENDING_DELETION ' +
      'account can reach this, and gets `scheduledErasureAt` as well - which is how the ' +
      'restore offer can say how long is left rather than just that something is pending. ' +
      'Null for everybody else, because there is no deletion to count down to.',
  })
  async deletionConsequences(@Principal() principal: AuthenticatedPrincipal) {
    const pending = await this.deletion.pendingRequestFor(principal.userId);

    return {
      ...this.deletion.consequences(),
      scheduledErasureAt: pending?.scheduledErasureAt.toISOString() ?? null,
    };
  }

  @Delete('me')
  @RequiresWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete this account (SET-API-005, SET-FR-004, BR-008/009).',
    description:
      "THE PASSWORD IS RE-ENTERED, because the phone is already unlocked and in somebody's " +
      'hand. The account becomes invisible immediately and every session is revoked; posts and ' +
      'comments REMAIN, attributed to "Deleted User". Nothing is erased for 30 days, and ' +
      'logging in within that window restores everything - profile, followers, following and ' +
      'post attribution - because phase one changes only the STATE. ' +
      'AVAILABLE IN EVERY STATE EXCEPT ALREADY-DELETED, INCLUDING WHILE SUSPENDED (BR-008): a ' +
      'suspension must not trap somebody in the product.',
  })
  async deleteAccount(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(deleteBody)) body: DeleteBody,
  ) {
    const result = await this.settings.deleteAccount(principal.userId, body.password);

    if (result.status === 'PENDING') {
      return {
        scheduledErasureAt: result.scheduledErasureAt.toISOString(),
        consequences: result.consequences,
      };
    }

    if (result.reason === 'PASSWORD_REQUIRED') {
      // Deliberately NOT a 401. The session is valid; it is the confirmation
      // that failed, and a 401 would sign a confused user out of an account
      // they were trying not to lose.
      throw new BadRequestException({
        code: 'PASSWORD_CONFIRMATION_FAILED',
        message: 'That password is not correct.',
        details: [{ path: 'password', message: 'PASSWORD_REQUIRED' }],
      });
    }

    if (result.reason === 'ALREADY_PENDING') {
      // Idempotent in spirit, but told plainly: somebody who taps twice should
      // learn their account IS being deleted rather than that something failed.
      throw new BadRequestException({
        code: 'DELETION_ALREADY_PENDING',
        message: 'This account is already scheduled for deletion.',
      });
    }

    throw new NotFoundException({
      code: 'RESOURCE_UNAVAILABLE',
      message: 'This content is no longer available.',
    });
  }

  @Post('me/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore an account inside the grace period (SET-FR-005).',
    description:
      'Reachable with a session issued by the login flow to a PENDING_DELETION account ' +
      '(UX-AUTH-012). NO ADMINISTRATOR INVOLVEMENT - a restoration that needed a support ' +
      'ticket would fail everybody who deleted in a moment they cannot face explaining. Past ' +
      'the 30 days the answer is a NEUTRAL not-found, because by then the account genuinely ' +
      'no longer exists.',
  })
  async restore(@Principal() principal: AuthenticatedPrincipal) {
    const result = await this.deletion.restore(principal.userId);

    if (result.status === 'RESTORED') return { status: 'RESTORED' as const };

    if (result.status === 'NOT_PENDING') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'This account is not scheduled for deletion.',
      });
    }

    // SET-FR-005's error case, verbatim: "the account genuinely no longer
    // exists and a neutral not-found response is returned".
    throw new NotFoundException({
      code: 'RESOURCE_UNAVAILABLE',
      message: 'This content is no longer available.',
    });
  }
}
