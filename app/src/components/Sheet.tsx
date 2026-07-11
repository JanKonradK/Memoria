import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../hooks';

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="rounded-full bg-white/5 p-2 text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-200"
      aria-label="Close"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
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
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const desktop = useMediaQuery('(min-width: 640px)');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 z-50 flex justify-center ${desktop ? 'items-center p-6' : 'items-end'}`}>
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={onClose}
          />
          {desktop ? (
            <motion.div
              role="dialog"
              aria-modal="true"
              className={`glass gold-hairline relative flex max-h-[85dvh] w-full flex-col rounded-3xl shadow-2xl ${
                wide ? 'max-w-3xl' : 'max-w-xl'
              }`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 16 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-5">
                <h2 className="text-lg font-bold tracking-tight text-slate-100">{title}</h2>
                <CloseButton onClose={onClose} />
              </div>
              <div className="scrollbar-thin overflow-y-auto px-6 pb-6">{children}</div>
            </motion.div>
          ) : (
            <motion.div
              role="dialog"
              aria-modal="true"
              className="glass gold-hairline relative flex max-h-[90dvh] w-full max-w-xl flex-col rounded-t-3xl shadow-2xl"
              initial={reduced ? { opacity: 0 } : { y: '100%' }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              drag={reduced ? false : 'y'}
              dragListener={false}
              dragControls={controls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 600) onClose();
              }}
            >
              <div
                className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-3 px-5 pb-2 pt-3 active:cursor-grabbing"
                onPointerDown={(e) => controls.start(e)}
              >
                <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
                <h2 className="mt-2 text-base font-bold text-slate-100">{title}</h2>
                <div className="mt-1">
                  <CloseButton onClose={onClose} />
                </div>
              </div>
              <div className="scrollbar-thin overflow-y-auto px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                {children}
              </div>
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
