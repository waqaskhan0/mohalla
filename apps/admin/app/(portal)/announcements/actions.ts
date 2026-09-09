'use server';

import { revalidatePath } from 'next/cache';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { guardedRequest } from '../../../lib/admin-api/guarded';
import { messageForCode } from '../../../lib/admin-api/messages';
import { announcementPublishedSchema } from '../../../lib/admin-api/schemas';
import { FIELDS, LIMITS, type AnnouncementState, type Field } from './announcement-state';

/**
 * Publish an announcement — ADMIN-FR-009, NOTIF-FR-005.
 *
 * BOTH LANGUAGES ARE REQUIRED, and the requirement gives the reason rather than
 * leaving it to taste: "a single-language announcement fails half the
 * audience." The API enforces it in the schema shape, so the refusal happens
 * before any handler runs. It is checked here too, per field, so the reader is
 * told WHICH version is missing instead of being handed one message about both.
 *
 * THE BROADCAST IS A SEPARATE DECISION FROM THE PUBLICATION, and the response
 * reflects that: `broadcast` in the result is what the server did, not what the
 * form asked for. The portal reports the server's answer, because telling an
 * administrator a push went out when it did not is how the same announcement
 * gets published twice.
 */
export async function publishAnnouncement(
  _previous: AnnouncementState,
  form: FormData,
): Promise<AnnouncementState> {
  const values: Record<Field, string> = {
    titleEn: String(form.get('titleEn') ?? '').trim(),
    titleUr: String(form.get('titleUr') ?? '').trim(),
    bodyEn: String(form.get('bodyEn') ?? '').trim(),
    bodyUr: String(form.get('bodyUr') ?? '').trim(),
  };
  const broadcastRequested = form.get('broadcast') === 'on';
  const rawExpiry = String(form.get('expiresAt') ?? '').trim();

  for (const field of FIELDS) {
    if (values[field] === '') {
      return { status: 'INVALID', field, message: MISSING[field] };
    }
    const max = field.startsWith('title') ? LIMITS.title : LIMITS.body;
    if (values[field].length > max) {
      return {
        status: 'INVALID',
        field,
        message: `At most ${max} characters. This one is ${values[field].length}.`,
      };
    }
  }

  // A `date` input gives `YYYY-MM-DD` and the API wants an ISO instant. Read as
  // the END of the chosen day in this host's zone, because somebody picking
  // today means "until today is over", not "until midnight this morning" —
  // which would already be in the past and refused.
  const expiry = endOfDay(rawExpiry);
  if (expiry === null) {
    return {
      status: 'INVALID',
      field: 'expiresAt',
      message: 'Choose the last day this announcement should be shown.',
    };
  }
  if (expiry.getTime() <= Date.now()) {
    return {
      status: 'INVALID',
      field: 'expiresAt',
      message: 'The expiry must be in the future. Choose today or a later date.',
    };
  }

  try {
    const result = await guardedRequest({
      path: '/admin/announcements',
      method: 'POST',
      body: {
        titleEn: values.titleEn,
        titleUr: values.titleUr,
        bodyEn: values.bodyEn,
        bodyUr: values.bodyUr,
        expiresAt: expiry.toISOString(),
        broadcast: broadcastRequested,
      },
      schema: announcementPublishedSchema,
    });

    // The allowance on the page is now stale if a broadcast went out.
    revalidatePath('/announcements');

    return {
      status: 'PUBLISHED',
      id: result.id,
      broadcast: result.broadcast,
      broadcastRequested,
    };
  } catch (error) {
    return publishFailure(error);
  }
}

const MISSING: Record<Field, string> = {
  titleEn: 'The English title is required. Both language versions are needed.',
  titleUr: 'The Urdu title is required — a single-language announcement reaches half the audience.',
  bodyEn: 'The English text is required. Both language versions are needed.',
  bodyUr: 'The Urdu text is required — a single-language announcement reaches half the audience.',
};

/**
 * The end of a `YYYY-MM-DD` day, or null.
 *
 * Parsed by parts rather than handed to `new Date(string)`, because
 * `new Date('2026-09-09')` is midnight UTC while `new Date('2026/09/09')` is
 * midnight local — and a one-day announcement is exactly where that difference
 * shows up as an expiry in the past.
 */
function endOfDay(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
  return Number.isFinite(date.getTime()) ? date : null;
}

function publishFailure(error: unknown): AnnouncementState {
  if (error instanceof AdminApiError) {
    // NOTIF-FR-005's cap, and the API's refusal states the limit. Not a fault:
    // the announcement was not published, and the reader needs to know they
    // may still publish it without the push.
    if (error.status === 429) {
      return {
        status: 'BROADCAST_LIMIT',
        message: messageForCode('RATE_LIMITED'),
      };
    }

    if (error.code === 'VALIDATION_FAILED') {
      // The API names the failing field in `details`: `titleUr` for a missing
      // translation, `expiresAt` for a bad expiry.
      const field = (['titleEn', 'titleUr', 'bodyEn', 'bodyUr'] as const).find(
        (candidate) => error.details[candidate] !== undefined,
      );
      if (field !== undefined) {
        return { status: 'INVALID', field, message: MISSING[field] };
      }
      if (error.details.expiresAt !== undefined) {
        return {
          status: 'INVALID',
          field: 'expiresAt',
          message: 'The expiry must be in the future. Choose today or a later date.',
        };
      }
    }

    return {
      status: 'FAILED',
      message: messageForCode(error.code),
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  if (error instanceof AdminApiShapeError) {
    // The announcement may well have been PUBLISHED and only the response
    // failed to parse. There is no route to withdraw one, so this must not
    // invite a second attempt — it says to check before republishing.
    return {
      status: 'FAILED',
      message:
        'The API answered in a shape this portal does not understand, so it is not certain whether the announcement was published. Do not publish it again until you have checked — there is no way to withdraw a duplicate.',
      ...(error.correlationId ? { reference: error.correlationId } : {}),
    };
  }

  throw error;
}
