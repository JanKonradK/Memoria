import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it("grants the PC window's commands to the app's own three ports only", () => {
  const root = resolve(__dirname, '../../desktop/tauri');
  const capability = JSON.parse(readFileSync(resolve(root, 'capabilities/main.json'), 'utf8')) as {
    remote: { urls: string[] };
  };
  const server = readFileSync(resolve(root, 'src/server.rs'), 'utf8');
  const ports = /PORTS: \[u16; 3\] = \[(\d+), (\d+), (\d+)\]/.exec(server)!.slice(1);
  expect(capability.remote.urls).toEqual(ports.map((port) => `http://127.0.0.1:${port}/*`));
});
