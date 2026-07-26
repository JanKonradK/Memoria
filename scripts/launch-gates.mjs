import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkConfig } from './check-config.mjs';

const root = resolve(import.meta.dirname, '..');

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
  'Configure production Clerk, D1, secrets, GitHub environment, DNS, and TLS.',
  'Run account export/deletion, D1 restore, migration failure, key rotation, Clerk outage, and alert-sweep drills.',
  'Enable Workers Logs/Traces, uptime checks, cron-sweep alerts, auth/sync/error alerts, and the public status page.',
  'Obtain legal review for Privacy, Terms, retention and subprocessors.',
  'Record mobile Lighthouse scores: performance ≥90; accessibility, best practices, and PWA ≥95.',
  'Record pre-launch production sync p95 and agree the production SLO.',
  'Verify fair-use limits and cost alerts before announcing registration.',
  'Tag the approved release, deploy with manual production approval, and complete post-deploy verification.',
];

console.log('Void automated launch gates\n');
for (const [name, step] of automated) {
  console.log(`\n== ${name} ==`);
  step();
}

const auth = read('app/src/auth.tsx');
console.log('\n== deployment configuration ==');
const configIssues = checkConfig({ strict: false });
const legalReviewPresent = auth.includes('legal review');
if (legalReviewPresent) {
  console.warn('\nLegal-review marker is still present in app/src/auth.tsx.');
} else {
  console.log('\nNo legal-review marker found.');
}

console.log('\nManual launch gates still required before public registration:');
for (const item of manual) console.log(`  - ${item}`);
if (configIssues.length > 0 || legalReviewPresent) {
  console.error('\nAutomated launch gates failed.');
  process.exitCode = 1;
} else {
  console.log('\nAutomated launch gates passed.');
}
