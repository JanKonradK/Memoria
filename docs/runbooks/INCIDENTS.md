# Production incident runbook

## Triage

1. Freeze production promotions and record the start time/correlation IDs.
2. Check `/api/health`, `/api/ready`, Workers Logs/Traces, queue backlog/DLQ, D1 errors, Clerk status, and uptime checks.
3. Never paste raw user state or integration credentials into tickets or logs.

## Rollback

- Roll back Worker code to the prior tagged deployment from Cloudflare deployment history.
- D1 migrations are forward-only. Ship a numbered corrective migration; do not edit an applied migration.
- For destructive corruption, use D1 Time Travel to create/restore a known-good database, validate tenant counts and
  isolation, then update the binding during a maintenance window.
- Verify health, one staging test account, sync, queue delivery, and error rate after rollback.

## Clerk outage

Keep IndexedDB data usable. Hosted sync/integration controls should show retryable errors; do not bypass token
verification. Resume sync after Clerk recovers and watch conflict/latency metrics.

## Queue failure or replay

Pause the consumer if deliveries are harmful. Fix the cause, inspect redacted DLQ metadata, then replay bounded batches.
`user_alerts_sent` makes deliveries idempotent per user and dedupe key. Monitor retries and downstream rate limits.

## Master-key rotation

Set the new `MASTER_KEY`, increment `MASTER_KEY_VERSION`, and temporarily set `PREVIOUS_MASTER_KEY`. Deploy the dual-read
version, then repeatedly call `POST /api/admin/rotate-secrets` with `x-admin-migration-key` until it returns
`"complete":true`. Verify all rows have the current key version, remove `PREVIOUS_MASTER_KEY`, rotate the admin key, and
redeploy. The endpoint processes at most 100 rows and never logs plaintext.

## Suspected credential exposure

Revoke affected integrations, rotate the production master key, invalidate leaked Clerk/Cloudflare keys, preserve
redacted audit evidence, notify affected users as required, and document root cause and follow-up controls.
