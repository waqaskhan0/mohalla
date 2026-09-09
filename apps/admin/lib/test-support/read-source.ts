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
