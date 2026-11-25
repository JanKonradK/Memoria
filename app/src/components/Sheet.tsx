import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { animate, AnimatePresence, m, useMotionValue, usePresence, type MotionValue } from 'motion/react';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { backdropFade, dialogEnter, sheetEnter, sheetSpring } from '../motion';
import { useUnsavedDraft } from '../desktop-host';
import { confirmDialog } from './ConfirmDialog';

/** The one question every dirty draft asks before it is dropped. */
export const confirmDiscard = () =>
  confirmDialog({
    title: 'Discard your unsaved changes?',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    danger: true,
  });

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-ui-full bg-fill-2 text-muted ring-1 ring-line-hairline transition hover:bg-fill-3 hover:text-fg-soft fine:h-9 fine:w-9"
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </DialogPrimitive.Close>
  );
}

/** Drag, entrance, return and exit all own the same transform. */
function useDragDismiss(
  dialogRef: React.RefObject<HTMLDivElement | null>,
  y: MotionValue<string>,
  reduced: boolean,
  /** True closed, false stayed; a promise is a question still being asked. */
  onClose: () => boolean | Promise<boolean>,
) {
  const releaseVelocity = useRef(0);
  const drag = useRef<{
    startY: number;
    startOffset: number;
    height: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);
  const returnHome = () => animate(y, '0%', reduced ? { duration: 0 } : sheetSpring);
  /** Starts a drag from here. False when the sheet is not there to drag. */
  const begin = (clientY: number, at: number): boolean => {
    if (!dialogRef.current) return false;
    const height = dialogRef.current.getBoundingClientRect().height;
    y.stop();
    releaseVelocity.current = 0;
    drag.current = {
      startY: clientY,
      startOffset: (parseFloat(y.get()) / 100) * height,
      height,
      lastY: clientY,
      lastT: at,
      velocity: 0,
    };
    return true;
  };
  const move = (clientY: number, at: number) => {
    const current = drag.current;
    if (!current) return;
    const offset = Math.max(0, current.startOffset + clientY - current.startY);
    y.set(`${(offset / Math.max(1, current.height)) * 100}%`);
    const dt = at - current.lastT;
    if (dt > 0) current.velocity = ((clientY - current.lastY) / dt) * 1000;
    current.lastY = clientY;
    current.lastT = at;
  };
  const end = (clientY: number, at: number) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const distance = clientY - current.startY;
    const offset = Math.max(0, current.startOffset + distance);
    const velocity = at - current.lastT < 100 ? current.velocity : 0;
    if (distance > 10 && (offset > Math.min(120, current.height * 0.28) || velocity > 600)) {
      releaseVelocity.current = velocity;
      // A dirty draft asks first: the sheet settles back while the question is
      // open, and a confirmed discard then closes it from rest.
      if (onClose() !== true) {
        releaseVelocity.current = 0;
        returnHome();
      }
    } else returnHome();
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
    if (begin(event.clientY, event.timeStamp)) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => move(event.clientY, event.timeStamp);
  const onPointerUp = (event: React.PointerEvent) => end(event.clientY, event.timeStamp);
  const onPointerCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    returnHome();
  };
  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // Losing capture is not a release gesture. Restore the sheet if the
      // browser or another surface takes over before pointerup arrives.
      onLostPointerCapture: onPointerCancel,
    },
    releaseVelocity,
    body: { begin, move, end, cancel: onPointerCancel },
  };
}

/** A pull down from these is theirs: typing, a scrubbed bar, a swiped row, a control. */
const BODY_OWN_GESTURE =
  'input, textarea, select, [contenteditable], button, a, [data-scrub], [data-swipe-row], [role="slider"]';
const BODY_LOCK_PX = 10;

/**
 * The sheet's body drags it down too, but only from the top of its scroll: a
 * pull past the top that is clearly downward. Touch events rather than pointer
 * events, because only a cancelled `touchmove` keeps the browser from scrolling
 * (and then cancelling the pointer) once the drag has taken over.
 */
