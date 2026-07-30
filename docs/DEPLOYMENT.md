# Deployment

Void uses one Cloudflare Worker for the Hono API and static PWA assets. The repository keeps local
development configuration and one production environment to stay within the Cloudflare Free tier.

## Provision production

1. Create the `void-production` D1 database. Replace its placeholder ID in `worker/wrangler.jsonc`.
2. Replace `app.example.invalid` with the canonical production origin.
3. Create the production Clerk application. Configure the matching origin and account deletion behavior.
4. Set `CLERK_FRONTEND_API` in `worker/wrangler.jsonc` to the new Clerk custom domain, then update the matching
   `script-src` host in `app/public/_headers`; these values must stay in sync.
5. Store `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `CLERK_JWT_KEY` with
   `wrangler secret put --env production`. Never put values in GitHub variables or the Wrangler file.
6. Configure the GitHub environment named `production`:
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - variables: `CLERK_PUBLISHABLE_KEY`, `DEPLOY_ORIGIN`
   - require manual approval.

`npm run check:config` reports placeholder configuration without failing local or CI quality checks. The deploy workflow
runs it with `CHECK_CONFIG_STRICT=1`, so placeholders block migrations and deployment.

## First deployment

```sh
npm ci
npm run check
npm -w worker run db:migrate:production
npm run deploy:production
```

Verify `/api/health`, `/api/ready`, sign-up, local-data migration, cross-device sync, export, account deletion, and
scheduled operational retention before opening registration. Production deploys only from a `v*` tag or an approved
manual run.
