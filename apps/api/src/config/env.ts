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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Field names and messages only. Values are never printed - they may be
    // secrets, and a startup stack trace ends up in a log aggregator.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${fields}`);
  }
  return parsed.data;
}
