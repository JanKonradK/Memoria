import { motion } from 'framer-motion';
import { DateTime } from 'luxon';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDur, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { Btn, SectionTitle } from './ui';

const DAY = 86_400_000;

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const deleteReminder = useApp((s) => s.deleteReminder);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const openSheet = useUI((s) => s.openSheet);

  const seedPlan = planSeedImport(state, now);
  const importSeed = () => {
    for (const p of seedPlan) {
      if (p.kind === 'add') {
        upsertEvent({
          gameId: p.gameId,
          name: p.seed.name,
          type: p.seed.type,
          start: p.start,
          end: p.end,
          dailyTouch: p.seed.dailyTouch ?? false,
          notify: p.seed.type === 'maintenance' ? false : p.seed.notify ?? true,
          notes: p.seed.notes ?? '',
          sourceKey: p.seed.sourceKey,
        });
      } else {
        // Refresh pass: correct previously imported dates/names (TBC → confirmed).
        upsertEvent({ id: p.eventId, gameId: p.gameId, name: p.seed.name, start: p.start, end: p.end });
      }
    }
  };

  const ws = now - 2 * DAY;
  const we = now + 16 * DAY;
  const span = we - ws;

  const gameById = new Map(state.games.filter((g) => !g.deleted).map((g) => [g.id, g]));
  const events = state.events
    .filter((e) => !e.deleted && gameById.has(e.gameId) && e.end >= ws && e.start <= we)
    .sort((a, b) => a.end - b.end);
  const reminders = state.reminders.filter((r) => !r.deleted).sort((a, b) => a.at - b.at);

  const ticks: DateTime[] = [];
  for (let i = 0; i <= 6; i++) ticks.push(DateTime.fromMillis(ws + (span / 6) * i));

  return (
    <div className="mx-auto w-full max-w-4xl px-5 pb-28 pt-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-slate-100">Event timeline</h2>
        <div className="flex gap-2">
          {seedPlan.length > 0 && (
            <Btn onClick={importSeed} title={`Bundled with the app (updated ${SEED_UPDATED}) — adds new events, fixes changed dates`}>
              📦 Import {seedPlan.length}
            </Btn>
          )}
          {state.settings.hoyolabLinks.length > 0 && (
            <Btn onClick={() => openSheet({ kind: 'hoyoImport' })}>⤓ HoYoLAB</Btn>
          )}
          <Btn onClick={() => openSheet({ kind: 'pasteEvents' })}>📋 Paste (AI)</Btn>
          <Btn kind="primary" onClick={() => openSheet({ kind: 'event' })}>
            + Event
          </Btn>
        </div>
      </div>

      <div className="glass gold-hairline relative rounded-3xl p-4">
        <div className="relative mb-2 ml-0 h-4 text-[10px] text-slate-500">
          {ticks.map((t, i) => (
            <span key={i} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(i / 6) * 100}%` }}>
              {t.toFormat('dd LLL')}
            </span>
          ))}
        </div>

        <div className="relative space-y-2 py-1">
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400/80"
            style={{ left: `${((now - ws) / span) * 100}%` }}
          >
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-rose-400" />
          </div>

          {events.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No events yet — add banners and events so nothing ends without you noticing.
            </p>
          )}

          {events.map((ev) => {
            const game = gameById.get(ev.gameId)!;
            const left = (Math.max(ev.start, ws) - ws) / span;
            const width = (Math.min(ev.end, we) - Math.max(ev.start, ws)) / span;
            const ended = ev.end <= now;
            return (
              <motion.button
                key={ev.id}
                type="button"
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => openSheet({ kind: 'event', eventId: ev.id, gameId: ev.gameId })}
                className="relative block h-9 w-full rounded-xl text-left"
                title={`${game.name}: ${ev.name}`}
              >
                <div className="absolute inset-0 rounded-xl bg-white/[0.03]" />
                <motion.div
                  layout
                  className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-xl px-2"
                  style={{
                    left: `${left * 100}%`,
                    width: `${Math.max(width * 100, 8)}%`,
                    background: `linear-gradient(90deg, ${tint(game.color, 0.25)}, ${tint(game.color, 0.5)})`,
                    boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.5)}`,
                    opacity: ended ? 0.4 : 1,
                  }}
                >
                  <span className="text-xs">{game.icon}</span>
                  <span className="truncate text-xs font-semibold text-slate-100">{ev.name}</span>
                </motion.div>
                <span className="absolute -bottom-0.5 right-1 text-[10px] font-bold tabular-nums" style={{ color: game.color }}>
                  {ended ? 'ended' : `ends in ${fmtDur(ev.end - now)}`}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      <SectionTitle>One-off reminders</SectionTitle>
      <div className="space-y-2">
        {reminders.map((r) => {
          const game = r.gameId ? gameById.get(r.gameId) : undefined;
          const due = r.at <= now;
          return (
            <div
              key={r.id}
              className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 ${due ? 'opacity-60' : ''}`}
            >
              <span className="text-lg">{game?.icon ?? '⏰'}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{r.message}</div>
                <div className="text-[11px] tabular-nums text-slate-500">
                  {DateTime.fromMillis(r.at).toFormat('ccc dd LLL HH:mm')} {due ? '· sent/due' : `· in ${fmtDur(r.at - now)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteReminder(r.id)}
                className="text-slate-500 transition hover:text-rose-400"
                aria-label="Delete reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
        <Btn onClick={() => openSheet({ kind: 'reminder' })}>+ Reminder</Btn>
      </div>
    </div>
  );
}
