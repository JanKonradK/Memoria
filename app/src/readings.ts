import { create } from 'zustand';
import {
  extractScreenshotRatios,
  mapHoYoNotes,
  parseScreenshotReadings,
  planGameImport,
  presetForGame,
  type GameImportBatch,
  type GameImportResult,
} from '@memoria/shared';
import { flushPersist, useApp } from './store';
import { flushSync } from './sync';
import { launcherFetch, servedByLauncher } from './launcher';
import { isNativeApp } from './native';
import { chooseScreenshot, type ScreenshotText } from './screenshot-native';
import { useUI } from './ui-store';
import { navigateWorkspace } from './workspace-navigation';

export type ReadingPanel = 'review' | 'account' | 'history';

/** A reading Memoria would not save by itself. It waits in its game's card. */
export interface ReadingDraft {
  /** Stable while the player edits, so the card's form is not rebuilt per keystroke. */
  id: number;
  gameId: string;
  text: string;
  /** When the screenshot was taken, epoch ms. */
  capturedAt: number;
  /** A Play mode inbox entry. It leaves the inbox only once its readings are saved. */
  captureId?: string;
  /** Why this one needs a look, in the player's terms. */
  reason: string;
}

export interface ReadingNotice {
  id: number;
  tone: 'ok' | 'error';
  text: string;
  /** Present when the notice reports a saved import that can still be undone. */
  batchId?: string;
}

interface Unassigned {
  text: string;
  capturedAt: number;
  captureId?: string;
  candidates: string[];
}

interface ReadingsStore {
  busy: boolean;
  draft: ReadingDraft | null;
  /** The one card whose readings panel is open. */
  panel: { gameId: string; view: ReadingPanel } | null;
  /** A screenshot that could belong to more than one tracked game. */
  unassigned: Unassigned | null;
  notice: ReadingNotice | null;
}

export const useReadings = create<ReadingsStore>(() => ({
  busy: false,
  draft: null,
  panel: null,
  unassigned: null,
  notice: null,
}));

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCOUNT_PRESETS = new Set(['genshin', 'hsr', 'zzz']);
let noticeId = 0;
let draftId = 0;
/** Bumped by anything that supersedes an image still being read. */
let requestEpoch = 0;

const message = (error: unknown) => (error instanceof Error ? error.message : 'The reading could not be saved.');
const plural = (count: number) => `${count} reading${count === 1 ? '' : 's'}`;

/** The app's one line of feedback for something that happened outside a card's own controls. */
export function showNotice(tone: ReadingNotice['tone'], text: string) {
  notify(tone, text);
}

function notify(tone: ReadingNotice['tone'], text: string, batchId?: string) {
  useReadings.setState({ notice: { id: ++noticeId, tone, text, ...(batchId ? { batchId } : {}) } });
}

export function dismissReadingNotice() {
  useReadings.setState({ notice: null });
}

/** This device can turn an image into text. The plain browser version cannot. */
export function canReadImages(): boolean {
  return isNativeApp || servedByLauncher();
}

/** HoYoLAB notes exist for three presets, and only where a launcher or native shell can reach them. */
export function supportsAccount(gameId: string): boolean {
  const game = useApp.getState().state.games.find((item) => item.id === gameId && !item.deleted);
  const key = game ? presetForGame(game)?.key : undefined;
  return Boolean(key && ACCOUNT_PRESETS.has(key));
}

/**
 * Bring a game's card on screen.
 *
 * A wide window already has it beside Today's list. Anything narrower opens the
 * game's own page, the same way tapping its row does.
 */
export function showGameCard(gameId: string) {
  const ui = useUI.getState();
  if (ui.tab === 'home' && ui.focusedGameId === gameId) return;
  if (window.matchMedia('(min-width: 900px)').matches) {
    ui.setTodayGameId(gameId);
    ui.setTab('today');
    return;
  }
  navigateWorkspace(gameId, ui.focusedGameId, () => {
    ui.setFocusedGameId(gameId);
    ui.setTab('home');
  });
}

/** The game whose card is on screen, if one is. Used only to break ties. */
function gameOnScreen(): string | undefined {
  const ui = useUI.getState();
  if (ui.tab === 'home') return ui.focusedGameId ?? undefined;
  if (ui.tab === 'today') return ui.todayGameId ?? undefined;
  return undefined;
}

export function openReadings(gameId: string, view: ReadingPanel) {
  useReadings.setState({ panel: { gameId, view } });
  showGameCard(gameId);
}

/** Close the card's panel. Asked for directly, so a reading being checked goes with it. */
export function closeReadings() {
  requestEpoch += 1;
  useReadings.setState({ panel: null, draft: null, busy: false });
}

function keepsDraft(): boolean {
  return Boolean(useReadings.getState().draft) && !window.confirm('Replace the reading you are checking?');
}

