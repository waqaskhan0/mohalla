import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MediaService } from './media.service.js';
import { MAX_IMAGE_BYTES } from '../domain/upload-limits.js';
import type { MediaStorage, UploadTarget } from '../ports/media-storage.port.js';
import type {
  MediaKind,
  MediaRecord,
  MediaRepository,
} from '../repositories/media.repository.port.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

/** A real PNG header, so inspection has something genuine to identify. */
function png(width = 100, height = 100, padTo = 0): Uint8Array {
  const base = new Uint8Array(Math.max(24, padTo));
  base.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  base.set(
    [...'IHDR'].map((c) => c.charCodeAt(0)),
    12,
  );
  const view = new DataView(base.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return base;
}

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/**
 * In-memory storage with the same two-prefix separation the real one has.
 * Kept separate so a test can assert that a rejected object left NEITHER
 * prefix populated.
 */
class InMemoryStorage implements MediaStorage {
  readonly quarantine = new Map<string, Uint8Array>();
  readonly served = new Map<string, Uint8Array>();
  /** Make promote fail, to test the copy-then-delete ordering. */
  failPromote = false;

  async presignUpload(key: string, seconds: number): Promise<UploadTarget> {
    return {
      url: `/media/upload/${key}`,
      method: 'PUT',
      headers: {},
      expiresAt: new Date(Date.now() + seconds * 1000),
    };
  }
  async writeQuarantined(key: string, bytes: Uint8Array): Promise<void> {
    this.quarantine.set(key, bytes);
  }
  async readQuarantined(key: string): Promise<Uint8Array | null> {
    return this.quarantine.get(key) ?? null;
  }
  async promote(from: string, to: string): Promise<void> {
    if (this.failPromote) throw new Error('storage unavailable');
    const bytes = this.quarantine.get(from);
    if (bytes === undefined) throw new Error('quarantined object is missing');
    this.served.set(to, bytes);
    this.quarantine.delete(from);
  }
  async deleteQuarantined(key: string): Promise<void> {
    this.quarantine.delete(key);
  }
  async deleteServed(key: string): Promise<void> {
    this.served.delete(key);
  }
  async readServed(key: string): Promise<Uint8Array | null> {
    return this.served.get(key) ?? null;
  }
}

class InMemoryMedia implements MediaRepository {
  readonly rows = new Map<string, MediaRecord>();
  now: () => Date = () => new Date();

  async createSlot(input: {
    id: string;
    ownerId: string;
    kind: MediaKind;
    quarantineKey: string;
  }): Promise<MediaRecord> {
    const row: MediaRecord = {
      id: input.id,
      ownerId: input.ownerId,
      kind: input.kind,
      state: 'PENDING_UPLOAD',
      quarantineKey: input.quarantineKey,
      storageKey: null,
      mimeVerified: null,
      byteSize: null,
      width: null,
      height: null,
      rejectionReason: null,
      createdAt: this.now(),
      readyAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<MediaRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async markProcessing(id: string): Promise<boolean> {
    const row = this.rows.get(id);
    // Mirrors the guarded UPDATE: only PENDING_UPLOAD advances, so two
    // concurrent completions cannot both proceed.
    if (row === undefined || row.state !== 'PENDING_UPLOAD') return false;
    this.rows.set(id, { ...row, state: 'PROCESSING' });
    return true;
  }

  async markReady(
    id: string,
    r: {
      storageKey: string;
      mimeVerified: string;
      byteSize: number;
      width: number | null;
      height: number | null;
    },
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) return;
    this.rows.set(id, {
      ...row,
      state: 'READY',
      storageKey: r.storageKey,
      mimeVerified: r.mimeVerified,
      byteSize: r.byteSize,
      width: r.width,
      height: r.height,
      rejectionReason: null,
      readyAt: this.now(),
    });
  }

  async markRejected(id: string, reason: string): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) return;
    this.rows.set(id, { ...row, state: 'REJECTED', rejectionReason: reason, storageKey: null });
  }

  async findSweepable(olderThan: Date, limit: number): Promise<MediaRecord[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          ['PENDING_UPLOAD', 'PROCESSING', 'REJECTED'].includes(r.state) && r.createdAt < olderThan,
      )
      .slice(0, limit);
  }

  async deleteById(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

function build(allowPdf = false) {
  const repo = new InMemoryMedia();
  const storage = new InMemoryStorage();
  const logs: string[] = [];
  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new MediaService(repo, storage, logger, allowPdf);

  return {
    service,
    repo,
    storage,
    logs,
    /** Request a slot and put `bytes` in quarantine, as a client would. */
    async upload(ownerId: string, bytes: Uint8Array, kind: MediaKind = 'IMAGE') {
      const slot = await service.requestSlot({
        ownerId,
        kind,
        declaredBytes: Math.max(bytes.length, 1),
      });
      if (slot.status !== 'SLOT_ISSUED') throw new Error(`slot refused: ${slot.reason}`);
      const row = await repo.findById(slot.mediaId);
      await storage.writeQuarantined(row!.quarantineKey, bytes);
      return slot.mediaId;
    },
  };
}

describe('MediaService.requestSlot (MED-API-001)', () => {
  let ctx: ReturnType<typeof build>;
  let owner: string;
  beforeEach(() => {
    ctx = build();
    owner = randomUUID();
  });

  it('issues a slot with a server-chosen quarantine key', async () => {
    const r = await ctx.service.requestSlot({ ownerId: owner, kind: 'IMAGE', declaredBytes: 1000 });
    expect(r.status).toBe('SLOT_ISSUED');
    if (r.status !== 'SLOT_ISSUED') return;

    const row = await ctx.repo.findById(r.mediaId);
    expect(row?.state).toBe('PENDING_UPLOAD');
    // Client-chosen keys would let an uploader overwrite another object or
    // aim bytes at the served prefix.
    expect(row?.quarantineKey.startsWith('quarantine/')).toBe(true);
    expect(row?.storageKey).toBeNull();
  });

  it('REFUSES AN OVERSIZED DECLARATION BEFORE ANY BYTES MOVE', async () => {
    const r = await ctx.service.requestSlot({
      ownerId: owner,
      kind: 'IMAGE',
      declaredBytes: 40 * 1024 * 1024,
    });
    expect(r).toEqual({ status: 'REJECTED', reason: 'TOO_LARGE' });
  });

  it('refuses a document slot while PDF is gated off (ADR-013)', async () => {
    const r = await ctx.service.requestSlot({
      ownerId: owner,
      kind: 'DOCUMENT',
      declaredBytes: 1000,
    });
    expect(r).toEqual({ status: 'REJECTED', reason: 'TYPE_NOT_ALLOWED' });
  });

  it('gives the slot an expiry, so a stale target cannot be reused', async () => {
    const r = await ctx.service.requestSlot({ ownerId: owner, kind: 'IMAGE', declaredBytes: 100 });
    if (r.status !== 'SLOT_ISSUED') throw new Error('expected a slot');
    expect(r.upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('MediaService.completeUpload — the gate (SEC-012/013, MEDIA-FR-005)', () => {
  let ctx: ReturnType<typeof build>;
  let owner: string;
  beforeEach(() => {
    ctx = build();
    owner = randomUUID();
  });

  it('promotes a genuine image to READY', async () => {
    const id = await ctx.upload(owner, png(1600, 900));
    const r = await ctx.service.completeUpload(id, owner);

    expect(r.status).toBe('READY');
    if (r.status !== 'READY') return;
    expect(r.media.mimeVerified).toBe('image/png');
    expect(r.media.width).toBe(1600);
    expect(r.media.height).toBe(900);
  });

  it('GIVES THE SERVED OBJECT A KEY UNRELATED TO THE QUARANTINE KEY (SEC-015)', async () => {
    const id = await ctx.upload(owner, png());
    const before = await ctx.repo.findById(id);
    await ctx.service.completeUpload(id, owner);
    const after = await ctx.repo.findById(id);

    // The quarantine key was returned to the uploader. If the served key were
    // derived from it, that would be a guessable handle on the served object.
    expect(after?.storageKey).not.toBe(before?.quarantineKey);
    expect(after?.storageKey?.includes(before!.quarantineKey.split('/')[1]!)).toBe(false);
    expect(ctx.storage.quarantine.size).toBe(0); // copy-then-DELETE
    expect(ctx.storage.served.size).toBe(1);
  });

  it('REJECTS AN EXECUTABLE AND STORES NOTHING', async () => {
    // MEDIA-FR-005 AC: "rejected and no file is stored".
    const id = await ctx.upload(owner, new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]));
    const r = await ctx.service.completeUpload(id, owner);

    expect(r).toEqual({ status: 'REJECTED', reason: 'EXECUTABLE_CONTENT' });
    expect(ctx.storage.quarantine.size).toBe(0);
    expect(ctx.storage.served.size).toBe(0);
  });

  it('REJECTS A ZIP RENAMED AS AN IMAGE (EDGE-014)', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const id = await ctx.upload(owner, zip);
    const r = await ctx.service.completeUpload(id, owner);
    expect(r.status).toBe('REJECTED');
    expect(ctx.storage.served.size).toBe(0);
  });

  it('REJECTS A FILE THAT UNDER-DECLARED ITS SIZE', async () => {
    // The declared size passed the slot check; the real bytes did not. The
    // measured value is the authority (SEC-012).
    const huge = png(100, 100, MAX_IMAGE_BYTES + 1024);
    const slot = await ctx.service.requestSlot({
      ownerId: owner,
      kind: 'IMAGE',
      declaredBytes: 1000, // a lie
    });
    if (slot.status !== 'SLOT_ISSUED') throw new Error('expected a slot');
    const row = await ctx.repo.findById(slot.mediaId);
    await ctx.storage.writeQuarantined(row!.quarantineKey, huge);

    const r = await ctx.service.completeUpload(slot.mediaId, owner);
    expect(r).toEqual({ status: 'REJECTED', reason: 'TOO_LARGE' });
    expect(ctx.storage.served.size).toBe(0);
  });

  it('rejects a decompression-bomb sized image', async () => {
    const id = await ctx.upload(owner, png(60_000, 60_000));
    const r = await ctx.service.completeUpload(id, owner);
    // A few hundred KB compressed, gigabytes decompressed. The byte check
    // passes comfortably, so the limit has to be on the dimensions.
    expect(r).toEqual({ status: 'REJECTED', reason: 'IMAGE_TOO_LARGE_IN_PIXELS' });
  });

  it('rejects a PDF that arrived through an IMAGE slot', async () => {
    const pdf = ascii('%PDF-1.7\nxref\ntrailer\n%%EOF\n');
    const id = await ctx.upload(owner, pdf);
    const r = await ctx.service.completeUpload(id, owner);
    // The slot's kind gated the size limit, so reclassifying would let a
    // 10 MB document through a 5 MB image slot.
    expect(r.status).toBe('REJECTED');
  });

  it('rejects when the client says it uploaded but nothing is there', async () => {
    const slot = await ctx.service.requestSlot({
      ownerId: owner,
      kind: 'IMAGE',
      declaredBytes: 100,
    });
    if (slot.status !== 'SLOT_ISSUED') throw new Error('expected a slot');

    const r = await ctx.service.completeUpload(slot.mediaId, owner);
    // Rejected rather than left PROCESSING, or the row sits until the sweep.
    expect(r).toEqual({ status: 'REJECTED', reason: 'NO_OBJECT_UPLOADED' });
  });

  it('IS SAFE AGAINST A DOUBLE COMPLETE', async () => {
    const id = await ctx.upload(owner, png());
    const [first, second] = await Promise.all([
      ctx.service.completeUpload(id, owner),
      ctx.service.completeUpload(id, owner),
    ]);

    // Exactly one inspection ran and exactly one promotion happened; the other
    // caller is told the media is already resolved.
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['ALREADY_RESOLVED', 'READY']);
    expect(ctx.storage.served.size).toBe(1);
  });

  it("gives the same answer for another person's media as for none", async () => {
    const id = await ctx.upload(owner, png());
    const stranger = randomUUID();

    // A media id is not a secret. Distinguishing these would let anyone probe
    // which ids exist.
    const notMine = await ctx.service.completeUpload(id, stranger);
    const notThere = await ctx.service.completeUpload(randomUUID(), stranger);
    expect(JSON.stringify(notMine)).toBe(JSON.stringify(notThere));
    expect(notMine).toEqual({ status: 'NOT_FOUND' });
  });

  it('NEVER LOGS A STORAGE KEY', async () => {
    const id = await ctx.upload(owner, png());
    await ctx.service.completeUpload(id, owner);
    const row = await ctx.repo.findById(id);

    for (const line of ctx.logs) {
      // A storage key in a log is a handle on the object.
      expect(line).not.toContain(row!.storageKey!);
      expect(line).not.toContain(row!.quarantineKey);
    }
  });
});

describe('MediaService — PDF is gated (ADR-013)', () => {
  it('refuses a PDF by default', async () => {
    const ctx = build(false);
    const owner = randomUUID();
    const slot = await ctx.service.requestSlot({
      ownerId: owner,
      kind: 'IMAGE',
      declaredBytes: 500,
    });
    if (slot.status !== 'SLOT_ISSUED') throw new Error('expected a slot');
    const row = await ctx.repo.findById(slot.mediaId);
    await ctx.storage.writeQuarantined(row!.quarantineKey, ascii('%PDF-1.7\nxref\ntrailer\n%%EOF'));

    expect((await ctx.service.completeUpload(slot.mediaId, owner)).status).toBe('REJECTED');
  });

  it('accepts a clean PDF when explicitly enabled', async () => {
    const ctx = build(true);
    const owner = randomUUID();
    const id = await ctx.upload(
      owner,
      ascii('%PDF-1.7\n1 0 obj\n<< >>\nendobj\nxref\ntrailer\n<< >>\n%%EOF\n'),
      'DOCUMENT',
    );
    const r = await ctx.service.completeUpload(id, owner);
    expect(r.status).toBe('READY');
  });

  it('REFUSES A PDF WITH ACTIVE CONTENT even when PDF is enabled', async () => {
    const ctx = build(true);
    const owner = randomUUID();
    const id = await ctx.upload(
      owner,
      ascii('%PDF-1.7\n<< /S /JavaScript /JS (evil) >>\nxref\ntrailer\n%%EOF\n'),
      'DOCUMENT',
    );
    expect(await ctx.service.completeUpload(id, owner)).toEqual({
      status: 'REJECTED',
      reason: 'PDF_ACTIVE_CONTENT',
    });
  });
});

describe('MediaService.readServed (MED-API-003)', () => {
  it('serves a READY object with its verified type', async () => {
    const ctx = build();
    const owner = randomUUID();
    const id = await ctx.upload(owner, png());
    await ctx.service.completeUpload(id, owner);

    const served = await ctx.service.readServed(id);
    expect(served?.mime).toBe('image/png');
  });

  it('SERVES NOTHING THAT IS NOT READY', async () => {
    const ctx = build();
    const owner = randomUUID();

    // Bytes are in quarantine but inspection has not run. A guessed id must
    // not reach them.
    const id = await ctx.upload(owner, png());
    expect(await ctx.service.readServed(id)).toBeNull();

    // And a rejected object is gone entirely.
    const bad = await ctx.upload(owner, new Uint8Array([0x4d, 0x5a]));
    await ctx.service.completeUpload(bad, owner);
    expect(await ctx.service.readServed(bad)).toBeNull();
  });
});

describe('MediaService.sweepOrphans (ADR-013)', () => {
  it('removes abandoned uploads and their objects', async () => {
    const ctx = build();
    const owner = randomUUID();
    ctx.repo.now = () => new Date('2026-03-01T00:00:00Z');

    const abandoned = await ctx.upload(owner, png());
    const swept = await ctx.service.sweepOrphans(new Date('2026-03-02T00:00:00Z'));

    expect(swept).toBe(1);
    expect(await ctx.repo.findById(abandoned)).toBeNull();
    expect(ctx.storage.quarantine.size).toBe(0);
  });

  it('NEVER SWEEPS A READY OBJECT BY AGE', async () => {
    const ctx = build();
    const owner = randomUUID();
    ctx.repo.now = () => new Date('2026-03-01T00:00:00Z');

    const id = await ctx.upload(owner, png());
    await ctx.service.completeUpload(id, owner);

    // READY media is deleted with its post or account, never because it is
    // old - a year-old photo on a live post must not vanish.
    expect(await ctx.service.sweepOrphans(new Date('2027-01-01T00:00:00Z'))).toBe(0);
    expect(await ctx.repo.findById(id)).not.toBeNull();
  });

  it('keeps going when one row fails', async () => {
    const ctx = build();
    const owner = randomUUID();
    ctx.repo.now = () => new Date('2026-03-01T00:00:00Z');
    await ctx.upload(owner, png());
    await ctx.upload(owner, png());

    let calls = 0;
    const original = ctx.storage.deleteQuarantined.bind(ctx.storage);
    ctx.storage.deleteQuarantined = async (key: string) => {
      calls += 1;
      if (calls === 1) throw new Error('storage hiccup');
      return original(key);
    };

    // One bad row must not stop the sweep; it stays sweepable and is retried.
    expect(await ctx.service.sweepOrphans(new Date('2026-03-02T00:00:00Z'))).toBe(1);
  });
});
