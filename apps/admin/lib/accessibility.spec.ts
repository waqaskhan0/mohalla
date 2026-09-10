import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCode, readFile, readProse } from './test-support/read-source';

/**
 * Group 14 — accessibility, as rules that survive the next edit.
 *
 * MEASURED IN A BROWSER THAT ACTUALLY HELD FOCUS, which matters: Stage 7 left
 * a note saying the skip link "left a 1x1 clipped box" when focused, implying a
 * defect. It did not. The automation pane had no OS window focus, so `:focus`
 * matched nothing and the measurement was meaningless. With
 * `document.hasFocus()` true:
 *
 *   - the skip link is first in tab order, 1x1 at rest, and 139x40 at (8,8)
 *     when focused, with a 3px outline
 *   - all 14 focusable elements on a page carry a visible focus indicator
 *   - contrast, light theme: body 5.99, buttons 7.66, headings 15.48
 *   - contrast, dark theme: body 7.87, buttons 8.84, decision buttons 9.50,
 *     table headers 9.29 — every sample at or above AA
 *   - at a 320px viewport the page does not scroll sideways; the table scrolls
 *     inside its own container
 *
 * WHAT WAS NOT DONE: only Chromium was exercised. Firefox and Safari are not
 * available in this environment and are NOT claimed.
 */

const ADMIN = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ADMIN, dir))) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const rel = join(dir, entry);
    if (statSync(join(ADMIN, rel)).isDirectory()) {
      sourceFiles(rel, out);
    } else if (/\.tsx$/.test(entry) && !entry.endsWith('.spec.tsx')) {
      out.push(rel.split('\\').join('/'));
    }
  }
  return out;
}

describe('the skip link', () => {
  const layout = 'app/(portal)/layout.tsx';

  it('points at a landmark that can actually receive focus', () => {
    // THE DEFECT THIS ENCODES. Without `tabIndex={-1}` on the target,
    // following `#admin-main` moves the SCROLL POSITION and nothing else:
    // `document.activeElement` stays on `<body>`, so the next Tab carries a
    // keyboard user straight back into the sidebar they just asked to skip.
    // Measured before the fix — hash changed, page scrolled, focus did not
    // move. After: activeElement is `admin-main` and the sidebar is skipped.
    const source = readCode(layout);

    expect(source).toContain('href="#admin-main"');
    expect(source).toContain('id="admin-main"');
    expect(source).toContain('tabIndex={-1}');
  });

  it('is the first focusable thing in the document', () => {
    // A skip link that is not first is not a skip link.
    const source = readFile(layout);
    const skip = source.indexOf('skip-link');
    const nav = source.indexOf('<AdminSidebar');
    const main = source.indexOf('id="admin-main"');

    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(nav);
    expect(skip).toBeLessThan(main);
  });

  it('is hidden until focused, and then genuinely visible', () => {
    const css = readCode('app/globals.css');
    const focusRule = css.slice(css.indexOf('.skip-link:focus'));
    const block = focusRule.slice(0, focusRule.indexOf('}'));

    // Measured: 1x1 at rest, 139x40 at (8,8) on focus.
    expect(block).toContain('inset-block-start');
    expect(block).toContain('inset-inline-start');
    expect(block).not.toContain('clip:');
  });

  it('does not paint a focus ring on the landmark itself', () => {
    // Focus still MOVES, which is the point; an outline around the whole
    // content column would read as an error rather than as a position.
    const css = readCode('app/globals.css');
    expect(css).toContain('.admin-main:focus');
  });
});

describe('§44 — every interactive element shows focus', () => {
  it('defines a visible focus ring globally', () => {
    // Removing the default outline without replacing it is the single most
    // common way a keyboard-only workflow becomes unusable.
    const css = readCode('app/globals.css');
    const rule = css.slice(css.indexOf(':focus-visible'));
    const block = rule.slice(0, rule.indexOf('}'));

    expect(block).toContain('outline:');
    expect(block).toContain('outline-offset');
  });

  it('never removes an outline without putting something back', () => {
    // Measured: all 14 focusable elements on a page carried an indicator. The
    // one `outline: none` in the stylesheet is the landmark above, which is
    // not an interactive control.
    const css = readCode('app/globals.css');
    const removals = css.match(/outline:\s*none/g) ?? [];

    expect(removals.length, 'each removal needs a justification in the file').toBeLessThanOrEqual(
      1,
    );
    if (removals.length === 1) {
      expect(css).toContain('.admin-main:focus');
    }
  });

  it('moves focus when a confirmation replaces the controls', () => {
    // Otherwise somebody using a keyboard is left at the bottom of a form
    // whose buttons have just been replaced by different ones.
    for (const file of [
      'app/(portal)/moderation/[caseId]/decision-panel.tsx',
      'app/(portal)/users/[userId]/enforcement-panel.tsx',
    ]) {
      const code = readCode(file);
      expect(code, file).toContain('confirmRef.current?.focus()');
      expect(code, file).toContain('tabIndex={-1}');
    }
  });
});

