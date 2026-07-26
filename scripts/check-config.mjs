import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wranglerPath = resolve(root, 'worker/wrangler.jsonc');
const placeholderDatabaseId = /^00000000-0000-0000-0000-00000000000\d$/;

export function findConfigIssues(wrangler = readFileSync(wranglerPath, 'utf8')) {
  const issues = [];
  const productionStart = wrangler.indexOf('"production"');
  const productionConfig = productionStart >= 0 ? wrangler.slice(productionStart) : '';
  if (!productionConfig) {
    issues.push('production environment configuration is missing');
  }
  const databaseIds = productionConfig.matchAll(/"database_id"\s*:\s*"([^"]*)"/g);
  for (const [, databaseId] of databaseIds) {
    const value = databaseId.trim();
    if (!value) {
      issues.push('database_id is empty');
    } else if (placeholderDatabaseId.test(value)) {
      issues.push(`database_id is still a placeholder: ${value}`);
    }
  }

  const origins = new Set(wrangler.match(/https?:\/\/[^",\s]*\.example\.invalid\b/g) ?? []);
  for (const origin of origins) {
    issues.push(`origin is still a placeholder: ${origin}`);
  }

  if (/"queues"\s*:/.test(wrangler)) {
    issues.push('Cloudflare Queues configuration is still present');
  }
  return issues;
}

export function checkConfig({ strict = process.env.CHECK_CONFIG_STRICT === '1' } = {}) {
  const issues = findConfigIssues();
  if (issues.length === 0) {
    console.log('Cloudflare configuration check passed.');
    return issues;
  }

  console.warn(`Cloudflare configuration check found ${issues.length} issue(s):`);
  for (const issue of issues) console.warn(`  - ${issue}`);
  if (strict) {
    console.error('Strict configuration check failed.');
    process.exitCode = 1;
  } else {
    console.warn('Warning only; set CHECK_CONFIG_STRICT=1 to block deployment.');
  }
  return issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkConfig();
}
