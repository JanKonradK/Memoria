import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { CapturedReading } from '../desktop-play';
import { isNativeApp } from '../native';
import { useUnsavedDraft } from '../desktop-host';
import { duration, easing } from '../motion';
import { getPendingScreenshot, onScreenshotReceived } from '../screenshot-native';
import { useApp } from '../store';
import {
  assignScreenshot,
  dismissReadingNotice,
  openReadings,
  receiveScreenshotFiles,
  receiveScreenshotText,
  supportsAccount,
  undoReading,
  useReadings,
} from '../readings';
import { useIdentityColors } from './roster';
import { Btn, GameBadge } from './ui';

/** Long enough to read and reach Undo; short enough not to sit over the next action. */
const NOTICE_MS = 10_000;

const noticeMotion = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.fast, ease: easing.out } },
  exit: { opacity: 0, y: 8, transition: { duration: duration.fast, ease: easing.out } },
};

function validCapture(capture: CapturedReading | undefined): capture is CapturedReading {
  return (
    !!capture &&
    typeof capture.id === 'string' &&
    typeof capture.text === 'string' &&
    Number.isFinite(capture.capturedAt) &&
    capture.capturedAt >= 0 &&
    capture.capturedAt <= 8.64e15
  );
}

/**
 * Everything that brings a reading in from outside a card.
 *
 * A screenshot can be dropped or pasted anywhere, shared from an Android
 * gallery, or captured in Play mode. Each one is read and saved without a
 * form. This component only speaks when there is something to say: what was
 * saved, with Undo, or which of two accounts a screenshot belongs to.
 */
export function ReadingIntake() {
  const games = useApp((store) => store.state.games);
  const colors = useIdentityColors(games);
  const busy = useReadings((store) => store.busy);
  const notice = useReadings((store) => store.notice);
  const unassigned = useReadings((store) => store.unassigned);
  // A reading waiting in a card is unsaved work, wherever the player has gone since.
  useUnsavedDraft(useReadings((store) => store.draft !== null));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (isNativeApp) return;
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = useReadings.getState().busy ? 'none' : 'copy';
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      // Only leaving the window counts; moving between elements fires this too.
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void receiveScreenshotFiles(Array.from(event.dataTransfer!.files));
    };
    const paste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const images = Array.from(clipboard.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const files = images.length
        ? images
        : Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      void receiveScreenshotFiles(files);
    };
    const reset = () => setDragging(false);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    document.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
      document.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp) return;
    let active = true;
    const receive = () =>
      void getPendingScreenshot()
        .then((result) => {
          if (active && result) receiveScreenshotText(result);
        })
        .catch(() => undefined);
    const listener = onScreenshotReceived(receive);
    void listener.then(receive).catch(() => undefined);
    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    // Play mode hands over one inbox entry. Cancelling the event keeps its panel open.
    const capture = (event: Event) => {
      const detail = (event as CustomEvent<CapturedReading>).detail;
      if (
        !validCapture(detail) ||
        !receiveScreenshotText(
          { text: detail.text, capturedAt: detail.capturedAt },
          { hint: detail.gameId || undefined, captureId: detail.id },
        )
      )
        event.preventDefault();
    };
    // Settings and Play mode ask for accounts without knowing which card holds them.
    const accounts = (event: Event) => {
      const requested = (event as CustomEvent<{ gameId?: string }>).detail?.gameId;
      const live = useApp.getState().state.games.filter((game) => !game.deleted);
      const game =
        live.find((item) => item.id === requested) ?? live.find((item) => supportsAccount(item.id)) ?? live[0];
      if (game) openReadings(game.id, 'account');
    };
    document.addEventListener('memoria:review-capture', capture);
    document.addEventListener('memoria:open-accounts', accounts);
    return () => {
      document.removeEventListener('memoria:review-capture', capture);
      document.removeEventListener('memoria:open-accounts', accounts);
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const timer = window.setTimeout(dismissReadingNotice, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const candidates = (unassigned?.candidates ?? [])
    .map((id) => games.find((game) => game.id === id && !game.deleted))
    .filter((game) => game !== undefined);

  return (
    <>
      {dragging && (
        <div className="reading-drop" aria-hidden>
          <p>{busy ? 'Still reading the last screenshot' : 'Drop the screenshot to read it'}</p>
        </div>
      )}
      <div
        data-reading-intake
        className="app-toasts pointer-events-none fixed inset-x-3 z-[60] flex flex-col items-center gap-2 lg:left-auto lg:right-4 lg:w-[min(28rem,calc(100vw-2rem))] lg:items-end"
      >
        <AnimatePresence>
          {busy && (
            <m.p
              key="reading"
              variants={noticeMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="status"
              className="reading-notice pointer-events-auto"
            >
              Reading…
            </m.p>
          )}
          {notice && !busy && (
            <m.div
              // One element for every notice: a newer one replaces the text in place
              // rather than leaving two status regions on screen while one fades.
              key="notice"
              variants={noticeMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              role={notice.tone === 'error' ? 'alert' : 'status'}
              data-tone={notice.tone}
              className="reading-notice pointer-events-auto"
            >
              <span className="min-w-0 flex-1">{notice.text}</span>
              {notice.batchId && (
                <button type="button" className="reading-notice-action" onClick={() => undoReading(notice.batchId!)}>
                  Undo
                </button>
              )}
              <button
                type="button"
                className="reading-notice-action text-muted"
                aria-label="Dismiss"
                onClick={dismissReadingNotice}
              >
                <svg viewBox="0 0 20 20" aria-hidden className="icon h-4 w-4" fill="none" stroke="currentColor">
                  <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
                </svg>
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>
      <Dialog.Root open={!!unassigned} onOpenChange={(open) => !open && assignScreenshot(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim/50" />
          <Dialog.Content className="popover-motion fixed left-1/2 top-1/2 z-[70] w-[min(26rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-ui-card bg-popover p-5 shadow-float ring-1 ring-line-strong">
            <Dialog.Title className="text-lead font-semibold tracking-tight text-fg">Which game is this?</Dialog.Title>
            <Dialog.Description className="sr-only">
              More than one tracked game could own this screenshot. Choose where its readings belong.
            </Dialog.Description>
            <ul className="mt-4 space-y-1">
              {candidates.map((game) => (
                <li key={game.id}>
                  <button type="button" className="reading-choice" onClick={() => assignScreenshot(game.id)}>
                    <GameBadge short={game.short} {...(colors[game.id] ?? game)} />
                    <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{game.name}</span>
                    {game.accountLabel && (
                      <span className="max-w-[40%] truncate text-meta text-muted">{game.accountLabel}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <Dialog.Close asChild>
                <Btn>Cancel</Btn>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
