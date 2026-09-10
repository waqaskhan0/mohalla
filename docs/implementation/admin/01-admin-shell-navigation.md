# 01 — The Authenticated Shell and Navigation

**Stage 8 · Group 03** · the frame every administrator screen sits inside.

---

## 1. What the shell is

One layout for the whole authenticated group, `app/(portal)/layout.tsx`. It
holds the skip link, the top bar, the sidebar and the `<main>` landmark, and it
calls `requireAdminSession()` **once** for the group rather than once per page.

| | |
|---|---|
| Sidebar | 240px, collapsing to a 64px icon rail between 768 and 1024 (§27) |
| Top bar | 64px |
| Content | fluid, capped at 1200px, **left-aligned against the sidebar** |
| Page | capped at 1440px |
| Grid | 12 columns, 24px gutter |

## 2. The six destinations

Dashboard · Moderation · Users · Announcements · Verification · Audit log.

Active state is decided by prefix matching on `usePathname`, so
`/moderation/<caseId>` keeps Moderation lit — a detail screen is not a place the
navigation forgets you are. The active item carries `aria-current="page"`.

## 3. Two decisions worth recording

**The content is left-aligned, and that took a fix.** Stage 5's foundation
stylesheet sets `main { margin-inline: auto }`, which centred the console's
content 260px away from the sidebar it belongs to. `.admin-main` sets
`margin-inline: 0` explicitly, with the reason written beside it, because a
cascade collision corrected without explanation is one somebody re-introduces.

**No administrator name is shown.** There is no `/admin/me` route and no route
that lists administrators, so the shell has nothing truthful to put there
(`ADMIN-API-GAP-002`). An avatar with an initial taken from the login email
would be inventing an identity from a credential.

## 4. The skip link

First in tab order, 1x1 at rest, 139x40 at (8,8) when focused. Its target
carries `tabIndex={-1}` — see [14](14-accessibility.md), where the absence of
that attribute was a real defect: the link moved the scroll position and left
focus on `<body>`, so the next Tab went back into the sidebar it had just
skipped.

## 5. Sign out

A form posting to a server action, not a link. Signing out is a state change,
and it revokes the session **server-side** before clearing the cookie — verified
in flow L of [15](15-runtime-e2e.md): the same token is refused afterwards.
