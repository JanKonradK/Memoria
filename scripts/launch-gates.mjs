import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const placeholders = [
  'staging.example.invalid',
  'app.example.invalid',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
];

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd: root, stdio: 'inherit', env: process.env });
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const automated = [
  ['lint/format/types/tests/build/pwa', () => run('npm run check')],
  ['browser accessibility and responsive journeys', () => run('npm run test:e2e')],
  ['high-severity dependency audit', () => run('npm run audit')],
  [
    'generated Cloudflare bindings',
    () => {
      run('npm run cf:types');
      run('git diff --exit-code -- worker/worker-env.d.ts');
    },
  ],
];

const manual = [
  'Replace placeholder D1 IDs, origins, domains, contacts, and legal-review markers.',
  'Configure independent staging/production Clerk, D1, Queue, secrets, GitHub environments, DNS, and TLS.',
  'Run account export/deletion, D1 restore, migration failure, key rotation, Clerk outage, and queue replay drills.',
  'Enable Workers Logs/Traces, uptime checks, queue/DLQ alerts, auth/sync/error alerts, and the public status page.',
  'Obtain legal review for Privacy, Terms, retention and subprocessors.',
  'Record mobile Lighthouse scores: performance ≥90; accessibility, best practices, and PWA ≥95.',
  'Record normal staging sync p95 and agree the production SLO.',
  'Complete a 72-hour staging soak with no unexplained sync, cron, queue, or notification failures.',
  'Verify fair-use limits and cost alerts before announcing registration.',
  'Tag the approved release, deploy with manual production approval, and complete post-deploy verification.',
];

console.log('TechnoGG automated launch gates\n');
for (const [name, step] of automated) {
  console.log(`\n== ${name} ==`);
  step();
}

const wrangler = read('worker/wrangler.jsonc');
const auth = read('app/src/auth.tsx');
const found = placeholders.filter((marker) => wrangler.includes(marker) || auth.includes('legal review'));
if (found.length > 0) {
  console.warn('\nPlaceholder markers still present (expected before first real deployment):');
  for (const marker of found) console.warn(`  - ${marker}`);
} else {
  console.log('\nNo known placeholder deployment markers found.');
}

console.log('\nManual launch gates still required before public registration:');
for (const item of manual) console.log(`  - ${item}`);
console.log('\nAutomated launch gates passed.');
