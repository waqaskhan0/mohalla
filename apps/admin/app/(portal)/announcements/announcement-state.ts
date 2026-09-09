/**
 * The state of the announcement form.
 *
 * IN ITS OWN MODULE because `actions.ts` is a `'use server'` file.
 */

/** The API's own bounds, restated so the fields can say them first. */
export const LIMITS = {
  title: 200,
  body: 2000,
} as const;

/** The four content fields, so the form and the action cannot disagree. */
export const FIELDS = ['titleEn', 'titleUr', 'bodyEn', 'bodyUr'] as const;
export type Field = (typeof FIELDS)[number];

export type AnnouncementState =
  | { status: 'IDLE' }
  /**
   * What the API says happened, which is not always what was asked for: a
   * publication can succeed while its broadcast is refused, so `broadcast`
   * here is the server's answer rather than the checkbox's value.
   */
  | { status: 'PUBLISHED'; id: string; broadcast: boolean; broadcastRequested: boolean }
  | { status: 'INVALID'; field: Field | 'expiresAt'; message: string }
  /** The broadcast cap (NOTIF-FR-005). Not a fault - a limit, and it says so. */
  | { status: 'BROADCAST_LIMIT'; message: string }
  | { status: 'FAILED'; message: string; reference?: string };

export const IDLE_ANNOUNCEMENT: AnnouncementState = { status: 'IDLE' };
