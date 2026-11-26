import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Btn } from './ui';

const DialogsSuspended = createContext(false);

/**
 * Keeps full-app portaled dialogs hidden (preserving their React state) while
 * the quick card temporarily holds the single desktop window.
 */
export function SuspendDialogs({ suspended, children }: { suspended: boolean; children: ReactNode }) {
  return <DialogsSuspended.Provider value={suspended}>{children}</DialogsSuspended.Provider>;
}

export function useDialogsSuspended(): boolean {
  return useContext(DialogsSuspended);
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A choice that loses something: the confirm button takes the danger style. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * For a dialog's `onInteractOutside`: the Windows app's title bar sits above
 * every dialog, and minimizing, maximizing or closing from it must not dismiss
 * one, or drop the draft in it.
 */
export function keepOpenForWindowChrome(event: { target: EventTarget | null; preventDefault(): void }): void {
  if (event.target instanceof Element && event.target.closest('[data-window-chrome]')) event.preventDefault();
}

let show: ((pending: Pending) => void) | null = null;
const queue: Pending[] = [];

/**
 * Ask a yes-or-no question in the app's own dialog. Resolves true on confirm and
 * false on cancel, Escape or a scrim press. Needs one `<ConfirmHost />` mounted;
 * without it every question resolves false, so nothing is lost silently.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const pending = { ...options, resolve };
    if (show) show(pending);
    else queue.push(pending);
  });
}

/** Mount once. Renders above any open sheet. */
export function ConfirmHost() {
  const suspended = useDialogsSuspended();
  const [current, setCurrent] = useState<Pending | null>(null);
  // The open question and the ones asked while it was open, outside React state
  // so a re-run updater can never queue a question twice.
  const open = useRef<Pending | null>(null);
  const waiting = useRef<Pending[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const take = (pending: Pending) => {
      if (open.current) return void waiting.current.push(pending);
      open.current = pending;
      setCurrent(pending);
    };
    show = take;
    queue.splice(0).forEach(take);
    return () => {
      if (show === take) show = null;
    };
  }, []);

  const settle = (ok: boolean) => {
    const answered = open.current;
    if (!answered) return;
    open.current = waiting.current.shift() ?? null;
    setCurrent(open.current);
    answered.resolve(ok);
  };

  // If a second question arrives while the first is still open or exiting,
  // Radix keeps the same Content mounted and skips onOpenAutoFocus.
  useEffect(() => {
    if (!current || suspended) return;
    (current.danger ? cancelRef.current : confirmRef.current)?.focus();
  }, [current, suspended]);

  // The question stays on the dialog while it leaves: once answered, `current`
  // is gone, but the words must not blank out mid-exit.
  const [last, setLast] = useState<Pending | null>(null);
  if (current && current !== last) setLast(current);
  const shown = current ?? last;

  return (
    <DialogPrimitive.Root open={current !== null && !suspended} onOpenChange={(open) => !open && settle(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="confirm-motion sheet-scrim fixed inset-0 z-[90] bg-scrim-veil backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          role="alertdialog"
          {...(shown?.description ? {} : { 'aria-describedby': undefined })}
          onInteractOutside={keepOpenForWindowChrome}
          // Destructive questions land on Cancel; the rest on their answer.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (shown?.danger ? cancelRef.current : confirmRef.current)?.focus();
          }}
          className="confirm-motion glass gold-hairline fixed left-1/2 top-1/2 z-[90] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-ui-card p-5 shadow-float outline-none"
        >
          <DialogPrimitive.Title className="text-lead font-bold text-fg text-balance">
            {shown?.title}
          </DialogPrimitive.Title>
          {shown?.description && (
            <DialogPrimitive.Description className="mt-2 text-body text-muted">
              {shown.description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Btn ref={cancelRef} onClick={() => settle(false)}>
              {shown?.cancelLabel ?? 'Cancel'}
            </Btn>
            <Btn ref={confirmRef} kind={shown?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {shown?.confirmLabel ?? 'OK'}
            </Btn>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
