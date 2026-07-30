# Security and data lifecycle

## Trust boundaries

- Clerk owns identity and sessions. The Worker validates every hosted API request and restricts the token's authorized
  party to the configured environment origins.
- Every D1 document, export, deletion, and tenant-scoped operational query is keyed by the authenticated Clerk
  user ID. Browser-supplied user IDs are never accepted.
- Planner state is validated, size-limited, schema-versioned, and merged with optimistic compare-and-swap retries.
- The Worker has no notification-channel credential store or channel-management routes.

## Retention

- Planner documents remain until account deletion.
- Tombstones are compacted after 90 days.
- Browser error reports expire after 30 days and audit records after 180 days.
- Account exports contain planner data only.

## Deletion

The authenticated account deletion route removes the tenant document and tenant-scoped operational records, writes a
non-identifying deletion marker, and removes the Clerk user. The browser clears IndexedDB after the API succeeds.

## Reporting vulnerabilities

Add the operator security contact and disclosure policy before opening registration. Do not include tokens, cookies, or
personal planner data in a report.
