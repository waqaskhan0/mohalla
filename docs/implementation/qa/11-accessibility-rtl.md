# Urdu / RTL and accessibility QA

Two verdicts are kept apart throughout, because they answer different questions
and only one of them can be automated.

| | |
| --- | --- |
| **RTL TECHNICAL QA** | **PASS** — 22 checks, 0 failed |
| **HUMAN URDU LANGUAGE QUALITY** | **NOT EXECUTED** — no fluent reviewer |
| **ACCESSIBILITY, AUTOMATED / STRUCTURAL** | **PASS** — 14 checks, 0 failed |
| **HUMAN TALKBACK REVIEW** | **NOT EXECUTED** — nobody listened to a session |

## How Urdu was reached

Not by typing it. `adb shell input text` cannot send non-ASCII at all — it
exits 255 — so the app was switched to Urdu through **its own Settings screen**
and every subsequent screen was driven and read in Urdu. That also makes the
language change itself part of the evidence:

| Check | Evidence |
| --- | --- |
| Settings offers both languages | `English`, `اردو` |
| Choosing Urdu re-renders immediately | `واپس`, `زبان`, and the explanatory sentence in Urdu |
| The choice persists server-side | `users.language = 'ur'` |
| And survives an app upgrade | still Urdu after `install -r` of a newer APK |

Urdu *search* is covered separately at the API, where a query can be sent
exactly: `/search/people?q=اردو` and `/search/posts?q=پانی` both answer 200.

## RTL layout

| Check | Evidence |
| --- | --- |
| The bottom navigation has all five destinations | `پروفائل`, `پیغامات`, `نیا`, `تقریبات`, `ہوم` |
| **And it is mirrored** — Home rightmost, Profile leftmost | left-to-right reading is the exact reverse of the LTR order |
| **Create stays centred rather than mirroring** | centre 541px on a 1080px screen — **1px off centre** |
| Home renders in Urdu | 30 labels |
| Events renders in Urdu | 35 labels |
| Messages renders in Urdu | 11 labels |
| Profile renders in Urdu | 29 labels |
| Composer opens in Urdu | `بند کریں`, `نئی پوسٹ`, `پوسٹ کریں` |
| Search opens in Urdu | including its own cross-script hint |
| Notifications opens in Urdu | |
| Settings opens in Urdu | 15 labels |
| **Nothing is clipped past either screen edge**, on every screen above | all nodes within 0..1080 |
| A long Urdu label does not break layout | longest 26 characters, laid out intact |
| **Mixed English/Urdu/digits in an RTL field** | `Mixed English aur Urdu 123` typed into the composer — nothing clipped |
| No crash across the pass | `logcat -b crash` clean |

The Create check is the one worth keeping: everything else in the bar mirrors,
and Create must *not*, because it anchors the bar. Measuring it at 1px from
centre is the difference between "looks fine" and "is centred".

The clipping check is the other one. RTL layout fails by pushing content off the
leading edge, and a screenshot review misses it whenever the overflow is a few
pixels. Reading every node's bounds does not.

### Two navigation mistakes of mine, recorded

Search and Notifications were first reported as unreachable. They live in the
**Home top bar**, not the tab bar, and the helper only guaranteed the bottom
navigation was present — which is true on every tab. Arriving from Profile found
neither icon. The controls were always there; the suite was looking in the wrong
place.

## Human Urdu quality — NOT EXECUTED

No fluent Urdu reviewer took part, so no judgement is offered on whether the
translations read naturally, use the right register for a civic platform, or
are idiomatic.

Two things are passed to that reviewer as **candidates, not defects** — noticed
while reading the tree, and explicitly not adjudicated here:

- the search hint uses `ھ` where `ہ` is often expected (`یھاں`, `کھا`);
- the same hint uses `ٰ` (superscript alef) where quotation marks appear to be
  intended: `ٰپانیٰ` and `ٰpaniٰ`.

Both may be deliberate house style. Neither is called an error by this QA pass,
because calling it one would be exactly the kind of judgement a non-speaker
should not make.

## Accessibility — automated and structural

| Check | Evidence |
| --- | --- |
| Clickable controls are exposed to the accessibility tree | 16 clickable nodes on the profile screen |
| **Every clickable control has an accessible name** | all 16 named, directly or through a named child |
| **Touch targets are at least 48dp** (126px at density 420) | all ≥ 126px |
| The screen presents a title as its first content | `پروفائل` |

### Font scaling

| Scale | Home reachable | All five destinations | Overflow |
| --- | --- | --- | --- |
| 100% | yes | yes | none |
| 130% | yes | yes | none |
| **200%** | yes | **yes** | none |

No crash across the pass, and the scale is restored to 100% afterwards so a
later suite is not silently running at 200%.

### Two assertions of mine that were wrong first

Both failed against correct behaviour and are recorded rather than quietly
fixed:

- **"3 unnamed clickable controls" and "126x21 touch targets"** were the same
  three nodes — the like, comment and share buttons of the *next* post card,
  clipped by the bottom of the viewport, with their labels below the fold. The
  identical controls one card above measure 126×126 and are named. Judging a
  half-scrolled control by its clipped rectangle measures the viewport, not the
  design; the checks now consider only fully visible nodes.
- **"all five destinations"** failed at 100% with nine items, because the
  threshold reached up into a post card and collected its action row. All five
  destinations were present the whole time.

### Human TalkBack review — NOT EXECUTED

Nobody listened to a TalkBack session. What is proven above is that the
information TalkBack needs is present and correctly shaped — names, targets,
titles. Whether the resulting speech is usable, correctly ordered and not
maddening is a human judgement, and it has not been made.

Automated structure passing is not a substitute, and is not reported as one.
