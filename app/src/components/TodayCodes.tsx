import { useState } from 'react';
import type { Game } from '@memoria/shared';
import { useLiveCodes, useRedeemed } from '../codes';
import { fmtDur } from '../util';
import { Btn } from './ui';

/** Unredeemed codes for the games on the roster, while they still work. */
export function TodayCodes({ games, now }: { games: Game[]; now: number }) {
  const codes = useLiveCodes(games, now);
  const mark = useRedeemed((s) => s.mark);
  const [message, setMessage] = useState('');
  if (!codes.length) return null;
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(`Copied ${code}`);
    } catch {
      setMessage(`Could not copy ${code}`);
    }
  };
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
        {codes.map(({ game, key, code, rewards, expiresAt, redeemUrl }) => (
          <li key={`${game.id}:${code}`} className="flex items-center gap-2 px-2 py-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-meta text-fg">
                <span className="text-muted">{game.short} · </span>
                <code className="numeral select-all font-semibold">{code}</code>
              </p>
              <p className="aside truncate text-caption text-muted" title={rewards}>
                {expiresAt ? `${fmtDur(expiresAt - now)} left · ` : ''}
                {rewards}
              </p>
            </div>
            <Btn className="shrink-0" onClick={() => void copy(code)} aria-label={`Copy ${code}`}>
              Copy
            </Btn>
            {redeemUrl && (
              <a
                href={redeemUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Redeem ${code}`}
                className="min-h-11 shrink-0 content-center px-1 text-meta font-semibold text-accent-fg underline underline-offset-4 fine:min-h-8"
              >
                Redeem
              </a>
            )}
            <Btn className="shrink-0" onClick={() => mark(key, code)} aria-label={`Mark ${code} redeemed`}>
              ✓
            </Btn>
          </li>
        ))}
      </ul>
      <p role="status" className="px-2 text-caption text-muted empty:hidden">
        {message}
      </p>
    </section>
  );
}
