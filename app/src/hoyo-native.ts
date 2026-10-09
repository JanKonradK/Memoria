import { registerPlugin } from '@capacitor/core';
import { isDesktopApp } from './desktop-host';

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

export const connectHoyo = () =>
  isDesktopApp() && window.memoriaDesktop?.hoyo ? window.memoriaDesktop.hoyo.connect() : HoyoConnection.connect();
export const getHoyoStatus = () => HoyoConnection.status();
export const listHoyoAccounts = (options: Parameters<HoyoConnectionPlugin['listAccounts']>[0]) => {
  if (isDesktopApp()) {
    if (window.memoriaDesktop?.browser) return window.memoriaDesktop.browser.listAccounts(options);
    if (window.memoriaDesktop?.hoyo) return window.memoriaDesktop.hoyo.listAccounts(options);
    return Promise.reject(new Error('Update the Windows app to use the browser connector.'));
  }
  return HoyoConnection.listAccounts(options);
};
export const fetchHoyoNotes = (options: Parameters<HoyoConnectionPlugin['fetchNotes']>[0]) =>
  HoyoConnection.fetchNotes(options);
export async function disconnectHoyo(): Promise<void> {
  if (isDesktopApp() && window.memoriaDesktop?.hoyo) await window.memoriaDesktop.hoyo.disconnect();
  else await HoyoConnection.disconnect();
}
