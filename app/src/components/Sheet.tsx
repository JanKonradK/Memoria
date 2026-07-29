import { useCallback, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, m } from 'motion/react';
import { useMediaQuery } from '../hooks';
import { backdropFade, dialogEnter, sheetEnter } from '../motion';

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-ui-full bg-fill-2 text-muted ring-1 ring-line-hairline transition hover:bg-fill-3 hover:text-fg-soft sm:h-9 sm:w-9"
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </DialogPrimitive.Close>
  );
}

/** Drag-to-dismiss for the mobile bottom sheet: grab the header, swipe down to close. */
function useDragDismiss(dialogRef: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const drag = useRef<{ startY: number; lastY: number; lastT: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !dialogRef.current) return;
    const offset = Math.max(0, e.clientY - drag.current.startY);
    dialogRef.current.style.transform = `translateY(${offset}px)`;
    dialogRef.current.style.transition = 'none';
    drag.current.lastT = e.timeStamp;
    drag.current.lastY = e.clientY;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || !dialogRef.current) return;
    const offset = Math.max(0, e.clientY - drag.current.startY);
    const dt = Math.max(1, e.timeStamp - drag.current.lastT);
    const velocity = ((e.clientY - drag.current.lastY) / dt) * 1000;
    drag.current = null;
    if (offset > 120 || velocity > 600) {
      onClose();
    } else {
      dialogRef.current.style.transition = 'transform 0.2s ease-out';
      dialogRef.current.style.transform = '';
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}

/**
 * Responsive dialog: centered modal on desktop (bottom sheets are a mobile
 * pattern — NN/g), draggable bottom sheet on touch-sized screens.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Use a wider desktop dialog for dense editors (game detail, add game). */
  wide?: boolean;
  /**
   * Keep the title for assistive tech only — for content that already renders
   * its own heading (the game card), so the name is not printed twice.
   */
  hideTitle?: boolean;
}) {
  const desktop = useMediaQuery('(min-width: 640px)');
  const dialogRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  const dragHandlers = useDragDismiss(dialogRef, requestClose);

  return (
    <DialogPrimitive.Root open={open && !closing} onOpenChange={(next) => !next && requestClose()}>
      <DialogPrimitive.Portal forceMount>
        <AnimatePresence onExitComplete={() => closing && onClose()}>
          {open && !closing && (
            <m.div
              key={desktop ? 'dialog' : 'sheet'}
              className={`pointer-events-none fixed inset-0 z-50 flex justify-center ${
                desktop ? 'items-center p-6' : 'items-end'
              }`}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DialogPrimitive.Overlay forceMount asChild>
                <m.div
                  className="pointer-events-auto fixed inset-0 bg-scrim-veil backdrop-blur-[2px]"
                  variants={backdropFade}
                />
              </DialogPrimitive.Overlay>
              {desktop ? (
                <m.div
                  className={`pointer-events-auto w-full ${wide ? 'max-w-4xl' : 'max-w-xl'}`}
                  variants={dialogEnter}
                >
                  <DialogPrimitive.Content
                    forceMount
                    ref={dialogRef}
                    aria-describedby={undefined}
                    className="glass gold-hairline relative flex max-h-[85dvh] w-full flex-col rounded-ui-card shadow-float outline-none"
                  >
                    <div
                      className={`flex shrink-0 items-center justify-between gap-3 px-6 ${
                        hideTitle ? 'pb-0 pt-3' : 'pb-3 pt-5'
                      }`}
                    >
                      <DialogPrimitive.Title asChild>
                        <h2 className={hideTitle ? 'sr-only' : 'text-title font-bold tracking-tight text-fg'}>
                          {title}
                        </h2>
                      </DialogPrimitive.Title>
                      <CloseButton />
                    </div>
                    <div className="scrollbar-thin overflow-y-auto px-6 pb-6">{children}</div>
                  </DialogPrimitive.Content>
                </m.div>
              ) : (
                <m.div className="pointer-events-auto w-full max-w-xl" variants={sheetEnter}>
                  <DialogPrimitive.Content
                    forceMount
                    ref={dialogRef}
                    aria-describedby={undefined}
                    className="glass gold-hairline relative flex max-h-[90dvh] w-full flex-col rounded-t-ui-card shadow-float outline-none"
                  >
                    <div
                      className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-3 px-5 pb-2 pt-3 active:cursor-grabbing"
                      {...dragHandlers}
                    >
                      <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-ui-full bg-fill-4" />
                      <DialogPrimitive.Title asChild>
                        <h2 className={hideTitle ? 'sr-only' : 'mt-2 text-lead font-bold text-fg'}>{title}</h2>
                      </DialogPrimitive.Title>
                      <div className="mt-1">
                        <CloseButton />
                      </div>
                    </div>
                    <div className="scrollbar-thin overflow-y-auto px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                      {children}
                    </div>
                  </DialogPrimitive.Content>
                </m.div>
              )}
            </m.div>
          )}
        </AnimatePresence>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
