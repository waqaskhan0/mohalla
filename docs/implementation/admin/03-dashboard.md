# 03 — Dashboard

**Stage 8 · Group 04** · UX-ADM-002, ADMIN-FR-001 and ADMIN-FR-011.

---

## 1. What it shows

Seven figures, all of them aggregates: total users, new users today, new users
this week, posts today, upcoming events, open reports, actions this week.

Four tiles, then three secondary figures. **Open reports is first and largest** —
it is the only figure on the screen that demands an action, and the number that
tells one moderator whether today is an ordinary day. Four across, becoming 2x2
at tablet.

## 2. Aggregates only, and the shape enforces it

ADMIN-FR-011: "aggregate figures only; no per-user analytics and no data export
in V1", with the criterion that "no individual user's activity is profiled".

No identifier appears in the response at all. That is a property of the API's
shape rather than a promise about what the portal renders — verified in flow F
of [15](15-runtime-e2e.md), which asserts the serialized response contains no
UUID of any kind. There is no drill-down, no export and no per-user view,
because there is nothing in the data to build one from.

## 3. Two figures that looked wrong and were not

Investigated rather than assumed:

- **"Today" is a rolling 24 hours, not a calendar day** — 2,828 against 747 for
  the calendar day. Both correct; the tile now says "In the last 24 hours".
- **New-this-week (5,377) exceeded total users (5,332)** — the total excludes 45
  DELETED accounts, while the weekly figure counts registrations including
  accounts since deleted. Both correct; the note says so.

A figure whose window is not stated is a figure somebody will eventually
misread, and these two were the proof.

## 4. The failure state renders no figures

`DashboardUnavailable` shows no numbers at all. §41 wants each failure to be a
state rather than a crashed page, and a dashboard showing zeros when the API is
unreachable would tell a moderator opening the console during an incident that
the day was quiet.
