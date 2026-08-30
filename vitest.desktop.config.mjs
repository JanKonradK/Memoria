import { defineConfig } from 'vitest/config';

// The launcher and its updater are plain ESM outside the app/shared workspaces,
// so they get their own tiny runner rather than being forced into either one.
export default defineConfig({
  test: {
    include: ['desktop/test/**/*.test.mjs'],
    // Each test rebinds APPDATA before importing update.mjs; sharing a process
    // between files would let one test's scratch directory leak into another.
    isolate: true,
  },
});
