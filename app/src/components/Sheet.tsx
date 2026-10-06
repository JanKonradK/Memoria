import { useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { animate, AnimatePresence, m, useMotionValue, usePresence, type MotionValue } from 'motion/react';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { backdropFade, dialogEnter, sheetEnter, sheetSpring } from '../motion';

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

/** Drag, entrance, return and exit all own the same transform. */
function useDragDismiss(
  dialogRef: React.RefObject<HTMLDivElement | null>,
  y: MotionValue<string>,
  reduced: boolean,
  onClose: () => void | boolean,
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
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button') || !dialogRef.current)
      return;
    const height = dialogRef.current.getBoundingClientRect().height;
    y.stop();
    releaseVelocity.current = 0;
    drag.current = {
      startY: event.clientY,
      startOffset: (parseFloat(y.get()) / 100) * height,
      height,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const offset = Math.max(0, current.startOffset + event.clientY - current.startY);
    y.set(`${(offset / Math.max(1, current.height)) * 100}%`);
    const dt = event.timeStamp - current.lastT;
    if (dt > 0) current.velocity = ((event.clientY - current.lastY) / dt) * 1000;
    current.lastY = event.clientY;
    current.lastT = event.timeStamp;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const distance = event.clientY - current.startY;
    const offset = Math.max(0, current.startOffset + distance);
    const velocity = event.timeStamp - current.lastT < 100 ? current.velocity : 0;
    if (distance > 10 && (offset > Math.min(120, current.height * 0.28) || velocity > 600)) {
      releaseVelocity.current = velocity;
      if (onClose() === false) {
        releaseVelocity.current = 0;
        returnHome();
      }
    } else returnHome();
  };
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
  };
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
  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return false;
    onClose();
    return true;
  };
  const { handlers: dragHandlers, releaseVelocity } = useDragDismiss(dialogRef, sheetY, reduced, close);

  return (
    <DialogPrimitive.Root open={open && present} onOpenChange={(next) => !next && close()}>
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
