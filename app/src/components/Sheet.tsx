import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../hooks';

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
      aria-label="Close"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
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
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Use a wider desktop dialog for dense editors (game detail, add game). */
  wide?: boolean;
}) {
  const desktop = useMediaQuery('(min-width: 640px)');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dragHandlers = useDragDismiss(dialogRef, onClose);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? dialogRef.current)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = oldOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex justify-center ${desktop ? 'items-center p-6' : 'items-end'}`}>
      <div className="fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      {desktop ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`dialog-enter glass gold-hairline relative flex max-h-[85dvh] w-full flex-col rounded-3xl shadow-2xl ${
            wide ? 'max-w-4xl' : 'max-w-xl'
          }`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-5">
            <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-100">
              {title}
            </h2>
            <CloseButton onClose={onClose} />
          </div>
          <div className="scrollbar-thin overflow-y-auto px-6 pb-6">{children}</div>
        </div>
      ) : (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="sheet-enter glass gold-hairline relative flex max-h-[90dvh] w-full max-w-xl flex-col rounded-t-3xl shadow-2xl"
        >
          <div
            className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-3 px-5 pb-2 pt-3 active:cursor-grabbing"
            {...dragHandlers}
          >
            <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
            <h2 id={titleId} className="mt-2 text-base font-bold text-slate-100">
              {title}
            </h2>
            <div className="mt-1">
              <CloseButton onClose={onClose} />
            </div>
          </div>
          <div className="scrollbar-thin overflow-y-auto px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
