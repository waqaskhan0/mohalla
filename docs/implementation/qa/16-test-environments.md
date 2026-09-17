# Stage 10 — test environments actually executed

Only environments that were really used are listed. An environment that was not
exercised is named in the gaps section rather than left out, because a matrix
that lists only what passed reads as coverage it does not have.

## Host

| | |
| --- | --- |
| OS | Microsoft Windows 10 Pro, 10.0.19045.7725 |
| Physical RAM | 8.47 GB |
| Node | v24.14.1 |
| npm | 11.11.0 |
| Docker | 29.7.2 |
| JDK | OpenJDK 21.0.12.1 LTS |

8.47 GB is the constraint that shapes everything below: Postgres, the API, the
worker, two Next processes and an Android emulator share it. It is the reason
the emulator profile had to be changed before any measurement was trustworthy —
see the note under *Android emulator*.

## Services

| Service | How it runs | Port |
| --- | --- | --- |
| PostgreSQL | `npm run infra:up` → container `mohalla-postgres`, **PostgreSQL 18.6** | 5432 |
| API | `node apps/api/dist/main.js` (the built artifact, not a dev watcher) | 3000 |
| Worker | `node apps/worker/dist/main.js` | — |
| Socket.IO | inside the API, namespace `/messaging`, path `/realtime` | 3000 |
| Admin portal — production | `next start` on a `next build` output | 3001 |
| Admin portal — development | `next dev` | 3002 |

**Both portal modes are run deliberately.** Stage 9 only ever exercised the
development portal, and QA-001 exists precisely because a production build
behaves differently in a way no dev-mode run could reveal.

Adapters: the SMS provider is `FakeSmsProvider` (in-process, records instead of
sending) and push is `FakePushSender`. No message leaves the host.

## Android emulator

| | |
| --- | --- |
| AVD | `mohalla_test`, `system-images/android-36/google_apis/x86_64` |
| Android | 16 (API 36) |
| Model | `sdk_gphone64_x86_64` |
| Screen | 1080×2280, density 420 |
| RAM / cores | **3072 MB / 4** (raised from 2048 MB / 2 — see below) |
| Mode | headless (`-no-window`, `-gpu swiftshader_indirect`) |

### The profile had to be corrected before any timing meant anything

The first cold launch on the original 2048 MB / 2-core profile reported
`Status: timeout`, and three consecutive runs measured first draw at **+29.4 s,
+21.4 s and +26.9 s**. That looks exactly like a serious startup defect.

It was not. A screenshot taken at that moment shows the app's own
*"Choose your language"* screen rendered correctly behind a system dialog
reading **"System UI isn't responding"**, and `logcat` carried ANRs in
`com.google.android.inputmethod.latin` and `com.android.phone` — neither of
them ours. `top` inside the guest showed **2.43 GB of 2.53 GB used and 6 % idle**.

The emulator was thrashing, so every number it produced was a measurement of
the emulator. The profile was raised to 3072 MB / 4 cores and moved to headless
before any performance figure was recorded. **No launch-time defect is claimed
or denied on the discarded numbers.**

## Physical Android devices

**None available.** `adb devices -l` lists the emulator only.

Every physical-device requirement — the REL-002 / REL-008 release lane, the
low-end and mid-range device profiles, real TalkBack, real network hardware —
is therefore `BLOCKED_EXTERNAL / DEVICE_UNAVAILABLE`. It is not PASS, and an
emulator result is never substituted for it.

## Coverage gaps, stated rather than omitted

| Gap | Consequence |
| --- | --- |
| Only API 36 is exercised; `minSdk` is **26** | Nothing between API 26 and 35 is covered. Android 8 behaviours that differ most — runtime media permissions, notification channels — are exactly the ones an API 36 image cannot show. |
| No physical hardware | Real-device performance, thermal behaviour, manufacturer skins and real TalkBack are all unexecuted. |
| Emulator is headless | Rendering is verified through `screencap` and the accessibility tree, not by a human looking at a screen. |
| Host is Windows | CI builds on Linux. Anything host-specific here (path handling, `next build` behaviour) is a property of this host, and is labelled as such wherever it appears. |
