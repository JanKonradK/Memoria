import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig } from 'motion/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui';
import { initPwa } from './pwa';
import { applyTheme, useUI } from './ui-store';
import './index.css';
// Per-game title fonts (see fonts.ts). These aggregate weight files are the ONLY
// @fontsource entry points that carry `unicode-range` per subset — the per-subset
// files (latin-400.css, latin-ext-400.css) declare identical @font-face descriptors
// with no range, so importing both makes latin-ext win for every character and
// basic ASCII silently falls back to the system font. unicode-range also means the
// browser never downloads the devanagari/vietnamese faces; they are emitted to
// dist/ but excluded from the service-worker precache in vite.config.ts.
// The shell: DM Sans carries every word, IBM Plex Mono carries every number.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// Per-game display faces (see fonts.ts). Titles set at 600; 500 is the fallback
// cut for a face whose 600 has not landed yet.
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/exo-2/500.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/saira/500.css';
import '@fontsource/saira/600.css';

/** Loaded after first paint — see motion-features.ts. */
const loadMotionFeatures = () => import('./motion-features').then((module) => module.default);

// Before first paint: a theme applied inside React would flash the dark ground
// on a light-theme load, and that flash is the whole reason this runs here.
applyTheme(useUI.getState().theme);
initPwa();
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
