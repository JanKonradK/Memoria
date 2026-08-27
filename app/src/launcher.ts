/**
 * The Windows desktop launcher (desktop/memoria.mjs) serves the built app from a
 * fixed loopback port and backs /api/state, /api/sync and /api/events with
 * %APPDATA%\void\state.json. Opened any other way — `npm run dev`, a plain
 * static server — the app is IndexedDB-only and sync stays off.
 */
const LAUNCHER_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):1781[789]$/;

export function servedByLauncher(): boolean {
  return typeof window !== 'undefined' && LAUNCHER_ORIGIN.test(window.location.origin);
}
