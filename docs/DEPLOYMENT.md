# Deployment

Techno's Library uses one Cloudflare Worker for the Hono API and static PWA assets. Staging and production must use different
Clerk instances, D1 databases, Queues, secrets, origins, and GitHub environments.

## Provision each environment

1. Create `technogg-staging` and `technogg-production` D1 databases. Replace the placeholder IDs in
   `worker/wrangler.jsonc`.
2. Create the staging/production alert queues and dead-letter queues named in `worker/wrangler.jsonc`.
3. Replace `staging.example.invalid` and `app.example.invalid` with canonical origins.
4. Create separate Clerk development/staging and production applications. Configure the matching origins and account
   deletion behavior.
5. Generate a 32-byte encryption key for each environment:

   ```sh
   openssl rand -base64 32
   ```

6. Store `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `MASTER_KEY`, and
   `ADMIN_MIGRATION_KEY` with `wrangler secret put --env <environment>`. Never put values in GitHub variables or the
   Wrangler file.
7. Configure GitHub environments named `staging` and `production`:
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - variables: `CLERK_PUBLISHABLE_KEY`, `DEPLOY_ORIGIN`
   - production: require manual approval.

## First deployment

```sh
npm ci
npm run check
npm -w worker run db:migrate:staging
npm run deploy:staging
```

Verify `/api/health`, `/api/ready`, sign-up, local-data migration, cross-device sync, integration connect/revoke, export,
and account deletion before production promotion. Production deploys only from a `v*` tag or an approved manual run.

## Legacy document migration

`POST /api/admin/migrate-legacy` is hidden unless `x-admin-migration-key` matches `ADMIN_MIGRATION_KEY`. Call once with
`{"userId":"user_...","apply":false}` to preview, then repeat with `"apply":true`. Rotate or delete the migration
secret afterward. The legacy table is retained for recovery until the post-launch retention decision.
