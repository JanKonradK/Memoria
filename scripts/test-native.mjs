// Tests the Rust desktop host: its unit and parity tests, then the launcher
// contract suite (native/test/launcher.test.mjs) against the built binary.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = join(root, 'native', 'Cargo.toml');
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('cargo', ['test', '--manifest-path', manifest]);
run('cargo', ['build', '--manifest-path', manifest]);
const binary = join(root, 'native', 'target', 'debug', `memoria-desktop${process.platform === 'win32' ? '.exe' : ''}`);
run('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.mjs', 'native/test'], {
  ...process.env,
  MEMORIA_NATIVE_BIN: binary,
});
