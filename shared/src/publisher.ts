import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const PUBLISHER_KEY = '7dd4999088b64d4f5a446440f4ba6f2581154b11d9d3dc991ccf45e130e9a9c6';
export const FEED_CONTEXT = 'memoria-event-feed-v1';
export const RELEASE_CONTEXT = 'memoria-release-v1';
export type SignedFile = { payload: string; signature: string };
export type TrustStamp = { sequence: number; digest: string };
export type ReleaseManifest = {
  version: string;
  tag: string;
  files: Record<string, string>;
  windows: Record<string, string>;
};
const utf8 = new TextEncoder();

/** Sign exact UTF-8 bytes, rather than relying on JSON property ordering. */
export function verifyPublished<T>(
  envelope: unknown,
  context: string,
  previous?: TrustStamp | null,
  publicKey = PUBLISHER_KEY,
): { data: T; stamp: TrustStamp } {
  try {
    const file = envelope as SignedFile;
    if (typeof file?.payload !== 'string' || typeof file.signature !== 'string' || file.payload.length > 2_000_000)
      throw new Error();
    const bytes = Uint8Array.from(atob(file.payload), (c) => c.charCodeAt(0));
    if (!ed25519.verify(hexToBytes(file.signature), bytes, hexToBytes(publicKey), { zip215: false })) throw new Error();
    const signed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      signed.context !== context ||
      !Number.isSafeInteger(signed.sequence) ||
      signed.sequence < 1793836800000 ||
      signed.sequence > Date.now() + 300_000
    )
      throw new Error();
    const stamp = { sequence: signed.sequence, digest: bytesToHex(sha256(bytes)) };
    if (
      previous &&
      (stamp.sequence < previous.sequence || (stamp.sequence === previous.sequence && stamp.digest !== previous.digest))
    )
      throw new Error('This signed file is older than the last accepted publication.');
    return { data: signed.data as T, stamp };
  } catch (error) {
    if (error instanceof Error && error.message.includes('older than')) throw error;
    throw new Error('Publisher signature is missing or invalid. Kept saved data.');
  }
}

export function publisherFingerprint(): string {
  return bytesToHex(sha256(hexToBytes(PUBLISHER_KEY)));
}
export function signedBytes(context: string, sequence: number, data: unknown): Uint8Array {
  return utf8.encode(JSON.stringify({ context, sequence, data }));
}
