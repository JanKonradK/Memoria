import { describe, expect, it } from 'vitest';
import { encodePairingCode, parsePairingCode } from '../src/pairing';

describe('phone connection codes', () => {
  it('round trips private addresses and a single-use code without credentials', () => {
    const text = encodePairingCode(['192.168.1.20', 'http://10.0.0.2:17820', '192.168.1.20'], '01234567');
    expect(parsePairingCode(text)).toEqual({
      kind: 'memoria-pair',
      version: 1,
      addresses: ['http://192.168.1.20:17820', 'http://10.0.0.2:17820'],
      code: '01234567',
    });
    expect(text).not.toContain('token');
  });
  it('rejects unrelated QR codes, newer formats, credentials and nonlocal destinations', () => {
    const base = { kind: 'memoria-pair', version: 1, addresses: ['http://192.168.1.20:17820'], code: '12345678' };
    for (const value of [
      'https://example.com',
      'null',
      'x'.repeat(2049),
      JSON.stringify({ ...base, version: 2 }),
      JSON.stringify({ ...base, code: '1234567é' }),
      JSON.stringify({ ...base, addresses: [] }),
      ...[
        'https://example.com',
        'http://127.0.0.1',
        'http://user:password@192.168.1.2',
        'http://192.168.1.2/pair',
        'http://192.168.1.2?code=1',
        'http://192.168.1.256',
        'http://192.168.01.2',
        'http://192.168.1.2:0',
        'http://192.168.1.2:65536',
      ].map((address) => JSON.stringify({ ...base, addresses: [address] })),
      JSON.stringify({ ...base, addresses: Array(9).fill('192.168.1.2') }),
    ])
      expect(() => parsePairingCode(value)).toThrow('not a Memoria connection code');
  });
});
