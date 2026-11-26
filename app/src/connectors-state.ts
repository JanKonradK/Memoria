import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';
import type { OcrCapture, OcrPass, OcrReadingCandidate, OcrScreenshotMatches } from '@memoria/shared';
import type { BrowserStartResult, ConnectorStatus } from './desktop-host';
import { isNativeApp } from './native';

/**
 * The connectors' state, small enough for any screen to read. The calls that
 * fill it (HoYoLAB, SKPORT, OCR matching) live in `connectors.ts`, which loads
 * on demand and re-exports everything here.
 */

/** Fired whenever a screenshot waits for confirmation, so App can mount the sheet without loading the connectors first. */
export const PENDING_SCREENSHOT_EVENT = 'memoria:pending-screenshot';
/** Fired with a warning or error notice as its `detail`, so it can show outside Settings. */
export const CONNECTOR_NOTICE_EVENT = 'memoria:connector-notice';

export type ScreenshotSource = 'windows-ocr' | 'android-share' | 'android-camera' | 'file';

export interface PendingScreenshot {
  /** One capture's identity. A fresh capture gets a new one; a region merged in keeps it. */
  captureKey: string;
  /** Counts the captures merged in since `captureKey` was made. */
  revision: number;
  fileName: string;
  observedAt: number;
  /** OCR text; each region's lines are set apart by one empty line. */
  lines?: string[];
  dataUrl?: string;
  /** How many snipped regions the text covers. Missing means one. */
  regionCount?: number;
  /** Every pass Windows read, each naming its region, so a merged capture keeps its passes per region. */
  passes?: OcrPass[];
  /** What each region was read from, by region index, when the host said. */
  captures?: (OcrCapture | null)[];
  source: ScreenshotSource;
  /** The bar readings in `matches`, kept for older callers. */
  candidates: OcrReadingCandidate[];
  /** Every bar, task, savings count and endgame cycle the text showed for `gameId`. */
  matches: OcrScreenshotMatches;
  gameId: string;
}

export interface ConnectorNotice {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

interface ConnectorsStore {
  status: ConnectorStatus | null;
  busy: Record<string, boolean>;
  notice: ConnectorNotice | null;
  /** When `notice` was set, so a later visit can drop one that is no longer news. */
  noticeAt?: number;
  pendingScreenshot: PendingScreenshot | null;
  /** The one-time code the browser helper is waiting to pair with. */
  activeBrowserHandoff: BrowserStartResult | null;
}

export const useConnectors = create<ConnectorsStore>(() => ({
  status: null,
  busy: {},
  notice: null,
  pendingScreenshot: null,
  activeBrowserHandoff: null,
}));

/** Whether the Android app's connector plugin is here. */
export function hasAndroidConnector(): boolean {
  return isNativeApp && Capacitor.isPluginAvailable('Connector');
}

/** Where live connectors run: the Windows app, the Android app, or nowhere (a browser). */
export function connectorRuntime(): 'desktop' | 'android' | 'web' {
  if (window.memoriaDesktop?.connectors) return 'desktop';
  if (hasAndroidConnector()) return 'android';
  return 'web';
}

/**
 * Shows a notice in Settings. A warning or error is also announced through
 * `CONNECTOR_NOTICE_EVENT` unless `announce` is false, so it is seen wherever
 * the player is.
 */
export function setConnectorNotice(notice: ConnectorNotice | null, { announce = true } = {}): void {
  useConnectors.setState({ notice, noticeAt: Date.now() });
  if (announce && notice && notice.tone !== 'ok') {
    window.dispatchEvent(new CustomEvent<ConnectorNotice>(CONNECTOR_NOTICE_EVENT, { detail: notice }));
  }
}

/** Clears the notice; with `olderThanMs`, only one set at least that long ago. */
export function clearConnectorNotice(olderThanMs = 0, at = Date.now()): void {
  const { notice, noticeAt } = useConnectors.getState();
  if (notice && at - (noticeAt ?? 0) >= olderThanMs) useConnectors.setState({ notice: null });
}

export function inBackoff(status: ConnectorStatus | null, at = Date.now()): boolean {
  const until = status?.hoyolab.backoffUntilMs;
  return until != null && until > at;
}

function hoyolabLinked(status: ConnectorStatus | null, gameId: string): boolean {
  return connectorRuntime() !== 'web' && status?.hoyolab.connected === true && !!status.hoyolab.gameLinks[gameId];
}

/** Whether one tap can claim for this game: the app is signed in to HoYoLAB and the game is linked. */
export function isHoyolabLinked(gameId: string): boolean {
  return hoyolabLinked(useConnectors.getState().status, gameId);
}

/** `isHoyolabLinked`, kept current as the sign-in or links change. */
export function useHoyolabLinked(gameId: string): boolean {
  return useConnectors((store) => hoyolabLinked(store.status, gameId));
}
