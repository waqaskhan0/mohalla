import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { inspect } from '../domain/content-inspection.js';
import { checkDeclaredSize, checkMeasuredFile } from '../domain/upload-limits.js';
import {
  MEDIA_STORAGE,
  type MediaStorage,
  type UploadTarget,
} from '../ports/media-storage.port.js';
import {
  MEDIA_REPOSITORY,
  type MediaKind,
  type MediaRecord,
  type MediaRepository,
  type MediaVisibility,
} from '../repositories/media.repository.port.js';

/** How long an upload slot stays usable. */
const SLOT_TTL_SECONDS = 15 * 60;

export interface RequestSlotCommand {
  ownerId: string;
  kind: MediaKind;
  /** Advisory. Re-measured from the stored object before anything is served. */
  declaredBytes: number;
  /**
   * MSG-FR-008. Defaults to PUBLIC because that is what a post attachment is;
   * a caller that wants an object unreachable by id must ask for it, and the
   * module that owns the containing record then serves it itself.
   */
  visibility?: MediaVisibility | undefined;
}

export type RequestSlotResult =
  | { status: 'SLOT_ISSUED'; mediaId: string; upload: UploadTarget }
  | { status: 'REJECTED'; reason: string };

export type CompleteUploadResult =
  | { status: 'READY'; media: MediaRecord }
  | { status: 'REJECTED'; reason: string }
  | { status: 'NOT_FOUND' }
  | { status: 'ALREADY_RESOLVED'; media: MediaRecord };

