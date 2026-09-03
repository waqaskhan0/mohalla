import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { MediaStorage, UploadTarget } from '../ports/media-storage.port.js';

/**
 * Filesystem-backed storage, for development and CI.
 *
 * NOT THE PRODUCTION ADAPTER. The frozen stack is S3-compatible object storage
 * behind a CDN (ADR-012), and Stage 6 provisions nothing paid — so this exists
 * to make the whole ADR-013 lifecycle runnable and testable now, and the S3
 * adapter arrives with the bucket.
 *
 * ONE PROPERTY IS DELIBERATELY WEAKER HERE, and it is worth naming rather than
 * discovering later: a filesystem cannot presign, so `presignUpload` returns an
 * API path and the bytes cross the API. That gives up ADR-013's bandwidth
 * benefit but keeps its SECURITY properties intact — quarantine is still a
 * separate directory that is never served, inspection still happens before
 * promotion, and the served key is still random and unrelated to anything the
 * client saw.
 *
 * The two directories are separate at the filesystem level, and `resolveSafe`
 * refuses any key that would escape them. A key never comes from a client, but
 * a path-traversal check on the one place keys become paths costs nothing and
 * removes an entire class of mistake from every future caller.
 */
@Injectable()
export class LocalMediaStorage implements MediaStorage {
  constructor(
    private readonly quarantineDir: string,
    private readonly servedDir: string,
    /** Where the API exposes its upload endpoint, for the returned target. */
    private readonly uploadPathPrefix = '/media/upload',
  ) {}

  async presignUpload(quarantineKey: string, expiresInSeconds: number): Promise<UploadTarget> {
    return {
      // An API path, not a storage URL. The S3 adapter returns a presigned URL
      // here and the client's code path is otherwise identical.
      url: `${this.uploadPathPrefix}/${encodeURIComponent(quarantineKey)}`,
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async writeQuarantined(quarantineKey: string, bytes: Uint8Array): Promise<void> {
    const path = this.resolveSafe(this.quarantineDir, quarantineKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async readQuarantined(quarantineKey: string): Promise<Uint8Array | null> {
    return this.readOrNull(this.resolveSafe(this.quarantineDir, quarantineKey));
  }

  async promote(quarantineKey: string, servedKey: string): Promise<void> {
    const from = this.resolveSafe(this.quarantineDir, quarantineKey);
    const to = this.resolveSafe(this.servedDir, servedKey);

    const bytes = await this.readOrNull(from);
    if (bytes === null) throw new Error('quarantined object is missing');

    // COPY first, then delete. A failure part-way leaves the object in
    // quarantine - recoverable and unserved - rather than in neither place.
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, bytes);
    await rm(from, { force: true });
  }

  async deleteQuarantined(quarantineKey: string): Promise<void> {
    await rm(this.resolveSafe(this.quarantineDir, quarantineKey), { force: true });
  }

  async deleteServed(servedKey: string): Promise<void> {
    await rm(this.resolveSafe(this.servedDir, servedKey), { force: true });
  }

  async readServed(servedKey: string): Promise<Uint8Array | null> {
    return this.readOrNull(this.resolveSafe(this.servedDir, servedKey));
  }

  private async readOrNull(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(path));
    } catch (e) {
      // A missing object is an ordinary outcome - swept, deleted, or never
      // uploaded. Anything else is a real failure and must not be swallowed.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /**
   * Turn a storage key into a path that cannot escape its directory.
   *
   * Keys are server-generated, so traversal should be impossible already. This
   * is here because "should be impossible" is exactly the assumption that stops
   * holding when someone later adds a caller — and the check is one line.
   */
  private resolveSafe(baseDir: string, key: string): string {
    const base = resolve(baseDir);
    const candidate = resolve(join(base, normalize(key)));
    if (candidate !== base && !candidate.startsWith(base + sep)) {
      throw new Error('storage key escapes its directory');
    }
    return candidate;
  }
}
