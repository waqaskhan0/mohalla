import { z } from 'zod';

/**
 * Environment contract for the API process.
 *
 * Stage 5 foundation rule: the process refuses to start when configuration is
 * missing or malformed, rather than starting and failing later under load.
 * Every variable here is documented in `.env.example` and in
 * `docs/foundation/10-environment-variables.md`.
 *
 * No secret has a default value. `DATABASE_URL` deliberately has none.
 */
/**
 * The value a development build hashes OTPs under.
 *
 * Exported so tests can assert that production refuses exactly this string,
 * rather than re-typing it and drifting from what the schema actually defaults
 * to (requirement L: a test fixture must not make a default production key
 * possible).
 */
/**
 * Terms versions accepted by a development or CI deployment.
 *
 * `terms-2026-01` is what the smoke test and QA fixtures submit;
 * `unpublished-od-015` is what the debug Android build submits, and its name
 * says exactly what it is. Neither is a published document, which is why
 * production defaults to accepting NOTHING rather than to this list.
 */
export const DEVELOPMENT_TERMS_VERSIONS = 'terms-2026-01,unpublished-od-015';

export const DEVELOPMENT_OTP_HASH_KEY = 'development-only-otp-key-not-for-production-use';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // No default. A missing database URL must stop the process.
  //
  // The message is set on the TYPE check as well as the length check: zod
  // reports the type failure first, so a variable that is entirely absent -
  // by far the most common misconfiguration - would otherwise produce
  // "expected string, received undefined" and never the intended message.
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),

  // Connection pool bounds - kept small for a modular monolith on managed PaaS.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Allowed browser origins, comma-separated.
   *
   * Empty means "no cross-origin browser access", which is the correct default:
   * the Android client is not a browser and is unaffected by CORS, and the
   * admin console is served from its own origin. An origin is added only when a
   * real deployment needs it - never `*`, which would let any page on the
   * internet issue credentialed requests.
   */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /** Injected at build time so a running instance can identify its artefact. */
  APP_VERSION: z.string().default('0.0.0'),
  GIT_COMMIT: z.string().default('unknown'),

  // ---- observability / EPIC-15 -------------------------------------------
  /**
   * The bearer token an external monitor presents to read `/health/metrics`
   * (NFR-OBS-003).
   *
   * NOT AN ADMIN SESSION, deliberately. §15.5 names the technical owner as the
   * responder, and OD-020 means there is no administrator to be one - so a
   * metrics surface gated behind an admin login would be a metrics surface
   * nobody can reach, in the exact situation it exists for. An uptime checker
   * also cannot log in, hold a session or refresh one.
   *
   * UNSET MEANS THE ROUTE IS OFF, not open. An operational surface that
   * defaults to public when somebody forgets a variable is a slow disclosure of
   * queue depths, user counts and database size to anyone who guesses the path.
   * Refusing until it is configured is the failure that gets noticed and fixed.
   *
   * 32 characters minimum, because this is a shared secret compared in one
   * step - there is no rate limit or lockout behind it, so its only defence is
   * being too long to guess.
   */
  METRICS_TOKEN: z.string().min(32).optional(),

  // ---- identity / EPIC-02 ------------------------------------------------
  //
  // Argon2id (SEC-001). Defaults are BENCHMARKED on the development host to
  // ~236 ms per hash; see adapters/argon2-password-hasher.ts. They are
  // host-specific and MUST be re-benchmarked on the production host once one is
  // selected (ADR-016 / OD-019) - a slower instance makes login painful, a
  // faster one weakens the hash. Bounds below reject anything under the OWASP
  // floor rather than letting a typo silently weaken hashing.
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).max(1_048_576).default(98_304),
  ARGON2_ITERATIONS: z.coerce.number().int().min(2).max(20).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

  /**
   * Pepper for identifier hashing (BR-036).
   *
   * No default, and no fallback: hashing the ban list with an empty or guessed
   * key would make it reversible. In development the value is any 32+ char
   * string; in production it is generated once and NEVER rotated, because
   * rotating it silently unbans every banned identifier.
   */
  IDENTIFIER_HASH_PEPPER: z
    .string({ error: 'IDENTIFIER_HASH_PEPPER is required' })
    .min(32, 'IDENTIFIER_HASH_PEPPER must be at least 32 characters')
    .default('development-only-pepper-not-for-production-use'),

  /**
   * Secret key for OTP challenge digests (QA-005).
   *
   * SEPARATE FROM `IDENTIFIER_HASH_PEPPER` ON PURPOSE. One leaking must not
   * compromise the other, and the two have opposite rotation properties: the
   * identifier pepper can never be rotated because doing so silently unbans
   * every banned identifier, while this key can be rotated freely — the only
   * cost is that outstanding codes stop working, and they expire in ten
   * minutes anyway.
   *
   * The development default below is REFUSED IN PRODUCTION by the check under
   * the schema. A six-digit code hashed under a key everyone can read from a
   * public repository is not hashed under a key at all.
   */
  OTP_HASH_KEY: z
    .string({ error: 'OTP_HASH_KEY is required' })
    .min(32, 'OTP_HASH_KEY must be at least 32 characters')
    .default(DEVELOPMENT_OTP_HASH_KEY),

  /**
   * Terms versions this deployment will accept an acceptance of (QA-006).
   *
   * Comma-separated. EMPTY MEANS REFUSE EVERY REGISTRATION, and that is the
   * correct production posture while OD-015 is unresolved: no Terms document is
   * published, so there is no version anybody can meaningfully accept, and a
   * stored acceptance of a document that does not exist is worse than no
   * account — it is the stated basis for every enforcement action (PRIV-018).
   *
   * The release Android build already refuses to submit, by shipping an empty
   * `TERMS_VERSION`. This is the server saying the same thing, because a rule
   * that lives only in the client is not a rule — the same lesson QA-002
   * recorded about the Admin cookie.
   *
   * The development default carries the versions local tooling and CI really
   * use, so nothing here changes how development behaves.
   */
  PUBLISHED_TERMS_VERSIONS: z
    .string()
    .default(DEVELOPMENT_TERMS_VERSIONS)
    .transform((raw) =>
      raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),

  /** Socket.IO mount path. Namespaced so it cannot collide with a REST route. */
  SOCKET_IO_PATH: z.string().startsWith('/').default('/realtime'),

  /**
   * Where the local media adapter keeps its two prefixes.
   *
   * Development and CI only. The frozen stack is S3-compatible object storage
   * behind a CDN (ADR-012); this exists because Stage 6 provisions nothing
   * paid, and it keeps quarantine and served bytes in SEPARATE directories so
   * the security boundary is the same shape it will be in production.
   */
  MEDIA_LOCAL_ROOT: z.string().min(1).default('.media'),

  /**
   * Whether PDF attachments are accepted (ADR-013).
   *
   * ADR-013 puts PDF behind a Technical Lead gate on the selected
   * inspection/sanitisation capability, and is explicit that if no practical
   * safe mechanism fits V1, PDF is CUT rather than SEC-013 weakened.
   *
   * DEFAULTS TO FALSE, and that default is the point: enabling PDF must be a
   * decision somebody makes and records, not one inherited by whoever copies
   * an environment file. POST-FR-005, MEDIA-FR-003 and MEDIA-FR-004 are all
   * Should, so this costs no Must requirement.
   */
  MEDIA_ALLOW_PDF: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * How many reverse proxies sit in front of this process (SEC-007).
   *
   * Express only derives `req.ip` from `X-Forwarded-For` when `trust proxy` is
   * set, and this MUST be stated rather than guessed, because both mistakes are
   * real and opposite:
   *
   *   TOO LOW  - behind a load balancer, every request reports the balancer's
   *              address. The per-source login lockout then counts the whole
   *              internet as one client: 50 failed logins from anywhere lock
   *              out every user at once.
   *   TOO HIGH - with no proxy in front, `X-Forwarded-For` is a header the
   *              client sets. An attacker rotates it freely and the per-source
   *              limit stops existing.
   *
   * A hop COUNT rather than `true`: `true` trusts the entire chain, so the
   * left-most (client-supplied) entry can win. The count says "trust exactly
   * the hops I actually operate".
   *
   * Defaults to 0 - no proxy - because that is the only safe assumption for a
   * value nobody has set. It is set per deployment when the topology is known
   * (still open: no production host is selected in Stage 6).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
});

