import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LOCAL CI EQUIVALENT.
 *
 * Runs every check the GitHub `ci` workflow runs that can run WITHOUT a remote
 * or a database, plus the ones that need a database when one is reachable. Each
 * lane reports PASS, FAIL, or BLOCKED - a lane that cannot run (no database, no
 * Android toolchain) is BLOCKED and never silently counted as a pass.
 *
 * Exit codes:
 *   0  every lane that ran passed, nothing blocked
 *   1  at least one lane FAILED
 *   2  no failures, but at least one lane was BLOCKED (incomplete)
 *
 * This is the command a developer runs before pushing, and it is deliberately
 * the same set of checks CI runs so that "passes locally" and "passes in CI"
 * mean the same thing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const isWindows = process.platform === 'win32';

/**
 * NO SHELL, NO cmd.exe - ANYWHERE IN THIS SCRIPT.
 *
 * `shell: true` makes Node concatenate arguments into one unescaped command
 * string (Node's own DEP0190 warning), and routing through `cmd.exe /c` is no
 * better because cmd then parses that string itself. Either way a repository
 * path containing a shell metacharacter could break or inject - which is what
 * CodeQL's "shell command built from environment values" rule flags.
 *
 * So the `.cmd`/`.bat` shims are bypassed and their real entry points are
 * executed directly, exactly as those shims do internally:
 *
 *   npm    -> node <npm-cli.js> ...
 *   gradle -> java -classpath <gradle-wrapper.jar> GradleWrapperMain ...
 *
 * Every argument stays a distinct argv element that no shell ever sees.
 */
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

/** Build an argv for an npm script without touching a shell. */
function npmRun(...args) {
  return existsSync(npmCli)
    ? [process.execPath, [npmCli, ...args]]
    : // POSIX (and any layout without the bundled CLI): `npm` is a real executable.
      ['npm', args];
}

/** Build an argv that runs the Gradle wrapper via the JVM, bypassing gradlew(.bat). */
function gradleRun(androidDir, args) {
  const jar = resolve(androidDir, 'gradle/wrapper/gradle-wrapper.jar');
  const javaHome = process.env.JAVA_HOME ?? '';
  const javaBin = resolve(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
  return [
    javaBin,
    [
      '-Dorg.gradle.appname=gradlew',
      '-classpath',
      jar,
      'org.gradle.wrapper.GradleWrapperMain',
      ...args,
    ],
  ];
}

const results = [];

function run(name, cmd, args, { cwd = repoRoot, env = process.env, allowSkip = false } = {}) {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: false });

  if (r.error) {
    if (allowSkip) {
      results.push({ name, status: 'BLOCKED', detail: r.error.message });
      return;
    }
    results.push({ name, status: 'FAIL', detail: r.error.message });
    return;
  }
  results.push({ name, status: r.status === 0 ? 'PASS' : 'FAIL', detail: `exit ${r.status}` });
}

function blocked(name, detail) {
  process.stdout.write(`\n▶ ${name}\n  BLOCKED: ${detail}\n`);
  results.push({ name, status: 'BLOCKED', detail });
}

// ---------------------------------------------------------------- packages
// Shared packages compile first; every downstream lane depends on their output.
run('build shared packages', ...npmRun('run', 'build:packages'));

// -------------------------------------------------------------------- guards
run('guard: module dependency direction', process.execPath, [
  resolve(repoRoot, 'scripts/posix/check-module-dependencies.mjs'),
]);
run('guard: localization parity', process.execPath, [
  resolve(repoRoot, 'scripts/posix/check-locale-parity.mjs'),
]);
run('guard: secret scan', process.execPath, [resolve(repoRoot, 'scripts/posix/check-secrets.mjs')]);

// ---------------------------------------------------------------- node lanes
run('format check', ...npmRun('run', 'format:check'));
run('lint (includes the RTL gate)', ...npmRun('run', 'lint'));
run('build all apps', ...npmRun('run', 'build:apps'));
run(
  'unit tests (api, worker, validation, admin)',
  ...npmRun('run', 'test', '--workspaces', '--if-present'),
);

