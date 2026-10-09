import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom;
afterEach(() => {
  dom?.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom?.window.close();
  dom = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

const NOW = 1_791_500_000_000;
const snapshot = {
  version: 1,
  fetchedAt: NOW,
  accounts: [
    {
      provider: 'genshin',
      uid: '712345678',
      server: 'os_euro',
      nickname: 'Traveler',
      reading: { observedAt: NOW, data: { current_resin: 123 } },
    },
  ],
};
async function popup(initial) {
  vi.useFakeTimers();
  dom = new JSDOM(readFileSync(new URL('../../browser-extension/popup.html', import.meta.url), 'utf8'));
  let status = initial;
  const listeners = new Set();
  const browser = {
    runtime: { sendMessage: vi.fn(async () => status) },
    storage: {
      onChanged: {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
      },
    },
  };
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('chrome', browser);
  await import('../../browser-extension/popup.mjs');
  await vi.advanceTimersByTimeAsync(0);
  return {
    browser,
    read: dom.window.document.getElementById('read'),
    status: dom.window.document.getElementById('status'),
    accounts: dom.window.document.getElementById('accounts'),
    update(value) {
      status = value;
    },
    change(changes, area = 'local') {
      for (const listener of listeners) listener(changes, area);
    },
    close() {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    },
  };
}

describe('browser connector popup updates', () => {
  it('unblocks a popup opened during an alarm read and stops polling when the read ends', async () => {
    const view = await popup({ ok: true, automatic: true, busy: true });
    expect(view.read.disabled).toBe(true);
    expect(view.read.textContent).toBe('Reading…');
    view.update({ ok: true, automatic: true, busy: false, snapshot, checkedAt: NOW });
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.read.disabled).toBe(false);
    expect(view.read.textContent).toBe('Read accounts');
    expect(view.status.textContent).toContain('1 account sent to Memoria');
    expect(view.accounts.textContent).toContain('712345678');
    expect(view.browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('refreshes completed and failed scheduled reads from storage changes', async () => {
    const view = await popup({ ok: true, automatic: true, busy: false });
    view.update({ ok: true, automatic: true, busy: false, snapshot, checkedAt: NOW });
    view.change({ snapshot: { newValue: snapshot }, checkedAt: { newValue: NOW } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.status.textContent).toContain('1 account sent to Memoria');
    view.update({ ok: true, automatic: true, busy: false, snapshot, lastError: 'Readings could not reach Memoria.' });
    view.change({ lastError: { newValue: 'Readings could not reach Memoria.' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.status.textContent).toBe('Readings could not reach Memoria.');
    expect(view.status.dataset.error).toBe('true');
    expect(view.accounts.textContent).toContain('712345678');
    const calls = view.browser.runtime.sendMessage.mock.calls.length;
    view.change({ unrelated: { newValue: true } });
    view.change({ snapshot: { newValue: snapshot } }, 'sync');
    await vi.advanceTimersByTimeAsync(0);
    expect(view.browser.runtime.sendMessage).toHaveBeenCalledTimes(calls);
  });

  it('cancels busy polling and storage listeners when the popup closes', async () => {
    const view = await popup({ ok: true, busy: true });
    view.close();
    await vi.advanceTimersByTimeAsync(5000);
    view.change({ checkedAt: { newValue: NOW } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(view.browser.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('shows a failed status read and lets the user retry instead of staying disabled', async () => {
    const view = await popup({ ok: true, busy: true });
    view.update({ ok: false, error: 'private diagnostic' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.read.disabled).toBe(false);
    expect(view.status.dataset.error).toBe('true');
    expect(view.status.textContent).toContain('Set up browser connector');
    expect(view.status.textContent).not.toContain('private diagnostic');
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});
