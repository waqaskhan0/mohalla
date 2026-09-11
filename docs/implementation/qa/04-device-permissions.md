# Device, install and permissions QA

Emulator only. **No physical device is available**, so every physical-device
requirement is `BLOCKED_EXTERNAL` and no emulator result is offered in its
place — see the closing section.

## The APK under test

| | |
| --- | --- |
| Commit | `f39f0fddfc2bd87011afb4bab880d2b2c405fa09` |
| File | `app-debug.apk` |
| Bytes | 14,718,455 |
| SHA-256 | `74556e81b8e7940869aa4cafbcda004630459ea8cd31281006819468e4be0556` |
| Application id | `org.shehersaaz.mohalla` |
| versionName / versionCode | `0.0.1-foundation` / 1 |
| minSdk | 26 |

## Clean install (§5A)

`adb uninstall` → `adb install` → launch.

| Check | Evidence |
| --- | --- |
| The package is really gone first | `run-as: unknown package` |
| Install succeeds | `Success`, and `pm path` resolves the base APK |
| Local state starts empty | only `cache`, `code_cache`, `files`, `shared_prefs`, all created at first launch |
| First screen is the language chooser | `Choose your language` / `English` / `اردو` |
| No crash | `logcat -b crash` clean |

One thing worth recording: the first install reported `Success` while `pm path`
returned nothing and only `org.shehersaaz.mohalla.test` was present. The
package manager was still recovering from a burst of system ANRs. Reinstalling
after the emulator settled put the package in place. **`Success` from
`adb install` was not sufficient evidence that the app was installed**, and the
check is now `pm path`.

## Upgrade install (§5B)

The prior build is the real Stage 9 artifact, downloaded from the CI run for the
Stage 9 merge commit rather than rebuilt:

| | |
| --- | --- |
| Source | GitHub Actions run 34558230708, `main` @ `a005975` |
| Bytes | 14,718,455 |
| SHA-256 | `6f37e96fca65caebba7453c9b99183b328e7fe55d9607992a3119c4185b73d1a` |

State established on the Stage 9 build before upgrading — deliberately more
than a login, so the upgrade has something to preserve:

1. signed in as a synthetic fixture account (session established);
2. language switched to **Urdu** in Settings, which is a non-default preference
   and is verified server-side: `users.language = 'ur'`.

Then `adb install -r` of the Stage 10 APK, **without uninstalling**.

| Check | Evidence |
| --- | --- |
| The app launches after the upgrade | yes |
| Still signed in | Urdu home renders: `محلہ`, `تلاش کریں`, `اطلاعات`, `فالوونگ`, `دریافت` |
| Language preference survives | still Urdu, not reset to the default |
| No crash from stale preferences or storage | `logcat -b crash` clean |

## Permissions (§6, §7)

The audit answers most of §6 by construction, so the evidence is the manifest
and the device's own view of it rather than a click-through of dialogs that do
not exist.

**Everything the app declares:**

```
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE
org.shehersaaz.mohalla.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

> **Re-audited 2026-09-12, after QA-009 closed.** The push client added three
> permissions to the merged manifest. The current list is below; the tables that
> follow were rewritten to match rather than annotated, because a permission
> audit that has to be read alongside a correction is a permission audit nobody
> will read correctly.
>
> ```
> android.permission.INTERNET
> android.permission.ACCESS_NETWORK_STATE
> android.permission.POST_NOTIFICATIONS
> android.permission.WAKE_LOCK
> com.google.android.c2dm.permission.RECEIVE
> org.shehersaaz.mohalla.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
> ```

Confirmed three ways: the source manifest, `aapt2 dump permissions` on the
built APK, and `dumpsys package` on the device.

| Permission | Protection level | Declared by | Justification |
| --- | --- | --- | --- |
| `INTERNET` | normal | the app | the product is a network client |
| `ACCESS_NETWORK_STATE` | normal | the app | offline and reconnect handling |
| `POST_NOTIFICATIONS` | **dangerous** | the app | NOTIF-FR-001. The only runtime permission in the build, requested contextually after sign-in; refusing it costs notifications and nothing else. Its full lifecycle is tested below. |
| `WAKE_LOCK` | normal | **merged in by `firebase-messaging`** | lets the FCM service finish handling a message that arrives while the device is asleep. Not requested by any of this project's code, and it is a normal permission: no prompt, no user-visible grant, no access to anything personal. |
| `com.google.android.c2dm.permission.RECEIVE` | signature | **merged in by `firebase-messaging`** | the historic Cloud-to-Device-Messaging permission. Signature-level and defined by Google Play services, so only Play services can send the app a message under it; it grants this app no ability to reach anything else. |
| `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | signature | AndroidX | generated; it *restricts* internal broadcast receivers rather than requesting anything |

