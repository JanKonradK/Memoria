import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** A loopback port nothing is listening on, from the candidates in order. */
export async function freePort(candidates = [0]) {
  for (const candidate of candidates) {
    const probe = createServer();
    probe.listen(candidate, '127.0.0.1');
    try {
      await once(probe, 'listening');
    } catch (error) {
      if (error.code === 'EADDRINUSE') continue;
      throw error;
    }
    const { port } = probe.address();
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    return port;
  }
  throw new Error('No test launcher port is available');
}

/** Builds the development Rust host and returns its path. */
export function buildNativeHost() {
  const built = spawnSync('cargo', ['build', '--manifest-path', join(root, 'native', 'Cargo.toml')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('cargo could not build native/. Install Rust from https://rustup.rs');
  return join(root, 'native', 'target', 'debug', 'memoria-desktop.exe');
}

/** The environment that keeps a test host off the ports and data of a running Memoria. */
export async function isolatedHostEnv({ appdata, install, ports = [0] }) {
  return {
    ...process.env,
    APPDATA: appdata,
    ...(install ? { MEMORIA_ROOT: install } : {}),
    // The built app accepts only its own launcher origins, so a test that
    // loads it passes those ports. Other tests take any free port.
    MEMORIA_TEST_PORT: String(await freePort(ports)),
    MEMORIA_TEST_LAN_PORT: String(await freePort()),
  };
}

/** Waits for `--headless` to print its one-use launch URL. */
export function launchUrlFrom(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`The test host exited early: ${errors}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/api\/launch\/[A-Za-z0-9_-]{43}/);
      if (match) resolve(match[0]);
    });
  });
}

/**
 * Starts the Rust host with no window and signs in as its window would.
 * `api(path, body)` calls the launcher API with that session.
 */
export async function startHeadlessHost({ binary, env, cwd }) {
  const child = spawn(binary, ['--headless'], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await launchUrlFrom(child);
    const origin = new URL(url).origin;
    const html = await (await fetch(url)).text();
    const token = JSON.parse(html.match(/const token = ("[A-Za-z0-9_-]{43}");/)[1]);
    const api = async (path, body) => {
      const response = await fetch(`${origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          origin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const answer = await response.json();
      if (!response.ok) throw new Error(`${path}: ${response.status} ${answer.error}`);
      return answer;
    };
    const stop = async () => {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    };
    return { child, url, origin, api, stop };
  } catch (error) {
    child.kill();
    throw error;
  }
}
