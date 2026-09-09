import type { DetectedType } from './content-inspection.js';

/**
 * Upload limits (SRS §12 · SEC-012 · MEDIA-FR-005 · BR-013/015).
 *
 * MEDIA-FR-005 is the reason this is a server-side module at all:
 *
 *   > all size, count and type limits are enforced on the server irrespective
 *   > of what the client permitted
 *
 * with the acceptance criterion "GIVEN a request that bypasses the app and
 * posts a 40 MB file directly, WHEN it reaches the server, THEN it is rejected
 * and no file is stored". So every value here is checked twice: once when the
 * slot is requested (advisory, to fail fast and cheaply) and again against the
 * ACTUAL stored bytes (authoritative). The declared size is never trusted.
 */

/** §12: images under 5 MB before compression. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * §12 / MEDIA-FR-001: under 500 KB AFTER client-side compression.
 *
 * Not enforced as a hard limit, and that is deliberate. Client-side
 * compression is mandatory (NFR-PERF-005) because Pakistani mobile data is
 * expensive and slow, but a device that compresses to 520 KB has still done
 * the expensive part, and refusing it would lose the user's photo to save
 * 20 KB. `MAX_IMAGE_BYTES` is the wall; this is the target the client aims at
 * and the server records against.
 */
export const TARGET_COMPRESSED_IMAGE_BYTES = 500 * 1024;

/** MEDIA-FR-001: target longest edge after client-side resize. */
export const TARGET_LONGEST_EDGE_PX = 1600;

/**
 * An upper bound on stored dimensions.
 *
 * Not in §12, and added for a reason §12 does not cover: a 60,000 × 60,000 PNG
 * can be a few hundred kilobytes compressed and gigabytes decompressed — a
 * decompression bomb that passes a byte-size check comfortably. Any thumbnail
 * pipeline that later opens one of these would exhaust memory, so the limit is
 * on the DIMENSIONS rather than only on the file.
 */
export const MAX_IMAGE_EDGE_PX = 10_000;

/** §12 / BR-015: PDFs up to 10 MB. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** BR-013: at most four images per post. Also structural in `post_media`. */
export const MAX_IMAGES_PER_POST = 4;

/** BR-015: one document per post. */
export const MAX_DOCUMENTS_PER_POST = 1;

export type LimitRejection =
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'TOO_MANY_IMAGES'
  | 'TOO_MANY_DOCUMENTS'
  | 'IMAGE_TOO_LARGE_IN_PIXELS'
  | 'TYPE_NOT_ALLOWED';

/** The maximum a file of this type may occupy. */
export function maxBytesFor(type: DetectedType): number {
  return type === 'application/pdf' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
}

/**
 * Check a file's measured size and dimensions.
 *
 * Takes MEASURED values — the caller has already inspected the bytes. A variant
 * that accepted declared values would be the one somebody reached for by
 * mistake, so there isn't one.
 */
export function checkMeasuredFile(input: {
  type: DetectedType;
  byteSize: number;
  width?: number | undefined;
  height?: number | undefined;
}): LimitRejection | null {
  if (input.byteSize <= 0) return 'EMPTY';
  if (input.byteSize > maxBytesFor(input.type)) return 'TOO_LARGE';

  if (input.type !== 'application/pdf') {
    const longest = Math.max(input.width ?? 0, input.height ?? 0);
    if (longest > MAX_IMAGE_EDGE_PX) return 'IMAGE_TOO_LARGE_IN_PIXELS';
  }
  return null;
}

/**
 * Check a DECLARED size at slot-request time.
 *
 * Advisory only, and named to say so. Its job is to refuse a 40 MB upload
 * before 40 MB is transferred, not to establish the truth — the stored object
 * is re-measured afterwards, and a client that under-declares is caught there.
 */
export function checkDeclaredSize(
  kind: 'IMAGE' | 'DOCUMENT',
  declaredBytes: number,
): LimitRejection | null {
  if (!Number.isFinite(declaredBytes) || declaredBytes <= 0) return 'EMPTY';
  const max = kind === 'DOCUMENT' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  return declaredBytes > max ? 'TOO_LARGE' : null;
}

/** BR-013 / BR-015: how many attachments a post may carry. */
export function checkAttachmentCounts(counts: {
  images: number;
  documents: number;
}): LimitRejection | null {
  if (counts.images > MAX_IMAGES_PER_POST) return 'TOO_MANY_IMAGES';
  if (counts.documents > MAX_DOCUMENTS_PER_POST) return 'TOO_MANY_DOCUMENTS';
  return null;
}
