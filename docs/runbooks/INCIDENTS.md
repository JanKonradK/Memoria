# Production incident runbook

## Triage

1. Freeze production promotions and record the start time/correlation IDs.
2. Check `/api/health`, `/api/ready`, Workers Logs/Traces, retention metrics, D1 errors, Clerk status, and uptime checks.
3. Never paste raw user state, session tokens, or personal data into tickets or logs.

## Rollback

- Roll back Worker code to the prior tagged deployment from Cloudflare deployment history.
- D1 migrations are forward-only. Ship a numbered corrective migration; do not edit an applied migration.
- For destructive corruption, use D1 Time Travel to create/restore a known-good database, validate tenant counts and
  isolation, then update the binding during a maintenance window.
- Verify health, one production test account, sync, scheduled retention, and error rate after rollback.

## Clerk outage

Keep IndexedDB data usable. Hosted sync controls should show retryable errors; do not bypass token verification.
Resume sync after Clerk recovers and watch conflict/latency metrics.

## Scheduled retention failure

If retention queries are harming database availability, disable the cron trigger, fix the cause, verify the retention
cutoffs against a restored database, and then restore the trigger. Monitor query failures and D1 latency.

## Suspected account-data exposure

Invalidate leaked Clerk or Cloudflare keys, preserve redacted audit evidence, restore affected data if needed, notify
affected users as required, and document root cause and follow-up controls.
