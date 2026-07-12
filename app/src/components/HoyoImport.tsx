import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { AnnEvent, EventType } from '@technogg/shared';
import { HOYO_KIND_LABEL } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDur } from '../util';
import { fetchHoyoAnnouncements } from '../hoyolab-client';
import { Sheet } from './Sheet';
import { Btn, Field, Select } from './ui';

const DAY = 86_400_000;
/** Announcements longer than this are permanent hubs/notices, not events. */
const MAX_SENSIBLE_DURATION = 70 * DAY;

const TYPE_BADGE: Record<EventType, { label: string; cls: string }> = {
  banner: { label: 'banner', cls: 'bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-300/25' },
  event: { label: 'event', cls: 'bg-sky-400/15 text-sky-200 ring-sky-300/25' },
  maintenance: { label: 'maint', cls: 'bg-slate-400/15 text-slate-300 ring-slate-300/25' },
  custom: { label: 'custom', cls: 'bg-white/10 text-slate-300 ring-white/15' },
};

export function HoyoImportSheet({ open }: { open: boolean }) {
  const app = useApp();
  const closeSheet = useUI((s) => s.closeSheet);

  const links = app.state.settings.hoyolabLinks.filter((l) =>
    app.state.games.some((g) => g.id === l.gameId && !g.deleted),
  );
  const [gameId, setGameId] = useState<string>('');
  const link = links.find((l) => l.gameId === gameId) ?? links[0];
  const game = app.state.games.find((g) => g.id === link?.gameId && !g.deleted);

  const [anns, setAnns] = useState<AnnEvent[] | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [importedMsg, setImportedMsg] = useState('');

  // Live (non-tombstoned) imported keys block re-import; deleted ones may return.
  const liveKeys = useMemo(
    () => new Set(app.state.events.filter((e) => !e.deleted && e.sourceKey).map((e) => e.sourceKey!)),
    [app.state.events],
  );

  useEffect(() => {
    if (!open || !link || !game) return;
    setAnns(null);
    setError('');
    setImportedMsg('');
    let cancelled = false;
    fetchHoyoAnnouncements(link.kind, link.region)
      .then((list) => {
        if (cancelled) return;
        setAnns(list);
        const now = Date.now();
        setChecked(
          new Set(
            list
              .filter(
                (a) =>
                  !liveKeys.has(a.sourceKey) &&
                  a.type !== 'maintenance' &&
                  a.end > now &&
                  a.end - a.start <= MAX_SENSIBLE_DURATION,
              )
              .map((a) => a.sourceKey),
          ),
        );
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link?.gameId, link?.kind, link?.region]);

  const toggle = (key: string) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const doImport = () => {
    if (!game || !anns) return;
    const picked = anns.filter((a) => checked.has(a.sourceKey) && !liveKeys.has(a.sourceKey));
    for (const a of picked) {
      app.upsertEvent({
        gameId: game.id,
        name: a.name,
        type: a.type,
        start: a.start,
        end: a.end,
        sourceKey: a.sourceKey,
        dailyTouch: false,
        notify: a.type !== 'maintenance',
      });
    }
    setImportedMsg(`Imported ${picked.length} event${picked.length === 1 ? '' : 's'} → Timeline.`);
    setChecked(new Set());
  };

  const now = Date.now();

  return (
    <Sheet open={open} onClose={closeSheet} wide title="⤓ Import events from HoYoLAB">
      {links.length === 0 ? (
        <p className="py-6 text-sm text-slate-400">
          Link a game first: Settings → HoYoLAB auto-import.
        </p>
      ) : (
        <>
          <Field label="Game">
            <Select value={link?.gameId ?? ''} onChange={(e) => setGameId(e.target.value)}>
              {links.map((l) => {
                const g = app.state.games.find((x) => x.id === l.gameId)!;
                return (
                  <option key={l.gameId} value={l.gameId}>
                    {g.name} — {HOYO_KIND_LABEL[l.kind]}
                  </option>
                );
              })}
            </Select>
          </Field>

          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          {!error && anns == null && <p className="mt-4 text-sm text-slate-400">Fetching announcements…</p>}
          {anns != null && anns.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">
              Nothing published right now{link?.kind === 'hsr' ? ' — Star Rail lists its events in the in-game calendar, not this feed' : ''}.
            </p>
          )}

          {anns != null && anns.length > 0 && (
            <>
              <div className="mt-3 max-h-[46dvh] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                {anns.map((a) => {
                  const imported = liveKeys.has(a.sourceKey);
                  const ended = a.end <= now;
                  const badge = TYPE_BADGE[a.type];
                  return (
                    <label
                      key={a.sourceKey}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white/5 ${
                        imported || ended ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-fuchsia-400"
                        checked={checked.has(a.sourceKey)}
                        disabled={imported}
                        onChange={() => toggle(a.sourceKey)}
                      />
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={a.name}>
                        {a.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                        {DateTime.fromMillis(a.start).toFormat('dd LLL')} → {DateTime.fromMillis(a.end).toFormat('dd LLL')}
                        {imported ? ' · imported' : ended ? ' · ended' : ` · ends in ${fmtDur(a.end - now)}`}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-3 pb-1">
                <Btn kind="primary" onClick={doImport} disabled={checked.size === 0}>
                  Import {checked.size || ''} selected
                </Btn>
                {importedMsg && <span className="text-xs text-emerald-300">{importedMsg}</span>}
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
