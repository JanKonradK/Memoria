import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUSY,
  CALL_TIMEOUT_MS,
  COLLECT_TIMEOUT_MS,
  MAX_WAITING,
  Mailbox,
  NO_ANSWER,
  OFFLINE,
  PC_FRESH_MS,
} from '../src/mailbox.mjs';
import { Room } from '../src/index.mjs';

describe('relay mailbox', () => {
  let clock;
  let ids;
  let box;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    ids = 0;
    box = new Mailbox({ now: () => clock, newId: () => `id-${++ids}` });
  });
  afterEach(() => vi.useRealTimers());

  it('says the PC is offline before it has ever collected', async () => {
    expect(await box.call('/hello', {})).toEqual(OFFLINE);
  });

  it('hands a call to a waiting PC and its reply back to the phone', async () => {
    const collected = box.next();
    const answer = box.call('/sync', { sealed: true });
    expect(await collected).toEqual({ id: 'id-1', path: '/sync', body: { sealed: true } });
    expect(box.reply('id-1', 200, { ok: 1 })).toBe(true);
    expect(await answer).toEqual({ status: 200, body: { ok: 1 } });
    // A reply is used once.
    expect(box.reply('id-1', 200, {})).toBe(false);
  });

  it('queues calls between collects while the PC is fresh', async () => {
    const empty = box.next();
    await vi.advanceTimersByTimeAsync(COLLECT_TIMEOUT_MS);
    expect(await empty).toBeNull();
    const first = box.call('/hello', {});
    const second = box.call('/sync', {});
    expect((await box.next()).id).toBe('id-1');
    expect((await box.next()).id).toBe('id-2');
    box.reply('id-2', 200, 'b');
    box.reply('id-1', 200, 'a');
    expect(await first).toEqual({ status: 200, body: 'a' });
    expect(await second).toEqual({ status: 200, body: 'b' });
  });

  it('gives up on a PC that does not answer, and forgets it once stale', async () => {
    const collected = box.next();
    const answer = box.call('/sync', {});
    await collected;
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(await answer).toEqual(NO_ANSWER);
    expect(box.reply('id-1', 200, {})).toBe(false);
    clock += PC_FRESH_MS + 1;
    expect(await box.call('/hello', {})).toEqual(OFFLINE);
  });
});

describe('relay mailbox limits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds at most four calls and refuses the fifth before reading it', async () => {
    expect(MAX_WAITING).toBe(4);
    const box = new Mailbox({ now: () => 1_000_000 });
    void box.next();
    const calls = Array.from({ length: MAX_WAITING }, () => box.call('/sync', {}));
    expect(box.refusal()).toEqual(BUSY);
    expect(await box.call('/sync', {})).toEqual(BUSY);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(await Promise.all(calls)).toEqual(calls.map(() => NO_ANSWER));
    expect(box.refusal()).toBeNull();
  });
});

describe('relay room ownership', () => {
  const room = 'a'.repeat(32);
  const token = 'b'.repeat(64);
  const owner = 'c'.repeat(64);
  const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const sha = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const storage = () => {
    const values = new Map();
    return { values, get: async (key) => values.get(key), put: async (key, value) => void values.set(key, value) };
  };
  const reply = (headers) =>
    new Request(`https://relay.test/v1/rooms/${room}/reply/missing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ status: 200, body: null }),
    });
  const both = { authorization: `Bearer ${token}`, 'x-memoria-owner': owner };

  it('needs both the bearer token and the owner secret, even to claim an empty room', async () => {
    const state = { storage: storage() };
    const relay = new Room(state);
    // A caller with only a token cannot claim an unclaimed room.
    expect((await relay.fetch(reply({ authorization: `Bearer ${token}` }))).status).toBe(403);
    expect((await relay.fetch(reply({ 'x-memoria-owner': owner }))).status).toBe(403);
    expect((await relay.fetch(reply({ ...both, 'x-memoria-owner': 'short' }))).status).toBe(403);
    expect(state.storage.values.size).toBe(0);
    // The first full pair claims it; the reply itself has nothing waiting.
    expect((await relay.fetch(reply(both))).status).toBe(410);
    expect(state.storage.values.get('owner')).toBe(await sha(`${token}:${owner}`));
    expect((await relay.fetch(reply(both))).status).toBe(410);
    // After that, a different secret with the right token, or the reverse, is refused.
    expect((await relay.fetch(reply({ ...both, 'x-memoria-owner': 'd'.repeat(64) }))).status).toBe(403);
    expect((await relay.fetch(reply({ ...both, authorization: `Bearer ${'d'.repeat(64)}` }))).status).toBe(403);
  });

  it('moves a room claimed by token alone to the token and owner pair', async () => {
    const state = { storage: storage() };
    await state.storage.put('owner', await sha(token));
    const relay = new Room(state);
    expect((await relay.fetch(reply({ authorization: `Bearer ${token}` }))).status).toBe(403);
    expect((await relay.fetch(reply(both))).status).toBe(410);
    expect(state.storage.values.get('owner')).toBe(await sha(`${token}:${owner}`));
    // A stranger's pair never takes over a token-only claim it does not hold.
    const other = { storage: storage() };
    await other.storage.put('owner', await sha('e'.repeat(64)));
    expect((await new Room(other).fetch(reply(both))).status).toBe(403);
  });

  it('turns away a call to an offline PC or an oversized call without reading its body', async () => {
    const relay = new Room({ storage: storage() });
    const call = (headers = {}) =>
      new Request(`https://relay.test/v1/rooms/${room}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: new ReadableStream({
          pull() {
            throw new Error('The body must not be read.');
          },
        }),
        duplex: 'half',
      });
    expect(await (await relay.fetch(call())).json()).toEqual(OFFLINE);
    relay.mailbox.pcSeenAt = Date.now();
    const large = await (await relay.fetch(call({ 'content-length': String(8_388_609) }))).json();
    expect(large.status).toBe(413);
  });
});
