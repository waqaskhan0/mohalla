# Group 6 — media

Baseline: `a16d25bc2de4acdf24998d87225ab17a96cdcd90`.

Driven on emulator-5554 against the local API, PostgreSQL 18.6 and the existing
local storage adapter. ADR-013's pipeline only — no multipart upload was
introduced.

## The client half, which is what this group adds

The API half of ADR-013 was already covered at real HTTP by the smoke test, and
still is (below). What Stage 9 adds is whether the **app** walks that pipeline.
It did not: media had never worked from Android at all.

| Step | Evidence | Result |
| --- | --- | --- |
| No storage credentials in Android | Source grep for keys, secrets, buckets, signing: nothing. The client only ever receives a target it was given | PASS |
| Request upload slot | `POST /media/upload-slot` 201 | PASS |
| Presigned upload into quarantine | `PUT` to the returned target, 204 | FIXED — INTEGRATION-007 |
| Inspection and promotion | `POST /media/{id}/complete` 200 | PASS |
| READY in the database | `state READY`, `ready_at` set, `storage_key` and `quarantine_key` both present | PASS |
| Compression before transmission | A 1080×2280 source arrived as **757×1600, 106,771 bytes, `image/jpeg`** — longest edge exactly `MAX_LONGEST_EDGE_PX` (§7) and well under the 500 KB `MAX_UPLOAD_BYTES` ceiling (NFR-PERF-005) | PASS |
| Verified MIME, not a client claim | `mime_verified = image/jpeg`, decided by the server from the bytes | PASS |
| Attach | `POST /posts` 201; `post_media` row at `position 0` pointing at the READY media | PASS |
| Render | The image draws in the post on the profile — `Attached image` node, confirmed on a screenshot | PASS |
| Multiple images | The attach sheet reports "4 more can be added"; the server enforces the count | PASS |
| Ownership | Another user's media id is refused at attach, 409 | PASS |
| Not-READY media | Refused at attach, 409 `MEDIA_NOT_READY` | PASS |
| Executable, ZIP, MIME mismatch | Refused at `complete` on the bytes, 400; the rejected object is not servable, 404 | PASS |
| Oversized declaration | 40 MB refused before any bytes move, 400 | PASS |
| Unsupported kind | `DOCUMENT` gated off, 400 | PASS |
| Failed upload and retry | An unreachable target degrades to `UploadResult.Failed`, which keeps the bytes and offers a retry, rather than `Rejected`, which does not | PASS |

The rows from "Ownership" down are the smoke test's, at real HTTP against this
database. They are named here because Group 6 covers them, not re-derived.

## INTEGRATION-007 — attaching any image killed the app, twice over

Two distinct crashes in the same six lines, the second only visible once the
first was fixed. Both were fatal on the main thread: the process died while the
user was writing a post.

### (a) A relative upload target

`media-storage.port.ts` is explicit that its two adapters answer differently:
S3 presigns an absolute URL, and the local adapter — which cannot presign —
returns the API path `/media/upload/{key}`. Both are valid targets, and the
comment says the client's code path is meant to be otherwise identical.

It was not. `ImageUploader` passed the target straight to
`Request.Builder().url()`, which throws `IllegalArgumentException` on a path.
That is not an `IOException`, and the catch held only `IOException`.

```
POST /media/upload-slot 201
FATAL EXCEPTION: main
java.lang.IllegalArgumentException: Expected URL scheme 'http' or 'https'
  but no scheme was found for /media...
  at ImageUploader.upload(ImageUploader.kt:73)
```

Fixed by resolving a relative target against the API base and treating an
unusable one as a failed upload rather than a throw.

### (b) Blocking network on the main thread

With the URL resolved, the code reached `http.newCall(request).execute()` —
OkHttp's **blocking** call — still inside `viewModelScope`, which is
`Dispatchers.Main`. StrictMode answered with `NetworkOnMainThreadException`,
which is not an `IOException` either.

```
FATAL EXCEPTION: main
android.os.NetworkOnMainThreadException
  at okhttp3.internal.http1.Http1ExchangeCodec$KnownLengthSink.write
```

Every other network path in the app already dispatches to IO — `apiCall`,
`ImagePicker.read`, `UrlConnectionHttpClient` — and this one place did not,
which is exactly why only media crashed. Fixed with
`withContext(Dispatchers.IO)`.

The catch was also widened, deliberately and only here: this function can
already express "the bytes did not get there", and taking the process down is
never the better answer to it. `CancellationException` is re-thrown so a closed
composer still cancels.

### Mutation proof

| Mutation | Test | Result |
| --- | --- | --- |
| Target passed straight through (a) | `ImageUploadTargetTest` (JVM) | FAIL — `IllegalArgumentException`, 2 of 3 cases |
| Fix restored | same | PASS — 3 of 3 |
| PUT back on the caller's thread (b) | `ImageUploadThreadingTest` (device) | FAIL — `the upload must not be issued on the main thread. Actual: main` |
| Fix restored | same | PASS |

The absolute-URL case passes in both directions, which is the point: the tests
discriminate rather than failing wholesale.

**The threading test had to be rewritten to be worth anything.** Its first
version asserted only that the upload did not crash — and it PASSED against the
restored defect, because the widened catch turns a StrictMode violation into
the same `UploadResult.Failed` a refused connection produces. A test that
cannot tell a fixed call from a swallowed crash proves nothing, so it now
asserts the invariant itself through an OkHttp interceptor: the thread the
request is issued on.

A second procedural miss is worth recording, because it produced a false pass:
`installDebugAndroidTest` installs the **test** APK only. The mutated
`ImageUploader` lives in the app APK, so the first mutation run exercised the
fixed code and reported OK. Both APKs must be installed for a mutation on
production code to mean anything on a device.

Neither mutation was committed.

## Not claimed

Object-storage presigning is not exercised: the local adapter cannot presign and
the S3 adapter arrives with the bucket (ADR-012), so the absolute-URL path is
covered by unit test rather than by a running S3. Abandoned-upload sweeping is
the worker's and belongs with the job groups. CDN behaviour is a release
concern.
