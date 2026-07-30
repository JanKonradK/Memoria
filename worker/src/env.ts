export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: 'local' | 'production';
  ALLOWED_ORIGINS: string;
  CLERK_FRONTEND_API: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  SYNC_TOKEN?: string;
}