function useBodyDragDismiss(body: HTMLDivElement | null, drag: ReturnType<typeof useDragDismiss>['body']) {
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  });
  useEffect(() => {
    if (!body) return;
    let start: { x: number; y: number; id: number } | null = null;
    let taken = false;
    const touchOf = (event: TouchEvent, id: number) =>
      Array.from(event.changedTouches).find((t) => t.identifier === id);
    const onStart = (event: TouchEvent) => {
      start = null;
      taken = false;
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (!touch || (event.target as HTMLElement).closest(BODY_OWN_GESTURE)) return;
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = touchOf(event, start.id);
      if (!touch) return;
      if (!taken) {
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < BODY_LOCK_PX && Math.abs(dy) < BODY_LOCK_PX) return;
        if (!(dy > BODY_LOCK_PX && dy > Math.abs(dx)) || body.scrollTop > 0 || event.touches.length > 1) {
          start = null;
          return;
        }
        // Begins here, not at the touch, so the sheet does not jump the lock distance.
        if (!dragRef.current.begin(touch.clientY, event.timeStamp)) {
          start = null;
          return;
        }
        taken = true;
      }
      if (event.cancelable) event.preventDefault();
      dragRef.current.move(touch.clientY, event.timeStamp);
    };
    const onEnd = (event: TouchEvent) => {
      const touch = start && touchOf(event, start.id);
      if (!touch) return;
      start = null;
      if (!taken) return;
      taken = false;
      if (event.type === 'touchcancel') dragRef.current.cancel();
      else dragRef.current.end(touch.clientY, event.timeStamp);
    };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
      if (taken) dragRef.current.cancel();
    };
  }, [body]);
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
  footer,
  dirty = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Keep the commit action reachable while a long editor scrolls. */
  footer?: ReactNode;
  /** Protect a draft from Back, Escape, backdrop and drag dismissal. */
  dirty?: boolean;
  /** Use a wider desktop dialog for dense editors (game detail, add game). */
  wide?: boolean;
  /**
   * Keep the title for assistive tech only — for content that already renders
   * its own heading (the game card), so the name is not printed twice.
   */
  hideTitle?: boolean;
}) {
  const desktop = useMediaQuery('(min-width: 640px)');
  const reduced = useReducedMotion();
  const sheetY = useMotionValue(reduced ? '0%' : '100%');
  const dialogRef = useRef<HTMLDivElement>(null);
  // Every close updates the route first. Retain its portal until the inner
  // exit finishes, then release App's waiting presence boundary.
  const [present, safeToRemove] = usePresence();
  useUnsavedDraft(open && present && dirty);
  // Escape, the scrim, X and a drag can all ask at once; only one question opens.
  const asking = useRef(false);
  const close = (): boolean | Promise<boolean> => {
    if (!dirty) {
      onClose();
      return true;
    }
    if (asking.current) return false;
    asking.current = true;
    return confirmDiscard().then((discard) => {
      asking.current = false;
      if (discard) onClose();
      return discard;
    });
  };
  const { handlers: dragHandlers, releaseVelocity, body: bodyDrag } = useDragDismiss(dialogRef, sheetY, reduced, close);
  const [sheetBody, setSheetBody] = useState<HTMLDivElement | null>(null);
  useBodyDragDismiss(desktop ? null : sheetBody, bodyDrag);

  return (
    <DialogPrimitive.Root
      open={open && present}
      onOpenChange={(next) => {
        if (!next) void close();
      }}
    >
      <DialogPrimitive.Portal forceMount>
        <AnimatePresence custom={releaseVelocity.current} onExitComplete={safeToRemove ?? undefined}>
          {open && present && (
            <m.div
              key={desktop ? 'dialog' : 'sheet'}
              data-layer="sheet"
              className={`pointer-events-none fixed inset-0 z-50 flex justify-center ${
                desktop ? 'items-center p-6' : 'items-end'
              }`}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DialogPrimitive.Overlay forceMount asChild>
                <m.div
                  className="sheet-scrim pointer-events-auto fixed inset-0 bg-scrim-veil backdrop-blur-[2px]"
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
                    tabIndex={-1}
                    // The sheet itself takes focus, not its close button: a ring on X greets
                    // nobody. Tab still reaches X first.
                    onOpenAutoFocus={(event) => {
                      event.preventDefault();
                      dialogRef.current?.focus({ preventScroll: true });
                    }}
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
                    <div className="scrollbar-thin min-h-0 overflow-y-auto px-6 pb-6">{children}</div>
                    {footer && <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div>}
                  </DialogPrimitive.Content>
                </m.div>
              ) : (
                <m.div
                  className="pointer-events-auto w-full max-w-xl"
                  style={{ y: sheetY }}
                  variants={
                    reduced
                      ? {
                          hidden: { y: '0%', opacity: 0 },
                          visible: { y: '0%', opacity: 1 },
                          exit: { y: '0%', opacity: 0 },
                        }
                      : sheetEnter
                  }
                >
                  <DialogPrimitive.Content
                    forceMount
                    ref={dialogRef}
                    aria-describedby={undefined}
                    tabIndex={-1}
                    // The sheet itself takes focus, not its close button: a ring on X greets
                    // nobody. Tab still reaches X first.
                    onOpenAutoFocus={(event) => {
                      event.preventDefault();
                      dialogRef.current?.focus({ preventScroll: true });
                    }}
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
                    <div
                      ref={setSheetBody}
                      className={`scrollbar-thin min-h-0 overflow-y-auto px-5 ${footer ? 'pb-5' : 'pb-[calc(2rem+env(safe-area-inset-bottom))]'}`}
                    >
                      {children}
                    </div>
                    {footer && (
                      <div className="shrink-0 border-t border-line px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
                        {footer}
                      </div>
                    )}
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
