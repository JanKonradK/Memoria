import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error A plain build script without type declarations.
import { androidPolicy, withAndroidPolicy } from '../../scripts/android-csp.mjs';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const headers = readFileSync(resolve(__dirname, '../public/_headers'), 'utf8');

it('gives the Android page the web policy for scripts, as a meta tag, once', () => {
  const policy = androidPolicy(html) as string;
  const hashes = policy.match(/'sha256-[^']+'/g) ?? [];
  expect(hashes.length).toBeGreaterThan(0);
  for (const hash of hashes) expect(headers).toContain(hash);
  expect(policy).not.toContain("unsafe-inline' 'sha");
  expect(policy).toContain("object-src 'none'");
  const page = withAndroidPolicy(html) as string;
  expect(page.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  expect(withAndroidPolicy(page)).toBe(page);
});
