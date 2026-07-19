import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthShell } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initPwa } from './pwa';
import { reportClientError } from './reporting';
import './index.css';
// Per-game title fonts (see fonts.ts) — bundled so the PWA stays offline-capable.
import '@fontsource/marcellus/400.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/michroma/400.css';
import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/700.css';

initPwa();
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  void reportClientError(error, 'unhandled promise rejection');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthShell>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AuthShell>
  </StrictMode>,
);
