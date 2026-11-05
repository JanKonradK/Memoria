import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const PUBLISHER_KEY = '7dd4999088b64d4f5a446440f4ba6f2581154b11d9d3dc991ccf45e130e9a9c6';
export function signPublished(context, data, sequence = Date.now()) {
  if (process.env.CI && !process.env.MEMORIA_SIGNING_KEY)
    throw new Error('Add the MEMORIA_SIGNING_KEY Actions secret before releasing.');
  const pem =
    process.env.MEMORIA_SIGNING_KEY ||
    readFileSync(process.env.MEMORIA_SIGNING_KEY_FILE || join(homedir(), '.memoria/publisher-key.pem'), 'utf8');
  const key = createPrivateKey(pem);
  const publicHex = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  if (publicHex !== PUBLISHER_KEY) throw new Error('The signing key does not match the embedded publisher key.');
  const bytes = Buffer.from(JSON.stringify({ context, sequence, data }));
  return { payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('hex') };
}
export function readPublished(envelope, context) {
  const key = createPublicKey({
    key: Buffer.from(`302a300506032b6570032100${PUBLISHER_KEY}`, 'hex'),
    type: 'spki',
    format: 'der',
  });
  if (!verify(null, Buffer.from(envelope.payload, 'base64'), key, Buffer.from(envelope.signature, 'hex')))
    throw new Error('Invalid publisher signature.');
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64'));
  if (payload.context !== context) throw new Error('Wrong signing context.');
  return payload;
}
export function treeDigests(directory) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile())
        files[relative(directory, file).replaceAll('\\', '/')] = createHash('sha256')
          .update(readFileSync(file))
          .digest('hex');
      else throw new Error('Release trees cannot contain links.');
    }
  };
  walk(directory);
  return files;
}
export function signRelease(directory = resolve(import.meta.dirname, '../dist/release')) {
  const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json')));
  const windows = treeDigests(join(directory, 'Memoria'));
  const files = {};
  for (const name of ['Memoria-win-x64.zip', 'Memoria-android.apk', 'Memoria.html'])
    if (existsSync(join(directory, name)))
      files[name] = createHash('sha256')
        .update(readFileSync(join(directory, name)))
        .digest('hex');
  const target = join(directory, 'release-manifest.json');
  const previous = existsSync(target)
    ? readPublished(JSON.parse(readFileSync(target)), 'memoria-release-v1').sequence
    : 0;
  writeFileSync(
    target,
    JSON.stringify(
      signPublished(
        'memoria-release-v1',
        { version, tag: `v${version}`, files, windows },
        Math.max(Date.now(), previous + 1),
      ),
    ) + '\n',
  );
}
