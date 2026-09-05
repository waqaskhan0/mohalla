/**
 * The human-readable names a notification template needs.
 *
 * "{actor} liked your post" needs a display name, and an event reminder needs
 * the event's title. Both live in product-tier modules, so both arrive through
 * a port for the same reason `block-check.port.ts` does — platform must not
 * import product.
 *
 * THESE VALUES ARE NEVER TRANSLATED. LOCALE-FR-006: "user-generated content
 * inside a notification is never translated — only the surrounding template."
 * A person's name and an event's title are data, and putting either through a
 * translation step would be both wrong and, for a name, insulting.
 *
 * A missing name returns an empty string rather than throwing. A notification
 * whose actor was deleted mid-flight should still be delivered — the template
 * reads slightly oddly, which is a far better outcome than a dead-lettered row
 * and no notification at all.
 */
export const ACTOR_NAMES = Symbol.for('mohalla.notifications.actorNames');

export interface ActorNames {
  displayNameOf(userId: string): Promise<string>;
  eventTitleOf(eventId: string): Promise<string>;
}
