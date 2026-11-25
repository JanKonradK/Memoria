import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Btn } from './ui';

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
  const [current, setCurrent] = useState<Pending | null>(null);
  // The open question and the ones asked while it was open, outside React state
  // so a re-run updater can never queue a question twice.
  const open = useRef<Pending | null>(null);
  const waiting = useRef<Pending[]>([]);
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

  return (
    <DialogPrimitive.Root open={current !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="sheet-scrim fixed inset-0 z-[90] bg-scrim-veil backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          role="alertdialog"
          {...(current?.description ? {} : { 'aria-describedby': undefined })}
          // Destructive questions land on Cancel; the rest on their answer.
          onOpenAutoFocus={(event) => {
            if (current?.danger) return;
            event.preventDefault();
            confirmRef.current?.focus();
          }}
          className="glass gold-hairline fixed left-1/2 top-1/2 z-[90] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-ui-card p-5 shadow-float outline-none"
        >
          <DialogPrimitive.Title className="text-lead font-bold text-fg text-balance">
            {current?.title}
          </DialogPrimitive.Title>
          {current?.description && (
            <DialogPrimitive.Description className="mt-2 text-body text-muted">
              {current.description}
            </DialogPrimitive.Description>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Btn className="min-h-11 fine:min-h-9" onClick={() => settle(false)}>
              {current?.cancelLabel ?? 'Cancel'}
            </Btn>
            <Btn
              ref={confirmRef}
              kind={current?.danger ? 'danger' : 'primary'}
              className="min-h-11 fine:min-h-9"
              onClick={() => settle(true)}
            >
              {current?.confirmLabel ?? 'OK'}
            </Btn>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
