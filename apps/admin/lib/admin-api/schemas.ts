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
