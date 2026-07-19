import { useState } from 'react';
import type { Cadence, ResourceKind, TaskMode } from '@technogg/shared';
import { SERVER_TZ_OPTIONS } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fileToImageDataUrl, intOr } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, NumInput, SectionTitle, Select, TextArea, TextInput, Toggle } from './ui';
import { RESOURCE_ICON_KEYS, ResourceIcon } from './ResourceIcon';
import { FONT_OPTIONS } from '../fonts';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly', 'custom'];
const RESOURCE_KINDS: ResourceKind[] = ['regen', 'weekly', 'counter'];
const TASK_MODES: TaskMode[] = ['check', 'timer', 'count'];

/**
 * Per-game settings, kept lean on purpose: identity, resets, resources, tasks.
 * Events live on the Timeline.
 */
export function GameDetailSheet({ gameId, open }: { gameId: string | null; open: boolean }) {
  const state = useApp((s) => s.state);
  const app = useApp();
  const closeSheet = useUI((s) => s.closeSheet);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [newTaskCadence, setNewTaskCadence] = useState<Cadence>('daily');
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipDelta, setNewChipDelta] = useState('-20');

  const game = state.games.find((g) => g.id === gameId && !g.deleted);
  if (!game) {
    return (
      <Sheet open={false} onClose={closeSheet} title="">
        {null}
      </Sheet>
    );
  }

  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const chips = state.chips.filter((c) => c.gameId === game.id && !c.deleted).sort((a, b) => a.sort - b.sort);
  const tasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted).sort((a, b) => a.sort - b.sort);

  const close = () => {
    setConfirmDelete(false);
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={close} wide title={game.name}>
      <SectionTitle>Basics</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
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
        <Field label="Accent color 2 (gradient partner)">
          <input
            type="color"
            value={game.color2 ?? game.color}
            onChange={(e) => app.updateGame(game.id, { color2: e.target.value })}
            className="h-9 w-full cursor-pointer rounded-xl bg-white/5 ring-1 ring-white/10"
          />
        </Field>
        <Field label="Title font">
          <Select
            value={game.titleFont ?? ''}
            onChange={(e) => app.updateGame(game.id, { titleFont: e.target.value || undefined })}
          >
            <option value="">Default</option>
            {FONT_OPTIONS.map((font) => (
              <option key={font.css} value={font.css}>
                {font.label}
              </option>
            ))}
            {game.titleFont && !FONT_OPTIONS.some((font) => font.css === game.titleFont) && (
              <option value={game.titleFont}>{game.titleFont}</option>
            )}
          </Select>
        </Field>
        <div className="flex items-end pb-1">
          <Toggle checked={game.paused} onChange={(v) => app.updateGame(game.id, { paused: v })} label="Paused" />
        </div>
        <Field label="Server timezone" className="sm:col-span-2">
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
            onChange={(e) =>
              app.updateGame(game.id, { dailyResetHour: Math.min(23, Math.max(0, intOr(e.target.value, 4))) })
            }
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
            onChange={(e) =>
              app.updateGame(game.id, { monthlyResetDay: Math.min(28, Math.max(1, intOr(e.target.value, 1))) })
            }
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <TextArea value={game.notes ?? ''} onChange={(e) => app.updateGame(game.id, { notes: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Card artwork
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-200 ring-1 ring-white/10 sm:min-h-9">
              {game.image ? 'Replace image' : 'Choose image'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void fileToImageDataUrl(file).then((image) => app.updateGame(game.id, { image }));
                }}
              />
            </label>
            {game.image && <Btn onClick={() => app.updateGame(game.id, { image: undefined })}>Remove image</Btn>}
          </div>
        </div>
      </div>

      <SectionTitle>Energy resources</SectionTitle>
      <div className="space-y-2">
        {resources.map((r) => (
          <div key={r.id}>
            <div className="grid grid-cols-6 items-end gap-2 rounded-2xl bg-white/[0.025] p-2 sm:grid-cols-[44px_minmax(0,1fr)_72px_72px_72px_44px] sm:bg-transparent sm:p-0">
              <button
                type="button"
                onClick={() => setIconPickerFor((cur) => (cur === r.id ? null : r.id))}
                className="order-1 col-span-1 flex h-11 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/10 transition hover:bg-white/10 sm:col-span-1 sm:h-9"
                style={{ boxShadow: iconPickerFor === r.id ? `inset 0 0 0 1.5px ${game.color}` : undefined }}
                aria-label={`Icon for ${r.name}`}
                title="Pick an icon"
              >
                <ResourceIcon iconKey={r.icon} color={game.color} size={18} />
              </button>
              <Field label="Name" className="order-2 col-span-4 sm:col-span-1">
                <TextInput
                  value={r.name}
                  onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, name: e.target.value })}
                />
              </Field>
              <Field label="Cap" className="order-4 col-span-2 sm:order-3 sm:col-span-1">
                <NumInput
                  value={String(r.cap)}
                  onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, cap: intOr(e.target.value, r.cap) })}
                />
              </Field>
              <Field label="Min/pt" className="order-5 col-span-2 sm:order-4 sm:col-span-1">
                <NumInput
                  value={String(r.regenMinutes)}
                  onChange={(e) =>
                    app.upsertResource({
                      id: r.id,
                      gameId: game.id,
                      regenMinutes: intOr(e.target.value, r.regenMinutes),
                    })
                  }
                />
              </Field>
              <Field label="Reserve" className="order-6 col-span-2 sm:order-5 sm:col-span-1">
                <NumInput
                  value={String(r.reserveCap)}
                  onChange={(e) =>
                    app.upsertResource({ id: r.id, gameId: game.id, reserveCap: intOr(e.target.value, r.reserveCap) })
                  }
                />
              </Field>
              <Field label="Kind" className="order-7 col-span-2 sm:col-span-2">
                <Select
                  value={r.kind ?? 'regen'}
                  onChange={(e) =>
                    app.upsertResource({ id: r.id, gameId: game.id, kind: e.target.value as ResourceKind })
                  }
                >
                  {RESOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reserve label" className="order-8 col-span-2 sm:col-span-2">
                <TextInput
                  value={r.reserveLabel ?? ''}
                  onChange={(e) =>
                    app.upsertResource({ id: r.id, gameId: game.id, reserveLabel: e.target.value || undefined })
                  }
                />
              </Field>
              <Field label="Rsv min/pt" className="order-9 col-span-2 sm:col-span-1">
                <NumInput
                  value={String(r.reserveRegenMinutes ?? r.regenMinutes * 2)}
                  onChange={(e) =>
                    app.upsertResource({
                      id: r.id,
                      gameId: game.id,
                      reserveRegenMinutes: Math.max(1, intOr(e.target.value, r.regenMinutes * 2)),
                    })
                  }
                />
              </Field>
              <button
                type="button"
                onClick={() => app.deleteResource(r.id)}
                className="order-3 col-span-1 flex h-11 items-center justify-center rounded-xl text-lg text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-400 sm:order-6 sm:col-span-1 sm:h-9"
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
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] ring-1 transition hover:bg-white/10 sm:h-9 sm:w-9"
                    style={{
                      boxShadow:
                        r.icon === key ? `inset 0 0 0 1.5px ${game.color}` : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                    }}
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
        <p className="text-[11px] text-slate-500">
          Min/pt = minutes per point of regen. 0 = doesn't regenerate. Rsv min/pt = minutes per reserve point once the
          bar is capped (defaults to double Min/pt — reserve fills at half speed).
        </p>
      </div>

      <SectionTitle>Quick spend</SectionTitle>
      <div className="space-y-2">
        {chips.map((chip) => (
          <div key={chip.id} className="grid grid-cols-[minmax(0,1fr)_88px_44px] items-center gap-2">
            <TextInput
              value={chip.label}
              aria-label="Quick spend label"
              onChange={(e) => app.upsertChip({ id: chip.id, gameId: game.id, label: e.target.value })}
            />
            <NumInput
              value={String(chip.delta)}
              aria-label={`${chip.label} energy change`}
              onChange={(e) =>
                app.upsertChip({ id: chip.id, gameId: game.id, delta: intOr(e.target.value, chip.delta) })
              }
            />
            <button
              type="button"
              onClick={() => app.deleteChip(chip.id)}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-400 sm:h-9 sm:w-9"
              aria-label={`Delete quick spend ${chip.label}`}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_88px_auto]">
          <TextInput
            placeholder="Label, e.g. Domain"
            value={newChipLabel}
            onChange={(e) => setNewChipLabel(e.target.value)}
          />
          <NumInput value={newChipDelta} aria-label="Energy change" onChange={(e) => setNewChipDelta(e.target.value)} />
          <Btn
            onClick={() => {
              if (!newChipLabel.trim()) return;
              app.upsertChip({
                gameId: game.id,
                label: newChipLabel.trim(),
                delta: intOr(newChipDelta, -20),
              });
              setNewChipLabel('');
            }}
          >
            + Shortcut
          </Btn>
        </div>
        <p className="text-[11px] text-slate-500">
          One-tap adjustments for the first energy resource. Use negative values for spending.
        </p>
      </div>

      <SectionTitle>Tasks</SectionTitle>
      <div className="space-y-2">
        {tasks.map((t) => (
          <div
            key={t.id}
            className="rounded-2xl bg-white/[0.025] p-2 sm:flex sm:items-center sm:gap-2 sm:bg-transparent sm:p-0"
          >
            <div className="flex min-w-0 gap-2 sm:flex-1">
              <TextInput
                value={t.name}
                aria-label={`Task name: ${t.name}`}
                onChange={(e) => app.updateTask(t.id, { name: e.target.value })}
              />
              <button
                type="button"
                onClick={() => app.deleteTask(t.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-400 sm:order-last sm:h-9 sm:w-9"
                aria-label={`Delete task ${t.name}`}
              >
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 sm:mt-0">
              <Select
                className="min-w-0 flex-1 sm:w-28 sm:shrink-0"
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
              <Select
                className="min-w-0 flex-1 sm:w-28 sm:shrink-0"
                value={t.mode ?? 'check'}
                onChange={(e) => app.updateTask(t.id, { mode: e.target.value as TaskMode })}
                aria-label={`Mode for ${t.name}`}
              >
                {TASK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </Select>
              {t.cadence === 'custom' && (
                <>
                  <NumInput
                    className="!w-24 shrink-0 sm:!w-16"
                    title="Cycle length (days) — used only when no timeline window matches"
                    aria-label={`Cycle days for ${t.name}`}
                    value={String(t.intervalDays)}
                    onChange={(e) => app.updateTask(t.id, { intervalDays: Math.max(1, intOr(e.target.value, 2)) })}
                  />
                  <div
                    className="flex shrink-0 items-center"
                    title="Follow the matching Timeline window (resets when it ends, hidden between windows)"
                  >
                    <Toggle
                      checked={t.timelineLinked !== false}
                      onChange={(v) => app.updateTask(t.id, { timelineLinked: v ? undefined : false })}
                      label="Timeline"
                    />
                  </div>
                  {t.timelineLinked !== false && (
                    <TextInput
                      className="min-w-0 flex-1 sm:!w-32 sm:flex-none"
                      placeholder="match: auto"
                      title="Keyword to match timeline event names (empty = match by task name)"
                      aria-label={`Timeline match for ${t.name}`}
                      value={t.timelineMatch ?? ''}
                      onChange={(e) => app.updateTask(t.id, { timelineMatch: e.target.value || undefined })}
                    />
                  )}
                </>
              )}
              {(t.mode ?? 'check') === 'timer' && (
                <NumInput
                  className="!w-24 shrink-0"
                  title="Timer minutes"
                  aria-label={`Timer minutes for ${t.name}`}
                  value={String(t.timerDurationMinutes ?? 20 * 60)}
                  onChange={(e) =>
                    app.updateTask(t.id, { timerDurationMinutes: Math.max(1, intOr(e.target.value, 20 * 60)) })
                  }
                />
              )}
              {(t.mode ?? 'check') === 'count' && (
                <NumInput
                  className="!w-20 shrink-0"
                  title="Runs required"
                  aria-label={`Count target for ${t.name}`}
                  value={String(t.countTarget ?? 1)}
                  onChange={(e) =>
                    app.updateTask(t.id, { countTarget: Math.min(365, Math.max(1, intOr(e.target.value, 1))) })
                  }
                />
              )}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_112px_auto]">
          <TextInput
            placeholder="New task…"
            aria-label="New task name"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
          />
          <Select
            className="w-full sm:w-28"
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

      <SectionTitle>Card display</SectionTitle>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Toggle
            checked={!game.hideProgressRing}
            onChange={(v) => app.updateGame(game.id, { hideProgressRing: !v })}
            label="Daily progress ring"
          />
          <Toggle
            checked={!game.hideEventStrip}
            onChange={(v) => app.updateGame(game.id, { hideEventStrip: !v })}
            label="Active events strip"
          />
          <Toggle
            checked={!game.hideSleepChip}
            onChange={(v) => app.updateGame(game.id, { hideSleepChip: !v })}
            label="Safe-to-sleep chip"
          />
        </div>
        <p className="text-[11px] text-slate-500">
          Turns whole blocks of the game card on or off. Individual energy bars, quick-spend buttons and tasks are
          removed above; individual events are edited on the Timeline.
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
            <Btn
              kind="danger"
              onClick={() => {
                app.deleteGame(game.id);
                close();
              }}
            >
              Really delete {game.short}
            </Btn>
            <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          </>
        )}
      </div>
    </Sheet>
  );
}
