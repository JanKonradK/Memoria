import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig } from 'motion/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui';
import { initPwa } from './pwa';
import { initNative, isNativeApp } from './native';
import { applyTheme, useUI } from './ui-store';
import { isDesktopApp } from './desktop-host';
import './index.css';
// These aggregate weight files are the ONLY @fontsource entry points that carry
// `unicode-range` per subset — the per-subset files (latin-400.css,
// latin-ext-400.css) declare identical @font-face descriptors with no range, so
// importing both makes latin-ext win for every character and basic ASCII
// silently falls back to the system font. unicode-range also means the browser
// never downloads the vietnamese faces; they are emitted to dist/ but excluded
// from the service-worker precache in vite.config.ts.
// DM Sans carries every word and number. The light italic is the quiet voice.
import '@fontsource/dm-sans/300-italic.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
// Per-game title faces (see fonts.ts), one weight each: the weight that game's
// logo sets its name in.
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/zen-dots/400.css';
import '@fontsource/bungee/400.css';
import '@fontsource/vujahday-script/400.css';
import '@fontsource/righteous/400.css';
import '@fontsource/italiana/400.css';
// Latin only: the aggregate file brings 119 Japanese slices, which the service
// worker would precache (3.7 MB) for a face that only ever sets game names.
import '@fontsource/mochiy-pop-one/latin-400.css';
import '@fontsource/black-ops-one/400.css';
import '@fontsource/share-tech-mono/400.css';

/** Loaded after first paint — see motion-features.ts. */
const loadMotionFeatures = () => import('./motion-features').then((module) => module.default);

// Before first paint: a theme applied inside React would flash the dark ground
// on a light-theme load, and that flash is the whole reason this runs here.
applyTheme(useUI.getState().theme);
if (isDesktopApp()) {
  // The installed app carries its own assets. A service worker from an older
  // build must not keep serving stale code after the PC package is updated.
  void navigator.serviceWorker?.getRegistrations().then((registrations) => {
    return Promise.all(registrations.map((registration) => registration.unregister()));
  });
} else if (!isNativeApp) initPwa();
void initNative();
window.addEventListener('unhandledrejection', (event) => {
  console.error('Memoria unhandled rejection', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <ErrorBoundary>
          <TooltipProvider delayDuration={350} skipDelayDuration={150}>
            <App />
          </TooltipProvider>
        </ErrorBoundary>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
