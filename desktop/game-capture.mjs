import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recognizeScreenshot } from './screenshot-ocr.mjs';

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_TEXT = 20_000;
const MAX_PENDING = 20;
const MAX_SEEN = 200;
const MAX_STATE = 3_000_000;
const DEDUP_WINDOW = 30_000;
const GAME_ID = /^[\w-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cleanText = (value, max) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  ![...value].some((letter) => letter.charCodeAt(0) < 32);
const copy = (value) => structuredClone(value);

function metadata(input, now) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['base64', 'mimeType', 'gameId', 'gameName', 'sourceName', 'capturedAt'].includes(key),
    ) ||
    (input.gameId !== undefined && (typeof input.gameId !== 'string' || !GAME_ID.test(input.gameId))) ||
    (input.gameName !== undefined && (!input.gameId || !cleanText(input.gameName, 200))) ||
    !cleanText(input.sourceName, 255) ||
    !Number.isFinite(input.capturedAt) ||
    input.capturedAt <= 0 ||
    input.capturedAt > now ||
    now - input.capturedAt > 5 * 60_000
  )
    throw fail('Capture a game window again. Its game, name, or capture time was invalid.');
  return {
    ...(input.gameId === undefined ? {} : { gameId: input.gameId }),
    ...(input.gameName === undefined ? {} : { gameName: input.gameName }),
    name: input.sourceName,
    capturedAt: input.capturedAt,
  };
}

function imageBytes(input) {
  if (
    !['image/png', 'image/jpeg'].includes(input.mimeType) ||
    typeof input.base64 !== 'string' ||
    !input.base64 ||
    input.base64.length > Math.ceil(MAX_IMAGE / 3) * 4 ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw fail('Capture a PNG or JPEG image smaller than 8 MB.');
  const bytes = Buffer.from(input.base64, 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!bytes.length || bytes.length > MAX_IMAGE || (input.mimeType === 'image/png' ? !png : !jpeg))
    throw fail('The captured image is invalid. Capture the game window again.');
  return bytes;
}

function savedState(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.pending) ||
    !Array.isArray(value.seen) ||
    value.pending.length > MAX_PENDING ||
    value.seen.length > MAX_SEEN
  )
    throw fail('state');
  const ids = new Set();
  const pending = value.pending.map((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !GAME_ID.test(item.id) ||
      ids.has(item.id) ||
      (item.gameId !== undefined && (typeof item.gameId !== 'string' || !GAME_ID.test(item.gameId))) ||
      (item.gameName !== undefined && (!item.gameId || !cleanText(item.gameName, 200))) ||
      !cleanText(item.name, 255) ||
      typeof item.text !== 'string' ||
      item.text.length > MAX_TEXT ||
      !Number.isFinite(item.detectedAt) ||
      item.detectedAt <= 0 ||
      !Number.isFinite(item.capturedAt) ||
      item.capturedAt <= 0 ||
      item.capturedAt > item.detectedAt
    )
      throw fail('state');
    ids.add(item.id);
    return {
      id: item.id,
      ...(item.gameId === undefined ? {} : { gameId: item.gameId }),
      ...(item.gameName === undefined ? {} : { gameName: item.gameName }),
      name: item.name,
      text: item.text,
      capturedAt: item.capturedAt,
      detectedAt: item.detectedAt,
    };
  });
  const seen = value.seen.map((item) => {
    if (
      !item ||
      (item.gameId !== undefined && (typeof item.gameId !== 'string' || !GAME_ID.test(item.gameId))) ||
      !HASH.test(item.hash || '') ||
      typeof item.id !== 'string' ||
      !GAME_ID.test(item.id) ||
      !Number.isFinite(item.capturedAt) ||
      item.capturedAt <= 0
    )
      throw fail('state');
    return {
      ...(item.gameId === undefined ? {} : { gameId: item.gameId }),
      hash: item.hash,
      id: item.id,
      capturedAt: item.capturedAt,
    };
  });
  return { version: 1, pending, seen };
}

/**
 * User-triggered, local screenshot inbox. The native host captures an explicitly
 * selected window and supplies its capture instant. Only OCR text is retained.
 * Recognition never changes a game reading: each entry needs in-app review.
 */
