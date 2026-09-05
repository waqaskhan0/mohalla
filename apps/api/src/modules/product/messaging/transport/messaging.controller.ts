import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { HttpException } from '@nestjs/common';
import { FoundationErrorCode, IdentityErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../../platform/identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../../platform/identity/application/session.service.js';
import { MediaService } from '../../../platform/media/application/media.service.js';
import {
  MessagingService,
  type ConversationView,
  type MessageView,
} from '../application/messaging.service.js';
import { MESSAGE_BODY_MAX_LENGTH } from '../domain/message-body.js';
import { MAX_NEW_REQUESTS_PER_DAY } from '../domain/request-policy.js';

const idParam = z.object({ id: z.string().uuid() }).strict();
type IdParam = z.infer<typeof idParam>;

const mediaParam = z.object({ mediaId: z.string().uuid() }).strict();
type MediaParam = z.infer<typeof mediaParam>;

const openBody = z.object({ userId: z.string().uuid() }).strict();
type OpenBody = z.infer<typeof openBody>;

const sendBody = z
  .object({
    /**
     * Generated ON THE DEVICE before sending (ADR-009). Required, not
     * optional-with-a-server-fallback: a server-generated id would be different
     * on every retry, which is precisely the duplicate this field prevents.
     */
    clientMessageId: z.string().uuid(),
    // Generous bound; the domain counts grapheme clusters.
    body: z
      .string()
      .max(MESSAGE_BODY_MAX_LENGTH * 4)
      .nullish(),
    mediaId: z.string().uuid().nullish(),
  })
  .strict();
type SendBody = z.infer<typeof sendBody>;

const inboxQuery = z
  .object({
    section: z.enum(['CONVERSATIONS', 'REQUESTS']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().datetime().optional(),
  })
  .strict();
type InboxQuery = z.infer<typeof inboxQuery>;

const historyQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursorCreatedAt: z.string().datetime().optional(),
    cursorId: z.string().uuid().optional(),
  })
  .strict();
type HistoryQuery = z.infer<typeof historyQuery>;