/** Remove a reviewed Play mode capture, but only after both local stores hold the readings. */
function releaseCapture(captureId: string | undefined) {
  const play = window.memoriaDesktop?.play;
  if (!captureId || !play) return;
  void flushPersist()
    .then(flushSync)
    .then(() => play.remove(captureId))
    .catch(() => notify('error', 'Readings were saved. The capture stays in the inbox until saving is confirmed.'));
}

function gameName(gameId: string): string {
  return useApp.getState().state.games.find((game) => game.id === gameId)?.name ?? 'this game';
}

function report(result: GameImportResult, gameId: string, captureId?: string): boolean {
  if (result.applied === 0) {
    notify('error', result.issues[0]?.message ?? 'Nothing newer to save.');
    return false;
  }
  releaseCapture(captureId);
  notify(
    'ok',
    `Saved ${plural(result.applied)} to ${gameName(gameId)}.${result.skipped ? ` ${result.skipped} skipped.` : ''}`,
    result.batchId,
  );
  return true;
}

function askToCheck(reading: Omit<ReadingDraft, 'id'>) {
  const draft = { ...reading, id: ++draftId };
  useReadings.setState({ draft, unassigned: null, panel: { gameId: draft.gameId, view: 'review' } });
  showGameCard(draft.gameId);
}

/**
 * Decide what a screenshot's text is, and what to do with it.
 *
 * Saved without a question when every detected value names a tracked resource
 * beside its own cap, for exactly one game. Anything looser is handed to the
 * player in that game's card: a value with no cap, a meter with no label, a
 * screenshot two accounts could both claim.
 */
function ingest(
  text: string,
  capturedAt: number,
  options: { hint?: string; forced?: string; captureId?: string },
): void {
  const state = useApp.getState().state;
  const games = state.games.filter((game) => !game.deleted);
  if (!games.length) {
    notify('error', 'Add a game before reading a screenshot.');
    return;
  }
  if (!text.trim()) {
    notify('error', 'No text was found in that image. Try a clearer screenshot.');
    return;
  }
  const at = Math.min(capturedAt, Date.now());
  let gameId = options.forced;
  if (!gameId) {
    const matches = games.filter((game) => parseScreenshotReadings(state, game.id, text, at).resources?.length);
    const hint = options.hint ?? gameOnScreen();
    if (hint && matches.some((game) => game.id === hint)) gameId = hint;
    else if (matches.length === 1) gameId = matches[0]!.id;
    else if (!matches.length && hint && games.some((game) => game.id === hint)) gameId = hint;
    else if (games.length === 1) gameId = games[0]!.id;
    else {
      useReadings.setState({
        unassigned: {
          text,
          capturedAt: at,
          ...(options.captureId ? { captureId: options.captureId } : {}),
          candidates: (matches.length ? matches : games).map((game) => game.id),
        },
      });
      return;
    }
  }
  const batch = parseScreenshotReadings(state, gameId, text, at);
  const plan = planGameImport(state, batch, Date.now());
  const found = (batch.resources?.length ?? 0) + (batch.tasks?.length ?? 0);
  const unsure = plan.issues.some((issue) => issue.reason === 'needs-review');
  const draft = { gameId, text, capturedAt: at, ...(options.captureId ? { captureId: options.captureId } : {}) };
  if (found && unsure) {
    askToCheck({ ...draft, reason: 'Check these values before saving.' });
    return;
  }
  if (!found) {
    askToCheck({
      ...draft,
      reason: extractScreenshotRatios(text).length
        ? 'These meters have no label. Choose what each one is.'
        : 'No readings were recognised. Check the text.',
    });
    return;
  }
  try {
    useReadings.setState({ unassigned: null });
    report(useApp.getState().applyGameImport(batch), gameId, options.captureId);
  } catch (cause) {
    notify('error', message(cause));
  }
}

/** Text that already left OCR: a native share, a Play mode capture, or a chosen image. */
export function receiveScreenshotText(
  result: ScreenshotText,
  options: { hint?: string; captureId?: string } = {},
): boolean {
  if (keepsDraft()) return false;
  requestEpoch += 1;
  useReadings.setState({ draft: null, busy: false });
  ingest(result.text, result.capturedAt ?? Date.now(), options);
  return true;
}

