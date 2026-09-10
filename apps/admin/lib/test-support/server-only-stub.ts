/**
 * A stand-in for the `server-only` package, used by vitest alone.
 *
 * The real package has no runtime behaviour: it exists so a bundler errors
 * when a client component imports a server module. There is no bundler in a
 * test run, so this file supplies the module and nothing else.
 *
 * IT DOES NOT WEAKEN THE RULE. `next build` is what enforces the boundary, and
 * `lib/admin-api/client.spec.ts` asserts independently that no `'use client'`
 * file imports the credential path — a check that reads the source and so
 * cannot be fooled by an alias.
 */
export {};
