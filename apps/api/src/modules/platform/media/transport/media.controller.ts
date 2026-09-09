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
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { FoundationErrorCode } from '@mohalla/contracts';
import { ZodValidationPipe } from '../../../../common/validation/zod-validation.pipe.js';
import { Principal, RequiresWrite } from '../../identity/transport/session.guard.js';
import type { AuthenticatedPrincipal } from '../../identity/application/session.service.js';
import { MediaService } from '../application/media.service.js';
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES } from '../domain/upload-limits.js';

const slotBody = z
  .object({
    kind: z.enum(['IMAGE', 'DOCUMENT']),
    /** Advisory. The stored object is re-measured (SEC-012). */
    declaredBytes: z.coerce.number().int().min(1).max(MAX_DOCUMENT_BYTES),
    /**
     * MSG-FR-008. A RESTRICTED object is never served by `GET /media/{id}`;
     * the module owning the record it is attached to serves it after its own
     * access check. Optional, defaulting to PUBLIC, so existing post uploads
     * are unaffected - and so asking for privacy is an explicit act.
     */
    visibility: z.enum(['PUBLIC', 'RESTRICTED']).optional(),
  })
  .strict();
type SlotBody = z.infer<typeof slotBody>;

const mediaIdParam = z.object({ id: z.string().uuid() }).strict();
type MediaIdParam = z.infer<typeof mediaIdParam>;

const uploadKeyParam = z.object({ key: z.string().min(1).max(200) }).strict();
type UploadKeyParam = z.infer<typeof uploadKeyParam>;

/**
 * Media (MED-API-001…003, ADR-013).
 *
 * THE UPLOAD ROUTE HERE IS A DEVELOPMENT ARRANGEMENT, and saying so plainly
 * matters. ADR-013 has the device upload straight to object storage through a
 * presigned URL, so image bytes never cross the API — which matters given how
 * expensive Pakistani mobile data is. A filesystem cannot presign, so the local
 * adapter points the client back here and `PUT /media/upload/:key` accepts the
 * bytes. When the S3 adapter arrives, that route stops being used and this
 * controller keeps only the slot, complete and read endpoints.
 *
 * What does NOT change with the adapter is every security property: the key is
 * server-chosen, quarantine is never served, inspection happens before
 * promotion, and the served key is random and unrelated to anything the client
 * saw.
 */
