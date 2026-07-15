import type { PendingAlert } from '@technogg/shared';

export interface NotificationSecrets {
  discord?: { webhook: string };
  telegram?: { token: string; chatId: string };
}

function hexToInt(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : 0x8b5cf6;
}

async function sendDiscord(webhook: string, alerts: PendingAlert[]): Promise<boolean> {
  // Discord allows up to 10 embeds per message.
  for (let i = 0; i < alerts.length; i += 10) {
    const embeds = alerts.slice(i, i + 10).map((a) => ({
      title: a.title,
      description: a.body,
      color: hexToInt(a.color),
    }));
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'TechnoGG', embeds }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
  }
  return true;
}

async function sendTelegram(token: string, chatId: string, alerts: PendingAlert[]): Promise<boolean> {
  const text = alerts.map((a) => `${a.title}\n${a.body}`).join('\n\n');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

/** Send a batch of alerts to every configured channel. Returns channels that succeeded. */
export async function dispatchAlerts(secrets: NotificationSecrets, alerts: PendingAlert[]): Promise<string[]> {
  const ok: string[] = [];
  if (secrets.discord?.webhook) {
    if (await sendDiscord(secrets.discord.webhook, alerts).catch(() => false)) ok.push('discord');
  }
  if (secrets.telegram?.token && secrets.telegram.chatId) {
    if (await sendTelegram(secrets.telegram.token, secrets.telegram.chatId, alerts).catch(() => false))
      ok.push('telegram');
  }
  return ok;
}
