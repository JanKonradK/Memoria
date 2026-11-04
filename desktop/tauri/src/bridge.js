/* global window, document, location, Element, __ORIGIN__, __TOKEN__ */
// Runs before the app's own scripts on every page the Memoria window loads.
// It gives the app the same narrow `window.memoriaDesktop` API the Electron
// build had, backed by Rust commands, and hands the app this run's API token.
// Rust fills in __ORIGIN__ and __TOKEN__.
(() => {
  const ORIGIN = __ORIGIN__;
  if (location.origin !== ORIGIN || window.top !== window) return;

  try {
    sessionStorage.setItem('memoria-launcher-token', __TOKEN__);
    localStorage.removeItem('void-sync-config');
  } catch {
    // The API stays closed if storage is refused.
  }

  const invoke = (command, args) => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals) return Promise.reject(new Error('Memoria is still starting. Try again.'));
    // Rust rejects with a message. The app reads `error.message`.
    return internals.invoke(command, args ?? {}).catch((error) => {
      throw new Error(typeof error === 'string' ? error : String(error?.message ?? error));
    });
  };

  /** channel -> listeners. Rust calls __memoriaDesktopEmit to deliver. */
  const listeners = new Map();
  const subscribe = (
    channel,
    listener,
    accept = (value) => typeof value === 'string' || (value && typeof value === 'object'),
  ) => {
    if (typeof listener !== 'function') throw new TypeError('A listener is required.');
    const wrapped = (value) => {
      if (accept(value)) listener(value);
    };
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(wrapped);
    return () => listeners.get(channel)?.delete(wrapped);
  };
  Object.defineProperty(window, '__memoriaDesktopEmit', {
    value: (channel, value) => {
      for (const listener of listeners.get(channel) ?? []) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    },
  });

  // Links to the web open in the default browser, never inside the app window.
  const openExternal = (url) => void invoke('open_external', { url: String(url) }).catch(() => undefined);
  window.open = (url) => {
    if (url) openExternal(new URL(String(url), location.href).href);
    return null;
  };
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || event.defaultPrevented) return;
      const url = new URL(link.href, location.href);
      if (url.origin === ORIGIN) return;
      event.preventDefault();
      openExternal(url.href);
    },
    true,
  );

  // Ctrl and +, - or 0, and Ctrl with the mouse wheel, zoom the page as in a
  // browser. Rust applies the level and keeps it for the next launch.
  const zoom = (step) => void invoke('set_zoom', { step }).catch(() => undefined);
  const ZOOM_KEYS = { '=': 1, '+': 1, Add: 1, '-': -1, _: -1, Subtract: -1, 0: 0 };
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.code.startsWith('Numpad') ? event.code.slice(6) : event.key;
      const step = ZOOM_KEYS[key];
      if (step === undefined) return;
      event.preventDefault();
      zoom(step);
    },
    true,
  );
  let lastWheel = 0;
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      // A free-spinning wheel or a touchpad sends many events for one gesture.
      if (event.timeStamp - lastWheel < 120) return;
      lastWheel = event.timeStamp;
      zoom(event.deltaY < 0 ? 1 : -1);
    },
    { capture: true, passive: false },
  );

  Object.defineProperty(window, 'memoriaDesktop', {
    value: Object.freeze({
      version: 1,
      // A game is named by id only. Paths are picked in a native dialog and stay in Rust.
      launch: Object.freeze({
        list: () => invoke('launch_list'),
        choose: (gameId) => invoke('launch_choose', { gameId }),
        clear: (gameId) => invoke('launch_clear', { gameId }),
        start: (gameId) => invoke('launch_start', { gameId }),
      }),
      update: Object.freeze({
        check: () => invoke('update_check'),
        download: () => invoke('update_download'),
        install: () => invoke('update_install'),
        onProgress: (listener) =>
          subscribe(
            'memoria:update-progress',
            (progress) => listener({ received: progress.received, total: progress.total }),
            (value) => Number.isFinite(value?.received) && Number.isFinite(value?.total),
          ),
        onShowRequested: (listener) =>
          subscribe(
            'memoria:show-updates',
            () => listener(),
            () => true,
          ),
      }),
      presence: Object.freeze({
        get: () => invoke('presence_get'),
        set: (changes) => invoke('presence_set', { changes }),
        watch: (games) => invoke('games_watch', { games }),
        notify: (notice) => invoke('game_notify', { notice }),
        onChanged: (listener) => subscribe('memoria:presence-changed', listener),
        onGameStarted: (listener) => subscribe('memoria:game-started', listener),
        onOpenGame: (listener) => subscribe('memoria:open-game', listener),
      }),
      onCloseRequested(listener) {
        const stop = subscribe('memoria:close-request', listener, (value) => typeof value === 'string');
        void invoke('renderer_ready').catch(() => undefined);
        return stop;
      },
      completeClose(requestId, result) {
        if (typeof requestId !== 'string' || typeof result?.allow !== 'boolean') return;
        void invoke('close_result', {
          requestId,
          allow: result.allow,
          error: typeof result.error === 'string' ? result.error.slice(0, 500) : null,
        }).catch(() => undefined);
      },
    }),
  });
})();
