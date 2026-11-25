import { useState } from 'react';
import type { ChecklistItem } from '@memoria/shared';
import { withUndo } from '../codes';
import { useHoyolabLinked } from '../connectors-state';
import type { HoyolabCheckInResult } from '../desktop-host';
import { Pill } from './primitives';

export interface CheckInFailure {
  label: string;
  message: string;
  tone: 'warn' | 'danger';
}

const FAILED: Record<Exclude<HoyolabCheckInResult['status'], 'claimed' | 'already'>, CheckInFailure['label']> = {
  captcha: 'Verify',
  auth: 'Sign in needed',
  failed: 'Failed',
};

/** A HoYoLAB daily check-in task: a preset's own, or any task done on act.hoyolab.com. */
export function isHoyolabCheckIn(item: Pick<ChecklistItem, 'taskId' | 'link'>): boolean {
  if (/(?:^|[-:])(?:genshin|hsr|zzz)-hoyolab$/.test(item.taskId)) return true;
  try {
    return item.link != null && new URL(item.link).hostname === 'act.hoyolab.com';
  } catch {
    return false;
  }
}

/**
 * One-tap claiming for a HoYoLAB check-in task when the game is linked: a
 * claim (or one already made today) ticks the task with Undo; anything else
 * leaves it open and says why, so the page link is the fallback.
 */
export function useCheckInClaim(
  item: ChecklistItem,
  setTaskDone: (taskId: string, periodKey: string, done: boolean) => void,
): { available: boolean; busy: boolean; failure: CheckInFailure | null; claim(): void } {
  const linked = useHoyolabLinked(item.gameId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CheckInFailure | null>(null);
  const available = linked && !item.done && isHoyolabCheckIn(item);
  const claim = () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void import('../connectors')
      .then(({ claimHoyolabCheckIn }) => claimHoyolabCheckIn(item.gameId))
      .catch((): HoyolabCheckInResult => ({
        ok: false,
        status: 'failed',
        retcode: null,
        message: 'HoYoLAB could not be reached.',
      }))
      .then((result) => {
        setBusy(false);
        if (result.status === 'claimed' || result.status === 'already') {
          withUndo(
            result.status === 'claimed' ? 'Claimed HoYoLAB daily check-in' : 'Already checked in on HoYoLAB today',
            () => setTaskDone(item.taskId, item.periodKey, true),
          );
          return;
        }
        setFailure({
          label: FAILED[result.status] ?? 'Failed',
          message: result.message,
          tone: result.status === 'failed' ? 'danger' : 'warn',
        });
      });
  };
  return { available, busy, failure, claim };
}

/** Why a check-in did not go through, as a badge and its sentence. */
export function CheckInFailureNote({ failure, className = '' }: { failure: CheckInFailure; className?: string }) {
  return (
    <p className={`row-arrive flex items-center gap-2 text-caption ${className}`}>
      <Pill variant={failure.tone}>{failure.label}</Pill>
      <span className={failure.tone === 'warn' ? 'text-warn-fg' : 'text-danger-fg'}>{failure.message}</span>
    </p>
  );
}
