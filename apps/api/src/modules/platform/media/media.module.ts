import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { ENV } from '../../../config/env.token.js';
import type { Env } from '../../../config/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MEDIA_STORAGE } from './ports/media-storage.port.js';
import { LocalMediaStorage } from './adapters/local-media-storage.js';
import { MEDIA_REPOSITORY } from './repositories/media.repository.port.js';
import { PgMediaRepository } from './repositories/pg-media.repository.js';
import { MediaService } from './application/media.service.js';
import { MediaController } from './transport/media.controller.js';
import { StructuredLogger } from '../../../common/logging/structured.logger.js';

/**
 * `media` - platform tier. EPIC-06, ADR-013.
 *
 * Owns the quarantine lifecycle: slot, upload, inspect, promote or reject.
 * Content inspection (SEC-013) lives here and nowhere else, so every upload
 * path in the product passes the same gate.
 *
 * PDF IS OFF BY DEFAULT. ADR-013 gates it behind Technical Lead approval of a
 * sanitisation capability and says that if none fits V1, PDF is cut rather than
 * SEC-013 weakened. `MEDIA_ALLOW_PDF` exists so enabling it is a deliberate,
 * recorded act - not something inherited from a default.
 */
@Module({
  imports: [IdentityModule],
  controllers: [MediaController],
  providers: [
    PgMediaRepository,
    { provide: MEDIA_REPOSITORY, useExisting: PgMediaRepository },

    {
      // The filesystem adapter, for development and CI. The S3 adapter
      // replaces this one binding when a bucket exists (ADR-012); nothing
      // else in the module changes.
      provide: MEDIA_STORAGE,
      useFactory: (env: Env) =>
        new LocalMediaStorage(
          join(env.MEDIA_LOCAL_ROOT, 'quarantine'),
          join(env.MEDIA_LOCAL_ROOT, 'served'),
        ),
      inject: [ENV],
    },

    {
      provide: MediaService,
      useFactory: (repo, storage, logger: StructuredLogger, env: Env) =>
        new MediaService(repo, storage, logger, env.MEDIA_ALLOW_PDF),
      inject: [MEDIA_REPOSITORY, MEDIA_STORAGE, StructuredLogger, ENV],
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
