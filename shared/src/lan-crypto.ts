import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

const text = new TextEncoder();
export const newDeviceKey = () => bytesToHex(x25519.utils.randomSecretKey());
export const devicePublicKey = (secret: string) => bytesToHex(x25519.getPublicKey(hexToBytes(secret)));
export const deviceFingerprint = (publicKey: string) => bytesToHex(sha256(hexToBytes(publicKey)));
export type LanPacket = { publicKey: string; challenge: string; nonce: string; ciphertext: string };
export type LanKeys = { request: Uint8Array; response: Uint8Array };

/** Bind both identities and each direction into the key derivation. */
export function lanKeys(secret: string, peer: string, pc: string, phone: string): LanKeys {
  const shared = x25519.getSharedSecret(hexToBytes(secret), hexToBytes(peer));
  const salt = sha256(text.encode(`memoria-lan-v2\n${pc}\n${phone}`));
  return {
    request: hkdf(sha256, shared, salt, text.encode('request'), 32),
    response: hkdf(sha256, shared, salt, text.encode('response'), 32),
  };
}
function aad(path: string, challenge: string, replyTo: string) {
  return text.encode(`memoria-lan-v2\n${path}\n${challenge}\n${replyTo}`);
}
export function sealLan(
  key: Uint8Array,
  path: string,
  publicKey: string,
  challenge: string,
  data: unknown,
  replyTo = '',
): LanPacket {
  const nonce = randomBytes(24);
  return {
    publicKey,
    challenge,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(
      xchacha20poly1305(key, nonce, aad(path, challenge, replyTo)).encrypt(text.encode(JSON.stringify(data))),
    ),
  };
}
export function openLan(key: Uint8Array, path: string, packet: LanPacket, replyTo = ''): Record<string, unknown> {
  if (
    !/^[a-f0-9]{48}$/.test(packet.nonce) ||
    !/^[a-f0-9]{64}$/.test(packet.challenge) ||
    !/^(?:[a-f0-9]{2}){16,}$/.test(packet.ciphertext)
  )
    throw new Error('Invalid encrypted sync packet.');
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      xchacha20poly1305(key, hexToBytes(packet.nonce), aad(path, packet.challenge, replyTo)).decrypt(
        hexToBytes(packet.ciphertext),
      ),
    ),
  );
}
