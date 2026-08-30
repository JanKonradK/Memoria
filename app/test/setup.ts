import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom ships no ResizeObserver, and Ring.tsx observes its container to size the
// stroke — so any test rendering a GameBadge dies on mount without this stub.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom ships no matchMedia either, and useMediaQuery reads it during the first
// render. Resolve each query honestly rather than returning one blanket value:
// the app asks about reduced motion AND about width (640/1280/1500px), so a flat
// `matches: true` would claim the viewport is wide and reduced-motion at once.
// Individual tests can still vi.stubGlobal over this.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => {
    const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
    const matches = minWidth
      ? window.innerWidth >= Number(minWidth[1])
      : query.includes('prefers-reduced-motion: reduce');
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
