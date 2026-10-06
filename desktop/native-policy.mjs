/** Only the authenticated launcher may provide the first page for the app. */
export function launchOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !['17817', '17818', '17819'].includes(url.port) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/launch\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAppUrl(value, origin) {
  try {
    const url = new URL(value);
    return Boolean(origin) && url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Game source links may open outside the app, but never execute a local handler. */
export function externalUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.startsWith('[') ||
      /^\d+(\.\d+){3}$/.test(host) ||
      !host.includes('.')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function windowBounds(saved, displays) {
  const fallback = { width: 1280, height: 900 };
  if (!saved || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key]))) return fallback;
  if (saved.width < 800 || saved.height < 600 || saved.width > 10000 || saved.height > 10000) return fallback;
  const visible = displays.some(
    ({ workArea: d }) =>
      saved.x < d.x + d.width - 80 &&
      saved.x + saved.width > d.x + 80 &&
      saved.y >= d.y &&
      saved.y < d.y + d.height - 80,
  );
  return visible ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : fallback;
}
