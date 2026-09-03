import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../../database/database.service.js';
import { StructuredLogger } from '../../../common/logging/structured.logger.js';
import { currentCorrelationId } from '../../../common/correlation/correlation.context.js';

/** Who performed the action. `SYSTEM` covers jobs with no human actor. */
export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface AuditEntry {
  actorType: AuditActorType;
  /** Null for SYSTEM, and for an actor who could not be identified. */
  actorId?: string | null;
  /** Past-tense, stable, machine-readable. e.g. `ADMIN_LOGIN_SUCCEEDED`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /**
   * Structured detail.
   *
   * MUST NOT contain a phone number, an email address, a date of birth or a
   * password hash. The log is retained PSEUDONYMOUSLY after erasure (OD-019),
   * so anything identifying written here outlives the deletion request that
   * was supposed to remove it. `assertNoIdentifiers` below is the backstop.
   */
  metadata?: Record<string, unknown>;
  /** Peppered hash of the source address, never the address. */
  ipHash?: Buffer | null;
}

/**
 * Append-only audit log (SEC-021 · OD-019).
 *
 * WHY THIS IS A SERVICE AND NOT A LOGGER CALL
 *
 * Application logs are for operators and rotate away. This is evidence: who
 * suspended an account, who read a report, who signed in to the admin console.
 * It has to survive log rotation, be queryable, and be impossible to edit — the
 * database enforces the last part by privilege (the runtime role has INSERT and
 * SELECT, never UPDATE or DELETE) with a trigger as defence in depth.
 *
 * WRITES JOIN THE CALLER'S TRANSACTION when a client is passed. An audit row
 * for an action that then rolled back is a false record, and a rolled-back
 * action with no audit row is an invisible one. Both are worse than either
 * being merely late, so the row and the action commit together.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Append one entry.
   *
   * @param client Pass the caller's transaction client so the row commits with
   * the action it describes. Omit only for an action that is already committed
   * and cannot be undone.
   */
  async append(entry: AuditEntry, client?: PoolClient): Promise<void> {
    const metadata = entry.metadata ?? {};
    assertNoIdentifiers(entry.action, metadata);

    const sql = `
      INSERT INTO audit_log
        (id, actor_type, actor_id, action, entity_type, entity_id, metadata, correlation_id, ip_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`;

    const params = [
      randomUUID(),
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(metadata),
      currentCorrelationId() ?? null,
      entry.ipHash ?? null,
    ];

    if (client !== undefined) {
      await client.query(sql, params);
      return;
    }

    // No transaction to join. A failure here must not swallow the action that
    // already happened, but it must be loud - a silent gap in an audit trail
    // is indistinguishable from nothing having happened.
    try {
      await this.db.query(sql, params);
    } catch (e) {
      this.logger.error(
        JSON.stringify({ event: 'audit_append_failed', action: entry.action }),
        e instanceof Error ? e.stack : String(e),
        'audit',
      );
      throw e;
    }
  }
}

/**
 * Refuse to write anything that looks like a direct identifier.
 *
 * A guard rather than a convention, because the cost of getting this wrong is
 * asymmetric: the audit log is retained after account erasure, so a phone
 * number written here defeats a deletion request permanently and silently.
 * Failing the write is recoverable; a permanent privacy breach is not.
 *
 * Heuristic on purpose. It cannot catch everything, and is not the only
 * control — reviewers and the `metadata` doc comment matter too — but it stops
 * the obvious mistakes, which are the ones that actually happen.
 */
export function assertNoIdentifiers(action: string, metadata: Record<string, unknown>): void {
  const forbiddenKey = /phone|msisdn|mobile|email|dob|date_?of_?birth|password|token|otp|code/i;
  const looksLikeEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const looksLikeDate = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/;

  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 8) return;

    if (typeof value === 'string') {
      if (containsPakistaniMobile(value)) throw refuse(action, path, 'phone number');
      if (looksLikeEmail.test(value)) throw refuse(action, path, 'email address');
      if (looksLikeDate.test(value)) throw refuse(action, path, 'date of birth');
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }

    if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        const next = path === '' ? k : `${path}.${k}`;
        if (forbiddenKey.test(k)) throw refuse(action, next, `a '${k}' field`);
        walk(v, next, depth + 1);
      }
    }
  };

  walk(metadata, '', 0);
}

/**
 * Does this string contain a Pakistani mobile number?
 *
 * Deliberately matches WHOLE tokens rather than scanning for a digit run.
 * A loose scan is worse than useless here: `3\d{2}[\s-]?\d{7}` finds a "phone
 * number" inside the UUID `...-8333-4444555566...`, which would refuse
 * legitimate audit writes at runtime - and a privacy guard that blocks real
 * evidence from being recorded has made the audit trail less trustworthy, not
 * more.
 *
 * So the string is split on anything that cannot be part of a written number,
 * separators are removed, and the remaining digits must be a phone number
 * ENTIRELY. A UUID splits on its hex letters and none of its pieces qualify.
 */
function containsPakistaniMobile(value: string): boolean {
  // Same prefix rule as the identity domain's normalizer (03xx, 3[0-4]x). Not
  // imported: audit sits in the same tier as identity and identity depends on
  // audit, so an import back the other way would be a cycle.
  const asMobile = /^(?:0092|\+92|92|0)?3[0-4]\d{8}$/;

  // UUIDs are removed FIRST, because a UUID's hyphen-separated digit groups can
  // add up to a valid number. `92312345-6789-...` strips to `923123456789`,
  // which is `92` + a real 03xx mobile - so a plain token scan reports a phone
  // number inside an ordinary actor id. Since audit rows are mostly UUIDs, that
  // would refuse legitimate writes constantly.
  //
  // Stripping them is safe: a UUID is structurally unambiguous, and no real
  // phone number is written in that shape.
  const withoutUuids = value.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    ' ',
  );

  for (const token of withoutUuids.split(/[^\d+\s()-]+/)) {
    const digits = token.replace(/[\s()-]/g, '');
    if (digits.length >= 10 && asMobile.test(digits)) return true;
  }
  return false;
}

function refuse(action: string, path: string, what: string): Error {
  // The offending VALUE is never included - that would move the identifier
  // from the audit row into the error and then into the application log.
  return new Error(
    `audit metadata for '${action}' contains ${what} at '${path}'. ` +
      'The audit log is retained after erasure (OD-019), so it must never hold a direct identifier.',
  );
}
