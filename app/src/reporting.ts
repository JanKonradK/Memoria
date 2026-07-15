import { authHeaders, isHostedSession } from './auth-session';

export async function reportClientError(error: Error, context = ''): Promise<void> {
  if (!isHostedSession() || !navigator.onLine) return;
  await fetch('/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      message: context ? `${context}: ${error.message}` : error.message,
      stack: error.stack ?? '',
      build: import.meta.env.VITE_APP_VERSION ?? 'development',
    }),
  }).catch(() => undefined);
}
