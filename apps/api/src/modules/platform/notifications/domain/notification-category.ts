/**
 * The notification catalogue (NOTIF-FR-003/004/006/007 · LOCALE-FR-006).
 *
 * NOTIF-FR-007 offers the user SEVEN switches by name: "likes, comments,
 * follows, mentions, messages, events, announcements". NOTIF-FR-003 lists EIGHT
 * things that produce a notification, because "a comment on their post" and "a
 * reply to their comment" are different events.
 *
 * So there are eight categories and seven switches, and `pushPreferenceFor`
 * maps one onto the other. Resolving that mismatch by inventing an eighth
 * switch would be adding a setting nobody asked for; resolving it by merging
 * the two events would lose the distinction the requirement draws.
 */

export const NOTIFICATION_CATEGORIES = [
  'LIKE',
  'COMMENT',
  'REPLY',
  'FOLLOW',
  'MENTION',
  'MESSAGE',
  'EVENT',
  'ANNOUNCEMENT',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** The seven switches NOTIF-FR-007 exposes. */
export const PREFERENCE_KEYS = [
  'LIKE',
  'COMMENT',
  'FOLLOW',
  'MENTION',
  'MESSAGE',
  'EVENT',
  'ANNOUNCEMENT',
] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

/**
 * Which switch governs this category.
 *
 * REPLY answers to the COMMENT switch. Somebody who turned off comment
 * notifications wants their thread to stop buzzing, and a reply is part of that
 * thread — honouring the letter of the setting while still sending replies
 * would be technically defensible and obviously wrong.
 */
export function pushPreferenceFor(category: NotificationCategory): PreferenceKey {
  return category === 'REPLY' ? 'COMMENT' : category;
}

export type NotificationTarget =
  'POST' | 'COMMENT' | 'EVENT' | 'CONVERSATION' | 'PROFILE' | 'ANNOUNCEMENT';

/**
 * Template keys, one per notification kind.
 *
 * Keys rather than strings, and stored as keys on the row. LOCALE-FR-002
 * requires switching language to update "the entire interface without
 * reinstall", which a centre of pre-rendered text cannot do — so rendering
 * happens when the notification is READ, in whatever language the reader is
 * using then.
 */
export const TEMPLATE_KEYS = {
  LIKE: 'notification.like',
  LIKE_BATCHED: 'notification.like.batched',
  COMMENT: 'notification.comment',
  REPLY: 'notification.reply',
  FOLLOW: 'notification.follow',
  MENTION: 'notification.mention',
  MESSAGE: 'notification.message',
  EVENT_RSVP: 'notification.event.rsvp',
  EVENT_CHANGED: 'notification.event.changed',
  EVENT_CANCELLED: 'notification.event.cancelled',
  EVENT_REMINDER_24H: 'notification.event.reminder24h',
  EVENT_REMINDER_1H: 'notification.event.reminder1h',
  ANNOUNCEMENT: 'notification.announcement',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS];
