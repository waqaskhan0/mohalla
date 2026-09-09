import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * `audit` - platform tier.
 *
 * Append-only, protected from mutation by the application and administrator
 * roles (privilege first, trigger as defence in depth).
 *
 * Exposes only `AuditService.append`. There is deliberately no read API here
 * yet: reading the log is an admin-portal concern (EPIC-13) with its own
 * authorization, and an unguarded query surface in the platform tier would be
 * reachable by every product module that happens to import this one.
 *
 * Requirements owned by this module are listed in
 * `docs/architecture/06-backend-modules.md`.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
