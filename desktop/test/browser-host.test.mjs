import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BROWSER_ORIGIN } from '../browser-bridge.mjs';
import { encodeNativeMessage, runBrowserHost } from '../browser-host.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
function fixture(chunks, origin = BROWSER_ORIGIN) {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-host-test-'));
  directories.push(directory);
  const output = [];
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      output.push(Buffer.from(chunk));
      callback();
    },
  });
  return { output, run: () => runBrowserHost({ input: Readable.from(chunks), output: writer, origin, directory }) };
}
function messages(output) {
  const bytes = Buffer.concat(output);
  const results = [];
  for (let index = 0; index < bytes.length;) {
    const length = bytes.readUInt32LE(index);
    index += 4;
    results.push(JSON.parse(bytes.subarray(index, index + length).toString('utf8')));
    index += length;
  }
  return results;
}
describe('browser native messaging host', () => {
  it('decodes fragmented UTF-8 frames and sends only framed JSON', async () => {
    const bytes = Buffer.concat([
      encodeNativeMessage({ action: 'status', text: '旅行者 🌟' }),
      encodeNativeMessage({ action: 'headers', kind: 'accounts', provider: 'genshin' }),
    ]);
    const { run, output } = fixture([...bytes].map((byte) => Buffer.from([byte])));
    await run();
    const result = messages(output);
    expect(result[0]).toEqual({ ok: true, receivedAt: null, accounts: 0 });
    expect(result[1].url).toContain('game_biz=hk4e_global');
  });
  it('rejects another origin before processing or writing', async () => {
    const { run, output } = fixture([encodeNativeMessage({ action: 'status' })], 'chrome-extension://other/');
    await expect(run()).rejects.toThrow('only accepts');
    expect(output).toEqual([]);
  });
  it('rejects an oversize declared frame before waiting for its body', async () => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(1_000_001);
    const { run, output } = fixture([bytes]);
    await expect(run()).rejects.toThrow('too large');
    expect(output).toEqual([]);
  });
  it('reports invalid JSON without echoing incoming text and detects truncated messages', async () => {
    const bad = Buffer.from('{private-unreadable');
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(bad.length);
    const { run, output } = fixture([Buffer.concat([bytes, bad])]);
    await run();
    expect(messages(output)).toEqual([{ ok: false, error: 'The browser message is not valid JSON.' }]);
    await expect(fixture([Buffer.from([5, 0, 0, 0, 123])]).run()).rejects.toThrow('incomplete');
  });
  it('uses the real CLI argv origin and emits no extra stdout or stderr', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'memoria-host-cli-'));
    directories.push(directory);
    const execute = (origin) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            new URL('../browser-host.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
            origin,
            '--parent-window=0',
          ],
          { env: { ...process.env, APPDATA: directory }, windowsHide: true, stdio: 'pipe' },
        );
        const output = [];
        let error = '';
        child.stdout.on('data', (chunk) => output.push(chunk));
        child.stderr.on('data', (chunk) => {
          error += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code) => resolve({ code, output, error }));
        child.stdin.end(encodeNativeMessage({ action: 'status' }));
      });
    const trusted = await execute(BROWSER_ORIGIN);
    expect(trusted.code).toBe(0);
    expect(trusted.error).toBe('');
    expect(messages(trusted.output)).toEqual([{ ok: true, receivedAt: null, accounts: 0 }]);
    const untrusted = await execute('chrome-extension://other/');
    expect(untrusted.code).toBe(1);
    expect(untrusted.output).toEqual([]);
    expect(untrusted.error).toBe('');
  });
  it.skipIf(process.platform !== 'win32')(
    'runs the Chromium .cmd host path with spaces using binary stdio',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'memoria browser cmd '));
      directories.push(directory);
      const desktop = join(directory, 'desktop');
      mkdirSync(desktop);
      mkdirSync(join(directory, 'node'));
      copyFileSync(process.execPath, join(directory, 'node', 'node.exe'));
      for (const file of ['browser-host.cmd', 'browser-host.mjs', 'browser-bridge.mjs'])
        copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(desktop, file));
      const result = await new Promise((resolve, reject) => {
        // Matches Chromium's COMSPEC /d /s /c fallback for non-.exe native hosts.
        const command = `""${join(desktop, 'browser-host.cmd')}" "${BROWSER_ORIGIN}" --parent-window=0"`;
        const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', command], {
          env: { ...process.env, APPDATA: directory },
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: 'pipe',
        });
        const output = [];
        let error = '';
        child.stdout.on('data', (chunk) => output.push(chunk));
        child.stderr.on('data', (chunk) => {
          error += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code) => resolve({ code, output, error }));
        child.stdin.end(encodeNativeMessage({ action: 'status' }));
      });
      expect(result.code).toBe(0);
      expect(result.error).toBe('');
      expect(messages(result.output)).toEqual([{ ok: true, receivedAt: null, accounts: 0 }]);
    },
  );
});
