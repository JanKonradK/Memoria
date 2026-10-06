import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => mocks);
import { recognizeScreenshot } from '../screenshot-ocr.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
let child;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'process',
    new Proxy(process, { get: (target, key) => (key === 'platform' ? 'win32' : Reflect.get(target, key)) }),
  );
  mocks.mkdtemp.mockResolvedValue('temporary-ocr-directory');
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  mocks.rmdir.mockResolvedValue(undefined);
  child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => child.emit('close', 1));
  mocks.spawn.mockReturnValue(child);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(input = { base64: png, mimeType: 'image/png' }) {
  const result = recognizeScreenshot(input);
  // Temp-directory creation and the file write must finish before the process starts.
  await Promise.resolve();
  await Promise.resolve();
  return { result };
}

describe('local screenshot OCR', () => {
  it.each([
    { base64: 'not base64' },
    { base64: png, mimeType: 'image/jpeg' },
    { base64: png, mimeType: 'image/gif' },
    { base64: Buffer.from('not an image').toString('base64') },
    { base64: 'A'.repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 65) },
  ])('rejects invalid input without creating a file', async (input) => {
    await expect(recognizeScreenshot(input)).rejects.toThrow();
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('uses a hidden local process, preserves text and removes its temporary image', async () => {
    const { result } = await start({ base64: `data:image/png;base64,${png}` });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ text: 'Power 120 / 300\nTickets 4' })));
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ text: 'Power 120 / 300\nTickets 4' });
    const [, args, options] = mocks.spawn.mock.calls[0];
    expect(options.windowsHide).toBe(true);
    expect(options.shell).toBeUndefined();
    expect(args).toContain('-File');
    expect(args).toContain('-ImagePath');
    expect(mocks.unlink).toHaveBeenCalledWith(expect.stringContaining('screenshot.png'));
    expect(mocks.rmdir).toHaveBeenCalledWith('temporary-ocr-directory');
  });

  it('prevents concurrent processes and allows another import after failure', async () => {
    const first = await start();
    await expect(recognizeScreenshot({ base64: png })).rejects.toMatchObject({ status: 409 });
    child.stdout.emit('data', Buffer.from('{"error":"NO_OCR_LANGUAGE"}'));
    child.emit('close', 1);
    await expect(first.result).rejects.toThrow('Install text recognition');
    const second = await start();
    child.stdout.emit('data', Buffer.from('{"text":""}'));
    child.emit('close', 0);
    await expect(second.result).resolves.toEqual({ text: '' });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('preserves UTF-8 characters across process output chunks', async () => {
    const { result } = await start();
    const output = Buffer.from(JSON.stringify({ text: '原粋樹脂 120 / 200' }));
    for (const byte of output) child.stdout.emit('data', Buffer.from([byte]));
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ text: '原粋樹脂 120 / 200' });
  });

  it('kills a stalled engine after twenty seconds and cleans up', async () => {
    vi.useFakeTimers();
    const { result } = await start();
    const rejected = expect(result).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledOnce();
    expect(mocks.rmdir).toHaveBeenCalledOnce();
  });
});
