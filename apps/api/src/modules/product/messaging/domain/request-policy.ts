/**
 * MESSAGE REQUESTS (MSG-FR-005 · BR-027/028 · NOTIF-FR-004 · EDGE-019).
 *
 * The requirement says what this is for in plain words: a message from someone
 * the recipient does not follow lands in a separate area, and this is "the
 * platform's principal defence against unsolicited contact, and matters most
 * for women users". OD-022 promoted it from Should to Must on 1 September 2026,
 * so it is on the critical path and is not cuttable.
 *
 * FOUR SILENCES MAKE IT WORK, AND EACH ONE IS A SEPARATE PLACE TO GET IT WRONG.
 *
 *   1. NO PUSH NOTIFICATION for a request (BR-027, NOTIF-FR-004). A push is a
 *      contact. If a stranger's message buzzes the recipient's phone, the
 *      request area has failed at the only moment that mattered.
 *   2. NO READ RECEIPT for a request (MSG-FR-009). Reading a stranger's message
 *      must not tell them you read it — that is a signal, and a signal is an
 *      invitation to send another.
 *   3. NO SIGNAL ON DECLINE (BR-028), whose stated reason is worth keeping in
 *      view: "informing them invites retaliation". A declined sender sees an
 *      ordinary thread with no replies, indistinguishable from being ignored.
 *   4. NO DISCLOSURE OF A BLOCK (BR-025), same shape, same reason.
 *
 * All four are absences. Nothing here emits, notifies or returns them, and the
 * tests assert the absence rather than any behaviour — which is why they are
 * written down together, in the one file that decides them.
 */

/**
 * MSG-FR-005 E3: "a maximum of 10 new message requests per sender per day".
 *
 * A limit on OPENING threads, not on messages: someone conducting an accepted
 * conversation is not rate-limited, and someone opening their eleventh cold
 * thread in a day is doing something the feature exists to stop. It is
 * deliberately generous — the cost of a false positive here is a legitimate
 * neighbour told "not now", so the threshold sits well above ordinary use.
 */
export const MAX_NEW_REQUESTS_PER_DAY = 10;

export const REQUEST_QUOTA_WINDOW_HOURS = 24;

export type RequestState = 'ACCEPTED' | 'PENDING' | 'DECLINED';

/**
 * What state the RECIPIENT's side of a new conversation starts in.
 *
 * BR-027: "A first message from a user the recipient does not follow becomes a
 * Message Request." The test is whether the RECIPIENT follows the SENDER — not
 * the other way round. Getting that backwards would mean anyone could bypass
 * the request area by following their target first, which is precisely what an
 * unwanted contact would do.
 *
 * The SENDER's own side is always ACCEPTED. They opened the thread; from their
 * view it is an ordinary conversation, and that asymmetry is what keeps a
 * decline invisible.
 */
export function initialRecipientState(facts: { recipientFollowsSender: boolean }): RequestState {
  return facts.recipientFollowsSender ? 'ACCEPTED' : 'PENDING';
}

/**
 * Should this send create a NEW request, and therefore count against the quota?
 *
 * Only the first message into a thread whose recipient side is PENDING. A
 * DECLINED thread is explicitly NOT a new request — MSG-FR-005 A1: "further
 * messages from that sender go to the same suppressed state rather than
 * generating new requests". The messages are stored (they are evidence, and the
 * recipient may accept later) but nothing surfaces and nothing counts.
 */
export function countsAgainstRequestQuota(facts: {
  conversationExisted: boolean;
  recipientState: RequestState;
}): boolean {
  return !facts.conversationExisted && facts.recipientState === 'PENDING';
}

/**
 * May a read receipt be shown to the sender for messages in this thread?
 *
 * MSG-FR-009's rule, and its acceptance criterion is a negative: "GIVEN a
 * message in Message Requests, WHEN the recipient opens it, THEN the sender does
 * not see a read state."
 *
 * DECLINED counts as a request for this purpose too. A declined sender learning
 * their message was read would tell them a person is there and did read it,
 * which is the signal BR-028 exists to withhold.
 */
export function receiptsVisibleToSender(recipientState: RequestState): boolean {
  return recipientState === 'ACCEPTED';
}

/**
 * May this thread produce a push notification to the recipient?
 *
 * NOTIF-FR-004 and BR-027. Kept here beside the read-receipt rule rather than
 * in the notifications module, because they are the same decision about the
 * same fact and separating them is how one gets updated and the other does not.
 * EPIC-11 consults this; it does not re-derive it.
 */
export function pushAllowedToRecipient(recipientState: RequestState): boolean {
  return recipientState === 'ACCEPTED';
}

/**
 * MSG-FR-005 A3: "Recipient later follows the sender → any pending request is
 * promoted to the inbox automatically."
 *
 * Following someone is an unambiguous statement that you want to hear from
 * them, so leaving their message sitting in a request area would be the system
 * ignoring what the user just said. PENDING promotes; DECLINED does not — a
 * decline was also a decision, and a follow does not silently reverse it.
 */
export function promotesOnFollow(recipientState: RequestState): boolean {
  return recipientState === 'PENDING';
}
