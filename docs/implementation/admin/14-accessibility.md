# 14 — Accessibility, Keyboard and Browsers

**Stage 8 · Group 14** · §44, NFR-ACC-005.

---

## 1. Measured in a browser that actually held focus

This matters, because Stage 7 left a note in the stylesheet saying the skip link
"left a 1x1 clipped box" when focused, implying a defect, and marked it
unverified. **It was not a defect.** The automation pane had no OS window focus,
so `:focus` matched nothing and the observation was an artifact of the
instrument.

With `document.hasFocus()` true, the skip link measures 1x1 at rest and
**139x40 at (8,8)** when focused, with a 3px outline, and it is first in tab
order.

## 2. The skip link skipped nothing

`<main>` is not focusable by default, so following `#admin-main` moved the
**scroll position** and nothing else: `document.activeElement` stayed on
`<body>`, and the next Tab carried a keyboard user straight back into the
sidebar they had just asked to skip.

`tabIndex={-1}` on the landmark fixes it. After the change, `activeElement` is
`admin-main`, the sidebar is skipped, and the next control is the first field on
the page. The landmark gets no focus ring — an outline around the whole content
column reads as an error rather than as a position.

## 3. The dark theme failed contrast wherever the accent appeared

The dark block redefined the surface, the ink, the muted text and the border —
and left `--color-accent` alone. So a colour chosen to be read AGAINST white was
used as text ON near-black, and as a button background whose label came from
`--color-surface` and had therefore flipped dark.

**Measured at 2.31:1** against the 4.5 NFR-ACC-005 requires.

Fixed by giving the accent a dark-theme value and giving text on the accent its
own token instead of borrowing the surface. Re-measured in both themes:

| | light | dark |
|---|---|---|
| Body text | 5.99 | 7.87 |
| Buttons | 7.66 | 8.84 |
| Decision buttons | 7.66 | 9.50 |
| Table headers | — | 9.29 |
| Headings | 15.48 | 15.96 |
| Button against the page (non-text, needs 3.0) | 7.66 | 9.50 |

Every sample at or above AA.

## 4. Checked and clean

- One **visible** `<h1>` per page. The apparent duplicates are the skeleton and
  the resolved page in the same stream, never visible at once — a measurement
  artifact checked rather than assumed.
- Every form control labelled; every button and link named.
- Every `<th>` scoped; every table captioned — **including the loading
  skeleton**, which had `aria-busy` and no caption, so a screen reader meeting it
  while the queue loaded found an unlabelled table.
- Every field error is `role="alert"`, with `aria-invalid` and
  `aria-describedby` on the control it belongs to.
- All 14 focusable elements on a page carry a visible focus indicator.
- Confirmation panels move focus to their heading, so a keyboard user is not
  left at the bottom of a form whose buttons have just been replaced.
- Repeated row links ("Review", "Open") carry a visually-hidden name, because
  twenty identical links is what somebody listening to the page would otherwise
  get.
- At a **320px** viewport the page does not scroll sideways; the table scrolls
  inside its own container (§27). A horizontally scrolling page takes the
  sidebar off screen, which is how somebody ends up unable to navigate back.

## 5. What was not done, and is not claimed

**Only Chromium was exercised.** Firefox and Safari are not available in this
environment. §65: do not claim a pass that was not executed.

Screen-reader testing with an actual assistive technology (NVDA, JAWS,
VoiceOver) was **not** performed. The ARIA structure is asserted; how it sounds
is not.
