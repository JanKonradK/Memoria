// The publisher private key never belongs in the checkout or command output.
import { generateKeyPairSync, createPublicKey, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const file = resolve(process.env.MEMORIA_SIGNING_KEY_FILE || `${homedir()}/.memoria/publisher-key.pem`);
const repo = resolve(import.meta.dirname, '..');
const inside = relative(repo, file);
if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))
  throw new Error('Keep the private key outside the repository.');
if (existsSync(file)) throw new Error(`A key already exists at ${file}. It was not replaced.`);
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
if (process.platform === 'win32') {
  const result = spawnSync(
    'icacls',
    [file, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`],
    { windowsHide: true, stdio: 'pipe' },
  );
  if (result.status !== 0)
    throw new Error('Key created, but its ACL could not be restricted. Restrict access before use.');
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
console.log(`Private key file: ${file}`);
console.log(`Public key (hex): ${publicKey.toString('hex')}`);
console.log(`SHA-256 fingerprint: ${createHash('sha256').update(publicKey).digest('hex')}`);
