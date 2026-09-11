/**
 * QA-005 — retire every OTP challenge digested under the old unkeyed SHA-256.
 *
 * WHAT CHANGED IN THE APPLICATION. `otp_challenges.code_hash` used to hold
 * `sha256(code)`. A six-digit code has 10^6 possibilities, so that digest was
 * reversible from a database read alone — Stage 10's QA harness did exactly
 * that, every run, in well under a second, and `PASSWORD_RESET` challenges live
 * in the same table. The digest is now
 * `HMAC-SHA256(OTP_HASH_KEY, domain || challengeId || purpose || code)`.
 *
 * WHY THE ROWS ARE DELETED RATHER THAN MIGRATED. They cannot be migrated: the
 * new digest needs the plaintext code, and the whole point of the old value is
 * that the plaintext is not stored. Recomputing it would mean enumerating the
 * space — performing the attack in order to fix it — which would also leave the
 * codes in a migration log.
 *
 * WHY NOT A HASH-VERSION COLUMN AND A FALLBACK WINDOW. Because the fallback
 * would BE the vulnerability. Any row still verifiable under `sha256(code)` is
 * a row an attacker with a database read can still solve, so a "bounded"
 * legacy window is a bounded window in which nothing is fixed. The bound that
 * matters already exists in the data: OTPs live ten minutes. Deleting the live
 * ones costs at most one resend to anyone mid-flow at deploy time, and buys an
 * immediate, total cut-over with no dual-algorithm code path to remove later
 * and no way to accidentally keep one.
 *
 * WHAT A USER SEES. Somebody holding an unused code at the moment of deploy
 * finds it rejected and asks for a new one — the same experience as a code that
 * expired while they were reading it, which the app already handles. Nobody
 * loses an account, a session or any data: this table holds only in-flight
 * challenges.
 *
 * THE `DELETE` IS UNCONDITIONAL, including consumed and expired rows. They are
 * spent and carry no value, and leaving them would leave reversible digests
 * sitting in the table and in every backup taken afterwards for no reason at
 * all. The throttle state this could disturb is derived from `created_at` on
 * live rows; clearing history at worst grants one extra resend, which is the
 * generous direction.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    -- Nothing here is recoverable under the new construction, and nothing here
    -- should survive: every row is a digest an attacker could reverse.
    DELETE FROM otp_challenges;
  `);
};

exports.down = async (pgm) => {
  /**
   * DELIBERATELY EMPTY, and not a stub.
   *
   * There is no down migration for this: the rows are gone, they held one-time
   * codes that were valid for ten minutes at some point in the past, and
   * recreating them is neither possible nor desirable. Rolling the application
   * back to the unkeyed digest would simply start writing legacy rows again.
   */
  pgm.sql('SELECT 1');
};
