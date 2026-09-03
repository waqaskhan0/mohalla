import { Controller, Get, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FoundationErrorCode } from '@mohalla/contracts';
import { Public } from '../modules/platform/identity/transport/session.guard.js';
import { HealthService } from './health.service.js';

/**
 * The only routes the foundation exposes.
 *
 *   GET /health        - summary, including version and commit
 *   GET /health/live   - process liveness, no dependency consulted
 *   GET /health/ready  - dependency readiness, 503 when a dependency is down
 *
 * PROPOSED DEFAULT (Stage 5). Stage 4 requires health checks as a deployment
 * mechanism but does not specify paths or payloads, so this shape is a Stage 5
 * default recorded in `docs/foundation/13-observability.md`. It is changeable
 * without affecting any approved requirement.
 *
 * WHY /live AND /ready ARE SEPARATE
 *
 * A liveness probe that touches the database restarts a healthy process
 * whenever the database blips, turning a brief dependency outage into a full
 * availability incident. Liveness answers "is this process wedged?"; readiness
 * answers "should traffic come here?".
 */
@ApiTags('health')
@Controller('health')
// Authentication is the default for every route (the session guard is global),
// so health MUST opt out explicitly. A liveness or readiness probe carries no
// bearer token; a guarded /health/ready returns 401, the orchestrator concludes
// the process is unhealthy, and no traffic is ever routed to a working service.
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Service summary, version and dependency status' })
  @ApiOkResponse({ description: 'Summary returned. `status` may be `degraded`.' })
  async summary() {
    return this.health.summary();
  }

  @Get('live')
  @ApiOperation({ summary: 'Process liveness. Consults no dependency.' })
  @ApiOkResponse({ description: 'The process is running.' })
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness' })
  @ApiOkResponse({ description: 'Every dependency answered.' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable.' })
  async ready() {
    const result = await this.health.ready();
    if (!result.ok) {
      // 503 so an orchestrator withholds traffic rather than sending it to a
      // process whose database is unreachable.
      throw new ServiceUnavailableException({
        code: FoundationErrorCode.DEPENDENCY_UNAVAILABLE,
        message: 'One or more dependencies are unavailable.',
        details: result.dependencies
          .filter((d) => !d.ok)
          .map((d) => ({ path: d.name, message: d.detail })),
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    return result;
  }
}
