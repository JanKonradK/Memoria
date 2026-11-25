import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARK_PATH } from '../src/components/mark-path';

const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');

function mountSplash() {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div id="splash" aria-hidden="true"><div class="splash-stage"></div></div>',
  );
  return document.getElementById('splash')!;
}

async function loadSplash() {
  vi.resetModules();
  return import('../src/splash');
}

/** Lets the awaited promise chain in leave() advance past each timer and frame. */
async function flush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('the intro in index.html', () => {
  it('masks the mark with the logo’s own outline', () => {
    expect(html).toContain(`%3Cpath d='${MARK_PATH}'/%3E`);
  });

  it('paints before any module and moves only opacity and transform', () => {
    expect(html.indexOf('id="splash"')).toBeLessThan(html.indexOf('type="module"'));
    const keyframes = [...html.matchAll(/@keyframes splash-[\w-]+ \{([\s\S]*?)\n {6}\}/g)].map((match) => match[1]);
    expect(keyframes.length).toBeGreaterThan(5);
    for (const body of keyframes) {
      for (const [, property] of body.matchAll(/([a-z-]+):/g)) expect(['opacity', 'transform']).toContain(property);
    }
  });

  it('starts from the ground the native launch screens use', () => {
    expect(html).toMatch(/#splash \{[\s\S]*?background: #0c0d0f;/);
    const styles = readFileSync(
      resolve(import.meta.dirname, '../../android/app/src/main/res/values/styles.xml'),
      'utf8',
    );
    expect(styles).toContain('<item name="windowSplashScreenBackground">#0c0d0f</item>');
  });
});

describe('splash exit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16),
    );
    // The full intro; the test setup answers reduced motion by default.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    window.__memoriaSplashAt = performance.now();
    localStorage.removeItem('memoria-splash-seen');
  });

  afterEach(() => {
    document.getElementById('splash')?.remove();
    delete window.__memoriaSplashAt;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('holds until the intro has played, then fades and goes', async () => {
    const node = mountSplash();
    const { splashDone, INTRO_MS } = await loadSplash();
    splashDone();
    await flush(INTRO_MS - 200);
    expect(node.classList.contains('leave')).toBe(false);
    await flush(300);
    expect(node.classList.contains('leave')).toBe(true);
    node.dispatchEvent(new Event('animationend'));
    expect(node.isConnected).toBe(false);
  });

  it('only covers the first paint on a repeat open', async () => {
    localStorage.setItem('memoria-splash-seen', '1');
    const node = mountSplash();
    const { splashDone, REPEAT_INTRO_MS } = await loadSplash();
    splashDone();
    await flush(REPEAT_INTRO_MS + 100);
    expect(node.classList.contains('leave')).toBe(true);
  });

  it('holds a shorter beat under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    const node = mountSplash();
    const { splashDone } = await loadSplash();
    splashDone();
    await flush(800);
    expect(node.classList.contains('leave')).toBe(true);
  });

  it('a tap skips what is left of the intro once the app has drawn', async () => {
    const node = mountSplash();
    const { initSplash, splashDone } = await loadSplash();
    initSplash();
    splashDone();
    await flush(100);
    node.dispatchEvent(new Event('pointerdown'));
    await flush(100);
    expect(node.classList.contains('leave')).toBe(true);
  });

  it('gives the page back at once when nobody saw the intro start', async () => {
    delete window.__memoriaSplashAt;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const node = mountSplash();
    const { splashDone } = await loadSplash();
    splashDone();
    expect(node.isConnected).toBe(false);
    visibility.mockRestore();
  });

  it('never traps the app behind it', async () => {
    const node = mountSplash();
    const { initSplash } = await loadSplash();
    initSplash();
    await flush(12_000);
    expect(node.isConnected).toBe(false);
  });

  it('returns the status bar to the theme’s colour', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#f6f7f9" />');
    const meta = document.querySelector('meta[name="theme-color"]')!;
    const node = mountSplash();
    const { holdThemeColor, splashDone, INTRO_MS } = await loadSplash();
    holdThemeColor();
    expect(meta.getAttribute('content')).toBe('#0c0d0f');
    splashDone();
    await flush(INTRO_MS + 2000);
    expect(node.isConnected).toBe(false);
    expect(meta.getAttribute('content')).toBe('#f6f7f9');
    meta.remove();
  });
});
