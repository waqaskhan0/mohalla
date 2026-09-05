import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * String catalogues.
 *
 * English is the key language. Urdu is a peer, not a fallback - LOCALE-FR-001
 * and REL-002 require both, and `npm run guard:locale` fails the build when a
 * key exists in one catalogue and not the other. That check is the reason
 * DEP-011 (~400 Urdu strings, OD-016) cannot silently half-ship.
 *
 * Stage 5 seeded foundation keys only; EPIC-11 added the notification
 * templates, which are the first strings the SERVER renders rather than the
 * client. That is why they live here rather than in the app: LOCALE-FR-006
 * requires a push to arrive in the recipient's language, and the recipient is
 * not the one making the request.
 */
/**
 * The catalogue files, READ rather than imported.
 *
 * A JSON `import` would need `with { type: 'json' }` under ESM on Node 24, and
 * the attribute needs a newer `module` setting than the API compiles with — so
 * the two constraints have no overlap without changing a compiler flag for
 * every file in the app.
 *
 * Reading the files keeps the JSON as the SINGLE source of truth, which is what
 * matters: `npm run guard:locale` parses these same files, and a TypeScript
 * copy alongside them would be a second place for an Urdu string to go missing
 * — the exact failure DEP-011 and that guard exist to prevent.
 *
 * Only the API consumes this package, and it consumes it in Node. Nothing here
 * is bundled for a browser, where reading from disk would not work.
 */
const CATALOGUE_DIR = dirname(fileURLToPath(import.meta.url));

function load(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of CATALOGUE_FILES) {
    const text = readFileSync(join(CATALOGUE_DIR, locale, `${file}.json`), 'utf8');
    Object.assign(out, JSON.parse(text) as Record<string, string>);
  }
  return out;
}

/**
 * Every catalogue file, listed once.
 *
 * The guard walks the DIRECTORY, so a file added there and forgotten here would
 * pass parity and never render. Listing them is what makes that a compile-time
 * decision rather than a silent omission.
 */
const CATALOGUE_FILES = ['foundation', 'notifications'] as const;

export const catalogues: Record<Locale, Record<string, string>> = {
  en: load('en'),
  ur: load('ur'),
};

export function translate(locale: Locale, key: string): string {
  const value = catalogues[locale][key];
  if (value === undefined) {
    // Returning the key makes a missing string visible in the UI rather than
    // rendering an empty space that nobody notices.
    return key;
  }
  return value;
}

/**
 * Render a template with its parameters.
 *
 * LOCALE-FR-006's second half is the important one: "user-generated content
 * inside a notification is NEVER TRANSLATED - only the surrounding template."
 * So parameters are substituted verbatim. A person's name is data, not copy,
 * and putting it through a translation step would be both wrong and insulting.
 *
 * Substitution is a plain replace with no escaping, because these strings are
 * consumed as DATA - a JSON field and an FCM payload - never as markup. Any
 * surface that renders them into HTML escapes at that point, which is where
 * SEC-016 says encoding belongs: on output.
 *
 * An unknown parameter is left as its own placeholder rather than becoming
 * "undefined", so a template bug reads as a template bug.
 */
export function render(
  locale: Locale,
  key: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return translate(locale, key).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
