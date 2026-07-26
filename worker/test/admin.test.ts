import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const retiredAdminPaths = ['/api/admin/migrate-legacy', '/api/admin/rotate-secrets'];
const headerVariants: Record<string, string>[] = [
  {},
  { 'x-admin-migration-key': 'former-admin-key' },
  {
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    'x-admin-migration-key': 'former-admin-key',
  },
  { origin: 'https://evil.example' },
];

describe('retired admin endpoints', () => {
  for (const path of retiredAdminPaths) {
    it(`${path} returns 404 regardless of request headers`, async () => {
      for (const headers of headerVariants) {
        const response = await app.request(path, { method: 'POST', headers }, env);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'not_found' });
      }
    });
  }
});
