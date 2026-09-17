import { useState } from 'react';
import { redemptionCodeStatus } from '@memoria/shared';
import type { LivestreamCodes as CodeSet } from '../data/livestreams';
import { useNow } from '../hooks';
import { Btn } from './ui';

export function LivestreamCodes({ redemption, gameName }: { redemption: CodeSet; gameName: string }) {
  const now = useNow(30_000);
  const status = redemptionCodeStatus(redemption.expiresAt, now);
  const [message, setMessage] = useState('');
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(`${code} copied. Paste it to redeem.`);
    } catch {
      setMessage(`Could not copy ${code}. Select the code and copy it manually.`);
    }
  };
  return (
    <section aria-label={`${gameName} reward codes`} className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body font-semibold text-fg">Reward codes</h3>
        <span className="text-meta text-muted">
          {status === 'expired'
            ? 'Expired'
            : status === 'available'
              ? 'Redemption window open'
              : 'Expiry not confirmed'}
        </span>
      </div>
      {redemption.expiryLabel && (
        <p className="mt-1 text-caption text-muted">
          {status === 'expired' ? 'Expired' : 'Expires'} {redemption.expiryLabel}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line">
        {redemption.codes.map(({ code, rewards, redeemUrl }) => (
          <li key={code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1 basis-48">
              <code className="select-all break-all font-mono text-body font-semibold text-fg">{code}</code>
              <p className="mt-1 text-meta text-muted">{rewards}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Btn onClick={() => void copy(code)} aria-label={`Copy ${code}`} disabled={status === 'expired'}>
                Copy
              </Btn>
              {redeemUrl && (
                <a
                  href={redeemUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${status === 'expired' ? 'Redemption page for' : 'Redeem'} ${code}`}
                  className="inline-flex min-h-11 items-center text-meta text-accent-fg underline underline-offset-4"
                >
                  {status === 'expired' ? 'Redemption page' : 'Redeem'} ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-1 text-meta text-fg-soft">
        {message}
      </p>
      <p className="mt-3 text-meta leading-relaxed text-muted">{redemption.instructions}</p>
      <a
        href={redemption.source.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex min-h-11 items-center text-caption text-muted underline underline-offset-4 hover:text-fg"
      >
        {redemption.source.label} ↗
      </a>
    </section>
  );
}
