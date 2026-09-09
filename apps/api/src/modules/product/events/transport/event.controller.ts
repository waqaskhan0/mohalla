import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FoundationErrorCode, IdentityErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { EventService, type EventView } from '../application/event.service.js';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_MEETING_URL_MAX,
  EVENT_TITLE_MAX,
  MAX_EVENTS_PER_DAY,
} from '../domain/event-fields.js';
import { JOIN_WINDOW_MINUTES } from '../domain/join-link-policy.js';

const idParam = z.object({ id: z.string().uuid() }).strict();
type IdParam = z.infer<typeof idParam>;

const userIdParam = z.object({ userId: z.string().uuid() }).strict();
type UserIdParam = z.infer<typeof userIdParam>;

// Generous bounds; the domain counts grapheme clusters and owns the real limit.
const createBody = z
  .object({
    title: z.string().max(EVENT_TITLE_MAX * 4),
    description: z.string().max(EVENT_DESCRIPTION_MAX * 4),
    startsAt: z.string().datetime(),
    eventType: z.enum(['ONLINE', 'PHYSICAL']),
    meetingUrl: z.string().max(EVENT_MEETING_URL_MAX).nullish(),
    locationText: z.string().max(800).nullish(),
    categorySlug: z.string().max(64).nullish(),
  })
  .strict();
type CreateBody = z.infer<typeof createBody>;

const updateBody = z
  .object({
    title: z
      .string()
      .max(EVENT_TITLE_MAX * 4)
      .optional(),
    description: z
      .string()
      .max(EVENT_DESCRIPTION_MAX * 4)
      .optional(),
    startsAt: z.string().datetime().optional(),
    eventType: z.enum(['ONLINE', 'PHYSICAL']).optional(),
    meetingUrl: z.string().max(EVENT_MEETING_URL_MAX).nullish(),
    locationText: z.string().max(800).nullish(),
    categorySlug: z.string().max(64).nullish(),
  })
  .strict();
type UpdateBody = z.infer<typeof updateBody>;

const rsvpBody = z.object({ response: z.enum(['GOING', 'INTERESTED']) }).strict();
type RsvpBody = z.infer<typeof rsvpBody>;

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursorStartsAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof listQuery>;

/**
 * Events (EVENT-API-001…006).
 *
 * TWO THINGS ARE ABSENT FROM THIS FILE ON PURPOSE.
 *
 * THERE IS NO `GET /events/{id}/attendees`, and no response body carries an
 * attendee identity. ARCH-CONFLICT-006 / D-17: EVENT-FR-004 permits a public
 * COUNT and states the attendee list is not shown in V1. The route does not
 * exist rather than existing and returning an empty array, because a route that
 * exists is a route somebody later "fixes".
 *
 * AND NO RESPONSE CARRIES `meetingUrl` EXCEPT `POST /events/{id}/join`. The
 * detail body says only whether the join control is active and, when it is not
 * yet, when it will be. EVENT-FR-003 gates the link behind an RSVP and a
 * 30-minute window "which limits scraping of open meeting rooms" — a control
 * the client cannot be trusted to apply, because the response body is what gets
 * logged and cached.
 *
 * THE JOIN ROUTE SPLITS 403 FROM 404, which is the opposite of the rule
 * everywhere else. Elsewhere every refusal collapses so a caller cannot probe
 * what exists. Here the event is ALREADY PUBLIC, so a refusal discloses nothing
 * new — and EVENT-FR-003's acceptance criterion requires the user to be told
 * that "the join control is not yet active AND the availability time is
 * stated". 404 stays collapsed, because that one is about existence.
 */
@ApiTags('events')
@Controller()
export class EventController {
  constructor(private readonly events: EventService) {}

