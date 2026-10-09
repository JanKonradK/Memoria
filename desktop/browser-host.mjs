import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BROWSER_MESSAGE_LIMIT,
  BROWSER_ORIGIN,
  browserRequestHeaders,
  browserSnapshotStatus,
  publishBrowserSnapshot,
} from './browser-bridge.mjs';

export function encodeNativeMessage(value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  if (data.length > BROWSER_MESSAGE_LIMIT) throw new Error('The browser message is too large.');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length);
  return Buffer.concat([header, data]);
}
export async function runBrowserHost({
  input = process.stdin,
  output = process.stdout,
  origin = process.argv[2],
  directory = join(process.env.APPDATA ?? '', 'memoria'),
} = {}) {
  if (origin !== BROWSER_ORIGIN) throw new Error('This connector only accepts the Memoria browser extension.');
  if (!process.env.APPDATA && directory === join('', 'memoria')) throw new Error('Windows app data is unavailable.');
  let buffer = Buffer.alloc(0);
  let expected;
  for await (const chunk of input) {
    if (buffer.length + chunk.length > BROWSER_MESSAGE_LIMIT + 4) throw new Error('The browser message is too large.');
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (expected == null) {
        if (buffer.length < 4) break;
        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
        if (!expected || expected > BROWSER_MESSAGE_LIMIT)
          throw new Error('The browser message is invalid or too large.');
      }
      if (buffer.length < expected) break;
      const frame = buffer.subarray(0, expected);
      buffer = buffer.subarray(expected);
      expected = undefined;
      let response;
      try {
        const message = JSON.parse(frame.toString('utf8'));
        if (message?.action === 'headers') response = browserRequestHeaders(message);
        else if (message?.action === 'publish') response = await publishBrowserSnapshot(directory, message.snapshot);
        else if (message?.action === 'status') response = { ok: true, ...browserSnapshotStatus(directory) };
        else throw new Error('Unknown browser connector action.');
      } catch (error) {
        // Errors are fixed host text. Never echo incoming publisher data or credentials.
        response = {
          ok: false,
          error: error instanceof SyntaxError ? 'The browser message is not valid JSON.' : error.message,
        };
      }
      await new Promise((resolveWrite, reject) =>
        output.write(encodeNativeMessage(response), (error) => (error ? reject(error) : resolveWrite())),
      );
    }
    if (buffer.length > BROWSER_MESSAGE_LIMIT) throw new Error('The browser message is too large.');
  }
  if (expected != null || buffer.length) throw new Error('The browser message was incomplete.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // Chromium owns stdout. Do not print diagnostics or sign-in details to either stream.
  void runBrowserHost().catch(() => {
    process.exitCode = 1;
  });
}