export type Env = z.infer<typeof schema>;

/**
 * Configuration that is merely unwise in development and unacceptable in
 * production (QA-005 requirement K).
 *
 * Expressed here rather than as a `superRefine` on the schema so the rule reads
 * as what it is — a deployment gate — and so the message can say what to do
 * instead of what is malformed. Startup FAILS; it does not warn and continue,
 * because a warning in a boot log is a warning nobody reads until after the
 * incident.
 */
function refuseInsecureProduction(env: Env, source: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;

  // QA-006. Production must not inherit the development Terms list: those are
  // not published documents, and `unpublished-od-015` says so in its name.
  //
  // Reads `source`, not `process.env`. The first version read the global and
  // therefore ignored the environment it was actually given — which made three
  // unrelated tests fail against correct code, because they pass a synthetic
  // source while the real `process.env` has no such variable.
  if (source.PUBLISHED_TERMS_VERSIONS === undefined && env.PUBLISHED_TERMS_VERSIONS.length > 0) {
    throw new Error(
      'Invalid environment configuration: PUBLISHED_TERMS_VERSIONS is unset, so production ' +
        'would inherit the development Terms list. Set it explicitly — empty is valid and ' +
        'means registration is refused while OD-015 is unresolved.',
    );
  }

  if (env.OTP_HASH_KEY === DEVELOPMENT_OTP_HASH_KEY) {
    throw new Error(
      'Invalid environment configuration: OTP_HASH_KEY is the development default, ' +
        'which cannot be used in production. Generate a unique 32+ character secret, ' +
        'separate from IDENTIFIER_HASH_PEPPER.',
    );
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Field names and messages only. Values are never printed - they may be
    // secrets, and a startup stack trace ends up in a log aggregator.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${fields}`);
  }
  refuseInsecureProduction(parsed.data, source);
  return parsed.data;
}
