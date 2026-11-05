import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyPublished, signedBytes, FEED_CONTEXT, RELEASE_CONTEXT } from '../src/publisher';

describe('publisher signatures', () => {
  it('rejects unsigned, modified, wrong-domain, replayed and conflicting publications', () => {
    const secret = new Uint8Array(32).fill(42);
    const publicKey = bytesToHex(ed25519.getPublicKey(secret));
    const sign = (sequence: number, data: unknown = { events: [] }) => {
      const bytes = signedBytes(FEED_CONTEXT, sequence, data);
      return { payload: btoa(String.fromCharCode(...bytes)), signature: bytesToHex(ed25519.sign(bytes, secret)) };
    };
    const sequence = Date.now();
    const file = sign(sequence);
    const { stamp } = verifyPublished(file, FEED_CONTEXT, null, publicKey);
    expect(verifyPublished(file, FEED_CONTEXT, stamp, publicKey).data).toEqual({ events: [] });
    expect(() => verifyPublished({}, FEED_CONTEXT, null, publicKey)).toThrow('signature');
    expect(() => verifyPublished({ ...file, payload: btoa('changed') }, FEED_CONTEXT, null, publicKey)).toThrow(
      'signature',
    );
    expect(() => verifyPublished(file, RELEASE_CONTEXT, null, publicKey)).toThrow('signature');
    expect(() => verifyPublished(sign(sequence - 1), FEED_CONTEXT, stamp, publicKey)).toThrow('older');
    expect(() => verifyPublished(sign(sequence, { events: ['changed'] }), FEED_CONTEXT, stamp, publicKey)).toThrow(
      'older',
    );
  });
});
