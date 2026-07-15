# Launch checklist

No public registration until every item is evidenced in staging.

- [ ] Replace all placeholder D1 IDs, origins, domains, contacts, and legal-review markers.
- [ ] Configure independent staging/production Clerk, D1, Queue, secrets, GitHub environments, DNS, and TLS.
- [ ] Pass CI, dependency audit, tenant-isolation tests, responsive/keyboard/axe journeys, and production smoke tests.
- [ ] Confirm no raw integration secret appears in sync JSON, exports, responses, browser reports, or Worker logs.
- [ ] Run account export/deletion, D1 restore, migration failure, key rotation, Clerk outage, and queue replay drills.
- [ ] Enable Workers Logs/Traces, uptime checks, queue/DLQ alerts, auth/sync/error alerts, and the public status page.
- [ ] Obtain legal review for Privacy, Terms, retention and subprocessors.
- [ ] Record mobile Lighthouse scores: performance ≥90; accessibility, best practices, and PWA ≥95.
- [ ] Record normal staging sync p95 and agree the production SLO.
- [ ] Complete a 72-hour staging soak with no unexplained sync, cron, queue, or notification failures.
- [ ] Verify fair-use limits and cost alerts before announcing registration.
- [ ] Tag the approved release, deploy with manual production approval, and complete post-deploy verification.
