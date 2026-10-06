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
  const areas = displays
    .map((display) => display.workArea)
    .filter(
      (area) =>
        area &&
        ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(area[key])) &&
        area.width > 0 &&
        area.height > 0,
    );
  const valid =
    saved &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key])) &&
    saved.width >= 360 &&
    saved.height >= 320 &&
    saved.width <= 10000 &&
    saved.height <= 10000;
  const overlap = (area) =>
    valid
      ? Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)) *
        Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y))
      : 0;
  const area = areas.reduce(
    (best, item) => (overlap(item) > overlap(best) ? item : best),
    areas[0] ?? { x: 0, y: 0, width: 1280, height: 900 },
  );
  const restore = valid && overlap(area) > 0;
  const width = Math.min(area.width, Math.max(360, restore ? saved.width : 1280));
  const height = Math.min(area.height, Math.max(480, restore ? saved.height : 900));
  return {
    x: Math.round(
      restore ? Math.max(area.x, Math.min(saved.x, area.x + area.width - width)) : area.x + (area.width - width) / 2,
    ),
    y: Math.round(
      restore
        ? Math.max(area.y, Math.min(saved.y, area.y + area.height - height))
        : area.y + (area.height - height) / 2,
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}
