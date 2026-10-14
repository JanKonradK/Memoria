const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('memoria:launcher-session', (_event, session) => {
  if (session?.origin !== globalThis.location.origin || !/^[A-Za-z0-9_-]{43}$/.test(session?.token ?? '')) return;
  globalThis.sessionStorage.setItem('memoria-launcher-token', session.token);
  globalThis.dispatchEvent(new Event('memoria-launcher-restored'));
});

// Keep the renderer sandboxed. No filesystem, credentials, shell or generic IPC.
contextBridge.exposeInMainWorld(
  'memoriaDesktop',
  Object.freeze({
    version: 1,
    // A game is named by id only. Paths are chosen in a native dialog and stay in the main process.
    launch: Object.freeze({
      list: () => ipcRenderer.invoke('memoria:launch-list'),
      choose: (gameId) => ipcRenderer.invoke('memoria:launch-choose', gameId),
      clear: (gameId) => ipcRenderer.invoke('memoria:launch-clear', gameId),
      start: (gameId) => ipcRenderer.invoke('memoria:launch-start', gameId),
    }),
    // Release data comes from GitHub through the main process. Installing closes
    // Memoria through the normal save-and-close path first.
    update: Object.freeze({
      check: () => ipcRenderer.invoke('memoria:update-check'),
      download: () => ipcRenderer.invoke('memoria:update-download'),
      install: () => ipcRenderer.invoke('memoria:update-install'),
      onProgress(listener) {
        if (typeof listener !== 'function') throw new TypeError('A progress listener is required.');
        const handler = (_event, progress) => {
          if (Number.isFinite(progress?.received) && Number.isFinite(progress?.total))
            listener({ received: progress.received, total: progress.total });
        };
        ipcRenderer.on('memoria:update-progress', handler);
        return () => ipcRenderer.removeListener('memoria:update-progress', handler);
      },
      onShowRequested(listener) {
        if (typeof listener !== 'function') throw new TypeError('A listener is required.');
        const handler = () => listener();
        ipcRenderer.on('memoria:show-updates', handler);
        return () => ipcRenderer.removeListener('memoria:show-updates', handler);
      },
    }),
    onCloseRequested(listener) {
      if (typeof listener !== 'function') throw new TypeError('A close listener is required.');
      const handler = (_event, requestId) => {
        if (typeof requestId === 'string') listener(requestId);
      };
      ipcRenderer.on('memoria:close-request', handler);
      ipcRenderer.send('memoria:renderer-ready');
      return () => ipcRenderer.removeListener('memoria:close-request', handler);
    },
    completeClose(requestId, result) {
      if (typeof requestId !== 'string' || typeof result?.allow !== 'boolean') return;
      ipcRenderer.send('memoria:close-result', requestId, {
        allow: result.allow,
        ...(typeof result.error === 'string' ? { error: result.error.slice(0, 500) } : {}),
      });
    },
  }),
);
