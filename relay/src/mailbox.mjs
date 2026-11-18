// One PC's mailbox on the relay. Phones leave sealed requests ("call"), the
// PC collects them ("next") and posts each answer ("reply"), which goes back
// to the phone still waiting on its call. Everything here is ciphertext the
// relay cannot read; it only matches answers to the calls that asked.

/** How long a phone waits for its PC to answer. */
export const CALL_TIMEOUT_MS = 25_000;
/** How long the PC's collect request is held open when the mailbox is empty. */
export const COLLECT_TIMEOUT_MS = 25_000;
/** A PC that has not collected for this long counts as offline. */
export const PC_FRESH_MS = 70_000;
/** Calls waiting at once; more means something is wrong, not a busy owner. */
export const MAX_WAITING = 32;

export const OFFLINE = {
  status: 503,
  body: { error: 'Your PC is not connected. Open Memoria on it, with device sync on.' },
};
export const NO_ANSWER = {
  status: 504,
  body: { error: 'Your PC did not answer in time. Check that Memoria is running on it.' },
};
const BUSY = { status: 429, body: { error: 'Too many requests are waiting for your PC. Try again shortly.' } };

export class Mailbox {
  /** @param {{ now?: () => number, newId?: () => string }} [options] */
  constructor({ now = Date.now, newId = () => crypto.randomUUID() } = {}) {
    this.now = now;
    this.newId = newId;
    /** Calls the PC has not collected yet. */
    this.queue = [];
    /** Calls collected and waiting for their reply, by id. */
    this.pending = new Map();
    /** PC collect requests waiting for a call. */
    this.collectors = [];
    this.pcSeenAt = -Infinity;
  }

  /**
   * A phone's request. Resolves with the PC's `{ status, body }`, or a relay
   * error when the PC is offline or too slow.
   */
  call(path, body) {
    if (this.collectors.length === 0 && this.now() - this.pcSeenAt > PC_FRESH_MS) return Promise.resolve(OFFLINE);
    if (this.queue.length + this.pending.size >= MAX_WAITING) return Promise.resolve(BUSY);
    return new Promise((resolve) => {
      const entry = { id: this.newId(), path, body, resolve, timer: undefined };
      entry.timer = setTimeout(() => {
        this.queue = this.queue.filter((item) => item !== entry);
        this.pending.delete(entry.id);
        resolve(NO_ANSWER);
      }, CALL_TIMEOUT_MS);
      const collector = this.collectors.shift();
      if (collector) this.#deliver(entry, collector);
      else this.queue.push(entry);
    });
  }

  /** The PC asks for the next call. Resolves with `{ id, path, body }`, or null when none came. */
  next() {
    this.pcSeenAt = this.now();
    const entry = this.queue.shift();
    if (entry) {
      this.pending.set(entry.id, entry);
      return Promise.resolve({ id: entry.id, path: entry.path, body: entry.body });
    }
    return new Promise((resolve) => {
      const collector = { resolve, timer: undefined };
      collector.timer = setTimeout(() => {
        this.collectors = this.collectors.filter((item) => item !== collector);
        this.pcSeenAt = this.now();
        resolve(null);
      }, COLLECT_TIMEOUT_MS);
      this.collectors.push(collector);
    });
  }

  /** The PC's answer to call `id`. False when that call already timed out. */
  reply(id, status, body) {
    this.pcSeenAt = this.now();
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve({ status, body });
    return true;
  }

  #deliver(entry, collector) {
    clearTimeout(collector.timer);
    this.pending.set(entry.id, entry);
    collector.resolve({ id: entry.id, path: entry.path, body: entry.body });
  }
}
