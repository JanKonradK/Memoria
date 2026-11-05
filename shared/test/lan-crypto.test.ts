import { expect, it } from 'vitest';
import { newDeviceKey, devicePublicKey, lanKeys, sealLan, openLan } from '../src/lan-crypto';

it('agrees on directional keys and rejects tampering, reflection and substituted identities', () => {
  const pcSecret = newDeviceKey(),
    phoneSecret = newDeviceKey();
  const pc = devicePublicKey(pcSecret),
    phone = devicePublicKey(phoneSecret);
  const a = lanKeys(pcSecret, phone, pc, phone),
    b = lanKeys(phoneSecret, pc, pc, phone);
  expect(a).toEqual(b);
  expect(a.request).not.toEqual(a.response);
  const packet = sealLan(b.request, '/pair', phone, 'ab'.repeat(32), { code: '12345678' });
  expect(openLan(a.request, '/pair', packet)).toEqual({ code: '12345678' });
  expect(packet.ciphertext).not.toContain('12345678');
  expect(() => openLan(a.request, '/sync', packet)).toThrow();
  expect(() => openLan(a.response, '/pair', packet)).toThrow();
  expect(() =>
    openLan(a.request, '/pair', {
      ...packet,
      ciphertext:
        (Number.parseInt(packet.ciphertext.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') +
        packet.ciphertext.slice(2),
    }),
  ).toThrow();
  const reply = sealLan(a.response, '/pair', pc, packet.challenge, { deviceId: 'paired' }, packet.nonce);
  expect(openLan(b.response, '/pair', reply, packet.nonce)).toEqual({ deviceId: 'paired' });
  expect(() => openLan(b.response, '/pair', reply, '00'.repeat(24))).toThrow();
  expect(() => lanKeys(phoneSecret, '00'.repeat(32), pc, phone)).toThrow();
});
