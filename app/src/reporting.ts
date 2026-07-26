import { authHeaders, isHostedSession } from './auth-session';

const MAX_REPORTS_PER_PAGE = 5;
const reportedMessages = new Set<string>();

export async function reportClientError(error: Error, context = ''): Promise<void> {
  if (!isHostedSession() || !navigator.onLine) return;
  const message = context ? `${context}: ${error.message}` : error.message;
  if (reportedMessages.has(message) || reportedMessages.size >= MAX_REPORTS_PER_PAGE) return;
  reportedMessages.add(message);
  await fetch('/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      message,
      stack: error.stack ?? '',
      build: import.meta.env.VITE_APP_VERSION ?? 'development',
    }),
  }).catch(() => undefined);
}