  @Post('events')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an event (EVENT-API-001, EVENT-FR-001).',
    description:
      'Published immediately, with no approval step. BR-043: ANY active user may create ' +
      'events - creation is not restricted to verified organizations, so there is no role ' +
      'check here. An ONLINE event requires a meeting link and a PHYSICAL one a location; ' +
      'supplying both is refused, because V1 does not model a hybrid (EVENT-FR-001 A1).',
  })
  async create(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createBody)) body: CreateBody,
  ) {
    const result = await this.events.create(principal.userId, {
      title: body.title,
      description: body.description,
      startsAt: new Date(body.startsAt),
      eventType: body.eventType,
      meetingUrl: body.meetingUrl ?? null,
      locationText: body.locationText ?? null,
      categorySlug: body.categorySlug ?? null,
    });

    if (result.status === 'INVALID_INPUT') throw fieldError(result.problem);
    if (result.status === 'RATE_LIMITED') {
      throw new HttpException(
        {
          code: IdentityErrorCode.RATE_LIMITED,
          message: `You can create up to ${MAX_EVENTS_PER_DAY} events a day.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return toBody(result.event);
  }

  @Get('events')
  @ApiOperation({
    summary: 'Upcoming events (EVENT-API-002, EVENT-FR-005).',
    description:
      'SOONEST first - the only ascending list in the product, because an events list is read ' +
      'by what is about to happen rather than by what is newest. Past events drop off ' +
      'automatically. A CANCELLED event stays until its original date passes, marked, so ' +
      'somebody who never opened the notification still finds out (EVENT-FR-007).',
  })
  async listUpcoming(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    const page = await this.events.listUpcoming(
      principal.userId,
      query.limit ?? 20,
      cursorFrom(query),
    );
    return {
      events: page.events.map(toBody),
      nextCursor: cursorBody(page.nextCursor),
    };
  }

  @Get('users/:userId/events')
  @ApiOperation({
    summary: "A creator's events (EVENT-FR-001 step 8).",
    description:
      'Newest start first, because this is a history as much as a schedule. The creator sees ' +
      'their own auto-hidden events marked under review (BR-032); nobody else does.',
  })
  async listByCreator(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(userIdParam)) params: UserIdParam,
    @Query(new ZodValidationPipe(listQuery)) query: ListQuery,
  ) {
    const page = await this.events.listByCreator(
      principal.userId,
      params.userId,
      query.limit ?? 20,
      cursorFrom(query),
    );
    return {
      events: page.events.map(toBody),
      nextCursor: cursorBody(page.nextCursor),
    };
  }

  @Get('events/:id')
  @ApiOperation({
    summary: 'Event detail (EVENT-API-003, EVENT-FR-006).',
    description:
      'Title, description, creator, time, type, location or join state, COUNTS and category. ' +
      'Deliberately no attendee array and no meetingUrl - see the class comment.',
  })
  async detail(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const event = await this.events.findById(principal.userId, params.id);
    if (event === null) throw resourceUnavailable();
    return toBody(event);
  }

  @Put('events/:id/rsvp')
  @RequiresWrite()
  @ApiOperation({
    summary: 'RSVP (EVENT-API-004, EVENT-FR-004).',
    description:
      'Going or Interested, one response per user. Changing from Interested to Going is an ' +
      'update against the composite primary key, so the person is COUNTED ONCE - which is the ' +
      "requirement's acceptance criterion. RSVP to a past or cancelled event is refused, and " +
      'those two are told apart because they lead to different next actions.',
  })
  async rsvp(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(rsvpBody)) body: RsvpBody,
  ) {
    const result = await this.events.rsvp(principal.userId, params.id, body.response);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    if (result.status === 'EVENT_HAS_STARTED') {
      throw new BadRequestException({
        code: 'EVENT_HAS_STARTED',
        message: 'This event has already started.',
      });
    }
    if (result.status === 'EVENT_CANCELLED') {
      throw new BadRequestException({
        code: 'EVENT_CANCELLED',
        message: 'This event has been cancelled.',
      });
    }
    return toBody(result.event);
  }

  @Delete('events/:id/rsvp')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Withdraw an RSVP (EVENT-FR-004).',
    description:
      '"The user may change or withdraw the response at any time." Idempotent: withdrawing ' +
      'when nothing was recorded succeeds, because the caller asked for a state and that ' +
      'state now holds.',
  })
  async withdraw(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.events.withdrawRsvp(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    if (result.status !== 'RECORDED') throw resourceUnavailable();
    return toBody(result.event);
  }

  @Post('events/:id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the meeting link (EVENT-API-005, EVENT-FR-003).',
    description:
      'THE ONLY ROUTE THAT RETURNS A meetingUrl. Two conditions, both from the requirement: ' +
      `the caller must have RSVP'd, and the start must be within ${JOIN_WINDOW_MINUTES} ` +
      'minutes - "which limits scraping of open meeting rooms". 403 with a reason when the ' +
      'event is visible but the link is not yet yours; 404 only when the event itself is ' +
      'unavailable. BR-045: the platform hosts no video, so this always links out.',
  })
  async join(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.events.join(principal.userId, params.id);

    switch (result.status) {
      case 'AVAILABLE':
        return { meetingUrl: result.meetingUrl };
      case 'NOT_AVAILABLE':
        throw resourceUnavailable();
      case 'NOT_ATTENDING':
        throw new ForbiddenException({
          code: 'RSVP_REQUIRED',
          message: 'Respond to this event to get the joining link.',
        });
      case 'TOO_EARLY':
        // The availability time is STATED, which the acceptance criterion asks
        // for by name: "the join control is not yet active and the availability
        // time is stated".
        throw new ForbiddenException({
          code: 'JOIN_LINK_NOT_YET_AVAILABLE',
          message: `The joining link opens ${JOIN_WINDOW_MINUTES} minutes before the event starts.`,
          details: [{ path: 'availableFrom', message: result.availableFrom.toISOString() }],
        });
      case 'NOT_AN_ONLINE_EVENT':
        throw new BadRequestException({
          code: 'NOT_AN_ONLINE_EVENT',
          message: 'This event is held in person.',
        });
      case 'CANCELLED':
        throw new BadRequestException({
          code: 'EVENT_CANCELLED',
          message: 'This event has been cancelled.',
        });
    }
  }

  @Patch('events/:id')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Edit an event (EVENT-API-006, EVENT-FR-007).',
    description:
      'Creator only; anyone else gets the same neutral 404 as a missing event. The TYPE ' +
      'cannot change once anybody has responded (EVENT-FR-002) - somebody who agreed to walk ' +
      'to a park has not agreed to join a video call. Only a time, location or link change ' +
      'notifies attendees; fixing a typo at midnight must not wake fifty neighbours.',
  })
  async update(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(updateBody)) body: UpdateBody,
  ) {
    const result = await this.events.update(principal.userId, params.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
      ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
      ...(body.meetingUrl !== undefined ? { meetingUrl: body.meetingUrl } : {}),
      ...(body.locationText !== undefined ? { locationText: body.locationText } : {}),
      ...(body.categorySlug !== undefined ? { categorySlug: body.categorySlug } : {}),
    });

    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    if (result.status === 'INVALID_INPUT') throw fieldError(result.problem);
    if (result.status === 'TYPE_FROZEN') {
      // Refused "with the reason stated" — the acceptance criterion says so
      // explicitly, and a neutral refusal would leave the creator retrying.
      throw new BadRequestException({
        code: 'EVENT_TYPE_FROZEN',
        message: 'The type cannot change once people have responded to this event.',
      });
    }
    return { ...toBody(result.event), notifiedAttendees: result.notifiedAttendees };
  }

  @Delete('events/:id')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Cancel, or delete if nobody has responded (EVENT-FR-007).',
    description:
      'One intention - "this is not happening" - and the outcome is not the creator\'s ' +
      'choice. With no RSVPs the event is deleted. Once anybody has committed, deletion "is ' +
      'not offered": the event stays VISIBLE and marked cancelled until its original date ' +
      'passes, so somebody who never opens the notification still finds out.',
  })
  async cancel(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.events.cancelOrDelete(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    if (result.status === 'DELETED') return { outcome: 'DELETED' as const };
    return { outcome: 'CANCELLED' as const, notifiedAttendees: result.notifiedAttendees };
  }
}

