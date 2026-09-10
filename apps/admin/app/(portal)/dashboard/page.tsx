import { guardedRequest } from '../../../lib/admin-api/guarded';
import { apiFailure } from '../../../lib/admin-api/failure';
import { AdminApiError, AdminApiShapeError } from '../../../lib/admin-api/client';
import { dashboardCountsSchema } from '../../../lib/admin-api/schemas';
import { messageForCode } from '../../../lib/admin-api/messages';
import { MetricTile } from '../../../components/metric-tile';

export const metadata = {
  title: 'Dashboard · Mohalla Admin',
};

/**
 * UX-ADM-002 — the dashboard (ADMIN-FR-001 · ADMIN-FR-011).
 *
 * THE HIERARCHY IS THE SPEC'S: "Four tiles: Open reports first and largest —
 * it is the only figure that demands action. Then new users today, posts
 * today, upcoming events."
 *
 * Open reports is the only tile that is a link, because it is the only figure
 * an administrator can do something about, and §15 asks for it to be
 * "actionable into the moderation queue". The other three are information.
 *
 * ALL SEVEN FIGURES APPEAR, because ADMIN-FR-011 lists seven and its acceptance
 * criterion is that every one of them is shown. The four the spec ranks get
 * tiles; total users, new users this week and actions this week sit below as
 * secondary figures. Dropping them to keep the layout tidy would leave the
 * requirement unmet, and inventing three more tiles would flatten the
 * hierarchy the spec was explicit about.
 *
 * AGGREGATE ONLY — and worth noticing that this is enforced by the API rather
 * than by restraint here: `GET /admin/dashboard` returns seven integers and no
 * identifier of any kind, so there is nothing on this page to build a
 * per-user view, a cohort, a "top users" list or an export from. ADMIN-FR-011's
 * rule and §35's prohibitions are structural, not a matter of what the portal
 * chooses to render.
 */
export default async function DashboardPage() {
  let counts;

  try {
    counts = await guardedRequest({
      path: '/admin/dashboard',
      schema: dashboardCountsSchema,
    });
  } catch (error) {
    // `apiFailure` re-throws anything that is not one of the two API errors.
    //
    // THE COMMENT THAT USED TO BE HERE SAID "a 401 never reaches here —
    // `guardedRequest` redirects to sign-in", and it was wrong in a way worth
    // recording: `redirect()` works by THROWING, so the 401 did reach here,
    // this catch swallowed the redirect, and an expired session was shown the
    // signed-in console with a generic error (ADMIN-RUNTIME-004). The belief
    // was written down confidently and never tested against an invalid cookie.
    //
    // What genuinely remains after narrowing is the API being down, refusing,
    // or answering in a shape this portal cannot read — and §41 wants each of
    // those to be a state rather than a crashed page. A moderator opening the
    // console during an incident needs to know whether the tool is broken or
    // the day is quiet.
    return <DashboardUnavailable error={apiFailure(error)} />;
  }

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-lead">
        Aggregate figures for the whole platform. No per-user activity is shown or available here.
      </p>

      <div className="tile-grid">
        <MetricTile
          label="Open reports"
          value={counts.openReports}
          emphasis="primary"
          href="/moderation"
          note="Awaiting a moderation decision"
          zeroNote="Nothing is awaiting review"
        />
        {/*
          THE WINDOWS ARE STATED, because the labels are the spec's wording and
          the API's windows are ROLLING, not calendar. `new_users_today` and
          `posts_today` both count from `now - 24 hours`, so at one in the
          afternoon "today" includes yesterday afternoon. Verified against the
          database: 2,828 in the rolling window against 747 since midnight —
          the same figure would be read two very different ways depending on
          which a moderator assumed. The label stays as approved; the note
          says what it counts.
        */}
        <MetricTile
          label="New users today"
          value={counts.newUsersToday}
          note="In the last 24 hours"
        />
        <MetricTile label="Posts today" value={counts.postsToday} note="In the last 24 hours" />
        <MetricTile
          label="Upcoming events"
          value={counts.upcomingEvents}
          note="Scheduled from now onward"
        />
      </div>

      <h2 className="section-heading">Also this week</h2>
      <dl className="secondary-figures">
        <div>
          <dt>Total users</dt>
          <dd>{counts.totalUsers.toLocaleString('en')}</dd>
          <p className="figure-note">Excludes deleted accounts</p>
        </div>
        <div>
          <dt>New users this week</dt>
          <dd>{counts.newUsersThisWeek.toLocaleString('en')}</dd>
          {/*
            THIS NOTE PREVENTS A FALSE BUG REPORT. The two figures use
            different filters — total excludes DELETED accounts and this one
            does not — so on a young platform where most accounts were created
            recently, this number can exceed the total above. Measured: 5,377
            against 5,332, and the difference is exactly the 45 accounts
            registered this week and since deleted. Arithmetically consistent,
            and it looks wrong until somebody explains it.
          */}
          <p className="figure-note">Last 7 days, including accounts since deleted</p>
        </div>
        <div>
          <dt>Actions taken this week</dt>
          <dd>{counts.actionsThisWeek.toLocaleString('en')}</dd>
          <p className="figure-note">Moderation and enforcement, last 7 days</p>
        </div>
      </dl>
    </>
  );
}

/**
 * The dashboard, when the figures could not be fetched.
 *
 * IT DOES NOT RENDER ZEROS. A tile showing 0 open reports because the request
 * failed would tell a moderator the day is quiet when nobody knows whether it
 * is — the most costly possible lie on this particular screen.
 *
 * The two failures are told apart because they need different readers. An API
 * that is down or refusing is something an administrator can wait out or
 * escalate. A response this portal cannot parse is a contract drift for a
 * developer, and ADMIN-API-GAP-001 is why the portal checks at all: the
 * generated Stage 6 contract carries no schemas, so a renamed field would
 * otherwise render as a blank panel instead of saying so.
 */
function DashboardUnavailable({ error }: { error: unknown }) {
  const isShape = error instanceof AdminApiShapeError;
  const apiError = error instanceof AdminApiError ? error : null;

  return (
    <>
      <h1>Dashboard</h1>

      <div role="alert" className="notice notice-error">
        <p>
          {isShape
            ? 'The API answered, but not in a shape this portal understands. The figures are not shown rather than shown wrongly.'
            : messageForCode(apiError?.code ?? 'UNKNOWN')}
        </p>
        <p className="muted small">
          No figures are displayed, because a zero here would read as a quiet day.
        </p>
        {(apiError?.correlationId ?? (isShape ? error.correlationId : undefined)) !== undefined && (
          <p className="mono muted small">
            Reference: {apiError?.correlationId ?? (error as AdminApiShapeError).correlationId}
          </p>
        )}
      </div>

      <p className="page-lead">
        The moderation queue is reachable from the sidebar and does not depend on these figures.
      </p>
    </>
  );
}