// ---------------------------------------------------------------- database
// Only if a database is reachable. Absent one, these are BLOCKED, not failures.
if (process.env.DATABASE_URL) {
  run('migration status', ...npmRun('run', 'db:migrate:status'), { allowSkip: true });
  if (process.env.RUNTIME_APP_DATABASE_URL) {
    run('audit append-only test', ...npmRun('run', 'test', '--workspace', '@mohalla/db'), {
      allowSkip: true,
    });
  } else {
    blocked('audit append-only test', 'RUNTIME_APP_DATABASE_URL not set');
  }

  // Every epic's flow over real HTTP against the real database. The unit tests
  // prove the rules; this proves the routes are mounted, the guards are
  // applied, the DI graph resolves and the error envelope says what a client
  // will read - none of which a unit test can fail on. Uses the deterministic
  // fake SMS provider, so nothing is delivered to a real recipient.
  run('api smoke test (real HTTP)', ...npmRun('run', 'smoke:api'), { allowSkip: true });
} else {
  blocked('migration status', 'DATABASE_URL not set — no database reachable');
  blocked('audit append-only test', 'DATABASE_URL not set — no database reachable');
  blocked('api smoke test (real HTTP)', 'DATABASE_URL not set — no database reachable');
}

// ---------------------------------------------------------------- android
// The wrapper is committed; the JDK/SDK may or may not be present locally.
const gradlew = resolve(repoRoot, 'apps/android', isWindows ? 'gradlew.bat' : 'gradlew');
if (existsSync(gradlew) && process.env.ANDROID_HOME && process.env.JAVA_HOME) {
  // Invoke the wrapper by its ABSOLUTE path. A bare `gradlew.bat` is not found
  // by cmd.exe because the current directory is not on PATH - that is how the
  // first version of this lane failed.
  //
  // GUARD: Gradle is a Windows program and needs a WINDOWS JAVA_HOME. Git Bash
  // normally converts `/d/toolchain/...` to `D:	oolchain\...` automatically,
  // but `MSYS_NO_PATHCONV=1` (needed elsewhere for Docker paths) turns that off,
  // and Gradle then dies with a bare `exit 3`. Detect it and say so plainly
  // rather than letting an opaque code surface.
  if (isWindows && /^\/[a-z]\//i.test(process.env.JAVA_HOME ?? '')) {
    blocked(
      'android lint + unit tests',
      `JAVA_HOME is a POSIX path ("${process.env.JAVA_HOME}"). Gradle needs Windows form, ` +
        'e.g. D:\toolchain\jdk-21.0.12.1+1 - MSYS_NO_PATHCONV=1 suppresses the usual conversion.',
    );
  } else {
    const androidDir = resolve(repoRoot, 'apps/android');
    run(
      'android lint + unit tests',
      ...gradleRun(androidDir, ['test', 'lint', '--no-daemon', '--console=plain']),
      { cwd: androidDir, allowSkip: true },
    );
  }
} else {
  blocked(
    'android lint + unit tests',
    'JAVA_HOME/ANDROID_HOME not set in this shell — run from a shell with the Android toolchain',
  );
}

// ------------------------------------------------------------------- summary
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const blockedN = results.filter((r) => r.status === 'BLOCKED').length;

process.stdout.write(
  '\n\n═══════════════════════════ VERIFY SUMMARY ═══════════════════════════\n',
);
for (const r of results) {
  const tag = r.status === 'PASS' ? 'PASS   ' : r.status === 'FAIL' ? 'FAIL   ' : 'BLOCKED';
  process.stdout.write(`  ${tag}  ${r.name}${r.status !== 'PASS' ? `  (${r.detail})` : ''}\n`);
}
process.stdout.write(
  `\n  ${pass} passed · ${fail} failed · ${blockedN} blocked · ${results.length} total\n`,
);

if (fail > 0) {
  process.stdout.write('\nVERIFY: FAILED\n');
  process.exit(1);
}
if (blockedN > 0) {
  process.stdout.write('\nVERIFY: INCOMPLETE — blocked lanes did not run and are not passes\n');
  process.exit(2);
}
process.stdout.write('\nVERIFY: ALL LANES PASSED\n');
process.exit(0);
