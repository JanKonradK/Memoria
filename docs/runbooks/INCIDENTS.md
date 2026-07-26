# Production incident runbook

## Triage

1. Freeze production promotions and record the start time/correlation IDs.
2. Check `/api/health`, `/api/ready`, Workers Logs/Traces, cron-sweep metrics, D1 errors, Clerk status, and uptime checks.
3. Never paste raw user state or integration credentials into tickets or logs.

## Rollback

- Roll back Worker code to the prior tagged deployment from Cloudflare deployment history.
- D1 migrations are forward-only. Ship a numbered corrective migration; do not edit an applied migration.
- For destructive corruption, use D1 Time Travel to create/restore a known-good database, validate tenant counts and
  isolation, then update the binding during a maintenance window.
- Verify health, one production test account, sync, scheduled alert delivery, and error rate after rollback.

## Clerk outage

Keep IndexedDB data usable. Hosted sync/integration controls should show retryable errors; do not bypass token
verification. Resume sync after Clerk recovers and watch conflict/latency metrics.

## Alert sweep failure

Disable the cron trigger if deliveries are harmful. Fix the cause, inspect redacted `alert.sweep.error` logs, then restore
the trigger. `alerts_checked_at` rotates work across ticks, while `user_alerts_sent` makes deliveries idempotent per user
and dedupe key. Monitor sweep failures and downstream rate limits.

## Master-key rotation

Set the new `MASTER_KEY`, increment `MASTER_KEY_VERSION`, and temporarily set `PREVIOUS_MASTER_KEY`. Deploy the dual-read
version, then run a reviewed one-off rotation through authenticated Cloudflare operator tooling with deployment and D1
audit trails. Verify all rows have the current key version, remove `PREVIOUS_MASTER_KEY`, and redeploy. Never mount a
public HTTP endpoint for key rotation.

## Suspected credential exposure

Revoke affected integrations, rotate the production master key, invalidate leaked Clerk/Cloudflare keys, preserve
redacted audit evidence, notify affected users as required, and document root cause and follow-up controls.
