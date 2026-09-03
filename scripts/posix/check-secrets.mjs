import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/**
 * SECRET GUARD - refuses to let a credential become tracked.
 *
 * Scans files GIT ACTUALLY TRACKS, not the working tree. Scanning the working
 * tree would flood on node_modules and would miss the thing that matters:
 * whether a secret has entered version control, where it is permanent.
 *
 * This is a cheap high-signal net, not a replacement for provider-side secret
 * scanning. It is designed to have no false negatives on the patterns it knows
 * and to be quiet otherwise.
 */
/**
 * High-confidence patterns. Each matches a value whose SHAPE is issued by a
 * specific provider, so a match is a real credential with near-certainty.
 *
 * These are NOT allowlistable. A comment saying "example" next to a live AWS
 * key does not make it an example, and the one time that assertion is wrong is
 * the time it matters.
 */
const STRONG_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'GitHub personal access token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/, 'GitHub fine-grained token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/"private_key"\s*:\s*"-----BEGIN/, 'service account JSON'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'generic secret key'],
];

/**
 * Heuristic patterns. These match a NAME next to a quoted value, which is a
 * guess about intent rather than a recognisable credential. Only these may be
 * suppressed by ALLOWED, because only these have genuine false positives.
 */
const WEAK_PATTERNS = [
  [
    /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    'hardcoded credential',
  ],
];

/**
 * Values that trip a HEURISTIC pattern but are deliberate templates or test
 * fixtures. Each entry requires the author to have stated intent in the line
 * itself, which is the point: the allowance is a claim someone made on the
 * record, not a silent exemption.
 *
 * These never suppress a STRONG_PATTERNS match.
 */
const ALLOWED = [
  /CHANGE_ME/,
  /mohalla_local_dev_only/,
  /your[_-]?(?:key|token|secret)/i,
  /placeholder/i,
  /example\.com/,

  // psql variable interpolation: `WITH PASSWORD :'migration_owner_password'`.
  //
  // The generic "hardcoded credential" pattern below reads the `:` of `:'name'`
  // as an assignment operator and the variable NAME as the secret value. It is
  // not one - the value is supplied at run time from the environment and never
  // appears in the file.
  //
  // This is narrowed rather than removed: the form matched here is a colon bound
  // directly to a quoted bare identifier, which cannot itself be a literal
  // credential. `password: 'realsecret'` has a space after the colon and is
  // still caught.
  /(?:^|\s):'[A-Za-z_][A-Za-z0-9_]*'/,

  // Test fixtures. The addendum requires deterministic SYNTHETIC test data, so
  // a fixture password is expected to exist - but it must SAY it is one.
  //
  // Narrow on purpose: the marker has to appear inside the quoted VALUE, not in
  // a nearby comment, so it cannot be attached to a real credential without
  // altering that credential and breaking it.
  /['"][^'"\s]*synthetic[^'"\s]*['"]/i,
];

/** Files whose whole job is to describe secrets without containing them. */
const SKIP_FILES = [/^\.env\.example$/, /^docs\//, /^scripts\/posix\/check-secrets\.mjs$/];

let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  console.error('FAIL: not a git repository, or git is unavailable');
  process.exit(2);
}

// A committed .env is a finding on its own, regardless of contents.
const committedEnv = tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'));

const findings = [];
for (const f of committedEnv) {
  findings.push({ file: f, line: 0, what: 'environment file is tracked by git' });
}

for (const file of tracked) {
  if (SKIP_FILES.some((r) => r.test(file))) continue;

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > 1_000_000) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\u0000')) continue;

  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // Checked FIRST and without any allowlist: a provider-shaped credential is
    // a finding no matter what the line claims about itself.
    for (const [re, what] of STRONG_PATTERNS) {
      if (re.test(line)) {
        findings.push({ file, line: i + 1, what });
        return;
      }
    }

    if (ALLOWED.some((r) => r.test(line))) return;

    for (const [re, what] of WEAK_PATTERNS) {
      if (re.test(line)) {
        findings.push({ file, line: i + 1, what });
        return;
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`FAIL: ${findings.length} potential secret(s) in tracked files\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.what}`);
  }
  console.error(
    '\nIf a finding is a false positive, narrow the pattern - do not delete the check.',
  );
  process.exit(1);
}

console.log(`OK: ${tracked.length} tracked files scanned, no secrets found`);
