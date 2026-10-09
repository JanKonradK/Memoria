/* global chrome, document, window */
import { PROVIDERS, MESSAGES } from './hoyo-client.mjs';

const read = document.getElementById('read');
const automatic = document.getElementById('automatic');
const status = document.getElementById('status');
const accounts = document.getElementById('accounts');
const message = (action) => chrome.runtime.sendMessage(action);
const time = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const showError = (text) => {
  status.textContent = text;
  status.dataset.error = 'true';
};
let polling;
let loading;
let reload = false;
let closed = false;

function render(result) {
  automatic.checked = result.automatic === true;
  read.disabled = result.busy === true;
  read.textContent = result.busy ? 'Reading…' : 'Read accounts';
  accounts.replaceChildren();
  for (const account of result.snapshot?.accounts ?? []) {
    if (!PROVIDERS[account.provider]) continue;
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = PROVIDERS[account.provider].name;
    const identity = document.createElement('small');
    identity.textContent = `${account.nickname ? `${account.nickname} · ` : ''}${account.uid} · ${account.server}`;
    item.append(name, identity);
    if (account.reading?.observedAt) {
      const checked = document.createElement('small');
      checked.textContent = `Reading from ${time(account.reading.observedAt)}`;
      item.append(checked);
    }
    if (account.error) {
      const error = document.createElement('small');
      error.className = 'account-error';
      error.textContent = account.error;
      item.append(error);
    }
    accounts.append(item);
  }
  accounts.tabIndex = accounts.scrollHeight > accounts.clientHeight ? 0 : -1;
  status.dataset.error = 'false';
  if (result.lastError) showError(result.lastError);
  else if (result.busy) status.textContent = 'Reading your linked accounts…';
  else {
    const failed = Object.keys(result.errors ?? {}).length;
    const count = result.snapshot?.accounts.filter((account) => account.reading && !account.error).length ?? 0;
    if (failed) {
      showError(
        Object.entries(result.errors)
          .map(([provider, error]) => `${PROVIDERS[provider]?.name ?? 'HoYoLAB'}: ${error}`)
          .join(' '),
      );
    } else if (result.checkedAt) {
      status.textContent = count
        ? `${count} ${count === 1 ? 'account sent' : 'accounts sent'} to Memoria at ${time(result.checkedAt)}.`
        : 'No linked game accounts found. Check your HoYoLAB sign-in.';
    } else status.textContent = 'No readings yet.';
  }
}
function load() {
  if (closed) return Promise.resolve();
  if (loading) {
    reload = true;
    return loading;
  }
  clearTimeout(polling);
  loading = (async () => {
    try {
      const result = await message({ action: 'status' });
      if (closed) return;
      if (result?.ok !== true) throw new Error('Status unavailable');
      render(result);
      // A popup opened during an alarm read must become usable when that read ends.
      if (result.busy) polling = setTimeout(() => void load(), 1000);
    } catch {
      if (closed) return;
      showError(MESSAGES.host);
      read.disabled = false;
      read.textContent = 'Read accounts';
    }
  })().finally(() => {
    loading = undefined;
    if (reload) {
      reload = false;
      void load();
    }
  });
  return loading;
}
read.addEventListener('click', async () => {
  read.disabled = true;
  read.textContent = 'Reading…';
  status.dataset.error = 'false';
  status.textContent = 'Reading your linked accounts…';
  try {
    await message({ action: 'read' });
    await load();
  } catch {
    showError(MESSAGES.host);
  } finally {
    read.disabled = false;
    read.textContent = 'Read accounts';
  }
});
automatic.addEventListener('change', async () => {
  automatic.disabled = true;
  try {
    const result = await message({ action: 'configure', automatic: automatic.checked });
    if (!result.ok) throw new Error('Configuration failed');
  } catch {
    automatic.checked = !automatic.checked;
    showError(MESSAGES.host);
  } finally {
    automatic.disabled = false;
  }
});
const changed = (changes, area) => {
  if (
    area === 'local' &&
    ['snapshot', 'errors', 'lastError', 'checkedAt', 'automatic'].some((key) => Object.hasOwn(changes, key))
  )
    void load();
};
chrome.storage.onChanged.addListener(changed);
window.addEventListener('pagehide', () => {
  closed = true;
  clearTimeout(polling);
  chrome.storage.onChanged.removeListener(changed);
});
void load();
