import { countGraphemes } from '../../profile/domain/profile-fields.js';

/**
 * Message content rules (MSG-FR-002 · MSG-FR-008).
 *
 * "The user types up to 2,000 characters and sends" · "empty and
 * whitespace-only messages are refused".
 *
 * Counted in GRAPHEME CLUSTERS, for the same reason posts and comments are
 * (BR-012): counting code points charges an Urdu writer for diacritics a reader
 * never sees, so the same sentence would cost more in Urdu than in English on a
 * platform whose whole point is that Urdu is a first-class language.
 *
 * AN IMAGE IS A MESSAGE. MSG-FR-008 allows one image per message, and a photo
 * of a broken street light with no caption is a complete thing to send. So the
 * emptiness rule is "must carry text OR an attachment" rather than "must carry
 * text" — which is also exactly what the database CHECK says, so the two cannot
 * drift apart.
 */

export const MESSAGE_BODY_MAX_LENGTH = 2000;

export type MessageBodyRejection = 'NOT_A_STRING' | 'EMPTY' | 'TOO_LONG';

export function checkMessageBody(
  body: unknown,
  context: { hasAttachment: boolean },
): MessageBodyRejection | null {
  if (body === null || body === undefined) {
    return context.hasAttachment ? null : 'EMPTY';
  }
  if (typeof body !== 'string') return 'NOT_A_STRING';

  const trimmed = body.trim();
  if (trimmed === '') return context.hasAttachment ? null : 'EMPTY';
  if (countGraphemes(trimmed) > MESSAGE_BODY_MAX_LENGTH) return 'TOO_LONG';
  return null;
}

/**
 * @returns the stored form, or null when the message is attachment-only.
 *
 * Null rather than an empty string, because the column is nullable and the
 * CHECK distinguishes the two: an empty string would satisfy "not null" while
 * meaning nothing, which is precisely the state the constraint exists to
 * forbid.
 */
export function normalizeMessageBody(body: string | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  return trimmed === '' ? null : trimmed;
}
