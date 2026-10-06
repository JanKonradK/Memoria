import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const SCRIPT = fileURLToPath(new URL('./screenshot-ocr.ps1', import.meta.url));
let busy = false;

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function decodeImage(base64, mimeType) {
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) {
    throw failure('Choose a PNG or JPEG smaller than 8 MB.', 413);
  }
  let encoded = base64;
  if (encoded.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg));base64,/.exec(encoded);
    if (!match || (mimeType && mimeType !== match[1])) throw failure('Choose a PNG or JPEG image.');
    mimeType = match[1];
    encoded = encoded.slice(match[0].length);
  }
  if (mimeType && mimeType !== 'image/png' && mimeType !== 'image/jpeg') throw failure('Choose a PNG or JPEG image.');
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw failure('The screenshot data is invalid.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw failure('Choose an image smaller than 8 MB.', 413);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((!png && !jpeg) || (mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
    throw failure('The screenshot format does not match a PNG or JPEG image.');
  }
  return { bytes, extension: png ? '.png' : '.jpg' };
}

function runOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const child = spawn(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ImagePath', imagePath],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const decoder = new StringDecoder('utf8');
    let received = 0;
    let terminalError;
    const timeout = setTimeout(() => {
      terminalError = failure('Text recognition took too long. Crop the screenshot and try again.', 504);
      child.kill();
    }, 20_000);
    const collect = (chunk, stdout) => {
      received += chunk.length;
      if (received > MAX_OUTPUT) {
        terminalError = failure('The screenshot contains too much text. Crop it and try again.', 413);
        child.kill();
      } else if (stdout) output += decoder.write(chunk);
    };
    child.stdout.on('data', (chunk) => collect(chunk, true));
    child.stderr.on('data', (chunk) => collect(chunk, false));
    child.once('error', () => {
      clearTimeout(timeout);
      reject(failure('Windows text recognition could not start.', 503));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      output += decoder.end();
      if (terminalError) return reject(terminalError);
      let result;
      try {
        result = JSON.parse(output.replace(/^\uFEFF/, '').trim());
      } catch {
        /* Report a safe, useful error below. */
      }
      if (code !== 0 || typeof result?.text !== 'string') {
        return reject(
          failure(
            result?.error === 'NO_OCR_LANGUAGE'
              ? 'Install text recognition for a Windows language, then try again.'
              : 'Text could not be read. Try a clearer PNG or JPEG screenshot.',
            422,
          ),
        );
      }
      resolve({ text: result.text });
    });
  });
}

/** Screenshots stay on this PC. Only one Windows OCR process runs at a time. */
export async function recognizeScreenshot({ base64, mimeType } = {}) {
  if (process.platform !== 'win32') throw failure('Screenshot text recognition requires the Windows launcher.', 503);
  if (busy) throw failure('Finish the current screenshot first.', 409);
  const { bytes, extension } = decodeImage(base64, mimeType);
  busy = true;
  let directory;
  let imagePath;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'memoria-ocr-'));
    imagePath = path.join(directory, `screenshot${extension}`);
    await writeFile(imagePath, bytes, { flag: 'wx' });
    return await runOcr(imagePath);
  } finally {
    if (imagePath) await unlink(imagePath).catch(() => {});
    if (directory) await rmdir(directory).catch(() => {});
    busy = false;
  }
}
