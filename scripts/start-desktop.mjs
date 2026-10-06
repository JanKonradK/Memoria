import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import electron from 'electron';

// Electron-based terminals can inherit this flag. It must not turn the app
// executable into a Node command when a developer starts Memoria.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [resolve(import.meta.dirname, '../desktop/electron-main.mjs')], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
