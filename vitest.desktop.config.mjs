import { defineConfig } from 'vitest/config';

// Installer and release-tool tests (desktop/test), and the loopback contract of
// the Rust host (native/test, run by npm run test:native once it is built).
export default defineConfig({
  test: {
    include: ['desktop/test/**/*.test.mjs', 'native/test/**/*.test.mjs'],
    // Each file starts its own scratch processes and folders.
    isolate: true,
  },
});
