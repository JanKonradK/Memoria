# Launch checklist

No public registration until every item is evidenced in a production pre-launch verification.

- [ ] Replace all placeholder D1 IDs, origins, domains, and contacts.
- [ ] Configure production Clerk, D1, secrets, GitHub environment, DNS, and TLS.
- [ ] Pass CI, dependency audit, tenant-isolation tests, responsive/keyboard/axe journeys, and production smoke tests.
- [ ] Confirm account exports contain planner data only and no retired channel fields.
- [ ] Run account export/deletion, D1 restore, migration failure, and Clerk outage drills.
- [ ] Enable Workers Logs/Traces, uptime checks, retention-job monitoring, auth/sync/error alerts, and the public status page.
- [ ] Record mobile Lighthouse scores: performance ≥90; accessibility, best practices, and PWA ≥95.
- [ ] Record pre-launch production sync p95 and agree the production SLO.
- [ ] Verify fair-use limits and cost alerts before announcing registration.
- [ ] Tag the approved release, deploy with manual production approval, and complete post-deploy verification.
