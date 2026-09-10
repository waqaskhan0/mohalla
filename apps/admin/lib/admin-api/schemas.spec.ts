import { describe, expect, it } from 'vitest';
import { adminLoginResultSchema, caseSchema, queuePageSchema } from './schemas';

/**
 * The response schemas, and the two Stage 7 lessons behind them.
 *
 * ADMIN-API-GAP-001: the generated Stage 6 contract has `components.schemas`: 0
 * entries and a success response carries only a `description`, so it proves a
 * route exists and never what it returns. These schemas are the portal's answer
 * — a renamed or missing field fails at the seam with the field named instead
 * of rendering a blank panel.
 *
 * The two rules being asserted:
 *
 *   1. A field is required ONLY if the server always sends it. Requiring a
 *      field the server omits IS RUNTIME-012, exactly: `CategoryResponse`
 *      required an `id` that `GET /categories` has never sent, every fetch
 *      threw, and a feature was broken for a whole stage with green tests.
 *   2. Unknown keys are ignored. The API may add a field in a later release,
 *      and a portal that rejected the whole response over an additive change
 *      would break for no reason.
 */

/** A case body exactly as `toCaseBody` in the API emits it. */
const CASE_FROM_API = {
  id: '9d4f1a2b-0000-4000-8000-000000000001',
  targetType: 'POST',
  targetId: '9d4f1a2b-0000-4000-8000-000000000002',
  targetOwnerId: '9d4f1a2b-0000-4000-8000-000000000003',
  state: 'OPEN',
  maxSeverity: 'HIGH',
  distinctReportCount: 3,
  autoHidden: true,
  resolutionReason: null,
  resolvedByAdminId: null,
  resolvedAt: null,
  version: 1,
  createdAt: '2026-09-09T06:00:00.000Z',
};

describe('the moderation case schema', () => {
  it('accepts what the API actually sends', () => {
    const parsed = caseSchema.parse(CASE_FROM_API);
    expect(parsed.version).toBe(1);
    expect(parsed.distinctReportCount).toBe(3);
  });

  it('accepts a resolved case, where the nullable fields are populated', () => {
    const resolved = caseSchema.parse({
      ...CASE_FROM_API,
      state: 'RESOLVED_RESTORED',
      resolutionReason: 'Legitimate civic criticism; coordinated reporting.',
      resolvedByAdminId: '9d4f1a2b-0000-4000-8000-000000000009',
      resolvedAt: '2026-09-09T07:00:00.000Z',
    });

    expect(resolved.state).toBe('RESOLVED_RESTORED');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('IGNORES A FIELD IT DOES NOT KNOW, rather than refusing the response', () => {
    // The additive-change case. A portal that threw here would break on a
    // release that added a field it does not even use.
    const parsed = caseSchema.parse({ ...CASE_FROM_API, somethingAddedLater: 'x' });
    expect(parsed.id).toBe(CASE_FROM_API.id);
  });

  it('REFUSES A RESPONSE MISSING `version`, and names the field', () => {
    // `version` carries EDGE-024's optimistic concurrency: a decision must be
    // made against the version it was read at. A response without it cannot
    // support a safe decision, so failing loudly is the correct behaviour — and
    // the failure has to say which field, which is the whole point of parsing.
    const { version: _omitted, ...withoutVersion } = CASE_FROM_API;

    const result = caseSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('version');
    }
  });

  it('refuses a null where the API never sends one', () => {
    // `state` and `maxSeverity` are always present and never null. Accepting a
    // null would let an empty severity render as a blank cell in the queue.
    expect(caseSchema.safeParse({ ...CASE_FROM_API, state: null }).success).toBe(false);
    expect(caseSchema.safeParse({ ...CASE_FROM_API, maxSeverity: null }).success).toBe(false);
  });

  it('accepts null in every field the API declares nullable', () => {
    // The mirror of the rule above, and the RUNTIME-012 direction: a field the
    // server CAN omit or null must not be required.
    const parsed = caseSchema.parse({
      ...CASE_FROM_API,
      targetOwnerId: null,
      resolutionReason: null,
      resolvedByAdminId: null,
      resolvedAt: null,
    });
    expect(parsed.targetOwnerId).toBeNull();
  });
});

describe('the queue page schema', () => {
  it('accepts a page', () => {
    const page = queuePageSchema.parse({ cases: [CASE_FROM_API], total: 1 });
    expect(page.total).toBe(1);
    expect(page.cases).toHaveLength(1);
  });

  it('accepts an EMPTY queue as a normal answer', () => {
    // §16: an empty queue is a positive operational state, not an error. The
    // schema has to make that representable before the screen can say it.
    const page = queuePageSchema.parse({ cases: [], total: 0 });
    expect(page.cases).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('refuses a page whose total is missing', () => {
    // Paging is offset-based because the ordering key is mutable, so `total` is
    // what the portal pages against. Without it there is no last page.
    expect(queuePageSchema.safeParse({ cases: [] }).success).toBe(false);
  });
});

describe('the login result schema', () => {
  it('accepts what POST /admin/login returns', () => {
    const parsed = adminLoginResultSchema.parse({
      status: 'AUTHENTICATED',
      token: 'synthetic-admin-session-token',
      expiresAt: '2026-09-09T14:00:00.000Z',
    });
    expect(parsed.status).toBe('AUTHENTICATED');
  });

  it('refuses a success body with no token', () => {
    expect(
      adminLoginResultSchema.safeParse({
        status: 'AUTHENTICATED',
        expiresAt: '2026-09-09T14:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('refuses a status other than AUTHENTICATED', () => {
    // The API throws for every failure rather than returning a status, so a
    // 200 that says anything else is a contract change worth failing on.
    expect(
      adminLoginResultSchema.safeParse({
        status: 'FAILED',
        token: 't',
        expiresAt: '2026-09-09T14:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
