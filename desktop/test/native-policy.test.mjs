import { describe, expect, it } from 'vitest';
import { externalUrl, isAppUrl, launchOrigin, windowBounds } from '../native-policy.mjs';

const ticket = 'a'.repeat(43);
describe('native window boundaries', () => {
  it('accepts only the authenticated launcher URL shape on supported local ports', () => {
    expect(launchOrigin(`http://127.0.0.1:17817/api/launch/${ticket}`)).toBe('http://127.0.0.1:17817');
    for (const bad of [
      `https://127.0.0.1:17817/api/launch/${ticket}`,
      `http://127.0.0.1:17820/api/launch/${ticket}`,
      `http://evil.example:17817/api/launch/${ticket}`,
      `http://user@127.0.0.1:17817/api/launch/${ticket}`,
      `http://127.0.0.1:17817/api/launch/${ticket}?token=extra`,
      'file:///C:/private.txt',
      'not a URL',
    ])
      expect(launchOrigin(bad)).toBeNull();
  });

  it('keeps navigation and close IPC on the actual app origin', () => {
    const origin = 'http://127.0.0.1:17817';
    expect(isAppUrl(`${origin}/#games`, origin)).toBe(true);
    for (const bad of ['http://127.0.0.1:17818/', 'https://example.com', 'file:///C:/x', `${origin}.evil.test/`]) {
      expect(isAppUrl(bad, origin)).toBe(false);
    }
    expect(isAppUrl(origin, undefined)).toBe(false);
  });

  it('opens HTTPS source pages without enabling executable or local URL handlers', () => {
    expect(externalUrl('https://hoyolab.com/article/123')).toBe('https://hoyolab.com/article/123');
    for (const bad of [
      'file:///C:/x.exe',
      'javascript:alert(1)',
      'ms-settings:windowsupdate',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://printer.local/',
      'https://name:password@example.com',
      'http://example.com',
      'not a URL',
    ]) {
      expect(externalUrl(bad)).toBeNull();
    }
  });

  it('recovers a window when the old monitor is disconnected', () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    const saved = { x: 100, y: 100, width: 1200, height: 800 };
    expect(windowBounds(saved, displays)).toEqual(saved);
    expect(windowBounds({ ...saved, x: 4000 }, displays)).toEqual({ x: 320, y: 90, width: 1280, height: 900 });
    expect(windowBounds({ ...saved, width: Infinity }, displays)).toEqual({ x: 320, y: 90, width: 1280, height: 900 });
  });

  it('fits the full window on a small or scaled display, including first launch', () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 800, height: 560 } }];
    expect(windowBounds(undefined, displays)).toEqual({ x: 0, y: 0, width: 800, height: 560 });
    expect(windowBounds({ x: 10, y: 20, width: 1920, height: 1080 }, displays)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 560,
    });
    expect(windowBounds({ x: 0, y: 200, width: 600, height: 350 }, displays)).toEqual({
      x: 0,
      y: 80,
      width: 600,
      height: 480,
    });
  });

  it('retains compact sizes and clamps placement on a secondary display', () => {
    const displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { workArea: { x: -1280, y: 0, width: 1280, height: 720 } },
    ];
    const compact = { x: 0, y: 0, width: 360, height: 480 };
    expect(windowBounds(compact, displays)).toEqual(compact);
    expect(windowBounds({ x: -1200, y: 600, width: 1000, height: 600 }, displays)).toEqual({
      x: -1200,
      y: 120,
      width: 1000,
      height: 600,
    });
  });
});
