import tseslint from 'typescript-eslint';
import mohalla from './packages/eslint-plugin-mohalla/index.js';

/**
 * ESLint flat configuration.
 *
 * The rule that matters most here is `mohalla/no-physical-properties`, set to
 * `error` rather than `warn`. LOCALE-FR-003, BR-041 and REL-002 require the
 * interface to mirror completely for Urdu, and OD-011 explicitly forbids
 * meeting the 68-day schedule by "skipping RTL". A warning would be scrolled
 * past under delivery pressure; an error cannot be.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/android/**',
      'docs/**',
    ],
  },

  // Base rules for every JavaScript and TypeScript file.
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    plugins: { mohalla },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // TypeScript needs a real parser. Without it every `as const`, type
  // annotation and interface is a parse error - and, more importantly, the RTL
  // gate below would silently stop running over the admin console's .tsx files.
  //
  // This is why TypeScript is pinned to 6.0.3 rather than the newer 7.0.2:
  // typescript-eslint declares `typescript >=4.8.4 <6.1.0`, so TS 7 would cost
  // the entire TypeScript lint path. See FOUNDATION-CONFLICT-004 in
  // docs/foundation/04-toolchain-versions.md.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // The RTL gate. Applied wherever a style object can be written.
  //
  // The second glob read `packages/tokens/**` until Stage 8, and no such
  // directory has ever existed - the package is `packages/design-tokens`. So
  // the gate had been silently covering one of its two targets. Nothing was
  // found to fix in the tokens source once the glob reached it, which is the
  // only reason this is a corrected gate rather than a defect report: a gate
  // aimed at a path that does not exist reports success either way.
  {
    files: ['apps/admin/**/*.{ts,tsx,js,jsx}', 'packages/design-tokens/**/*.{ts,js}'],
    plugins: { mohalla },
    rules: {
      'mohalla/no-physical-properties': 'error',
    },
  },
];