const sinceQuery = z
  .object({
    since: z.string().datetime(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
type SinceQuery = z.infer<typeof sinceQuery>;

/**
 * Conversations and messages (MSG-FR-001…009).
 *
 * REST IS THE SOURCE OF TRUTH; REALTIME IS AN ACCELERATOR. `12` §1 states it
 * plainly, and every route here has to work with the socket switched off — a
 * missed socket event then costs latency and never data. The gateway calls the
 * same service these routes do, so there is no second implementation of any
 * rule to drift.
 *
 * EVERY REFUSAL THAT COULD INVOLVE A BLOCK IS THE SAME 404. Not a participant,
 * blocked either way, hidden, or no such conversation all produce
 * `RESOURCE_UNAVAILABLE`. MSG-FR-006 requires the send to be "refused without
 * disclosing the block", and the only reliable way to not disclose it is for
 * the refusal to be indistinguishable from every other one.
 *
 * THE ONE EXCEPTION IS THE REQUEST LIMIT, which is a 429 that says what it is.
 * That is not a disclosure about any person: it is a statement about the
 * caller's own recent behaviour, and MSG-FR-005 E3 makes it a stated limit
 * rather than a silent drop.
 */
@ApiTags('messaging')
@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly media: MediaService,
  ) {}

  @Post('conversations')
  @RequiresWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open the conversation with someone (MSG-FR-001).',
    description:
      '200, not 201: BR-024 says one conversation exists per pair FOREVER, so this RESOLVES a ' +
      'thread rather than creating one. Calling it twice returns the same conversation, which ' +
      'is the acceptance criterion. Opening notifies nobody and produces no request - an empty ' +
      'thread appears in neither inbox until something is actually sent.',
  })
  async open(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(openBody)) body: OpenBody,
  ) {
    const result = await this.messaging.open(principal.userId, body.userId);
    if (result.status === 'CANNOT_MESSAGE_SELF') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'You cannot message yourself.',
        details: [{ path: 'userId', message: 'CANNOT_MESSAGE_SELF' }],
      });
    }
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
    return toConversationBody(result.conversation);
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'The inbox, or the request list (MSG-FR-003).',
    description:
      'Most recent activity first. `section=REQUESTS` returns Message Requests, which are "a ' +
      'separate section with its own count" and never mixed into the main list. Conversations ' +
      'hidden by a block are absent while it stands and return intact on unblock.',
  })
  async inbox(
    @Principal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(inboxQuery)) query: InboxQuery,
  ) {
    const page = await this.messaging.listInbox(
      principal.userId,
      query.section ?? 'CONVERSATIONS',
      query.limit ?? 20,
      query.before === undefined ? undefined : new Date(query.before),
    );

    return {
      conversations: page.entries.map((e) => ({
        conversationId: e.conversationId,
        otherUserId: e.otherUserId,
        requestState: e.requestState,
        unreadCount: e.unreadCount,
        lastMessageAt: e.lastMessageAt?.toISOString() ?? null,
        preview: {
          body: e.previewBody,
          hasMedia: e.previewHasMedia,
          senderId: e.previewSenderId,
        },
        // EDGE-022: "the conversation becomes read-only and is clearly marked".
        // MARKED, which is why this is a field on the row rather than the
        // thread simply disappearing.
        readOnly: e.otherUserState === 'BANNED' || e.otherUserState === 'DELETED',
      })),
      nextBefore: page.nextBefore?.toISOString() ?? null,
    };
  }

  @Get('conversations/unread')
  @ApiOperation({
    summary: 'Unread badges (MSG-FR-003).',
    description:
      'Two numbers, because the inbox has two sections. Counts CONVERSATIONS with something ' +
      'unread rather than unread messages - "2" on that screen means two threads, not two ' +
      'hundred messages across two threads.',
  })
  async unread(@Principal() principal: AuthenticatedPrincipal) {
    return this.messaging.unreadCounts(principal.userId);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'Message history (MSG-API-002).',
    description:
      'NEWEST first, keyset-paginated - a conversation is read from the bottom, unlike a ' +
      "comment thread. `readAt` is present only on the viewer's OWN messages, and never at " +
      'all in a Message Request (MSG-FR-009).',
  })
  async history(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Query(new ZodValidationPipe(historyQuery)) query: HistoryQuery,
  ) {
    const cursor =
      query.cursorCreatedAt !== undefined && query.cursorId !== undefined
        ? { createdAt: new Date(query.cursorCreatedAt), id: query.cursorId }
        : undefined;

    const page = await this.messaging.listMessages(
      principal.userId,
      params.id,
      query.limit ?? 30,
      cursor,
    );
    if (page === null) throw resourceUnavailable();

    return {
      messages: page.messages.map(toMessageBody),
      nextCursor:
        page.nextCursor === null
          ? null
          : {
              cursorCreatedAt: page.nextCursor.createdAt.toISOString(),
              cursorId: page.nextCursor.id,
            },
    };
  }

  @Get('conversations/:id/messages/since')
  @ApiOperation({
    summary: 'Reconcile after a dropped connection (MSG-FR-004 E1).',
    description:
      'Everything after a server timestamp, OLDEST first - the client is appending to what it ' +
      'already holds. This is also the POLLING FALLBACK ADR-009 names: it returns the same ' +
      'messages carrying the same client ids, so a client that switches transports cannot ' +
      'duplicate anything.',
  })
  async since(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Query(new ZodValidationPipe(sinceQuery)) query: SinceQuery,
  ) {
    const messages = await this.messaging.listMessagesSince(
      principal.userId,
      params.id,
      new Date(query.since),
      query.limit ?? 100,
    );
    if (messages === null) throw resourceUnavailable();
    return { messages: messages.map(toMessageBody) };
  }

  @Post('conversations/:id/messages')
  @RequiresWrite()
  @ApiOperation({
    summary: 'Send a message (MSG-API-001, MSG-FR-002/004/006).',
    description:
      'Persisted BEFORE it is acknowledged (ADR-009 step 3). A repeat of the same ' +
      '`clientMessageId` returns the ORIGINAL message with 200 instead of creating a second ' +
      'with 201 - so a retry after a timeout, a duplicate delivery and a switch from socket to ' +
      'polling all resolve to exactly one message (EDGE-020, EDGE-021).',
  })
  async send(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
    @Body(new ZodValidationPipe(sendBody)) body: SendBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.messaging.send(principal.userId, {
      conversationId: params.id,
      clientMessageId: body.clientMessageId,
      body: body.body ?? null,
      mediaId: body.mediaId ?? null,
    });

    return this.finishSend(result, res);
  }

  @Post('conversations/:id/read')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark read (MSG-FR-009).',
    description:
      "Zeroes this participant's unread count. Safe to call on a Message Request: the read " +
      'marker moves, and no receipt is derived from it while the thread is a request, so the ' +
      'sender learns nothing - "reading a request does not signal anything to a stranger".',
  })
  async read(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.messaging.markRead(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Post('conversations/:id/accept')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Accept a Message Request (MSG-FR-005).',
    description:
      'The thread moves to the main inbox and normal messaging resumes. Idempotent: accepting ' +
      'an already-accepted conversation succeeds.',
  })
  async accept(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.messaging.acceptRequest(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Post('conversations/:id/decline')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Decline a Message Request (MSG-FR-005 A1, BR-028).',
    description:
      'THE SENDER IS TOLD NOTHING - no event, no notification, no observable change. BR-028: ' +
      '"a declined message request produces no signal to the sender, because informing them ' +
      'invites retaliation." Later messages from that sender are stored in the same suppressed ' +
      'thread rather than raising new requests, so they remain available if the recipient ' +
      'reports or later accepts.',
  })
  async decline(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(idParam)) params: IdParam,
  ) {
    const result = await this.messaging.declineRequest(principal.userId, params.id);
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();
  }

  @Get('conversations/media/:mediaId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Read an image sent in a message (MSG-FR-008).',
    description:
      'THE ONLY WAY TO REACH A MESSAGE IMAGE. `GET /media/{id}` refuses RESTRICTED objects ' +
      'outright, because it has no way to know who a participant is. This route checks that ' +
      "the caller is in the conversation the image was sent in, which is exactly MSG-FR-008's " +
      'criterion: "not retrievable by anyone outside that conversation." `no-store` rather ' +
      'than the long immutable cache post media gets - a private image should not sit in a ' +
      'shared cache.',
  })
  async messageMedia(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(mediaParam)) params: MediaParam,
    @Res() res: Response,
  ) {
    // The access check first, and the SAME 404 whether the media does not
    // exist, is not attached to any message, or belongs to a conversation the
    // caller is not in. Distinguishing them would turn this into a probe for
    // other people's private uploads.
    const allowed = await this.messaging.mayViewMessageMedia(principal.userId, params.mediaId);
    if (!allowed) throw resourceUnavailable();

    const served = await this.media.readServedRestricted(params.mediaId);
    if (served === null) throw resourceUnavailable();

    res.setHeader('Content-Type', served.mime);
    res.setHeader('Content-Length', String(served.bytes.length));
    res.end(Buffer.from(served.bytes));
  }

  /**
   * Turn a send result into a response.
   *
   * Shared with the socket path in spirit but not in code: the gateway returns
   * the same shape through an acknowledgement rather than a status line, and
   * both get it from the same service.
   */
  private finishSend(
    result: Awaited<ReturnType<MessagingService['send']>>,
    res: Response,
  ): unknown {
    if (result.status === 'INVALID_INPUT') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: 'Please check the highlighted fields.',
        details: [{ path: result.field, message: result.reason }],
      });
    }
    if (result.status === 'READ_ONLY') {
      // EDGE-022. Told plainly, because it is about the CONVERSATION rather
      // than about the other person's account: the client needs to close the
      // compose box and mark the thread, and a neutral 404 would instead make
      // a thread the user can still read look like one that vanished.
      throw new BadRequestException({
        code: 'CONVERSATION_READ_ONLY',
        message: 'This conversation can no longer receive messages.',
      });
    }
    if (result.status === 'REQUEST_LIMIT_REACHED') {
      // 429 with `RATE_LIMITED`, the code the catalogue already carries for a
      // limit in force. A message-request-specific code would tell a caller
      // which limit they hit, and the limits are a defence - naming them is how
      // somebody learns to stay just under one.
      throw new HttpException(
        {
          code: IdentityErrorCode.RATE_LIMITED,
          message: `You can start up to ${MAX_NEW_REQUESTS_PER_DAY} new conversations a day.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result.status === 'NOT_AVAILABLE') throw resourceUnavailable();

    // 201 for a message that was created, 200 for a replay of one that already
    // existed. The openapi contract lists both, and the distinction is useful
    // to a client deciding whether to animate a new bubble.
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return toMessageBody(result.message);
  }
}

function toMessageBody(m: MessageView): Record<string, unknown> {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    mediaId: m.mediaId,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  };
}

function toConversationBody(c: ConversationView): Record<string, unknown> {
  return {
    conversationId: c.id,
    otherUserId: c.otherUserId,
    requestState: c.requestState,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    readOnly: c.readOnly,
    createdAt: c.createdAt.toISOString(),
  };
}

function resourceUnavailable(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_UNAVAILABLE',
    message: 'This content is no longer available.',
  });
}
