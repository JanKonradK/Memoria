import { registerPlugin } from '@capacitor/core';

export interface HoyoNativeReading {
  provider: 'genshin' | 'hsr' | 'zzz';
  uid: string;
  observedAt: number;
  data: Record<string, unknown>;
}

export interface HoyoNativeAccount {
  provider: HoyoNativeReading['provider'];
  uid: string;
  server: string;
  nickname: string;
}

interface HoyoConnectionPlugin {
  connect(): Promise<{ connected: boolean }>;
  status(): Promise<{ connected: boolean }>;
  disconnect(): Promise<{ connected: boolean }>;
  listAccounts(options: { provider: HoyoNativeReading['provider'] }): Promise<{
    accounts: HoyoNativeAccount[];
  }>;
  fetchNotes(options: {
    provider: HoyoNativeReading['provider'];
    uid: string;
    server: string;
  }): Promise<HoyoNativeReading>;
}

/** Cookies never cross this bridge. Game account IDs may be stored separately on this device. */
export const HoyoConnection = registerPlugin<HoyoConnectionPlugin>('HoyoConnection');

export const connectHoyo = () => HoyoConnection.connect();
export const getHoyoStatus = () => HoyoConnection.status();
export const listHoyoAccounts = (options: Parameters<HoyoConnectionPlugin['listAccounts']>[0]) =>
  HoyoConnection.listAccounts(options);
export const fetchHoyoNotes = (options: Parameters<HoyoConnectionPlugin['fetchNotes']>[0]) =>
  HoyoConnection.fetchNotes(options);
export async function disconnectHoyo(): Promise<void> {
  await HoyoConnection.disconnect();
}