function cursorFrom(query: ListQuery): { startsAt: Date; id: string } | undefined {
  return query.cursorStartsAt !== undefined && query.cursorId !== undefined
    ? { startsAt: new Date(query.cursorStartsAt), id: query.cursorId }
    : undefined;
}

function cursorBody(
  cursor: { startsAt: Date; id: string } | null,
): { cursorStartsAt: string; cursorId: string } | null {
  return cursor === null
    ? null
    : { cursorStartsAt: cursor.startsAt.toISOString(), cursorId: cursor.id };
}

/**
 * The public shape of an event.
 *
 * Built field by field rather than spread from the view, so adding a field to
 * `EventView` cannot silently publish it. That matters more here than usual:
 * the one field that must never appear is a live meeting credential.
 */
function toBody(e: EventView): Record<string, unknown> {
  return {
    id: e.id,
    creatorId: e.creatorId,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    eventType: e.eventType,
    locationText: e.locationText,
    categorySlug: e.categorySlug,
    status: e.status,
    goingCount: e.goingCount,
    interestedCount: e.interestedCount,
    joinLinkAvailable: e.joinLinkAvailable,
    joinLinkAvailableFrom: e.joinLinkAvailableFrom?.toISOString() ?? null,
    myResponse: e.myResponse,
    underReview: e.underReview,
    editedAt: e.editedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

function resourceUnavailable(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}

function fieldError(problem: { field: string; reason: string }): BadRequestException {
  return new BadRequestException({
    code: FoundationErrorCode.VALIDATION_FAILED,
    message: 'Please check the highlighted fields.',
    details: [{ path: problem.field, message: problem.reason }],
  });
}
