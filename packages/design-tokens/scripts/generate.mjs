import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regenerates the token package from the approved prototype.
 *
 * The prototype is an approved Stage 3 artefact and is never modified. This
 * script only reads it. If a token value must change, the change belongs in the
 * design specification and the prototype - not here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const proto = readFileSync(resolve(repoRoot, 'docs/prototype.html'), 'utf8');

const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(proto);
if (!rootBlock) {
  console.error('FAIL: no :root block found in docs/prototype.html');
  process.exit(1);
}

const decls = [...rootBlock[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
  m[1],
  m[2].trim(),
]);

if (decls.length === 0) {
  console.error('FAIL: no token declarations extracted');
  process.exit(1);
}

const css = `/*\n * GENERATED from docs/prototype.html (approved Stage 3). Do not edit by hand.\n */\n:root {\n${decls
  .map(([k, v]) => `  ${k}: ${v};`)
  .join('\n')}\n}\n`;

mkdirSync(resolve(here, '../src'), { recursive: true });
writeFileSync(resolve(here, '../src/tokens.css'), css, 'utf8');

// ---------------------------------------------------------------- Kotlin
//
// STAGE 7. `04-mobile-architecture.md` §2 specifies the Compose theme is
// "91 tokens GENERATED from packages/design-tokens", and `MohallaTheme.kt`'s
// own comment said it "is replaced by a generated Kotlin token source in the
// design-system epic rather than being hand-extended here". This is that
// generation.
//
// WHY IT IS GENERATED RATHER THAN TYPED OUT ONCE. A hand-copied palette drifts
// the first time a colour changes in the prototype and nobody remembers the
// second copy exists - and then the app and the admin portal render different
// brands from the same approved source. Generation makes drift impossible to
// commit: the Kotlin is an output, and editing it is undone by the next run.
//
// Only COLOURS come from the prototype's :root block, because that is what the
// block declares. Spacing, radius, elevation, motion and type live in the
// UI/UX specification's own scales and are declared in Kotlin beside this
// output, each citing its approved source. Nothing is invented in either place.

/** `--brand-primary-hover` -> `BrandPrimaryHover`. */
const pascal = (name) =>
  name
    .replace(/^--/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const isColor = (value) => /^#[0-9a-fA-F]{3,8}$/.test(value);

/** `#F6F4EF` -> `0xFFF6F4EF`. Compose wants ARGB; the prototype writes RGB. */
const argb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 6) h = `FF${h}`;
  return `0x${h.toUpperCase()}`;
};

const colors = decls.filter(([, v]) => isColor(v));
if (colors.length === 0) {
  console.error('FAIL: no colour tokens extracted - refusing to write an empty palette');
  process.exit(1);
}

const kotlin = `package org.shehersaaz.mohalla.core.design

import androidx.compose.ui.graphics.Color

/**
 * GENERATED from docs/prototype.html (approved Stage 3) by
 * packages/design-tokens/scripts/generate.mjs. DO NOT EDIT BY HAND - rerun
 * \`npm run generate --workspace @mohalla/design-tokens\`.
 *
 * ${colors.length} colour tokens, each with an approved value behind it. A colour that is
 * not here has no approved value, and inventing one is a defect (UI/UX §16).
 *
 * NO DARK VARIANTS. Dark mode is explicitly out of V1 scope, and the approved
 * prototype declares no dark values - so there is nothing to generate and
 * nothing to guess.
 */
object MohallaPalette {
${colors.map(([k, v]) => `    /** \`${k}\` */\n    val ${pascal(k)} = Color(${argb(v)})`).join('\n\n')}
}
`;

const kotlinOut = resolve(
  repoRoot,
  'apps/android/app/src/main/java/org/shehersaaz/mohalla/core/design/MohallaPalette.kt',
);
mkdirSync(dirname(kotlinOut), { recursive: true });
writeFileSync(kotlinOut, kotlin, 'utf8');

console.log(
  `regenerated ${decls.length} tokens -> tokens.css, index.ts, ` +
    `MohallaPalette.kt (${colors.length} colours)`,
);
