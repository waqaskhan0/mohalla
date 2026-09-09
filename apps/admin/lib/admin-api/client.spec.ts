import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The credential must not be reachable from the browser bundle.
 *
 * SEC-025 says no admin credential in the client bundle, and the session
 * decision in `00-admin-baseline.md` §4 rests entirely on that holding. This
 * file asserts the mechanism rather than trusting the convention, because the
 * failure mode is invisible: a `'use client'` directive added to the wrong file
 * would ship the cookie-reading path into the browser and nothing would look
 * different.
 *
 * These are source-level checks. Stage 7 taught that a source rule catches the
 * SHAPE of a defect cheaply and is worth having even where a runtime test would
 * be better — and here a runtime test is not really available, since the thing
 * being asserted is what the bundler does with a module graph.
 */

const LIB = join(process.cwd(), 'lib');
const APP = join(process.cwd(), 'app');

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions.some((e) => entry.endsWith(e))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const SERVER_ONLY_MODULES = [
  'lib/admin-session.ts',
  'lib/require-admin.ts',
  'lib/admin-api/client.ts',
  'lib/admin-api/auth.ts',
];

describe('the admin credential path is server-only', () => {
  it.each(SERVER_ONLY_MODULES)('%s declares server-only', (relative) => {
    // `import 'server-only'` makes a client import a BUILD ERROR rather than a
    // review comment. Without it, the guarantee is a habit.
    const source = readFileSync(join(process.cwd(), relative), 'utf8');
    expect(source).toContain("import 'server-only'");
  });

  it('no module that touches the session is a client component', () => {
    const offenders = SERVER_ONLY_MODULES.filter((relative) =>
      readFileSync(join(process.cwd(), relative), 'utf8').includes("'use client'"),
    );

    expect(offenders, 'a client component cannot hold the admin credential path (SEC-025)').toEqual(
      [],
    );
  });

  it('NO CLIENT COMPONENT IMPORTS THE SESSION OR THE ADMIN API', () => {
    // The real risk is not the modules above declaring themselves wrongly — it
    // is a new client component importing one of them. `server-only` would fail
    // that build, and this names it earlier and more clearly.
    const clientFiles = filesUnder(APP, ['.tsx', '.ts'])
      .concat(filesUnder(LIB, ['.tsx', '.ts']))
      .filter((f) => !f.endsWith('.spec.ts') && !f.endsWith('.spec.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes("'use client'"));

    const forbidden = ['admin-session', 'admin-api/client', 'admin-api/auth', 'require-admin'];
    const offenders: string[] = [];

    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf8');
      for (const module of forbidden) {
        // Match an import specifier, not a mention in prose — the comments in
        // these files legitimately name the modules they are about.
        if (new RegExp(`from '[^']*${module}'`).test(source)) {
          offenders.push(`${file.replace(process.cwd(), '')} imports ${module}`);
        }
      }
    }

    expect(offenders, 'the credential must not enter the browser bundle').toEqual([]);
  });

  it('the login form is a client component and imports only the action', () => {
    // The one client component in the sign-in path. It exists for the pending
    // and error states and receives nothing but a message — asserted, because
    // "it only gets a message" is the claim the whole design rests on.
    const source = readFileSync(join(APP, 'login', 'login-form.tsx'), 'utf8');

    expect(source).toContain("'use client'");
    expect(source).toContain("from './actions'");

    // COMMENTS STRIPPED FIRST. The initial version of this check searched the
    // raw file for "token" and failed on the file's own comment explaining that
    // it never receives one — the assertion was reading prose instead of code.
    // What matters is that no CODE here names a token.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(code, 'the form must not handle a credential').not.toMatch(/token/i);
  });
});
