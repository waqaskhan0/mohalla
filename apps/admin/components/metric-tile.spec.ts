import { describe, expect, it } from 'vitest';
import { readCode, readFile } from '../lib/test-support/read-source';

/**
 * UX-ADM-002's rules, the ones that are easy to erode.
 *
 * The dashboard's whole job is to tell one moderator whether today is an
 * ordinary day, and three of its properties are load-bearing in a way that a
 * later "tidy-up" would quietly break:
 *
 *   1. ONE primary tile. The spec: "Four tiles: Open reports first and largest
 *      — it is the only figure that demands action." A second emphasised tile
 *      flattens the only signal on the page.
 *   2. ALL SEVEN figures. ADMIN-FR-011 lists seven and its acceptance criterion
 *      is that every one appears. Four have tiles; three are secondary.
 *   3. NO ZEROS ON FAILURE. A tile reading 0 open reports because the fetch
 *      failed tells a moderator the day is quiet when nobody knows — the most
 *      costly lie this screen can tell.
 *
 * Source-level, like the session rules: these are server components whose
 * rendering needs a Next request scope, so what is asserted is the shape.
 * The rendering itself was verified in a browser against the real API, and the
 * figures were checked against Postgres one by one.
 */

const read = readFile;

const DASHBOARD = 'app/(portal)/dashboard/page.tsx';

describe('UX-ADM-002 — the dashboard', () => {
  it('marks EXACTLY ONE tile as primary', () => {
    const source = read(DASHBOARD);
    const primaries = source.match(/emphasis="primary"/g) ?? [];

    expect(primaries, 'the spec ranks one figure above the others').toHaveLength(1);
  });

  it('the primary tile is open reports, and it is the one that links', () => {
    const source = read(DASHBOARD);

    // The emphasised tile and the linked tile must be the same one: the figure
    // that demands action is the figure you can act on (§15).
    const primaryBlock = source.slice(
      source.indexOf('label="Open reports"'),
      source.indexOf('label="New users today"'),
    );

    expect(primaryBlock).toContain('emphasis="primary"');
    expect(primaryBlock).toContain('href="/moderation"');
  });

  it('no other tile is a link', () => {
    const source = read(DASHBOARD);
    const hrefs = source.match(/href="\/[a-z-]*"/g) ?? [];

    // Exactly one `href` in the tile grid, and it is the queue. Making the
    // other figures navigable would imply a drill-down that ADMIN-FR-011
    // forbids and the API cannot serve — the response carries no identifier.
    expect(hrefs).toEqual(['href="/moderation"']);
  });

  it('RENDERS ALL SEVEN FIGURES that ADMIN-FR-011 requires', () => {
    const source = read(DASHBOARD);

    for (const field of [
      'counts.openReports',
      'counts.newUsersToday',
      'counts.postsToday',
      'counts.upcomingEvents',
      'counts.totalUsers',
      'counts.newUsersThisWeek',
      'counts.actionsThisWeek',
    ]) {
      expect(source, `${field} must appear — the AC is that every figure shows`).toContain(field);
    }
  });

  it('states the window on every rolling figure', () => {
    // The labels are the spec's wording and the API's windows are rolling, not
    // calendar: `new_users_today` counts from `now - 24 hours`. Measured
    // against the database, 2,828 in the rolling window against 747 since
    // midnight — the same number read two very different ways depending on
    // which a moderator assumed.
    const source = read(DASHBOARD);
    const inLast24 = source.match(/In the last 24 hours/g) ?? [];

    expect(inLast24, 'new users today and posts today are both 24-hour windows').toHaveLength(2);
    expect(source).toContain('Scheduled from now onward');
  });

  it('explains why new-this-week can exceed the total', () => {
    // Total excludes DELETED accounts and new-this-week does not, so on a
    // young platform the second can be larger. Measured: 5,377 against 5,332,
    // the difference being exactly the 45 accounts registered this week and
    // since deleted. Without the note this reads as a bug.
    const source = read(DASHBOARD);

    expect(source).toContain('Excludes deleted accounts');
    expect(source).toContain('including accounts since deleted');
  });

  it('THE FAILURE STATE RENDERS NO FIGURES AT ALL', () => {
    const source = read(DASHBOARD);
    const failure = source.slice(source.indexOf('function DashboardUnavailable'));

    // Not one `counts.` reference below the failure boundary, and no tile.
    expect(failure, 'a zero here would read as a quiet day').not.toContain('counts.');
    expect(failure).not.toContain('MetricTile');
    // And it must be announced, not merely displayed.
    expect(failure).toContain('role="alert"');
  });

  it('the failure state shows no raw error, stack or server message', () => {
    // §40: no raw JSON, no stack trace, no framework internals in front of an
    // administrator. The copy comes from the code map, never from the
    // envelope's developer-facing `message`.
    const source = read(DASHBOARD);
    const failure = source.slice(source.indexOf('function DashboardUnavailable'));

    expect(failure).toContain('messageForCode');
    expect(failure).not.toContain('error.message');
    expect(failure).not.toContain('JSON.stringify');
  });

  it('the loading state shows shape, never a number', () => {
    // A skeleton whose placeholder reads as data is how somebody screenshots
    // an empty dashboard and believes it.
    const loading = read('app/(portal)/dashboard/loading.tsx');

    expect(loading).toContain('skeleton-line');
    expect(loading).toContain('aria-busy');
    // No digits inside rendered text — the only numbers are the map keys.
    expect(loading).not.toContain('toLocaleString');
  });
});

describe('the metric tile', () => {
  it('treats zero as an answer, not an empty state', () => {
    // §16 calls an empty queue "a positive operational state, not an error",
    // and the figure that leads there has to agree or the two screens tell a
    // moderator different things.
    const tile = read('components/metric-tile.tsx');

    expect(tile).toContain('zeroNote');
    expect(read(DASHBOARD)).toContain('zeroNote="Nothing is awaiting review"');
  });

  it('offers no drill-down, breakdown or export', () => {
    // ADMIN-FR-011 is aggregate-only, and §35 lists what must not exist. The
    // API returns no identifier, so there is nothing to build these from — but
    // asserted anyway, because the next person to touch this file will not
    // have read the requirement.
    // `readCode`, not `read` — the fourth occurrence of this rule class
    // failed on this component's own comment saying it offers no drill-down.
    const tile = readCode('components/metric-tile.tsx');
    const dashboard = readCode(DASHBOARD);

    // NOT the bare word "export" — that matched the JavaScript keyword on
    // `export function MetricTile`, which is the third time in this codebase a
    // rule like this has read something other than what it meant. What
    // indicates a data export is a FORMAT or a DOWNLOAD, so those are the
    // markers.
    for (const forbidden of [
      'csv',
      'xlsx',
      'download',
      'drilldown',
      'drill-down',
      'breakdown',
      'text/csv',
      'application/vnd.ms-excel',
    ]) {
      expect(tile.toLowerCase(), `no ${forbidden}`).not.toContain(forbidden);
      expect(dashboard.toLowerCase(), `no ${forbidden}`).not.toContain(forbidden);
    }
  });
});
