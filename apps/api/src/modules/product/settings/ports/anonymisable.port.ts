import type { PoolClient } from 'pg';

/**
 * THE PER-MODULE ANONYMISATION CONTRACT (ADR-019).
 *
 * ADR-019 names its own disadvantage: "per-entity anonymisation logic is real
 * work and MUST BE MAINTAINED AS ENTITIES ARE ADDED — mitigated by A REGISTRY
 * EACH MODULE IMPLEMENTS." This is that registry.
 *
 * WHY IT IS A PORT RATHER THAN ONE BIG ERASURE FUNCTION. The alternative is a
 * single job that knows every table, and the failure mode is specific and
 * silent: EPIC-15 adds a table, nobody updates the erasure job, and a year
 * later somebody's "erased" account still has rows carrying their id. Nothing
 * fails, no test goes red, and the first person to notice is a regulator or a
 * journalist.
 *
 * With a registry, the module that OWNS the data owns its erasure, next to the
 * code that created it — and `settings` never learns another module's schema.
 * A module that adds a table and forgets is still possible, but the omission is
 * now visible in one file per module rather than absent from a file nobody
 * reads.
 *
 * EVERY IMPLEMENTATION RUNS IN THE CALLER'S TRANSACTION. Erasure is one
 * transaction across every module: a partial erasure is the worst possible
 * outcome, because the account is unusable AND the data is still there, and
 * nothing records which half succeeded.
 */
export const ANONYMISABLE = Symbol.for('mohalla.settings.anonymisable');

export interface AnonymisationOutcome {
  /** For the dry run and the log. Never the rows themselves. */
  readonly module: string;
  readonly rowsAnonymised: number;
  readonly rowsDeleted: number;
}

export interface Anonymisable {
  /** Names this contributor in the dry-run report and the audit metadata. */
  readonly moduleName: string;

  /**
   * What WOULD happen, without doing it.
   *
   * ADR-019: erasure "is irreversible, so the job is heavily tested and RUNS
   * DRY-RUN IN STAGING FIRST". A dry run that shared no code with the real one
   * would be a rehearsal of a different play, so both go through the same
   * interface and the flag is the only difference.
   */
  countFor(userId: string, client: PoolClient): Promise<AnonymisationOutcome>;

  /**
   * Do it. Irreversibly.
   *
   * The contract is per-entity and ADR-019 tabulates it:
   *
   *   Posts, comments   text RETAINED, author → the anonymous actor  (BR-009)
   *   Likes             retained as counts, actor anonymised
   *   Events            retained if future, organiser anonymised
   *   RSVPs             REMOVED from counts
   *   Messages sent     body retained FOR THE COUNTERPART, sender anonymised
   *   Reports filed     retained, reporter anonymised — moderation history
   *                     must survive somebody deleting their account
   *   Profile           erased
   *
   * The through-line is that OTHER PEOPLE'S records survive. A thread does not
   * lose its replies, a conversation does not lose one side, and a moderation
   * case does not lose the report that opened it — because none of those are
   * only the deleting user's data.
   */
  anonymise(userId: string, client: PoolClient): Promise<AnonymisationOutcome>;
}

/**
 * The permanent anonymous actor every module repoints content to.
 *
 * Created by migration 0021 rather than by the job, because a job that erases
 * somebody and then finds the destination missing has already passed the point
 * of no return.
 *
 * ONE SHARED ACTOR RATHER THAN A NULL PER PERSON, and that is what makes
 * PRIV-007's "carries no link back to the deleted identity" true. A null author
 * would still be a distinct absence: two posts by the same erased person would
 * still be visibly by one author, and anyone who remembered the thread could
 * re-link them. One shared row makes them genuinely indistinguishable.
 */
export const ANONYMOUS_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
