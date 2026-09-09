/**
 * 0005 — EPIC-02 · OTP resend throttle and attempt lockout.
 *
 * `09-authentication-authorization.md` §52 specifies five limits on an OTP.
 * 0003 implemented three of them (6 digits, 10-minute expiry, 5-attempt cap);
 * this migration supplies what the remaining two need:
 *
 *   15-minute lockout       after the attempt cap is reached
 *   60-second cooldown  ·  max 3 resends per hour
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: without a lockout, the 5-attempt cap is
 * decorative. An attacker exhausts five guesses, calls resend, and gets a fresh
 * challenge with the counter back at zero. Repeat that and the cap becomes
 * "5 guesses per resend" — which is unlimited guessing with extra steps, and it
 * costs the victim an SMS every time.
 *
 * The cooldown and hourly cap are derivable from `created_at`, which 0003
 * already stores, so they need only an index. The lockout is not derivable:
 * nothing records WHEN the fifth attempt happened, and `expires_at` is the
 * wrong clock (a challenge can be exhausted one minute after it is issued or
 * nine). So one column is added rather than inferring a time that was never
 * captured.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.addColumns('otp_challenges', {
    attempts_exhausted_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`
    COMMENT ON COLUMN otp_challenges.attempts_exhausted_at IS
      'SEC-003: when the 5-attempt cap was reached. Starts the 15-minute lockout. NULL while attempts remain.';

    -- The lockout and the hourly resend cap both ask "recent challenges for
    -- this identifier and purpose", so one index serves both. DESC because
    -- every such query wants the newest rows.
    CREATE INDEX otp_challenges_recent_by_identifier
      ON otp_challenges (identifier_hash, purpose, created_at DESC);
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS otp_challenges_recent_by_identifier;`);
  pgm.dropColumns('otp_challenges', ['attempts_exhausted_at']);
};
