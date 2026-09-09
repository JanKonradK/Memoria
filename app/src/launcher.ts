/**
 * The Windows desktop launcher (desktop/memoria.mjs) serves the built app from a
 * fixed loopback port and backs /api/state, /api/sync and /api/events with
 * %APPDATA%\memoria\state.json. Opened any other way — `npm run dev`, a plain
 * static server — the app is IndexedDB-only and sync stays off.
 */
const LAUNCHER_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):1781[789]$/;
const AUTH_MESSAGE = 'Reopen Memoria with its desktop shortcut to reconnect local sync.';

function authorizationError(): Error {
  const error = new Error(AUTH_MESSAGE);
  error.name = 'LauncherAuthorizationError';
  return error;
}

export function servedByLauncher(): boolean {
  return typeof window !== 'undefined' && LAUNCHER_ORIGIN.test(window.location.origin);
}

/** Session storage is scoped to the full origin; loopback cookies ignore ports. */
export function launcherFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!servedByLauncher() || !/^\/api\/[a-z]+$/.test(path)) throw new Error('Invalid launcher request.');
  const token = sessionStorage.getItem('memoria-launcher-token');
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw authorizationError();
  }
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers, credentials: 'omit', redirect: 'error' }).then((response) => {
    if (response.status === 401 || response.status === 403) throw authorizationError();
    return response;
  });
}
