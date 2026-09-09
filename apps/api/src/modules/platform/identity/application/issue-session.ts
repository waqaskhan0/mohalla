import { randomUUID } from 'node:crypto';

import type { Clock } from '../ports/clock.port.js';
import { issueSessionToken, sessionsToEvict } from '../domain/session-token.js';
import type { IdentityRepository } from '../repositories/identity.repository.port.js';
import type { DatabaseService } from '../../../../database/database.service.js';

type TransactionClient = Parameters<Parameters<DatabaseService['withTransaction']>[0]>[0];

/**
 * Establish a session, evicting the oldest if this is the sixth device.
 *
 * EXTRACTED SO THERE IS ONE OF IT. `LoginService` had this inline and
 * `OtpService` had nothing, which is how AUTH-FR-002's main flow step 5 -
 * *"A session is established and the visitor proceeds to username
 * selection"* - came to be unimplemented while login worked perfectly. A
 * second copy would have been a second thing to forget: BR-007's five-device
 * cap and EDGE-009's atomicity have to hold on every path that signs somebody
 * in, not just the one somebody remembered.
 *
 * EVERY STEP RUNS IN THE CALLER'S TRANSACTION (BR-007, EDGE-009). Read, evict
 * and insert must be atomic, or two simultaneous sign-ins each see five live
 * sessions, each evict one, and six survive.
 */
export async function issueSessionFor(
  repo: IdentityRepository,
  clock: Clock,
  userId: string,
  deviceLabel: string | null,
  client: TransactionClient,
): Promise<{ token: string; expiresAt: Date }> {
  const live = await repo.listLiveSessions(userId, client);
  const evict = sessionsToEvict(live);

  if (evict.length > 0) {
    await repo.revokeSessions(
      evict.map((s) => s.id),
      'EVICTED',
      client,
    );
  }

  const issued = issueSessionToken(clock.now());
  await repo.createSession(
    {
      id: randomUUID(),
      userId,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      deviceLabel,
    },
    client,
  );

  return { token: issued.token, expiresAt: issued.expiresAt };
}
