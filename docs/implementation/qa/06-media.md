# Media pipeline QA

Stage 9 found that attaching any image killed the app, twice over, and that
**media had never worked from the app at all**. So this pass does not treat a
green pipeline as low risk: it drives the real picker on the real device and
follows one image from selection to a rendered post, checking the database at
every hop.

**Result: 24 checks, 24 PASS, 0 FAIL.**

## The whole pipeline, on the device

| Stage | Evidence |
| --- | --- |
| The composer offers an image control | `تصویر` (running in Urdu) |
| The app's own "add to post" sheet opens | `پوسٹ میں شامل کریں`, `تصاویر`, `4 مزید شامل ھو سکتی ھیں` |
| The **Android Photo Picker** opens behind it | 9 cells, and *"Mohalla will only have access to the photos you select"* |
| An image is selected | picker reports `Selected` |
| → compress → slot → upload → inspect → **READY** | `media.state = READY` |
| **The server re-measured the bytes itself** (SEC-012) | `391909 bytes, image/jpeg, 1200x900` |
| The post submits | |
| The post row exists | |
| **And it carries the media**, through the `post_media` join | `media_id` present at `position 0` |
| The API serves it **to a different user** with its media | `mediaIds: ['fe1369b2-…']` to USER_B |
| And it renders in the feed after a pull-to-refresh | visible on the device |

Input was a 716,039-byte 1200×900 PNG; what reached storage was a 391,909-byte
JPEG at the same dimensions. Compression really ran, and the server's
`mime_verified` is its own reading of the bytes rather than the client's claim.

## Cancellation

| Check | Evidence |
| --- | --- |
| Cancelling the picker returns to a **working** composer | the image control is present again |
| And cancelling does not crash the app | clean |

## Ownership and state

| Check | Evidence |
| --- | --- |
| An upload slot is issued to its owner | 201 |
| **USER_B cannot attach USER_A's media** | 400 |
| **Media that is not READY cannot be attached, even by its owner** | 400 |
| **A READY object still cannot be reused by another account** | 400 |
| An unsupported kind is refused | 400 |
| A zero declared size is refused | 400 |
| An oversized declared size is refused | 400 |
| A negative declared size is refused | 400 |
| **An upload slot carries no storage credential to the client** | no `secret`, `accesskey`, `aws`, `signature` or `privatekey` anywhere in the response |

## A rejection that was my fixture, not a defect

The first attempt used a hand-built **180-byte, 64×64 PNG**. The app refused it
client-side — `قابلِ قبول نھیش` / *"Not supported"* — and **no upload slot was
ever requested**, so nothing reached the server.

That looked like the pipeline being broken. It was not:

- 217 media rows in this database have reached `READY` historically;
- the device flow had created **no** media row at all, so no upload had been
  attempted;
- a realistic 1200×900 photo went through the entire pipeline on the next try.

`ImageUploader` rejects `EMPTY` or `TOO_LARGE`, and `ImageCompressor` returns
null when a bitmap will not decode or scale usefully. A 180-byte synthetic PNG
is an unreasonable input, and refusing it is defensible. **No defect is filed**:
there is no requirement that such an image be accepted, and asserting one would
be inventing a rule.

## A harness mistake worth recording

The first version of this suite stopped at the app's own sheet and tapped a
blind coordinate inside it. Nothing was selected, no slot was requested, and it
reported the pipeline as broken. **There are two sheets**: the app's, and the
system picker one tap further behind "Photos". The suite now goes through both.