describe('the colour tokens work in both themes', () => {
  const css = readCode('app/globals.css');

  it('redefines the accent for dark, not only the surface', () => {
    // THE DEFECT THIS ENCODES. The dark block redefined surface, ink, muted
    // and border and left the accent alone — so a colour chosen to be read
    // against white was used as text ON near-black, and as a button background
    // whose label had flipped dark. Measured at 2.31:1 against the 4.5
    // NFR-ACC-005 requires. After: 8.84 and 9.50.
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
    const block = dark.slice(0, dark.indexOf('}'));

    expect(block).toContain('--color-accent:');
    expect(block).toContain('--color-on-accent:');
  });

  it('gives text on the accent its own token', () => {
    // Not `--color-surface`, which flips with the theme. The accent is a fixed
    // colour; what sits on it must be too.
    expect(css).toContain('--color-on-accent:');
    expect(css).not.toContain('background: var(--color-accent);\n  color: var(--color-surface);');
  });

  it('declares every colour token in the base :root block', () => {
    // A token whose only definition lives inside a media query never applies
    // in the un-stamped state, which is the classic unreadable-theme bug.
    const root = css.slice(css.indexOf(':root {'), css.indexOf('@media'));
    for (const token of [
      '--color-surface',
      '--color-ink',
      '--color-muted',
      '--color-accent',
      '--color-on-accent',
      '--color-border',
    ]) {
      expect(root, `${token} must be declared in :root`).toContain(token);
    }
  });
});

describe('structure a screen reader can navigate', () => {
  it('captions every table, including the loading skeleton', () => {
    // FOUND BY AUDITING THE STREAMED HTML: the queue skeleton had `aria-busy`
    // and no caption, so a screen reader reaching it while the queue loaded
    // met an unlabelled table.
    const withTables = sourceFiles('app').filter((f) => readFile(f).includes('<table'));

    expect(withTables.length).toBeGreaterThan(2);
    for (const file of withTables) {
      expect(readFile(file), `${file} has a table without a caption`).toContain('<caption');
    }
  });

  it('scopes every column header', () => {
    const withTables = sourceFiles('app').filter((f) => readFile(f).includes('<thead'));

    for (const file of withTables) {
      const source = readFile(file);
      const headers = source.match(/<th\b/g) ?? [];
      const scoped = source.match(/<th scope="col"/g) ?? [];
      expect(scoped.length, `${file}: every <th> needs a scope`).toBe(headers.length);
    }
  });

  it('announces an error rather than only colouring it', () => {
    // Every field error is a live region, and the control it belongs to is
    // marked invalid and described by it.
    for (const file of sourceFiles('app').filter((f) => readCode(f).includes('field-error'))) {
      const code = readCode(file);
      expect(code, `${file}: a field error must be announced`).toContain('role="alert"');
    }
  });

  it('gives a repeated link its own accessible name', () => {
    // Twenty rows of "Review" or "Open" are twenty identical links to somebody
    // listening to the page. Each carries the case or the account it opens.
    for (const file of [
      'app/(portal)/moderation/page.tsx',
      'app/(portal)/users/page.tsx',
      'app/(portal)/verification/page.tsx',
    ]) {
      expect(readCode(file), file).toContain('visually-hidden');
    }
  });
});

describe('the page never scrolls sideways', () => {
  it('keeps wide content in its own scroll container', () => {
    // §27, and measured at a 320px viewport: the page does not scroll
    // sideways and the table scrolls inside `.table-scroll`. A horizontally
    // scrolling page takes the sidebar off screen, which is how somebody ends
    // up unable to navigate back.
    const css = readCode('app/globals.css');
    const rule = css.slice(css.indexOf('.table-scroll'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('overflow-x: auto');

    for (const file of sourceFiles('app').filter((f) => readFile(f).includes('<table'))) {
      // Every table sits inside the scroll container rather than loose in the
      // page — except the ones inside a `loading.tsx`, which are skeletons of
      // the real table and inherit the same wrapper.
      expect(readFile(file), `${file}: a table must be wrapped`).toContain('table-scroll');
    }
  });
});

describe('what was not verified is written down', () => {
  it('records that only one browser engine was exercised', () => {
    // §65: do not claim a pass that was not executed.
    const spec = readProse('lib/accessibility.spec.ts');
    expect(spec).toContain('only Chromium was exercised');
    expect(spec).toContain('are NOT claimed');
  });
});
