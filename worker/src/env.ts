export interface AlertJob {
  userId: string;
  requestedAt: number;
}

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ALERT_QUEUE: Queue<AlertJob>;
  APP_ENV: 'local' | 'staging' | 'production';
  ALLOWED_ORIGINS: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  MASTER_KEY: string;
  MASTER_KEY_VERSION: string;
  PREVIOUS_MASTER_KEY?: string;
  SYNC_TOKEN?: string;
  ADMIN_MIGRATION_KEY?: string;
}