**One dangerous permission is declared, and it is the one the requirements ask
for.** Checked deliberately after the Firebase SDK was added: no storage, camera,
location, contacts, microphone, calendar, phone-state or SMS permission entered
the merged manifest — the two transitive additions are a normal and a
signature-level permission, neither of which the reader is ever asked about and
neither of which touches personal data.

Specifically still not requested:

| Not requested | Why that is correct |
| --- | --- |
| `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` | the app uses the Android Photo Picker (`ActivityResultContracts.PickVisualMedia`), which grants access to the chosen item only and needs no permission. §6 asks this to be verified rather than assumed — it is verified. |
| `CAMERA` | camera is not in the current implementation. §6 says test only if it is; it is not, so this is N/A rather than untested. |

### The notification-permission lifecycle — EXECUTED

> **This section replaces a wrong conclusion, and the wrong conclusion is worth
> remembering.** It previously read "**None of it applies**, because the app
> never asks" and recorded the whole lifecycle as N/A. The observations were
> accurate — there really was no permission and no posting code — but the
> inference was not: a missing external provider does not make a missing client
> implementation *not applicable*. That became QA-009, which is now **CLOSED**,
> and the lifecycle below was actually run.

§6 asks for allow / deny / grant-from-Settings / revoke. All four were executed
on the emulator against the real backend
(`.emulator-evidence/qa10_push.py`, 36/36).

| §6 case | Executed | Result |
| --- | --- | --- |
| The prompt appears, contextually | clean install → sign in as USER_A | **PASS** — shown after sign-in, not at launch |
| **Deny** | tapped "Don't allow" | **PASS** — the feed still loads, no crash, and every other feature is untouched |
| Registration despite a refusal | `device_tokens` read after the refusal | **PASS** — the token is still registered, so a later grant needs no second round trip |
| A refusal is not re-asked | force-stop → relaunch | **PASS** — and this failed first time, which is the defect recorded in QA-009's resolution |
| **Grant later, from Settings** | `pm grant` while backgrounded, then resume | **PASS** — re-registered, still one device row, same token |
| **Revoke later, from Settings** | `pm revoke` while backgrounded, then resume | **PASS** — no crash, app fully usable, and no new prompt |
| A refused reader can change their mind | Settings → Notifications | **PASS** — a notice appears only while the OS is refusing, and its button opens `Settings$AppNotificationSettingsActivity` for this app |
| Granting from that screen clears the notice | toggled "All Mohalla notifications" on | **PASS** — the notice is gone on resume |
| A push arriving with the permission refused | `PushDeniedDeliveryTest` | **PASS** — nothing posted, nothing thrown |

One honest limitation. Deleting the service's own permission guard did **not**
fail the refused-delivery test: on API 36 the platform drops the post itself, so
that test cannot tell an app that checks from one that does not. The guard stays
— it is there for OEM builds that throw instead — but this device cannot prove
it either way, and the test's own comment says so.

### Exported components

| Component | Exported | Assessment |
| --- | --- | --- |
| `MainActivity` | **true** | required — it carries `MAIN`/`LAUNCHER` and the §42 deep links. One activity by design, so the startup resolver cannot be bypassed by a second entry point. |
| `androidx.startup.InitializationProvider` | false | AndroidX default; `dumpsys` confirms it is not exported |
| `MohallaMessagingService` | **false** | the FCM receiver. Not exported, and **proven** so: `adb shell am start-foreground-service` on it is refused with *"Permission Denial: … not exported from uid 10221"*. That refusal is why the delivery tests run as instrumentation inside the app's own uid rather than the component being opened up to make it testable. |
| Firebase's own components | false | `FirebaseInitProvider` and the messaging receiver are merged in by the SDK; `dumpsys` confirms none is exported |

Nothing is unintentionally externally callable.

## Physical devices — BLOCKED_EXTERNAL

`adb devices -l` lists the emulator and nothing else.

| Requirement | Status |
| --- | --- |
| REL-002 / REL-008 low-to-mid-range device lane | `BLOCKED_EXTERNAL — PHYSICAL HARDWARE UNAVAILABLE` |
| Real low-end performance | `BLOCKED_EXTERNAL` |
| Real radio / 3G behaviour | `BLOCKED_EXTERNAL` |
| Physical-device RTL | `BLOCKED_EXTERNAL` |
| Real-device notification delivery | `BLOCKED_EXTERNAL` — also DEP-002 |
| Physical TalkBack experience | `BLOCKED_EXTERNAL` |

No emulator result is presented as a physical-device pass.

### API level coverage, stated as a gap

Only **API 36** is exercised. `minSdk` is **26**, so nothing between 26 and 35
is covered — and the behaviours that differ most across that range are exactly
runtime media permissions and notification channels. Adding an API 26 image was
not attempted: this host has 8 GB of RAM and the single API 36 emulator already
drives it into system-process ANRs, so a second profile would produce
measurements that would have to be discarded. Recorded as a coverage gap rather
than silently omitted.