export function createGameCapture({
  dataDir,
  recognize = recognizeScreenshot,
  onQueued = () => {},
  now = Date.now,
} = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw fail('A local data directory is required.');
  const storageDir = path.join(dataDir, 'capture');
  const stateFile = path.join(storageDir, 'state.json');
  let state = { version: 1, pending: [], seen: [] };
  let loaded = false;
  let busy = false;
  let stopped = false;
  let error;
  let operation = Promise.resolve();
  let recognition;
  const serial = (fn) => {
    const result = operation.then(fn, fn);
    operation = result.catch(() => {});
    return result;
  };
  const status = () => ({ count: state.pending.length, busy, ...(error ? { error } : {}) });

  async function persist(next) {
    const temporary = path.join(storageDir, `${randomUUID()}.tmp`);
    try {
      await mkdir(storageDir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, stateFile);
      state = next;
    } catch {
      throw fail('The screenshot inbox could not be saved. Check free disk space and try again.', 503);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async function load() {
    if (loaded) return;
    try {
      const stat = await lstat(stateFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE) throw fail('state');
      state = savedState(JSON.parse(await readFile(stateFile, 'utf8')));
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw fail('The screenshot inbox could not be read. Your saved file was kept.', 503);
    }
    loaded = true;
  }

  async function enqueue(input) {
    if (stopped) throw fail('Open Memoria before capturing a game window.', 503);
    if (busy) throw fail('The previous capture is still being read. Try the shortcut again in a moment.', 409);
    const details = metadata(input, now());
    const bytes = imageBytes(input);
    const mimeType = input.mimeType;
    busy = true;
    error = undefined;
    try {
      await serial(load);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const duplicate = state.seen.find(
        (item) =>
          item.gameId === details.gameId &&
          item.hash === hash &&
          Math.abs(item.capturedAt - details.capturedAt) < DEDUP_WINDOW,
      );
      if (duplicate) {
        const pending = state.pending.find((item) => item.id === duplicate.id);
        if (pending) return copy(pending);
        throw fail('This screenshot was already reviewed. Capture a changed game screen.', 409);
      }
      if (state.pending.length >= MAX_PENDING)
        throw fail('The screenshot inbox is full. Review captures to continue.', 409);
      const result = await recognize({ base64: bytes.toString('base64'), mimeType });
      if (typeof result?.text !== 'string' || result.text.length > MAX_TEXT)
        throw fail('The capture contains too much text. Choose a smaller game window and try again.');
      const entry = {
        id: randomUUID(),
        ...details,
        text: result.text,
        detectedAt: Math.max(now(), details.capturedAt),
      };
      await serial(async () => {
        await persist({
          ...state,
          pending: [...state.pending, entry],
          seen: [
            ...state.seen,
            {
              ...(details.gameId === undefined ? {} : { gameId: details.gameId }),
              hash,
              id: entry.id,
              capturedAt: entry.capturedAt,
            },
          ].slice(-MAX_SEEN),
        });
      });
      try {
        onQueued(copy(entry));
      } catch {
        // A host notification failure must not discard a saved capture.
      }
      return copy(entry);
    } catch (cause) {
      error = cause.message || 'The capture could not be read.';
      throw cause;
    } finally {
      busy = false;
    }
  }

  return {
    start: () =>
      serial(async () => {
        await load();
        stopped = false;
        return status();
      }),
    enqueue: (input) => {
      const alreadyBusy = busy;
      const current = enqueue(input);
      if (!alreadyBusy) recognition = current;
      // Keep a handled drain promise without changing the result seen by callers.
      void current
        .finally(() => {
          if (recognition === current) recognition = undefined;
        })
        .catch(() => {});
      return current;
    },
    status,
    pending: () => copy(state.pending),
    remove: (id) =>
      serial(async () => {
        if (typeof id !== 'string' || !GAME_ID.test(id)) throw fail('Choose a capture from the inbox.');
        await load();
        await persist({ ...state, pending: state.pending.filter((item) => item.id !== id) });
        error = undefined;
        return status();
      }),
    stop: async () => {
      stopped = true;
      await recognition?.catch(() => {});
      await operation;
    },
  };
}
