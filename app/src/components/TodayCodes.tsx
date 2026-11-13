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
    <section className="today-codes mb-4" aria-labelledby="today-codes-heading">
      <div className="today-group-rule">
        <h2 id="today-codes-heading" className="text-meta font-semibold text-fg-soft">
          Codes
        </h2>
        <span aria-hidden />
        <span className="numeral text-caption text-muted">{codes.length}</span>
      </div>
      <ul className="grid gap-1">
        {codes.map(({ game, key, code, rewards, expiresAt, redeemUrl }) => (
          <li key={`${game.id}:${code}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-body text-fg">
                <span className="text-muted">{game.short} · </span>
                <code className="numeral select-all font-semibold tracking-wide">{code}</code>
              </p>
              <p className="aside text-caption text-muted">
                {rewards}
                {expiresAt ? ` · expires in ${fmtDur(expiresAt - now)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => void copy(code)} aria-label={`Copy ${code}`}>
                Copy
              </Btn>
              {redeemUrl && (
                <a
                  href={redeemUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-11 content-center px-2 text-meta font-semibold text-accent-fg underline underline-offset-4 sm:min-h-8"
                >
                  Redeem
                </a>
              )}
              <Btn onClick={() => mark(key, code)} aria-label={`Mark ${code} redeemed`}>
                Redeemed
              </Btn>
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="px-2 text-caption text-muted empty:hidden">
        {message}
      </p>
    </section>
  );
}