@ApiTags('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('media/upload-slot')
  @RequiresWrite()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request an upload slot (MED-API-001).',
    description:
      'Returns a media id and an upload target scoped to a SERVER-CHOSEN quarantine key. The ' +
      'declared size is advisory - it refuses an oversized upload before the bytes move, but ' +
      'the stored object is re-measured and a client that under-declares is caught then ' +
      '(SEC-012, MEDIA-FR-005).',
  })
  async requestSlot(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(slotBody)) body: SlotBody,
  ) {
    const result = await this.media.requestSlot({
      ownerId: principal.userId,
      kind: body.kind,
      declaredBytes: body.declaredBytes,
      visibility: body.visibility,
    });

    if (result.status === 'REJECTED') {
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: uploadMessage(result.reason),
        details: [{ path: 'declaredBytes', message: result.reason }],
      });
    }

    return {
      mediaId: result.mediaId,
      upload: {
        url: result.upload.url,
        method: result.upload.method,
        headers: result.upload.headers,
        expiresAt: result.upload.expiresAt.toISOString(),
      },
    };
  }

  /**
   * Accept bytes into quarantine.
   *
   * Development and CI only — see the class comment. Deliberately does NOT
   * inspect: quarantine exists precisely so unvalidated bytes have somewhere to
   * land, and inspection happens at `complete`.
   */
  @Put('media/upload/:key')
  @RequiresWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Upload bytes into quarantine (local storage adapter only).',
    description:
      'Not part of the frozen API. Exists because a filesystem cannot presign; the S3 adapter ' +
      'replaces this with a direct-to-storage upload and this route disappears.',
  })
  async uploadBytes(
    @Param(new ZodValidationPipe(uploadKeyParam)) params: UploadKeyParam,
    @Req() req: Request,
  ) {
    const bytes = await readBody(req, MAX_DOCUMENT_BYTES);
    if (bytes === null) {
      // Refused mid-stream once the ceiling is passed, so a 40 MB upload does
      // not have to complete before being rejected.
      throw new BadRequestException({
        code: FoundationErrorCode.VALIDATION_FAILED,
        message: `Files must be under ${Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`,
      });
    }
    await this.media.acceptQuarantinedBytes(decodeURIComponent(params.key), bytes);
  }

  @Post('media/:id/complete')
  @RequiresWrite()
  // 200, not the 201 NestJS defaults @Post to: this RESOLVES an existing media
  // row rather than creating anything. The slot request is what created it.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report the upload finished; inspect and resolve (MED-API-002).',
    description:
      'Runs content inspection (SEC-013): magic-byte identification, executable rejection, and ' +
      'a re-measure of size and dimensions. On success the object is promoted under a NEW ' +
      'random key. On failure the object is DELETED, not merely marked - MEDIA-FR-005 requires ' +
      '"rejected and no file is stored". Safe to call twice.',
  })
  async complete(
    @Principal() principal: AuthenticatedPrincipal,
    @Param(new ZodValidationPipe(mediaIdParam)) params: MediaIdParam,
  ) {
    const result = await this.media.completeUpload(params.id, principal.userId);

    if (result.status === 'NOT_FOUND') {
      // Same answer for "no such media" and "not yours" - a media id is not a
      // secret, and distinguishing them would let anyone probe which exist.
      throw new NotFoundException({
        code: 'RESOURCE_UNAVAILABLE',
        message: 'This content is no longer available.',
      });
    }
    if (result.status === 'REJECTED') {
      // The reason IS returned: it is the caller's own file, and EDGE-013
      // needs them to know which attachment failed so they can retry that one
      // without re-uploading the others.
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: uploadMessage(result.reason),
        details: [{ path: 'file', message: result.reason }],
      });
    }
    if (result.status === 'ALREADY_RESOLVED') {
      return { mediaId: result.media.id, state: result.media.state };
    }

    return {
      mediaId: result.media.id,
      state: result.media.state,
      mime: result.media.mimeVerified,
      byteSize: result.media.byteSize,
      width: result.media.width,
      height: result.media.height,
    };
  }

  @Get('media/:id')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Read a media object (MED-API-003).',
    description:
      'Serves READY, PUBLIC media only. Quarantined, rejected and RESTRICTED objects are ' +
      'all unreachable here, and all give the same 404 - a message attachment is not ' +
      'retrievable by id (MSG-FR-008), and this route cannot say so without disclosing that ' +
      'the id names something. The Content-Type is the VERIFIED type from inspection, never ' +
      'a client claim, and nosniff stops a browser second-guessing it.',
  })
  async read(
    @Param(new ZodValidationPipe(mediaIdParam)) params: MediaIdParam,
    @Res() res: Response,
  ) {
    const served = await this.media.readServed(params.id);
    if (served === null) {
      throw new NotFoundException({
        code: 'RESOURCE_UNAVAILABLE',
        message: 'This content is no longer available.',
      });
    }

    // The verified type. Serving a client-declared type would let an uploader
    // have their file interpreted as something it is not.
    res.setHeader('Content-Type', served.mime);
    res.setHeader('Content-Length', String(served.bytes.length));
    res.end(Buffer.from(served.bytes));
  }
}

/**
 * Read a request body with a hard ceiling.
 *
 * Bounded as it streams rather than buffered and then checked, so a 40 MB
 * upload is cut off rather than fully received (MEDIA-FR-005). Returns null
 * once the ceiling is passed.
 */
async function readBody(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) return null;
    chunks.push(buf);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** A message a person can act on, without naming internals. */
function uploadMessage(reason: string): string {
  switch (reason) {
    case 'TOO_LARGE':
      return `Images must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB and documents under ${Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`;
    case 'IMAGE_TOO_LARGE_IN_PIXELS':
      return 'That image is too large. Please resize it and try again.';
    case 'EXECUTABLE_CONTENT':
    case 'UNRECOGNISED_TYPE':
    case 'TYPE_NOT_ALLOWED':
    case 'TYPE_DOES_NOT_MATCH_SLOT':
      return 'Choose a JPG, PNG or WebP image.';
    case 'PDF_ACTIVE_CONTENT':
    case 'PDF_MALFORMED':
      return 'That document could not be accepted.';
    case 'NO_OBJECT_UPLOADED':
      return 'The upload did not complete. Please try again.';
    default:
      return 'That file could not be accepted.';
  }
}