/**
 * The ADR-013 media lifecycle.
 *
 *   PENDING_UPLOAD ──client completes──► PROCESSING ──passes──► READY
 *         │                                   │
 *         └──24h sweep──► deleted             └──fails──► REJECTED ──► deleted
 *
 * FOUR THINGS THIS SERVICE REFUSES TO TRUST.
 *
 * 1. THE CLIENT'S DECLARED SIZE. Checked at slot request only so a 40 MB
 *    upload is refused before 40 MB moves. The authority is the byte count of
 *    the object that actually arrived (SEC-012, MEDIA-FR-005).
 *
 * 2. THE CLIENT'S DECLARED TYPE. Never read. Type comes from magic bytes, and
 *    a file that is executable in any layer is refused whatever it claims to
 *    be (SEC-013, EDGE-014).
 *
 * 3. THE CLIENT'S CHOICE OF KEY. The quarantine key is server-generated, and
 *    the SERVED key is generated again at promotion — unrelated to the
 *    quarantine key the uploader saw, and to the original filename, which is
 *    never stored at all (SEC-015).
 *
 * 4. THAT `complete` IS CALLED ONCE. The state transition is guarded in the
 *    UPDATE, so two concurrent completions cannot both run an inspection and
 *    race to promote the same object.
 *
 * A REJECTED OBJECT IS DELETED IMMEDIATELY, not left for the sweep. The sweep
 * is a backstop for abandoned uploads, not the mechanism for disposing of
 * something already known to be hostile.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_REPOSITORY) private readonly repo: MediaRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly logger: StructuredLogger,
    /**
     * ADR-013 gates PDF behind Technical Lead approval of a sanitisation
     * capability, and is explicit that if none fits V1, PDF is CUT rather than
     * SEC-013 weakened. Default false, so enabling it is a decision somebody
     * makes and records.
     */
    private readonly allowPdf = false,
  ) {}

  /** MED-API-001 — issue an upload slot. */
  async requestSlot(cmd: RequestSlotCommand): Promise<RequestSlotResult> {
    const declared = checkDeclaredSize(cmd.kind, cmd.declaredBytes);
    if (declared !== null) {
      // Refused before any bytes move. Advisory, but it saves the user a long
      // upload on a slow connection that was always going to fail.
      return { status: 'REJECTED', reason: declared };
    }

    if (cmd.kind === 'DOCUMENT' && !this.allowPdf) {
      return { status: 'REJECTED', reason: 'TYPE_NOT_ALLOWED' };
    }

    const id = randomUUID();
    // Random and server-chosen. A client-chosen key would let an uploader
    // overwrite another object or aim bytes at the served prefix.
    const quarantineKey = `quarantine/${randomKey()}`;

    const visibility = cmd.visibility ?? 'PUBLIC';
    await this.repo.createSlot({
      id,
      ownerId: cmd.ownerId,
      kind: cmd.kind,
      visibility,
      quarantineKey,
    });
    const upload = await this.storage.presignUpload(quarantineKey, SLOT_TTL_SECONDS);

    this.log('media_slot_issued', { mediaId: id, kind: cmd.kind, visibility });
    return { status: 'SLOT_ISSUED', mediaId: id, upload };
  }

  /**
   * MED-API-002 — the client reports the upload finished; inspect and resolve.
   *
   * Runs inline rather than as a queued job. ADR-013 describes a worker, and
   * that is the right shape once image variants are generated; inspection
   * itself is a synchronous read of a bounded buffer, and doing it here means
   * the client learns immediately which file failed — which is what EDGE-013
   * needs to let them retry one attachment without losing the others.
   * TODO(EPIC-11): move variant generation to the worker when it exists.
   */
  async completeUpload(mediaId: string, ownerId: string): Promise<CompleteUploadResult> {
    const media = await this.repo.findById(mediaId);
    if (media === null || media.ownerId !== ownerId) {
      // Same answer for "no such media" and "not yours": a media id is not a
      // secret, and distinguishing the two would let anyone probe which ids
      // exist.
      return { status: 'NOT_FOUND' };
    }

    // Guarded transition. Two concurrent completions cannot both proceed, so
    // only one inspection runs and only one promotion happens.
    const started = await this.repo.markProcessing(mediaId);
    if (!started) {
      const current = await this.repo.findById(mediaId);
      return current === null
        ? { status: 'NOT_FOUND' }
        : { status: 'ALREADY_RESOLVED', media: current };
    }

    const bytes = await this.storage.readQuarantined(media.quarantineKey);
    if (bytes === null) {
      // The client said it uploaded and there is nothing there. Rejected
      // rather than left in PROCESSING, or the row would sit until the sweep.
      await this.reject(media, 'NO_OBJECT_UPLOADED');
      return { status: 'REJECTED', reason: 'NO_OBJECT_UPLOADED' };
    }

    // ---- the actual gate -------------------------------------------------
    const inspection = inspect(bytes, { allowPdf: this.allowPdf });
    if (!inspection.ok) {
      await this.reject(media, inspection.reason);
      return { status: 'REJECTED', reason: inspection.reason };
    }

    const kindMatches =
      (media.kind === 'IMAGE' && inspection.type !== 'application/pdf') ||
      (media.kind === 'DOCUMENT' && inspection.type === 'application/pdf');
    if (!kindMatches) {
      // The slot said image and a PDF arrived, or the reverse. Refused rather
      // than reclassified, because the slot's kind gated the size limit.
      await this.reject(media, 'TYPE_DOES_NOT_MATCH_SLOT');
      return { status: 'REJECTED', reason: 'TYPE_DOES_NOT_MATCH_SLOT' };
    }

    const limit = checkMeasuredFile({
      type: inspection.type,
      byteSize: bytes.length,
      width: inspection.width,
      height: inspection.height,
    });
    if (limit !== null) {
      // MEDIA-FR-005's acceptance criterion: a 40 MB file posted directly is
      // rejected AND NOT STORED. `reject` deletes the object.
      await this.reject(media, limit);
      return { status: 'REJECTED', reason: limit };
    }

    // ---- promotion -------------------------------------------------------
    // A NEW random key, unrelated to the quarantine key the uploader saw
    // (SEC-015). Promotion is copy-then-delete, so a failure leaves the object
    // quarantined rather than in neither place.
    const storageKey = `served/${randomKey()}`;
    await this.storage.promote(media.quarantineKey, storageKey);

    await this.repo.markReady(mediaId, {
      storageKey,
      mimeVerified: inspection.type,
      byteSize: bytes.length,
      width: inspection.width ?? null,
      height: inspection.height ?? null,
    });

    const ready = await this.repo.findById(mediaId);
    if (ready === null) throw new Error('media vanished immediately after promotion');

    this.log('media_ready', { mediaId, type: inspection.type, byteSize: bytes.length });
    return { status: 'READY', media: ready };
  }

  /**
   * Accept bytes into quarantine (the local storage adapter's upload path).
   *
   * Deliberately does NOT inspect. Quarantine exists precisely so unvalidated
   * bytes have somewhere to land that is never served; inspection happens at
   * `completeUpload`, which is also where a rejection can delete the object.
   *
   * Only writes against a key that belongs to a real PENDING_UPLOAD slot, so a
   * caller cannot invent a key and place bytes anywhere they like.
   */
  async acceptQuarantinedBytes(quarantineKey: string, bytes: Uint8Array): Promise<boolean> {
    const media = await this.repo.findByQuarantineKey(quarantineKey);
    if (media === null || media.state !== 'PENDING_UPLOAD') return false;

    await this.storage.writeQuarantined(quarantineKey, bytes);
    return true;
  }

  /**
   * Read a served object, for MED-API-003. Only READY media is servable.
   *
   * PUBLIC only. A RESTRICTED object is not served through this route at all -
   * not "unless the caller is allowed", but never, because this module has no
   * way to evaluate the access rule and must not guess at one. MSG-FR-008's
   * criterion is that a message image "is not retrievable by anyone outside
   * that conversation", and only the messaging module knows who that is; it
   * calls `readServedRestricted` after checking.
   *
   * The refusal is the same `null` as a missing object, so a caller holding an
   * id cannot learn from this route whether it names anything.
   */
  async readServed(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const media = await this.repo.findById(mediaId);
    if (media === null || media.visibility !== 'PUBLIC') return null;
    if (media.state !== 'READY' || media.storageKey === null) return null;

    const bytes = await this.storage.readServed(media.storageKey);
    if (bytes === null) return null;
    return { bytes, mime: media.mimeVerified ?? 'application/octet-stream' };
  }

  /**
   * Read a RESTRICTED object on behalf of the module that owns its container.
   *
   * THE ACCESS DECISION IS THE CALLER'S, and the name says so: nothing here
   * checks who may see this, because nothing here could. The contract is that
   * a caller reaches this only after answering that question for its own
   * record - the messaging module after confirming the viewer is a participant
   * in the conversation the message belongs to.
   *
   * Kept as a separate method rather than a flag on `readServed`, so that
   * bypassing the check is a deliberate call to a differently-named method
   * rather than a boolean somebody passed wrongly.
   */
  async readServedRestricted(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const media = await this.repo.findById(mediaId);
    if (media === null || media.state !== 'READY' || media.storageKey === null) return null;

    const bytes = await this.storage.readServed(media.storageKey);
    if (bytes === null) return null;
    return { bytes, mime: media.mimeVerified ?? 'application/octet-stream' };
  }

  /**
   * The 24-hour orphan sweep (ADR-013).
   *
   * Deletes the object first, then the row. The other order can leave an
   * object with no row pointing at it — unreferenced bytes nobody will ever
   * clean up, which is worse than a row with no object.
   */
  async sweepOrphans(olderThan: Date, limit = 100): Promise<number> {
    const rows = await this.repo.findSweepable(olderThan, limit);
    let swept = 0;

    for (const row of rows) {
      try {
        await this.storage.deleteQuarantined(row.quarantineKey);
        if (row.storageKey !== null) await this.storage.deleteServed(row.storageKey);
        await this.repo.deleteById(row.id);
        swept += 1;
      } catch (e) {
        // One bad row must not stop the sweep. It stays sweepable and is
        // retried next time.
        this.logger.warn(JSON.stringify({ event: 'media_sweep_failed', mediaId: row.id }), 'media');
        void e;
      }
    }

    if (swept > 0) this.log('media_swept', { count: swept });
    return swept;
  }

  private async reject(media: MediaRecord, reason: string): Promise<void> {
    // Object deleted FIRST. MEDIA-FR-005 requires that a rejected upload is
    // "rejected and no file is stored", and leaving hostile bytes in
    // quarantine until a sweep would not satisfy that.
    await this.storage.deleteQuarantined(media.quarantineKey);
    await this.repo.markRejected(media.id, reason);
    this.log('media_rejected', { mediaId: media.id, reason });
  }

  private log(event: string, extra: Record<string, unknown>): void {
    // No keys, no filenames, no bytes. A storage key in a log is a handle on
    // an object, and the original filename is never held at all.
    this.logger.log(JSON.stringify({ event, ...extra }), 'media');
  }
}

/** 32 hex characters of CSPRNG output. Not derived from anything. */
function randomKey(): string {
  return randomBytes(16).toString('hex');
}
