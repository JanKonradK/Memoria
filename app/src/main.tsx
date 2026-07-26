import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig } from 'motion/react';
import App from './App';
import { AuthShell } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui';
import { initPwa } from './pwa';
import { reportClientError } from './reporting';
import { applyTextSize, useUI } from './ui-store';
import './index.css';
// Per-game title fonts (see fonts.ts). These aggregate weight files are the ONLY
// @fontsource entry points that carry `unicode-range` per subset — the per-subset
// files (latin-400.css, latin-ext-400.css) declare identical @font-face descriptors
// with no range, so importing both makes latin-ext win for every character and
// basic ASCII silently falls back to the system font. unicode-range also means the
// browser never downloads the devanagari/vietnamese faces; they are emitted to
// dist/ but excluded from the service-worker precache in vite.config.ts.
import '@fontsource/marcellus/400.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/michroma/400.css';
import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/700.css';

/** Loaded after first paint — see motion-features.ts. */
const loadMotionFeatures = () => import('./motion-features').then((module) => module.default);

applyTextSize(useUI.getState().textSize);
initPwa();
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  void reportClientError(error, 'unhandled promise rejection');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <AuthShell>
          <ErrorBoundary>
            <TooltipProvider delayDuration={350} skipDelayDuration={150}>
              <App />
            </TooltipProvider>
          </ErrorBoundary>
        </AuthShell>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
