import { authHeaders } from './auth-session';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(await authHeaders()),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function exportHostedAccount(): Promise<unknown> {
  return api('/api/export');
}

export async function deleteHostedAccount(): Promise<void> {
  await api('/api/account', { method: 'DELETE' });
}
