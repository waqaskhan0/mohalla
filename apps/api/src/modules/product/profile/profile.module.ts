import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { BLOCK_CHECK, NoBlocksYet } from './ports/block-check.port.js';
import { PROFILE_REPOSITORY } from './repositories/profile.repository.port.js';
import { PgProfileRepository } from './repositories/pg-profile.repository.js';
import { ProfileService } from './application/profile.service.js';
import { UsernameService } from './application/username.service.js';
import { ProfileController } from './transport/profile.controller.js';

/**
 * `profile` — product tier. EPIC-04.
 *
 * Owns `profiles`, `categories` and `profile_interests`, and defines the PUBLIC
 * PROJECTION that every surface showing a person renders (§162). One definition
 * is what makes a badge revocation or a block take effect everywhere at once,
 * rather than in the six places somebody remembered.
 *
 * Depends on `identity` (platform tier) for the session guard and the
 * authenticated principal — product → platform, which the dependency guard
 * allows. It does NOT depend on `social-graph`: the block predicate arrives
 * through `BLOCK_CHECK`, so EPIC-05 supplies an adapter rather than this module
 * reaching sideways into another product module.
 *
 * `media` is not imported yet either. `photoMediaId` is accepted and stored as
 * an opaque id; validating that it exists and is READY belongs with the media
 * module (MEDIA-FR-001) and is the one part of PROFILE-FR-010 that cannot be
 * finished here.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ProfileController],
  providers: [
    PgProfileRepository,
    { provide: PROFILE_REPOSITORY, useExisting: PgProfileRepository },

    // The stand-in until EPIC-05 owns blocks. Deliberately one binding: when
    // the real adapter arrives it replaces this line, rather than requiring a
    // change to every read path - and a read path is exactly where a privacy
    // rule gets missed. A service test asserts the read path consults this
    // port, so swapping it in cannot be a no-op.
    { provide: BLOCK_CHECK, useClass: NoBlocksYet },

    ProfileService,
    UsernameService,
  ],
  // Exported because almost every later epic renders a person: posts and
  // comments need the author projection, search needs it for results, and
  // messaging needs it for the inbox. The repository is NOT exported - no
  // other module writes a profile.
  exports: [ProfileService],
})
export class ProfileModule {}
