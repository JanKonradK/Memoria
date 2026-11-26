import { useEffect, useLayoutEffect, useState } from 'react';
import { DESKTOP_CHROME_GLYPHS, keepFocus, type DesktopWindow, type DesktopWindowState } from '../desktop-host';
import '../window-chrome.css';

/**
 * The Windows app's title bar. The window is frameless so the app's ground runs
 * to its top edge; this band is where it is dragged (Windows handles the drag,
 * double-click and the system menu through `app-region`), and it carries the
 * three caption buttons. Loaded only in the Windows app.
 */
export function WindowChrome({ host }: { host: DesktopWindow }) {
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, focused: true, zoom: 1 });

  // The rail, page bars and full-screen layers clear --desktop-chrome-h (index.css).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.desktopChrome = '';
    return () => {
      delete root.dataset.desktopChrome;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const stop = host.onStateChanged(setState);
    void host.getState().then(
      (next) => active && setState(next),
      () => undefined,
    );
    return () => {
      active = false;
      stop();
    };
  }, [host]);

  const toggleMaximize = () =>
    void host.toggleMaximize().then(
      (next) => setState(next),
      () => undefined,
    );

  return (
    <div
      data-window-chrome=""
      data-active={state.focused || undefined}
      className="window-chrome"
      // Reached only where Windows did not take the double-click itself.
      onDoubleClick={(event) => !(event.target as Element).closest('button') && toggleMaximize()}
    >
      <span className="window-chrome-title" aria-hidden>
        Memoria
      </span>
      <div className="window-chrome-buttons">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Minimize"
          onMouseDown={keepFocus}
          onClick={() => void host.minimize().catch(() => undefined)}
        >
          <span aria-hidden>{DESKTOP_CHROME_GLYPHS.minimize}</span>
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={state.maximized ? 'Restore' : 'Maximize'}
          onMouseDown={keepFocus}
          onClick={toggleMaximize}
        >
          <span aria-hidden>{state.maximized ? DESKTOP_CHROME_GLYPHS.restore : DESKTOP_CHROME_GLYPHS.maximize}</span>
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close"
          data-close=""
          onMouseDown={keepFocus}
          onClick={() => void host.close().catch(() => undefined)}
        >
          <span aria-hidden>{DESKTOP_CHROME_GLYPHS.close}</span>
        </button>
      </div>
    </div>
  );
}
