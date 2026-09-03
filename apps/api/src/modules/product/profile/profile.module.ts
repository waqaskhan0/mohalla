import { Module } from '@nestjs/common';
import { IdentityModule } from '../../platform/identity/identity.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { BlockService } from '../safety/application/block.service.js';
import { BLOCK_CHECK } from './ports/block-check.port.js';
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
 * allows — and on `safety` for the block predicate, which is the single shared
 * implementation every read path in the product consults (§165).
 *
 * It still does NOT depend on `social-graph`. The predicate arrives through
 * `BLOCK_CHECK`, which EPIC-05 filled in by changing one provider binding.
 *
 * `media` is not imported yet either. `photoMediaId` is accepted and stored as
 * an opaque id; validating that it exists and is READY belongs with the media
 * module (MEDIA-FR-001) and is the one part of PROFILE-FR-010 that cannot be
 * finished here.
 */
@Module({
  imports: [IdentityModule, SafetyModule],
  controllers: [ProfileController],
  providers: [
    PgProfileRepository,
    { provide: PROFILE_REPOSITORY, useExisting: PgProfileRepository },

    // EPIC-05 landed, so this is now the REAL predicate. It was one line to
    // change, which was the point of introducing the port in EPIC-04 rather
    // than writing the read paths without a block check and coming back: a
    // read path is exactly where a privacy rule gets missed. `BlockService`
    // satisfies `BlockCheck` structurally - `isBlockedEitherWay` with the same
    // symmetric contract.
    { provide: BLOCK_CHECK, useExisting: BlockService },

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
