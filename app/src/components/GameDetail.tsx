import { useState } from 'react';
import type { Cadence } from '@technogg/shared';
import { SERVER_TZ_OPTIONS } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, NumInput, SectionTitle, Select, TextInput, Toggle } from './ui';
import { RESOURCE_ICON_KEYS, ResourceIcon } from './ResourceIcon';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly', 'custom'];

/**
 * Per-game settings, kept lean on purpose: identity, resets, resources, tasks.
 * Events live on the Timeline; focus/teams/wallet/purchases live on Stats.
 */
export function GameDetailSheet({ gameId, open }: { gameId: string | null; open: boolean }) {
  const state = useApp((s) => s.state);
  const app = useApp();
  const closeSheet = useUI((s) => s.closeSheet);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [newTaskCadence, setNewTaskCadence] = useState<Cadence>('daily');

  const game = state.games.find((g) => g.id === gameId && !g.deleted);
  if (!game) {
    return <Sheet open={false} onClose={closeSheet} title="">{null}</Sheet>;
  }

  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const tasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted).sort((a, b) => a.sort - b.sort);

  const close = () => {
    setConfirmDelete(false);
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={close} wide title={game.name}>
      <SectionTitle>Basics</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <TextInput value={game.name} onChange={(e) => app.updateGame(game.id, { name: e.target.value })} />
        </Field>
        <Field label="Short label (shown as the game's badge)">
          <TextInput value={game.short} onChange={(e) => app.updateGame(game.id, { short: e.target.value })} />
        </Field>
        <Field label="Accent color">
          <input
            type="color"
            value={game.color}
            onChange={(e) => app.updateGame(game.id, { color: e.target.value })}
            className="h-9 w-full cursor-pointer rounded-xl bg-white/5 ring-1 ring-white/10"
          />
        </Field>
        <div className="flex items-end pb-1">
          <Toggle checked={game.paused} onChange={(v) => app.updateGame(game.id, { paused: v })} label="Paused" />
        </div>

        <Field label="Server timezone" className="col-span-2">
          <Select value={game.tz} onChange={(e) => app.updateGame(game.id, { tz: e.target.value })}>
            {SERVER_TZ_OPTIONS.map((o) => (
              <option key={o.tz} value={o.tz}>
                {o.label}
              </option>
            ))}
            {!SERVER_TZ_OPTIONS.some((o) => o.tz === game.tz) && <option value={game.tz}>{game.tz}</option>}
          </Select>
        </Field>
        <Field label="Daily reset hour">
          <NumInput
            value={String(game.dailyResetHour)}
            min={0}
            max={23}
            onChange={(e) => app.updateGame(game.id, { dailyResetHour: Math.min(23, Math.max(0, intOr(e.target.value, 4))) })}
          />
        </Field>
        <Field label="Weekly reset day">
          <Select
            value={String(game.weeklyResetDay)}
            onChange={(e) => app.updateGame(game.id, { weeklyResetDay: intOr(e.target.value, 1) })}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={String(i + 1)}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Monthly reset day">
          <NumInput
            value={String(game.monthlyResetDay)}
            min={1}
            max={28}
            onChange={(e) => app.updateGame(game.id, { monthlyResetDay: Math.min(28, Math.max(1, intOr(e.target.value, 1))) })}
          />
        </Field>
      </div>
      {game.notes && <p className="mt-2 text-[11px] text-amber-200/80">{game.notes}</p>}

      <SectionTitle>Energy resources</SectionTitle>
      <div className="space-y-2">
        {resources.map((r) => (
          <div key={r.id}>
          <div className="grid grid-cols-[36px_1fr_60px_60px_60px_28px] items-end gap-2">
            <button
              type="button"
              onClick={() => setIconPickerFor((cur) => (cur === r.id ? null : r.id))}
              className="flex h-9 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/10 transition hover:bg-white/10"
              style={{ boxShadow: iconPickerFor === r.id ? `inset 0 0 0 1.5px ${game.color}` : undefined }}
              aria-label={`Icon for ${r.name}`}
              title="Pick an icon"
            >
              <ResourceIcon iconKey={r.icon} color={game.color} size={18} />
            </button>
            <Field label="Name">
              <TextInput value={r.name} onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, name: e.target.value })} />
            </Field>
            <Field label="Cap">
              <NumInput value={String(r.cap)} onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, cap: intOr(e.target.value, r.cap) })} />
            </Field>
            <Field label="Min/pt">
              <NumInput
                value={String(r.regenMinutes)}
                onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, regenMinutes: intOr(e.target.value, r.regenMinutes) })}
              />
            </Field>
            <Field label="Reserve">
              <NumInput
                value={String(r.reserveCap)}
                onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, reserveCap: intOr(e.target.value, r.reserveCap) })}
              />
            </Field>
            <button
              type="button"
              onClick={() => app.deleteResource(r.id)}
              className="mb-1 text-lg text-slate-500 transition hover:text-rose-400"
              aria-label={`Delete ${r.name}`}
            >
              ✕
            </button>
          </div>
          {iconPickerFor === r.id && (
            <div className="mt-2 flex flex-wrap gap-1.5 rounded-2xl bg-white/[0.04] p-2 ring-1 ring-white/10">
              {RESOURCE_ICON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    app.upsertResource({ id: r.id, gameId: game.id, icon: key });
                    setIconPickerFor(null);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] ring-1 transition hover:bg-white/10"
                  style={{ boxShadow: r.icon === key ? `inset 0 0 0 1.5px ${game.color}` : 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                  title={key}
                >
                  <ResourceIcon iconKey={key} color={game.color} size={18} />
                </button>
              ))}
            </div>
          )}
          </div>
        ))}
        <Btn onClick={() => app.upsertResource({ gameId: game.id, name: 'Energy' })}>+ Resource</Btn>
        <p className="text-[11px] text-slate-500">Min/pt = minutes per point of regen. 0 = doesn't regenerate.</p>
      </div>

      <SectionTitle>Tasks</SectionTitle>
      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <TextInput value={t.name} onChange={(e) => app.updateTask(t.id, { name: e.target.value })} />
            <Select
              className="w-28 shrink-0"
              value={t.cadence}
              onChange={(e) => app.updateTask(t.id, { cadence: e.target.value as Cadence })}
              aria-label={`Cadence for ${t.name}`}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {t.cadence === 'custom' && (
              <NumInput
                className="!w-16 shrink-0"
                title="Cycle length (days)"
                aria-label={`Cycle days for ${t.name}`}
                value={String(t.intervalDays)}
                onChange={(e) => app.updateTask(t.id, { intervalDays: Math.max(1, intOr(e.target.value, 2)) })}
              />
            )}
            <button
              type="button"
              onClick={() => app.deleteTask(t.id)}
              className="text-slate-500 transition hover:text-rose-400"
              aria-label={`Delete task ${t.name}`}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <TextInput placeholder="New task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
          <Select
            className="w-28 shrink-0"
            value={newTaskCadence}
            onChange={(e) => setNewTaskCadence(e.target.value as Cadence)}
            aria-label="New task cadence"
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Btn
            className="shrink-0"
            onClick={() => {
              if (!newTask.trim()) return;
              app.addTask(game.id, newTask.trim(), newTaskCadence);
              setNewTask('');
            }}
          >
            + Task
          </Btn>
        </div>
        <p className="text-[11px] text-slate-500">
          Events → Timeline tab · focus, teams, currency & stats → Stats tab.
        </p>
      </div>

      <SectionTitle>Danger zone</SectionTitle>
      <div className="flex gap-2 pb-2">
        {!confirmDelete ? (
          <Btn kind="danger" onClick={() => setConfirmDelete(true)}>
            Delete game…
          </Btn>
        ) : (
          <>
            <Btn kind="danger" onClick={() => { app.deleteGame(game.id); close(); }}>
              Really delete {game.short}
            </Btn>
            <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          </>
        )}
      </div>
    </Sheet>
  );
}
