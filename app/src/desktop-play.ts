export interface CapturedReading {
  id: string;
  gameId?: string;
  gameName?: string;
  name: string;
  text: string;
  capturedAt: number;
  detectedAt: number;
}

export interface PlayModeStatus {
  enabled: boolean;
  background: boolean;
  hotkey: string;
  sourceId: string;
  sourceName: string;
  gameId: string;
  gameName: string;
  registered: boolean;
  busy: boolean;
  count: number;
  error?: string;
  pending: CapturedReading[];
}

export interface PlayModeConfig {
  enabled: boolean;
  background: boolean;
  hotkey: string;
  sourceId: string;
  gameId: string;
}

/** Native window capture is limited to a window selected in Play mode. */
export interface DesktopPlay {
  status(): Promise<PlayModeStatus>;
  sources(): Promise<{ id: string; name: string }[]>;
  configure(config: PlayModeConfig): Promise<PlayModeStatus>;
  capture(): Promise<PlayModeStatus>;
  remove(id: string): Promise<PlayModeStatus>;
  onChanged(listener: () => void): () => void;
  onOpen(listener: () => void): () => void;
}
