import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reading source files in tests, without reading the comments.
 *
 * WHY THIS IS A SHARED HELPER AND NOT A LOCAL ONE. Four separate source-level
 * rules in this codebase have failed the same way — asserting something about
 * the code and matching the file's own prose instead:
 *
 *   1. "the login form must not handle a token" matched the comment saying it
 *      never receives one.
 *   2. "the login screen offers no invitation" matched the comment saying
 *      there is no invitation flow.
 *   3. "the tile offers no export" matched the JavaScript keyword on
 *      `export function MetricTile` — not a comment, but the same category:
 *      a rule about meaning, applied to text that carries none.
 *   4. "the tile offers no drill-down" matched the comment saying it offers no
 *      drill-down.
 *
 * Every one of those assertions was RIGHT and every one had the wrong input.
 * The files in this project carry long explanations deliberately, so any rule
 * about what the code contains has to be given the code.
 *
 * The keyword case (3) is the reminder that stripping comments is not
 * sufficient on its own: a rule also has to pick markers that only appear in
 * the thing being forbidden. "csv" and "download" indicate a data export;
 * "export" indicates an ES module.
 *
 * AND ONE MORE, ABOUT THIS FILE. A broken regex literal here once made the
 * module a parse error, so the three specs that import it did not COLLECT --
 * vitest reported "Test Files 3 failed | 4 passed" beside "Tests 25 passed",
 * and a mutation of the code under test duly "passed" because its assertions
 * had never run. A test-count line is not a suite result: this suite is
 * checked by exit code. Because everything asserting a source-level rule
 * depends on this one module, a fault here is silent across all of them at
 * once, which is the argument for it being small and dull.
 */

const ADMIN = process.cwd();

/** The file verbatim — correct when the assertion is about rendered copy. */
export function readFile(relative: string): string {
  return readFileSync(join(ADMIN, relative), 'utf8');
}

/** The file with block and line comments removed. */
export function readCode(relative: string): string {
  return readFile(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * The file with comments AND JSX text nodes removed — code only.
 *
 * For rules about what the code DOES rather than what it says. JSX copy is
 * user-visible text, and a rule that forbids a concept will otherwise trip on
 * a sentence explaining that the concept is absent.
 */
export function readLogic(relative: string): string {
  return (
    readCode(relative)
      // Text between tags, which is rendered copy rather than logic. Crude by
      // design: it only has to be good enough that a forbidden word in a
      // sentence does not read as a forbidden word in a call.
      .replace(/>[^<>{}]+</g, '><')
  );
}

/**
 * One top-level function's source, bounded by the next one.
 *
 * WHY THIS EXISTS. Slicing with `source.slice(source.indexOf('function X'))`
 * runs to the end of the FILE, so an assertion about `X` silently reads every
 * function after it. That is how a test asserting the empty-queue state
 * contains no `role="alert"` failed on the error state defined below it — the
 * rule was right and its input was three functions too long.
 *
 * The same family as reading prose instead of code: a rule about one thing,
 * handed more than that thing.
 */
export function functionSource(relative: string, name: string): string {
  const source = readFile(relative);
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';

  // The next top-level declaration, or the end of the file. Searched from one
  // character past `start` so this function's own keyword is not the boundary
  // that ends it, and sliced back out of `source` so the offset correction is
  // applied once rather than silently shaving the leading `f` off the result.
  const rest = source.slice(start + 1);
  const nextDeclaration = rest.search(/\n(?:export )?(?:async )?function /);

  return nextDeclaration < 0
    ? source.slice(start)
    : source.slice(start, start + 1 + nextDeclaration);
}
