# Security and data lifecycle

## Trust boundaries

- Clerk owns identity and sessions. The Worker validates every hosted API request and restricts the token's authorized
  party to the configured environment origins.
- Every D1 document, credential, alert ledger, export, deletion, and scheduled job is keyed by the authenticated Clerk
  user ID. Browser-supplied user IDs are never accepted.
- Planner state is validated, size-limited, schema-versioned, and merged with optimistic compare-and-swap retries.
- Discord webhooks and Telegram credentials are stored only in `user_secrets`, encrypted using
  AES-256-GCM with a Worker secret. Raw values are not returned by status, sync, export, or log endpoints.

## Retention

- Planner documents remain until account deletion.
- Tombstones are compacted after 90 days; alert delivery deduplication expires after 60 days.
- Browser error reports and audit records require an operator-defined retention job before public launch.
- Normal exports contain planner data and masked integration status, never credentials.

## Deletion

The authenticated account deletion route removes the tenant document, encrypted credentials, and alert ledger, marks
the local audit identity deleted, and removes the Clerk user. The browser clears IndexedDB and local integration data
after the API succeeds.

## Reporting vulnerabilities

Add the operator security contact and disclosure policy before opening registration. Do not include tokens, cookies, or
personal planner data in a report.
