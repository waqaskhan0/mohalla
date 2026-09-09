import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../database/database.service.js';
import type { ActorNames } from '../../../platform/notifications/ports/actor-names.port.js';

/**
 * Supplies `notifications` with the display names and event titles its
 * templates need.
 *
 * READS DIRECTLY RATHER THAN GOING THROUGH `ProfileService`, and the reason is
 * that the two questions are different. `ProfileService.viewByUserId` answers
 * "what may this VIEWER see of this person", applying blocks and visibility —
 * correct for a profile screen, wrong here twice over: the notification
 * pipeline has already applied the block rule in its own order, and there is no
 * viewer, because the render happens before anyone opens anything.
 *
 * What this needs is the flat fact "what is this person called", and asking the
 * richer question would either apply the block twice or force a fake viewer
 * through a path built for a real one.
 *
 * A MISSING NAME IS AN EMPTY STRING, never a throw. A notification whose actor
 * was deleted mid-flight still gets delivered; a dead-lettered row and no
 * notification would be the worse failure.
 */
@Injectable()
export class ActorNamesAdapter implements ActorNames {
  constructor(private readonly db: DatabaseService) {}

  async displayNameOf(userId: string): Promise<string> {
    const r = await this.db.query<{ display_name: string }>(
      'SELECT display_name FROM profiles WHERE user_id = $1',
      [userId],
    );
    return r.rows[0]?.display_name ?? '';
  }

  async eventTitleOf(eventId: string): Promise<string> {
    const r = await this.db.query<{ title: string }>('SELECT title FROM events WHERE id = $1', [
      eventId,
    ]);
    return r.rows[0]?.title ?? '';
  }
}