/** The game chooser's answer for a screenshot more than one account could claim. */
export function assignScreenshot(gameId: string | null) {
  const pending = useReadings.getState().unassigned;
  useReadings.setState({ unassigned: null });
  if (!pending || !gameId) return;
  ingest(pending.text, pending.capturedAt, { forced: gameId, captureId: pending.captureId });
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** One dropped, pasted or chosen image. Read on this device, never uploaded. */
export async function receiveScreenshotFiles(files: File[], hint?: string): Promise<void> {
  if (useReadings.getState().busy) {
    notify('error', 'Wait for the current screenshot to finish reading, then try again.');
    return;
  }
  if (files.length !== 1) {
    notify('error', 'Read one screenshot at a time: one PNG or JPEG image, up to 8 MB.');
    return;
  }
  const file = files[0]!;
  if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES) {
    notify('error', 'Choose one PNG or JPEG image, up to 8 MB. The image must not be empty.');
    return;
  }
  if (!servedByLauncher()) {
    notify('error', 'Open the Windows app to read this image, or type the value on the game card.');
    return;
  }
  if (keepsDraft()) return;
  const epoch = ++requestEpoch;
  useReadings.setState({ busy: true, draft: null, notice: null });
  try {
    const base64 = await toBase64(file);
    if (requestEpoch !== epoch) return;
    const response = await launcherFetch('/api/ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64, mimeType: file.type }),
    });
    const result = (await response.json()) as ScreenshotText & { error?: string };
    if (!response.ok) throw new Error(result.error || 'Text recognition failed.');
    if (requestEpoch !== epoch) return;
    // A saved screenshot carries its own time. A pasted one was copied just now.
    const modified = file.lastModified > 0 && file.lastModified <= Date.now() ? file.lastModified : Date.now();
    ingest(result.text, result.capturedAt ?? modified, { hint });
  } catch (cause) {
    if (requestEpoch === epoch) notify('error', message(cause));
  } finally {
    if (requestEpoch === epoch) useReadings.setState({ busy: false });
  }
}

/** Android's own image picker, which returns recognised text. */
export async function chooseNativeScreenshot(hint?: string): Promise<void> {
  if (useReadings.getState().busy || keepsDraft()) return;
  const epoch = ++requestEpoch;
  useReadings.setState({ busy: true, draft: null, notice: null });
  try {
    const result = await chooseScreenshot();
    if (requestEpoch === epoch) ingest(result.text, result.capturedAt ?? Date.now(), { hint });
  } catch (cause) {
    if (requestEpoch === epoch) notify('error', message(cause));
  } finally {
    if (requestEpoch === epoch) useReadings.setState({ busy: false });
  }
}

/** Save what the player confirmed in the card. */
export function saveDraft(batch: GameImportBatch): boolean {
  const draft = useReadings.getState().draft;
  if (!draft || batch.gameId !== draft.gameId) return false;
  if (!useApp.getState().state.games.some((game) => game.id === batch.gameId && !game.deleted)) {
    notify('error', 'This game account is no longer available.');
    useReadings.setState({ draft: null, panel: null });
    return false;
  }
  try {
    const saved = report(
      useApp.getState().applyGameImport({
        ...batch,
        resources: batch.resources?.map((item) => ({ ...item, confirmed: true })),
        tasks: batch.tasks?.map((item) => ({ ...item, confirmed: true })),
      }),
      batch.gameId,
      draft.captureId,
    );
    if (saved) useReadings.setState({ draft: null, panel: null });
    return saved;
  } catch (cause) {
    notify('error', message(cause));
    return false;
  }
}

/** Account readings come from the publisher's own notes, so they save directly. */
export function saveAccountReading(batch: GameImportBatch): void {
  if (!batch.resources?.length && !batch.tasks?.length) {
    notify('error', 'The account returned no readings Memoria tracks for this game.');
    return;
  }
  try {
    const result = useApp.getState().applyGameImport(batch);
    if (result.applied > 0) report(result, batch.gameId);
    else notify('ok', `${gameName(batch.gameId)} is already up to date.`);
  } catch (cause) {
    notify('error', message(cause));
  }
}

export function undoReading(batchId: string): void {
  try {
    const result = useApp.getState().undoGameImport(batchId);
    notify(
      result.applied > 0 ? 'ok' : 'error',
      result.applied > 0
        ? `Restored ${plural(result.applied)}.${result.skipped ? ` ${result.skipped} kept, edited since.` : ''}`
        : (result.issues[0]?.message ?? 'Nothing to restore.'),
    );
  } catch (cause) {
    notify('error', message(cause));
  }
}

/** Ask a connected account for its current notes and save what it returns. */
export async function fetchAccountReading(gameId: string): Promise<void> {
  if (useReadings.getState().busy) return;
  useReadings.setState({ busy: true, notice: null });
  try {
    const { connectionRequest } = await import('./game-connections');
    const result = await connectionRequest({ action: 'refresh', gameId });
    if (result.reading?.gameId === gameId)
      saveAccountReading(mapHoYoNotes(useApp.getState().state, gameId, result.reading));
    else notify('error', 'The account returned no reading for this game.');
  } catch (cause) {
    notify('error', message(cause));
  } finally {
    useReadings.setState({ busy: false });
  }
}

/** Start a reading from typed or pasted text, for devices that cannot read images. */
export function startTextReading(gameId: string) {
  if (keepsDraft()) return;
  askToCheck({ gameId, text: '', capturedAt: Date.now(), reason: 'Paste the text from your screenshot.' });
}

/** Keep the player's corrections with the draft, so leaving the card does not lose them. */
export function editDraftText(text: string) {
  const draft = useReadings.getState().draft;
  if (draft) useReadings.setState({ draft: { ...draft, text } });
}
