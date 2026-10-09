/* global chrome */
import { createConnector, HOST, MESSAGES } from './hoyo-client.mjs';

export const ALARM = 'memoria-hoyolab-readings';

export function createWorker(browser, options = {}) {
  const connector = createConnector({
    ...options,
    sendNative(message) {
      return new Promise((resolve, reject) => {
        browser.runtime.sendNativeMessage(HOST, message, (response) => {
          if (browser.runtime.lastError) reject(new Error(MESSAGES.host));
          else resolve(response);
        });
      });
    },
  });
  let reading;
  const restoreAlarm = async () => {
    const { automatic } = await browser.storage.local.get('automatic');
    if (automatic === true) {
      if (!(await browser.alarms.get(ALARM)))
        await browser.alarms.create(ALARM, { periodInMinutes: 5, delayInMinutes: 5 });
    } else await browser.alarms.clear(ALARM);
  };
  const read = () => {
    if (reading) return reading;
    reading = (async () => {
      const { snapshot } = await browser.storage.local.get('snapshot');
      try {
        const result = await connector.refresh(snapshot);
        await browser.storage.local.set({ ...result, lastError: '', checkedAt: result.snapshot.fetchedAt });
        return { ok: true, ...result };
      } catch (error) {
        const message = Object.values(MESSAGES).includes(error.message) ? error.message : MESSAGES.host;
        await browser.storage.local.set({ lastError: message });
        return { ok: false, error: message };
      }
    })().finally(() => {
      reading = undefined;
    });
    return reading;
  };
  return {
    read,
    restoreAlarm,
    async status() {
      const stored = await browser.storage.local.get(['snapshot', 'automatic', 'errors', 'lastError', 'checkedAt']);
      return { ok: true, ...stored, automatic: stored.automatic === true, busy: Boolean(reading) };
    },
    async configure(automatic) {
      if (typeof automatic !== 'boolean') return { ok: false, error: 'Choose whether to read automatically.' };
      await browser.storage.local.set({ automatic });
      await restoreAlarm();
      return { ok: true, automatic };
    },
    async alarm(alarm) {
      if (alarm.name !== ALARM) return;
      const { automatic } = await browser.storage.local.get('automatic');
      if (automatic === true) await read();
    },
  };
}

if (typeof chrome !== 'undefined') {
  const worker = createWorker(chrome);
  const safely = (operation) => {
    void operation.catch(() => {});
  };
  chrome.runtime.onInstalled.addListener(() => safely(worker.restoreAlarm()));
  chrome.runtime.onStartup.addListener(() => safely(worker.restoreAlarm()));
  chrome.alarms.onAlarm.addListener((alarm) => safely(worker.alarm(alarm)));
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Only our popup may request reads. No website or external extension can call this bridge.
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
    let operation;
    if (message?.action === 'read') operation = worker.read();
    else if (message?.action === 'status') operation = worker.status();
    else if (message?.action === 'configure') operation = worker.configure(message.automatic);
    else return false;
    operation.then(reply, () => reply({ ok: false, error: MESSAGES.host }));
    return true;
  });
  // Chrome can drop alarms after a restart. Restore the user's choice whenever this worker starts.
  safely(worker.restoreAlarm());
}
