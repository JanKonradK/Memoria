import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface ScreenshotText {
  text: string;
  /** Present only when the image provider or EXIF supplies a capture instant. */
  capturedAt?: number;
  name?: string;
}

interface ScreenshotImportPlugin {
  choose(): Promise<ScreenshotText>;
  recognize(options: { base64: string }): Promise<ScreenshotText>;
  getPending(): Promise<{ screenshot: ScreenshotText | null }>;
  addListener(event: 'screenshotReceived', listener: () => void): Promise<PluginListenerHandle>;
}

const ScreenshotImport = registerPlugin<ScreenshotImportPlugin>('ScreenshotImport');

export function chooseScreenshot(): Promise<ScreenshotText> {
  return ScreenshotImport.choose();
}

export function recognizeScreenshot(options: { base64: string }): Promise<ScreenshotText> {
  return ScreenshotImport.recognize(options);
}

/** Each shared image is removed from the native inbox when recognition starts. */
export async function getPendingScreenshot(): Promise<ScreenshotText | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return (await ScreenshotImport.getPending()).screenshot;
}

/** Register before checking the inbox so warm shares cannot fall between those steps. */
export function onScreenshotReceived(listener: () => void): Promise<PluginListenerHandle> {
  return ScreenshotImport.addListener('screenshotReceived', listener);
}
