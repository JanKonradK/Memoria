import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameCapture } from '../game-capture.mjs';

let directory;
let captures;
let clock;
const png = (value = 1) => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, value]).toString('base64');
const input = (overrides = {}) => ({
  base64: png(),
  mimeType: 'image/png',
  gameId: 'genshin-account',
  gameName: 'Genshin Impact',
  sourceName: 'Genshin Impact',
  capturedAt: clock,
  ...overrides,
});

function make(options = {}) {
  const recognize = vi.fn(async () => ({ text: 'Original Resin 120 / 200' }));
  const onQueued = vi.fn();
  const capture = createGameCapture({ dataDir: directory, recognize, onQueued, now: () => clock, ...options });
  captures.push(capture);
  return { capture, recognize, onQueued };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'memoria-capture-test-'));
  captures = [];
  clock = Date.now();
});

afterEach(async () => {
  await Promise.all(captures.map((capture) => capture.stop()));
  // This path is the exact isolated directory returned by mkdtemp for this test.
  if (
    path.dirname(directory) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith('memoria-capture-test-')
  )
    throw new Error('Unexpected test directory.');
  await rm(directory, { recursive: true, force: true });
});

describe('native hotkey screenshot inbox', () => {
  it('retains text, mapping and actual capture time across restarts without saving images', async () => {
    const { capture, recognize, onQueued } = make();
    await expect(capture.start()).resolves.toEqual({ count: 0, busy: false });
    const entry = await capture.enqueue(input());
    expect(entry).toMatchObject({
      gameId: 'genshin-account',
      gameName: 'Genshin Impact',
      name: 'Genshin Impact',
      capturedAt: clock,
      detectedAt: clock,
      text: 'Original Resin 120 / 200',
    });
    expect(recognize).toHaveBeenCalledWith({ base64: png(), mimeType: 'image/png' });
    expect(onQueued).toHaveBeenCalledWith(entry);
    expect(await readdir(path.join(directory, 'capture'))).toEqual(['state.json']);
    const persisted = await readFile(path.join(directory, 'capture', 'state.json'), 'utf8');
    expect(persisted).not.toContain(png());
    expect(persisted).not.toContain('base64');
    const restored = make().capture;
    await restored.start();
    expect(restored.pending()).toEqual([entry]);
    const clone = restored.pending();
    clone[0].text = 'mutated';
    expect(restored.pending()[0].text).toBe(entry.text);
  });

  it('allows unmapped capture and keeps image data out of notifications', async () => {
    const { capture, onQueued } = make();
    const entry = await capture.enqueue(input({ gameId: undefined, gameName: undefined }));
    expect(entry.gameId).toBeUndefined();
    expect(onQueued.mock.calls[0][0]).not.toHaveProperty('base64');
    expect(capture.status()).toEqual({ count: 1, busy: false });
  });

  it.each([
    { capturedAt: NaN },
    { capturedAt: 0 },
    { capturedAt: '2026-10-01' },
    { sourceName: '' },
    { sourceName: 'Game\nInjected title' },
    { gameId: '../account' },
    { gameId: undefined },
    { directory: 'C:\\private' },
    { mimeType: 'image/webp' },
    { mimeType: 'image/jpeg' },
    { base64: 'not base64' },
    { base64: Buffer.from('not an image').toString('base64') },
  ])('rejects invalid metadata/image before OCR or disk writes: %j', async (overrides) => {
    const { capture, recognize } = make();
    await expect(capture.enqueue(input(overrides))).rejects.toThrow();
    expect(recognize).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects stale, future, and oversized captures before OCR', async () => {
    const { capture, recognize } = make();
    await expect(capture.enqueue(input({ capturedAt: clock + 1 }))).rejects.toThrow('capture time');
    await expect(capture.enqueue(input({ capturedAt: clock - 300_001 }))).rejects.toThrow('capture time');
    await expect(
      capture.enqueue(input({ base64: 'A'.repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4) })),
    ).rejects.toThrow('8 MB');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('deduplicates rapid repeat captures across restarts but accepts fresh observations later', async () => {
    const first = make();
    const entry = await first.capture.enqueue(input());
    clock += 1000;
    expect(await first.capture.enqueue(input())).toEqual(entry);
    expect(first.recognize).toHaveBeenCalledOnce();
    expect(first.onQueued).toHaveBeenCalledOnce();
    await first.capture.remove(entry.id);
    const second = make();
    await second.capture.start();
    await expect(second.capture.enqueue(input())).rejects.toThrow('already reviewed');
    expect(second.recognize).not.toHaveBeenCalled();
    clock += 30_000;
    const fresh = await second.capture.enqueue(input());
    expect(fresh.id).not.toBe(entry.id);
    expect(fresh.capturedAt).toBe(clock);
    expect(second.recognize).toHaveBeenCalledOnce();
  });

  it('does not confuse identical images assigned to different game accounts', async () => {
    const { capture, recognize } = make();
    await capture.enqueue(input());
    await capture.enqueue(input({ gameId: 'genshin-second-account' }));
    expect(capture.status().count).toBe(2);
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it('serializes OCR, rejects repeat hotkeys and drains active work before stopping', async () => {
    let finish;
    const recognize = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { capture } = make({ recognize });
    const first = capture.enqueue(input());
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    await expect(capture.enqueue(input({ base64: png(2) }))).rejects.toMatchObject({ status: 409 });
    let stopped = false;
    const drain = capture.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish({ text: 'Battery Charge 100 / 240' });
    await first;
    await drain;
    expect(capture.status().count).toBe(1);
    await expect(capture.enqueue(input({ base64: png(2) }))).rejects.toMatchObject({ status: 503 });
    await capture.start();
    expect(capture.pending()).toHaveLength(1);
  });

  it('enforces the inbox bound without dropping captures and resumes after review', async () => {
    const { capture, recognize } = make();
    for (let value = 0; value < 20; value += 1) await capture.enqueue(input({ base64: png(value) }));
    await expect(capture.enqueue(input({ base64: png(30) }))).rejects.toThrow('inbox is full');
    expect(recognize).toHaveBeenCalledTimes(20);
    expect(capture.pending()).toHaveLength(20);
    await capture.remove(capture.pending()[0].id);
    await capture.enqueue(input({ base64: png(30) }));
    expect(capture.pending()).toHaveLength(20);
    expect(capture.status().error).toBeUndefined();
  });

  it('recovers from OCR failure without marking the image as seen', async () => {
    const recognize = vi
      .fn()
      .mockRejectedValueOnce(new Error('Text recognition is unavailable.'))
      .mockResolvedValueOnce({ text: '120 / 200' });
    const { capture } = make({ recognize });
    await expect(capture.enqueue(input())).rejects.toThrow('unavailable');
    expect(capture.status()).toEqual({ count: 0, busy: false, error: 'Text recognition is unavailable.' });
    await capture.enqueue(input());
    expect(capture.pending()[0].text).toBe('120 / 200');
  });

  it('rejects excessive OCR output but retains unreadable empty captures for manual review', async () => {
    const recognize = vi
      .fn()
      .mockResolvedValueOnce({ text: 'x'.repeat(20_001) })
      .mockResolvedValueOnce({ text: '' });
    const { capture } = make({ recognize });
    await expect(capture.enqueue(input())).rejects.toThrow('too much text');
    await capture.enqueue(input());
    expect(capture.pending()[0].text).toBe('');
  });

  it('keeps a corrupt saved inbox untouched instead of overwriting it', async () => {
    await mkdir(path.join(directory, 'capture'));
    const filename = path.join(directory, 'capture', 'state.json');
    await writeFile(filename, '{broken');
    const { capture, recognize } = make();
    await expect(capture.start()).rejects.toThrow('saved file was kept');
    await expect(capture.enqueue(input())).rejects.toThrow('saved file was kept');
    expect(recognize).not.toHaveBeenCalled();
    expect(await readFile(filename, 'utf8')).toBe('{broken');
  });

  it('does not announce or retain a capture when durable storage fails', async () => {
    const recognize = vi.fn(async () => {
      // Block the save after the original inbox check and successful recognition.
      await writeFile(path.join(directory, 'capture'), 'blocked directory');
      return { text: 'Original Resin 120 / 200' };
    });
    const { capture, onQueued } = make({ recognize });
    await expect(capture.enqueue(input())).rejects.toThrow();
    expect(recognize).toHaveBeenCalledOnce();
    expect(capture.pending()).toEqual([]);
    expect(onQueued).not.toHaveBeenCalled();
  });

  it('preserves the capture even if a host notification callback fails', async () => {
    const { capture } = make({
      onQueued: () => {
        throw new Error('notification failed');
      },
    });
    await expect(capture.enqueue(input())).resolves.toMatchObject({ text: 'Original Resin 120 / 200' });
    expect(capture.pending()).toHaveLength(1);
  });
});
