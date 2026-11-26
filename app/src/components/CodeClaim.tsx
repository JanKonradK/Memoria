import { useState } from 'react';
import type { Game } from '@memoria/shared';
import { useRedeemed, withUndo } from '../codes';
import { useHoyolabLinked } from '../connectors-state';
import type { HoyolabRedeemResult } from '../desktop-host';
import { useApp } from '../store';
import { Pill } from './primitives';
import { Btn } from './ui';

/** The parts of a code a claim needs, from a game's list or Today's. */
export interface ClaimableCode {
  code: string;
  /** The feed's game key, which the redeemed list uses. */
  key: string;
  customId?: string;
  redeemUrl?: string;
}

type Failure = { label: string; message: string; tone: 'warn' | 'danger' };

const FAILED: Record<Exclude<HoyolabRedeemResult['status'], 'redeemed' | 'already'>, Failure['label']> = {
  expired: 'Expired',
  invalid: 'Invalid',
  cooldown: 'Cooldown',
  auth: 'Sign in needed',
  failed: 'Failed',
};

/** Marks a code redeemed: a saved one with Undo, a feed one on this device. */
export function markCodeRedeemed(gameId: string, item: ClaimableCode, text: string): void {
  const id = item.customId;
  if (id) withUndo(text, () => useApp.getState().toggleGameCodeRedeemed(gameId, id));
  else useRedeemed.getState().mark(item.key, item.code);
}

/**
 * A code's claim controls, as siblings in its row. With a linked HoYoLAB
 * account, Claim redeems it in one tap; otherwise its link opens the official
 * page and Worked / Failed record how that went.
 */
export function CodeClaim({
  game,
  item,
  linkClassName,
  onDone,
}: {
  game: Game;
  item: ClaimableCode;
  linkClassName: string;
  onDone(message: string): void;
}) {
  const linked = useHoyolabLinked(game.id);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const done = (text: string) => {
    markCodeRedeemed(game.id, item, text);
    onDone(text);
  };

  const claim = async () => {
    setBusy(true);
    setOpened(false);
    setFailure(null);
    let result: HoyolabRedeemResult;
    try {
      const { redeemHoyolabCode } = await import('../connectors');
      result = await redeemHoyolabCode(game.id, item.code);
    } catch {
      result = { ok: false, status: 'failed', retcode: null, message: 'HoYoverse could not be reached.' };
    }
    setBusy(false);
    if (result.status === 'redeemed' || result.status === 'already') {
      done(result.status === 'redeemed' ? `Claimed ${item.code}` : `Already claimed ${item.code}`);
      return;
    }
    setFailure({
      label: FAILED[result.status] ?? 'Failed',
      message: result.message,
      tone: result.status === 'cooldown' || result.status === 'auth' ? 'warn' : 'danger',
    });
  };

  return (
    <>
      {linked && (
        <Btn
          kind="primary"
          className="shrink-0"
          aria-label={`Claim ${item.code}`}
          aria-busy={busy}
          disabled={busy}
          onClick={() => void claim()}
        >
          {busy ? 'Claiming…' : 'Claim'}
        </Btn>
      )}
      {item.redeemUrl && (
        <a
          href={item.redeemUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Redeem ${item.code}`}
          className={linkClassName}
          onClick={() => {
            setOpened(true);
            setFailure(null);
          }}
        >
          {linked ? 'Open link ↗' : 'Redeem ↗'}
        </a>
      )}
      {opened && (
        <>
          <Btn
            className="shrink-0"
            aria-label={`${item.code} worked`}
            onClick={() => done(`Marked ${item.code} redeemed`)}
          >
            Worked ✓
          </Btn>
          <Btn
            className="shrink-0"
            aria-label={`${item.code} failed`}
            onClick={() => {
              setOpened(false);
              setFailure({ label: 'Failed', message: 'It did not redeem on the site.', tone: 'danger' });
            }}
          >
            Failed
          </Btn>
        </>
      )}
      {failure && (
        <p className="row-arrive flex basis-full items-center gap-2 text-caption">
          <Pill variant={failure.tone}>{failure.label}</Pill>
          <span className={failure.tone === 'warn' ? 'text-warn-fg' : 'text-danger-fg'}>{failure.message}</span>
        </p>
      )}
    </>
  );
}
