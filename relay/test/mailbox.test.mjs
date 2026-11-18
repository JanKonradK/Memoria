import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_TIMEOUT_MS, COLLECT_TIMEOUT_MS, Mailbox, NO_ANSWER, OFFLINE, PC_FRESH_MS } from '../src/mailbox.mjs';

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
