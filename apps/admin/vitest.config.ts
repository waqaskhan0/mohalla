import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
  },
  resolve: {
    alias: {
      /**
       * `server-only` is a BUILD-TIME marker with no runtime behaviour: the
       * package exists so that a bundler fails when a client component pulls
       * in a server module. Under vitest there is no bundler and no client
       * boundary, so importing it throws "Cannot find package" and takes down
       * any spec that imports the credential path — which is why the SEC-025
       * checks in `client.spec.ts` are written as source reads rather than as
       * behaviour.
       *
       * Aliasing it to an empty module lets a spec import those modules and
       * test what they DO. It does not weaken the guarantee: the guarantee is
       * enforced by `next build`, and `client.spec.ts` independently asserts
       * that no client component imports any of them.
       */
      'server-only': new URL('./lib/test-support/server-only-stub.ts', import.meta.url).pathname,
    },
  },
});
