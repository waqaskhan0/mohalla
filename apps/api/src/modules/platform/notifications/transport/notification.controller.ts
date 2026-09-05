import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LOCALES } from '@mohalla/localization';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../identity/application/session.service.js';
import { NotificationService, type NotificationView } from '../application/notification.service.js';
import { PREFERENCE_KEYS } from '../domain/notification-category.js';

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
    /**
     * The language the CLIENT is displaying right now.
     *
     * LOCALE-FR-002 requires switching language to update the whole interface
     * without a reinstall, and the notification centre is part of the
     * interface. Passing it per request is what makes a switch take effect
     * immediately, rather than waiting for a stored preference to sync.
     */
    locale: z.enum(LOCALES).optional(),
  })
  .strict();
type ListQuery = z.infer<typeof listQuery>;

const markReadBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict();
type MarkReadBody = z.infer<typeof markReadBody>;

const preferenceParam = z.object({ key: z.enum(PREFERENCE_KEYS) }).strict();
type PreferenceParam = z.infer<typeof preferenceParam>;

const preferenceBody = z.object({ pushEnabled: z.boolean() }).strict();
type PreferenceBody = z.infer<typeof preferenceBody>;

const deviceBody = z
  .object({
    token: z.string().min(8).max(4096),
    language: z.enum(LOCALES),
    platform: z.enum(['ANDROID']).optional(),
  })
  .strict();
type DeviceBody = z.infer<typeof deviceBody>;

/**
 * The notification centre, preferences and device tokens (NOTIF-API-001…004).
 *
 * THE CENTRE ALWAYS HAS EVERYTHING. NOTIF-FR-001's acceptance criterion is that
 * a user who DENIED the push permission still finds the notification here, and
 * NOTIF-FR-007's is that disabling a category stops the push and leaves the
 * entry. Both are about this endpoint returning things the user was never
 * buzzed about — so nothing here filters by preference or by push outcome.
 *
 * TEXT IS RENDERED AT READ TIME, in the language the request names. That is
 * what makes LOCALE-FR-002 — "the entire interface updates without reinstall" —
 * true for this screen too; a centre of pre-rendered Urdu would still be Urdu
 * after somebody switched to English.
 *
 * REGISTERING A DEVICE IS NOT A PRECONDITION FOR ANYTHING. PRIV-015: declining
 * push "degrades only notifications — no other function is withheld", so no
 * other route in this API asks whether a token exists.
 */
@ApiTags('notifications')
@Controller()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'The notification centre (NOTIF-API-001, NOTIF-FR-002).',
    description:
      'Newest first, keyset-paginated, rendered in the requested language. Contains everything ' +
      'the user was notified about INCLUDING what was never pushed - a declined push ' +
      'permission or a disabled category costs the buzz, never the record. Notifications ' +
      'whose target was deleted are already absent: they are removed rather than left to ' +
      'navigate nowhere.',
  })
  async list(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    const cursor =
      query.cursorCreatedAt !== undefined && query.cursorId !== undefined
        ? { createdAt: new Date(query.cursorCreatedAt), id: query.cursorId }
        : undefined;

    const page = await this.notifications.list(
      principal.userId,
      query.locale ?? null,
      query.limit ?? 20,
      cursor,
    );

    return {
      notifications: page.notifications.map(toBody),
      nextCursor:
        page.nextCursor === null
          ? null
          : {
              cursorCreatedAt: page.nextCursor.createdAt.toISOString(),
              cursorId: page.nextCursor.id,
            },
    };
  }

  @Get('notifications/unread-count')
  @ApiOperation({
    summary: 'The unread badge (NOTIF-FR-002).',
    description: 'One number, read on nearly every screen, so it has its own partial index.',
  })
  async unreadCount(@Principal() principal: AuthenticatedPrincipal) {
    return { unread: await this.notifications.unreadCount(principal.userId) };
  }

  @Post('notifications/read')
  @RequiresWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notifications read (NOTIF-API-002).',
    description:
      "Scoped to the caller's own notifications in the WHERE clause, so passing somebody " +
      "else's id changes nothing rather than marking their mail read.",
  })
  async markRead(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(markReadBody)) body: MarkReadBody,
  ) {
    return { marked: await this.notifications.markRead(principal.userId, body.ids) };
  }

  @Post('notifications/read-all')
  @RequiresWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read (NOTIF-FR-002).' })
  async markAllRead(@Principal() principal: AuthenticatedPrincipal) {
    return { marked: await this.notifications.markAllRead(principal.userId) };
  }

  @Get('notifications/preferences')
  @ApiOperation({
    summary: 'Push preferences (NOTIF-API-003, NOTIF-FR-007, SET-FR-007).',
    description:
      'All seven switches, with ENABLED as the default for any the user has never touched - ' +
      'so the settings screen shows the truth rather than an empty list that reads as ' +
      'everything being off. These gate PUSH ONLY.',
  })
  async preferences(@Principal() principal: AuthenticatedPrincipal) {
    return { preferences: await this.notifications.preferences(principal.userId) };
  }

  @Put('notifications/preferences/:key')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Enable or disable a push category (NOTIF-FR-007).',
    description:
      'Gates PUSH ONLY. The in-app centre keeps recording everything, so disabling a category ' +
      'never loses information - which is the acceptance criterion verbatim.',
  })
  async setPreference(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(preferenceParam)) params: PreferenceParam,
    @Body(new ZodValidationPipe(preferenceBody)) body: PreferenceBody,
  ) {
    await this.notifications.setPreference(principal.userId, params.key, body.pushEnabled);
  }

  @Post('notifications/devices')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register a device for push (NOTIF-API-004, NOTIF-FR-001).',
    description:
      'The LANGUAGE is required, and is the language this device chose at first launch. ' +
      'BR-040 says no default is pre-selected, so at registration the device knows the answer ' +
      'and the server may not - and a push rendered in a language nobody picked is worse than ' +
      'no push. Re-registering a token REASSIGNS it, so a handset that changes hands stops ' +
      "delivering the previous user's notifications.",
  })
  async registerDevice(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(deviceBody)) body: DeviceBody,
  ) {
    await this.notifications.registerDevice(
      principal.userId,
      body.token,
      body.language,
      body.platform ?? 'ANDROID',
    );
  }

  @Delete('notifications/devices')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister a device (ADR-014).',
    description:
      'Called on logout. Idempotent: a token that was already gone succeeds, because the ' +
      'caller asked for a state and that state holds.',
  })
  async removeDevice(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(deviceBody.pick({ token: true }))) body: { token: string },
  ) {
    await this.notifications.removeDevice(principal.userId, body.token);
  }
}

function toBody(n: NotificationView): Record<string, unknown> {
  return {
    id: n.id,
    category: n.category,
    actorId: n.actorId,
    targetType: n.targetType,
    targetId: n.targetId,
    text: n.text,
    batchCount: n.batchCount,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
