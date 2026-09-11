# Network resilience QA

Emulator, with the profile applied through the emulator console and the exact
settings recorded — "3G-like" means nothing without numbers.

**Result: 16 checks, 16 PASS, 0 FAIL.**

## Profiles

| Name | `adb emu network speed` / `delay` | Approximately |
| --- | --- | --- |
| NORMAL | `full` / `none` | unthrottled |
| HIGH_LATENCY | `full` / `gprs` | full bandwidth, ~500–1000 ms round trip |
| 3G_LIKE | `umts` / `umts` | ~384 kbps, ~150–400 ms |
| EDGE_LIKE | `edge` / `edge` | ~236 kbps, ~300–600 ms |

Offline is both radios down (`svc data disable` **and** `svc wifi disable`) —
one alone lets the device silently fall back to the other.

## Feed under degradation

| Profile | Refreshes and settles | Error state |
| --- | --- | --- |
| NORMAL | yes | none |
| HIGH_LATENCY | yes | none |
| 3G_LIKE | yes | none |
| EDGE_LIKE | yes | none |

The assertion is that it *finishes*, not that it is quick — a 45-second window,
because on EDGE the honest outcome is "slow", not "broken".

## Offline and recovery

| Check | Evidence |
| --- | --- |
| Offline does not leave the screen blank or spinning forever | 30 labels still rendered |
| The app does not crash offline | `logcat -b crash` clean |
| The feed recovers once the network returns | content re-rendered after reconnect |

## The one that could corrupt data

A publish was submitted, then the network was pulled **0.6 s later**, held down
for six seconds, and restored.

| Check | Evidence |
| --- | --- |
| **A single publish interrupted mid-flight never produces two rows** | **1 row** in `posts` |
| No stale retry control is left behind claiming an unsent post | none offered |

Either outcome is acceptable — the write lands or it does not. Two rows would
not be.

## Background and drafts

| Check | Evidence |
| --- | --- |
| Backgrounding the composer does not crash the app | clean |
| Draft text after background/foreground | **kept** |

The draft result is *recorded, not asserted*: whether a draft must survive
backgrounding is a product decision, and this pass reports what happens rather
than inventing a requirement.

## Pull-to-refresh, verified in isolation

A post was created server-side as the device's own account, then:

```
before refresh, present: False
after  refresh, present: True
```

This mattered because a **short swipe starting mid-list does not trigger the
refresh**. An earlier media check used one, found the post missing, and looked
like a stale-feed defect. Scrolling to the top and pulling from y=800 to y=1900
over 800 ms works every time; the gesture was the variable, not the feed.
