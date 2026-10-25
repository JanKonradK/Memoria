// window.memoriaDesktop for the Rust host. Same shape as the Electron preload
// (desktop/electron-preload.cjs) and app/src/desktop-host.ts: narrow actions
// only, no filesystem, shell or generic IPC.
(() => {
  if (!/^http:\/\/127\.0\.0\.1:1781[789]$/.test(location.origin) || 'memoriaDesktop' in window) return;
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const listeners = { 'close-request': new Set() };
  // Rust delivers host events through this one receiver.
  Object.defineProperty(window, '__memoriaReceive', {
    value: Object.freeze((name, payload) => {
      for (const listener of listeners[name] ?? []) {
        try {
          listener(payload);
        } catch (error) {
          console.error(error);
        }
      }
    }),
  });
  const subscribe = (name, listener) => {
    listeners[name].add(listener);
    return () => listeners[name].delete(listener);
  };

  Object.defineProperty(window, 'memoriaDesktop', {
    enumerable: true,
    value: Object.freeze({
      version: 1,
      onCloseRequested(listener) {
        if (typeof listener !== 'function') throw new TypeError('A close listener is required.');
        const stop = subscribe('close-request', (requestId) => {
          if (typeof requestId === 'string') listener(requestId);
        });
        void invoke('renderer_ready');
        return stop;
      },
      completeClose(requestId, result) {
        if (typeof requestId !== 'string' || typeof result?.allow !== 'boolean') return;
        void invoke('close_result', {
          requestId,
          allow: result.allow,
          error: typeof result.error === 'string' ? result.error.slice(0, 500) : null,
        });
      },
    }),
  });

  // Alt on its own shows or hides the menu bar, as Electron's auto-hide did.
  let altAlone = false;
  window.addEventListener(
    'keydown',
    (event) => {
      altAlone = event.key === 'Alt' && !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.repeat;
      if (event.key.toLowerCase() === 'q' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        void invoke('request_quit');
      }
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Alt' && altAlone) {
        event.preventDefault();
        void invoke('toggle_menu');
      }
      altAlone = false;
    },
    true,
  );
  window.addEventListener('mousedown', () => (altAlone = false), true);
})();
