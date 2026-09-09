import { z } from 'zod';

/**
 * The shapes the admin API actually returns.
 *
 * READ FROM THE API SOURCE, NOT FROM THE CONTRACT — and that distinction is the
 * whole reason this file exists.
 *
 * `openapi-stage6-generated.json` has `components.schemas`: **0 entries**, and a
 * success response carries only a `description`. It can prove a route exists
 * and never what that route returns. That is not a small gap: it is exactly the
 * blind spot that produced Stage 7's RUNTIME-012, where `CategoryResponse`
 * required an `id` the server has never sent, every category fetch threw, and
 * POST-FR-006's composer picker was broken for the entire stage while its tests
 * stayed green.
 *
 * So every shape here was read from the mappers and DTOs in
 * `apps/api/src/modules/admin/**` and cross-checked against a real response,
 * and every admin response is PARSED through these schemas at the boundary. A
 * renamed or missing field then fails at the seam with the field named, instead
 * of rendering a screen that is silently empty.
 *
 * TWO RULES, both learned the hard way in Stage 7:
 *
 *   1. A field is required here ONLY if the server always sends it. Marking a
 *      field required that the server omits is the RUNTIME-012 defect exactly.
 *   2. Objects are NOT `.strict()`. The API may add a field in a later release,
 *      and a portal that refused the whole response over an unknown key would
 *      break on a purely additive change. Unknown keys are ignored; missing
 *      known keys are not.
 */

/** ISO-8601 instant, as every `toISOString()` in the API produces. */
const instant = z.string().min(20);

/** A UUID as the API emits it. Not `.uuid()` — see the note in `caseSchema`. */
const id = z.string().min(1);

// --------------------------------------------------------------------- auth

/** `POST /admin/login` — `auth.controller.ts` `adminLogin`. */
export const adminLoginResultSchema = z.object({
  status: z.literal('AUTHENTICATED'),
  token: z.string().min(1),
  expiresAt: instant,
});
export type AdminLoginResult = z.infer<typeof adminLoginResultSchema>;

// -------------------------------------------------------------- moderation

/**
 * One moderation case — `toCaseBody` in `moderation.controller.ts`.
 *
 * `id` IS NOT VALIDATED AS A UUID. The portal only ever passes it back to the
 * API, which is the authority on its own identifier format; a client-side
 * format assertion would reject a server that changed nothing meaningful. The
 * same reasoning applies to every id below.
 *
 * `version` is present on EVERY read, because a decision must carry back the
 * version it was made against (EDGE-024). It is required here for that reason:
 * a response without it cannot support a safe decision, so failing loudly is
 * correct.
 */
export const caseSchema = z.object({
  id,
  targetType: z.string().min(1),
  targetId: id,
  targetOwnerId: id.nullable(),
  state: z.string().min(1),
  maxSeverity: z.string().min(1),
  distinctReportCount: z.number().int().nonnegative(),
  autoHidden: z.boolean(),
  resolutionReason: z.string().nullable(),
  resolvedByAdminId: id.nullable(),
  resolvedAt: instant.nullable(),
  version: z.number().int(),
  createdAt: instant,
});
export type ModerationCase = z.infer<typeof caseSchema>;

/**
 * `GET /admin/moderation/queue`.
 *
 * OFFSET-BASED, and the API says why in its own comment: the ordering key is
 * mutable, because a new report changes a case's severity or count and moves
 * it. `total` is what the portal pages against.
 *
 * THE ORDER IS THE SERVER'S — severity, then distinct report count, then age
 * ascending so the oldest of equal cases comes first and nothing at the bottom
 * waits forever. §16 forbids re-sorting client-side; this type carries an array
 * and the portal renders it in the order given.
 */
export const queuePageSchema = z.object({
  cases: z.array(caseSchema),
  total: z.number().int().nonnegative(),
});
export type QueuePage = z.infer<typeof queuePageSchema>;

/**
 * One prior enforcement action against the author — `caseDetail` in
 * `moderation.controller.ts`.
 *
 * WHY THE DETAIL SCREEN CARRIES THIS AT ALL. The API's own description gives
 * the reason: the history is here "so proportionality can be judged without
 * navigating away. An administrator deciding whether a first offence warrants
 * 30 days should not have to open another screen to find out it is the
 * fourth."
 */
