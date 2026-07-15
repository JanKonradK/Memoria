import type { IntegrationKind, IntegrationStatus } from '@technogg/shared';
import { authHeaders, isHostedSession } from './auth-session';

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

export function integrationsHosted(): boolean {
  return isHostedSession();
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  if (!isHostedSession()) return [];
  const body = await api<{ integrations: IntegrationStatus[] }>('/api/integrations');
  return body.integrations;
}

export async function saveIntegration(kind: IntegrationKind, value: Record<string, string>): Promise<void> {
  await api(`/api/integrations/${kind}`, {
    method: 'PUT',
    body: JSON.stringify({ value, consent: true }),
  });
}

export async function disconnectIntegration(kind: IntegrationKind): Promise<void> {
  await api(`/api/integrations/${kind}`, { method: 'DELETE' });
}

export async function exportHostedAccount(): Promise<unknown> {
  return api('/api/export');
}

export async function deleteHostedAccount(): Promise<void> {
  await api('/api/account', { method: 'DELETE' });
}
