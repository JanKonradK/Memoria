import type { Game } from '@memoria/shared';
import { useState } from 'react';
import { useCopyCode, useLiveCodes } from '../codes';
import { fmtDur } from '../util';
import { CodeClaim, markCodeRedeemed } from './CodeClaim';
import { Btn, Tooltip } from './ui';

const LINK_CLASS =
  'min-h-11 shrink-0 content-center px-1 text-meta font-semibold text-accent-fg underline underline-offset-4 fine:min-h-8';

/** Unredeemed codes for the games on the roster, while they still work. */
export function TodayCodes({ games, now }: { games: Game[]; now: number }) {
  const codes = useLiveCodes(games, now);
  const { copied, message, copy } = useCopyCode();
  const [note, setNote] = useState('');
  if (!codes.length) return null;
  return (
    <section className="today-codes" aria-labelledby="today-codes-heading">
      <div className="today-group-rule">
        <h2 id="today-codes-heading" className="text-meta font-semibold text-fg-soft">
          Codes
        </h2>
        <span aria-hidden />
        <span className="numeral text-caption text-muted">{codes.length}</span>
      </div>
      <ul className="grid gap-0.5">
        {codes.map(({ game, key, code, rewards, expiresAt, redeemUrl, customId }) => (
          <li key={`${game.id}:${code}`} className="flex flex-wrap items-center gap-2 px-2 py-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-meta text-fg">
                <span className="text-muted">{game.short} · </span>
                <code className="numeral select-all font-semibold">{code}</code>
              </p>
              <Tooltip content={rewards}>
                <p className="aside truncate text-caption text-muted">
                  {expiresAt ? `${fmtDur(expiresAt - now)} left · ` : ''}
                  {rewards}
                </p>
              </Tooltip>
            </div>
            <Btn className="min-w-16 shrink-0" onClick={() => void copy(code)} aria-label={`Copy ${code}`}>
              {copied === code ? 'Copied' : 'Copy'}
            </Btn>
            <CodeClaim
              game={game}
              item={{ code, key, customId, redeemUrl }}
              linkClassName={LINK_CLASS}
              onDone={setNote}
            />
            <Btn
              className="shrink-0"
              onClick={() => markCodeRedeemed(game.id, { code, key, customId }, `Marked ${code} redeemed`)}
              aria-label={`Mark ${code} redeemed`}
            >
              ✓
            </Btn>
          </li>
        ))}
      </ul>
      <p role="status" className="px-2 text-caption text-muted empty:hidden">
        {note || message}
      </p>
    </section>
  );
}