export const enforcementHistoryEntrySchema = z.object({
  id,
  kind: z.string().min(1),
  reason: z.string(),
  expiresAt: instant.nullable(),
  createdAt: instant,
});
export type EnforcementHistoryEntry = z.infer<typeof enforcementHistoryEntrySchema>;

/**
 * `GET /admin/moderation/cases/:id` — the case, plus what is needed to judge it.
 *
 * The queue's case body with two additions, and both are facts for a human to
 * weigh rather than verdicts:
 *
 *   - `repeatOffenderFlag` is BR-037: three admin-confirmed deletions in 30
 *     days FLAGS the account for a suspension decision. The requirement's very
 *     next sentence is "it is not auto-suspended", so this is rendered as a
 *     note beside the history, never as a recommendation.
 *   - `enforcementHistory` is every prior action against the author, oldest
 *     first as the API returns it.
 *
 * BOTH ARE EMPTY WHEN `targetOwnerId` IS NULL, which is the CONVERSATION case:
 * a conversation has no single owner, so the API skips both lookups. An empty
 * history therefore means one of two different things, and the screen has to
 * say which — "no prior actions" and "the author is not known for this target"
 * are not the same statement.
 */
export const caseDetailSchema = caseSchema.extend({
  repeatOffenderFlag: z.boolean(),
  enforcementHistory: z.array(enforcementHistoryEntrySchema),
});
export type ModerationCaseDetail = z.infer<typeof caseDetailSchema>;

/**
 * `GET /admin/moderation/cases/:id/conversation` — MSG-FR-007 / PRIV-009.
 *
 * THE ONLY PATH BY WHICH AN ADMINISTRATOR EVER SEES A PRIVATE MESSAGE, and
 * requesting it WRITES AN AUDIT ENTRY before the read — which is why nothing in
 * this portal fetches it on page load. See the read-conversation action.
 *
 * `readAt` is always null on this route: the API strips receipts because they
 * "would leak read state into a surface the participants never see". Kept
 * nullable rather than dropped, so a future change is a visible difference
 * rather than a silently ignored key.
 */
export const conversationExcerptSchema = z.object({
  messages: z.array(
    z.object({
      id,
      clientMessageId: z.string(),
      conversationId: id,
      senderId: id,
      body: z.string().nullable(),
      mediaId: id.nullable(),
      createdAt: instant,
      readAt: instant.nullable(),
    }),
  ),
});
export type ConversationExcerpt = z.infer<typeof conversationExcerptSchema>;

// -------------------------------------------------------------- accounts

/**
 * `GET /admin/users/search` and `GET /admin/users/:id` — `AdminUserView`.
 *
 * NO PHONE, NO EMAIL, NO DATE OF BIRTH, and that absence is the design rather
 * than an omission. The API's own description says why: "a lookup must not
 * itself be a sensitive-data view, or PRIV-008 would be audited on every screen
 * and mean nothing." The identifiers live behind a second, deliberate call that
 * writes an audit row before it reads anything.
 *
 * So the privacy rule here is enforced by the RESPONSE containing no
 * identifier, not by the portal choosing not to render one — the same shape as
 * the dashboard, and the same reason it is worth pointing out.
 *
 * `username` and `displayName` are NULLABLE: an account can exist before its
 * profile does, and a row rendered as an empty cell is honest where a fabricated
 * placeholder would not be.
 */
export const adminUserViewSchema = z.object({
  userId: id,
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  accountType: z.string().min(1),
  state: z.string().min(1),
  suspendedUntil: instant.nullable(),
  verifiedBadge: z.boolean(),
  createdAt: instant,
  postCount: z.number().int().nonnegative(),
  reportsMade: z.number().int().nonnegative(),
  reportsReceived: z.number().int().nonnegative(),
});
export type AdminUserView = z.infer<typeof adminUserViewSchema>;

/**
 * `GET /admin/users/search?q=` — the wrapper.
 *
 * THERE IS NO TOTAL AND NO OFFSET. The route takes `q` and `limit` and nothing
 * else, so the portal cannot page and cannot say how many accounts matched. A
 * screen that showed twenty rows without saying so would let an administrator
 * conclude twenty is all there are — the ADMIN-RUNTIME-003 mistake in a
 * different column. The users screen states the cap instead.
 */
export const userSearchResultSchema = z.object({
  users: z.array(adminUserViewSchema),
});
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;

/**
 * `GET /admin/users/:id/sensitive` — PRIV-008 / SEC-022.
 *
 * A SEPARATE TYPE FROM THE ACCOUNT VIEW, deliberately, and the API's own
 * comment gives the reason: "so the two cannot be fetched by accident
 * together. The ordinary account view carries no identifier at all, and
 * reaching this one is a deliberate second call that writes an audit row."
 *
 * THE REQUEST IS THE AUDITABLE EVENT. The entry is written BEFORE the read and
 * in the same transaction, so a read that happened cannot lack a record — and
 * the entry names the FIELDS, never their values, because "an audit log that
 * recorded the number to prove somebody looked at the number would be a second,
 * worse copy of it".
 *
 * NO EMAIL. PRIV-008 names "phone number, email or date of birth", and this
 * route returns two of the three. Recorded as ADMIN-API-GAP-006; the portal
 * shows what exists and does not imply the third is absent from the account.
 */
export const sensitiveUserViewSchema = z.object({
  phone: z.string().nullable(),
  dateOfBirth: instant.nullable(),
});
export type SensitiveUserView = z.infer<typeof sensitiveUserViewSchema>;

/**
 * The result of an enforcement action - `enforce` in `moderation.controller.ts`.
 *
 * `sessionsRevoked` IS THE EVIDENCE FOR BR-035. "All sessions are invalidated"
 * is a claim; the count is what makes it visible. An administrator told that
 * two sessions were signed out knows the suspension reached a device somebody
 * was holding.
 *
 * `expiresAt` is null for a ban and for a reinstatement, and an instant for a
 * suspension - EDGE-028 lifts it with no administrator action, so the portal
 * shows when rather than implying somebody must do something.
 */
export const enforcementResultSchema = z.object({
  id,
  kind: z.string().min(1),
  expiresAt: instant.nullable(),
  sessionsRevoked: z.number().int().nonnegative(),
});
export type EnforcementResult = z.infer<typeof enforcementResultSchema>;

// ----------------------------------------------------------- announcements

/**
 * `GET /admin/announcements/allowance` - NOTIF-FR-005.
 *
 * TWO PER ROLLING SEVEN DAYS, and the route exists so the portal can say so
 * BEFORE an administrator writes an announcement rather than refusing after
 * they have - which is the API's own stated reason for it.
 *
 * `used` can exceed `limit` in principle if the limit is ever lowered, so the
 * portal computes remaining as a floor of zero rather than trusting
 * subtraction.
 */
export const broadcastAllowanceSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});
export type BroadcastAllowance = z.infer<typeof broadcastAllowanceSchema>;

/**
 * `POST /admin/announcements` - ADMIN-FR-009.
 *
 * The response says whether the push actually went out, which is not the same
 * as what was asked for: a publication can succeed while its broadcast is
 * refused, so the portal reports the API's answer rather than the form's
 * intention.
 */
export const announcementPublishedSchema = z.object({
  id,
  broadcast: z.boolean(),
});
export type AnnouncementPublished = z.infer<typeof announcementPublishedSchema>;

/**
 * `PUT /admin/users/:id/verification` - ADMIN-FR-010.
 *
 * 204 NO CONTENT, so there is nothing to parse and nothing to render from. The
 * portal confirms by RE-READING the account rather than by trusting its own
 * request: the badge is what the account view says it is, and a screen that
 * reported success from the absence of an error would be reporting its own
 * intention.
 */
export const noContentSchema = z.void();

// --------------------------------------------------------------- dashboard

/**
 * `GET /admin/dashboard` — ADMIN-FR-001 / ADMIN-FR-011.
 *
 * The seven fields of `DashboardCounts` in
 * `enforcement.repository.port.ts`, read from that interface rather than from
 * the contract, which carries no schema for this route.
 *
 * AGGREGATES ONLY, and the API's own description says why it matters: "no id
 * appears in this response, and there is no export". There is nothing here to
 * build a per-user view out of, which is the shape ADMIN-FR-011's rule
 * requires — and it is worth noticing that the privacy rule is enforced by the
 * response containing no identifiers, not by the portal choosing not to render
 * them.
 */
export const dashboardCountsSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  newUsersToday: z.number().int().nonnegative(),
  newUsersThisWeek: z.number().int().nonnegative(),
  postsToday: z.number().int().nonnegative(),
  upcomingEvents: z.number().int().nonnegative(),
  openReports: z.number().int().nonnegative(),
  actionsThisWeek: z.number().int().nonnegative(),
});
export type DashboardCounts = z.infer<typeof dashboardCountsSchema>;
