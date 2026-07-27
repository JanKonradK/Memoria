import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cadence, Game, TaskMode } from '@void/shared';
import { SERVER_TZ_OPTIONS } from '@void/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fileToImageDataUrl, intOr } from '../util';
import { FONT_OPTIONS } from '../fonts';
import { GameAlerts } from './game-detail/GameAlerts';
import { ResourceEditor } from './game-detail/ResourceEditor';
import { Sheet } from './Sheet';
import { Btn, Field, NumInput, SectionTitle, Segmented, Select, TextArea, TextInput, Toggle } from './ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly', 'custom'];
const TASK_MODES: TaskMode[] = ['check', 'timer', 'count'];

type GameDetailSection = 'basics' | 'resources' | 'tasks' | 'display' | 'alerts' | 'danger';

const SECTIONS: { value: GameDetailSection; label: string }[] = [
  { value: 'basics', label: 'Basics' },
  { value: 'resources', label: 'Resources' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'display', label: 'Display' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'danger', label: 'Danger' },
];

type GameDraft = Pick<Game, 'name' | 'short'> & { notes: string };

function gameDraft(game: Game | undefined): GameDraft {
  return { name: game?.name ?? '', short: game?.short ?? '', notes: game?.notes ?? '' };
}

/** Per-game settings. Events remain on the Timeline. */
export function GameDetailSheet({ gameId, open }: { gameId: string | null; open: boolean }) {
  const state = useApp((s) => s.state);
  const updateGame = useApp((s) => s.updateGame);
  const deleteGame = useApp((s) => s.deleteGame);
  const upsertChip = useApp((s) => s.upsertChip);
  const deleteChip = useApp((s) => s.deleteChip);
  const addTask = useApp((s) => s.addTask);
  const updateTask = useApp((s) => s.updateTask);
  const deleteTask = useApp((s) => s.deleteTask);
  const closeSheet = useUI((s) => s.closeSheet);
  const [section, setSection] = useState<GameDetailSection>('basics');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [newTaskCadence, setNewTaskCadence] = useState<Cadence>('daily');
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipDelta, setNewChipDelta] = useState('-20');
  const game = state.games.find((candidate) => candidate.id === gameId && !candidate.deleted);
  const [draft, setDraft] = useState<GameDraft>(() => gameDraft(game));
  const draftRef = useRef(draft);
  const draftGameIdRef = useRef(gameId);

  const commitDraft = useCallback(() => {
    const draftGameId = draftGameIdRef.current;
    if (!draftGameId) return;
    const current = useApp
      .getState()
      .state.games.find((candidate) => candidate.id === draftGameId && !candidate.deleted);
    if (!current) return;
    const pending = draftRef.current;
    const patch: Partial<Game> = {};
    if (pending.name !== current.name) patch.name = pending.name;
    if (pending.short !== current.short) patch.short = pending.short;
    if (pending.notes !== (current.notes ?? '')) patch.notes = pending.notes;
    if (Object.keys(patch).length > 0) updateGame(draftGameId, patch);
  }, [updateGame]);

  const changeDraft = (field: keyof GameDraft, value: string) => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
  };

  useEffect(() => {
    if (open) setSection('basics');
  }, [open, gameId]);

  useEffect(() => {
    commitDraft();
    draftGameIdRef.current = gameId;
    if (!open || !gameId) return;
    const current = useApp.getState().state.games.find((candidate) => candidate.id === gameId && !candidate.deleted);
    const next = gameDraft(current);
    draftRef.current = next;
    setDraft(next);
  }, [commitDraft, gameId, open]);

  useEffect(() => {
    if (!open || !gameId) return;
    const timer = setTimeout(commitDraft, 300);
    return () => clearTimeout(timer);
  }, [commitDraft, draft, gameId, open]);

  useEffect(() => () => commitDraft(), [commitDraft]);

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
    commitDraft();
    setConfirmDelete(false);
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={close} wide title={game.name}>
      <div className="mb-5 overflow-x-auto pb-1">
        <Segmented options={SECTIONS} value={section} onChange={setSection} ariaLabel="Game settings section" />
      </div>

      {section === 'basics' && (
        <>
          <SectionTitle>Basics</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <TextInput
                value={draft.name}
                onChange={(event) => changeDraft('name', event.target.value)}
                onBlur={commitDraft}
              />
            </Field>
            <Field label="Short label (shown as the game's badge)">
              <TextInput
                value={draft.short}
                onChange={(event) => changeDraft('short', event.target.value)}
                onBlur={commitDraft}
              />
            </Field>
            <Field label="Accent color">
              <input
                type="color"
                value={game.color}
                onChange={(e) => updateGame(game.id, { color: e.target.value })}
                className="h-9 w-full cursor-pointer rounded-ui-lg bg-white/5 ring-1 ring-white/10"
              />
            </Field>
            <Field label="Accent color 2 (gradient partner)">
              <input
                type="color"
                value={game.color2 ?? game.color}
                onChange={(e) => updateGame(game.id, { color2: e.target.value })}
                className="h-9 w-full cursor-pointer rounded-ui-lg bg-white/5 ring-1 ring-white/10"
              />
            </Field>
            <Field label="Title font">
              <Select
                value={game.titleFont ?? ''}
                onChange={(e) => updateGame(game.id, { titleFont: e.target.value || undefined })}
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
              <Toggle checked={game.paused} onChange={(v) => updateGame(game.id, { paused: v })} label="Paused" />
            </div>
            <Field label="Server timezone" className="sm:col-span-2">
              <Select value={game.tz} onChange={(e) => updateGame(game.id, { tz: e.target.value })}>
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
                  updateGame(game.id, { dailyResetHour: Math.min(23, Math.max(0, intOr(e.target.value, 4))) })
                }
              />
            </Field>
            <Field label="Weekly reset day">
              <Select
                value={String(game.weeklyResetDay)}
                onChange={(e) => updateGame(game.id, { weeklyResetDay: intOr(e.target.value, 1) })}
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
                  updateGame(game.id, { monthlyResetDay: Math.min(28, Math.max(1, intOr(e.target.value, 1))) })
                }
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <TextArea
                value={draft.notes}
                onChange={(event) => changeDraft('notes', event.target.value)}
                onBlur={commitDraft}
              />
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-label font-semibold uppercase tracking-wider text-muted">
                Card artwork
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-ui-lg bg-white/[0.06] px-4 py-2 text-body font-semibold text-fg-soft ring-1 ring-white/10 sm:min-h-9">
                  {game.image ? 'Replace image' : 'Choose image'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const input = e.currentTarget;
                      input.setCustomValidity('');
                      const file = e.target.files?.[0];
                      if (file) {
                        void fileToImageDataUrl(file)
                          .then((image) => updateGame(game.id, { image }))
                          .catch((error: unknown) => {
                            input.setCustomValidity(
                              error instanceof Error ? error.message : 'The selected image could not be decoded.',
                            );
                            input.reportValidity();
                          });
                      }
                    }}
                  />
                </label>
                {game.image && <Btn onClick={() => updateGame(game.id, { image: undefined })}>Remove image</Btn>}
              </div>
            </div>
          </div>
        </>
      )}

      {section === 'resources' && (
        <>
          <SectionTitle>Energy resources</SectionTitle>
          <ResourceEditor game={game} resources={resources} />

          <SectionTitle>Quick spend</SectionTitle>
          <div className="space-y-2">
            {chips.map((chip) => (
              <div key={chip.id} className="grid grid-cols-[minmax(0,1fr)_88px_44px] items-center gap-2">
                <TextInput
                  value={chip.label}
                  aria-label="Quick spend label"
                  onChange={(e) => upsertChip({ id: chip.id, gameId: game.id, label: e.target.value })}
                />
                <NumInput
                  value={String(chip.delta)}
                  aria-label={`${chip.label} energy change`}
                  onChange={(e) =>
                    upsertChip({ id: chip.id, gameId: game.id, delta: intOr(e.target.value, chip.delta) })
                  }
                />
                <button
                  type="button"
                  onClick={() => deleteChip(chip.id)}
                  className="flex h-11 w-11 items-center justify-center rounded-ui-lg text-dim transition hover:bg-rose-400/10 hover:text-rose-400 sm:h-9 sm:w-9"
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
              <NumInput
                value={newChipDelta}
                aria-label="Energy change"
                onChange={(e) => setNewChipDelta(e.target.value)}
              />
              <Btn
                onClick={() => {
                  if (!newChipLabel.trim()) return;
                  upsertChip({
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
            <p className="text-label text-dim">
              One-tap adjustments for the first energy resource. Use negative values for spending.
            </p>
          </div>
        </>
      )}

      {section === 'tasks' && (
        <>
          <SectionTitle>Tasks</SectionTitle>
          <div className="space-y-3">
            {tasks.map((t) => {
              const mode = t.mode ?? 'check';
              const hasConditionalControls = t.cadence === 'custom' || mode === 'timer' || mode === 'count';

              return (
                <div key={t.id} className="rounded-ui-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
                  <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_128px_128px_44px]">
                    <Field label="Name">
                      <TextInput
                        value={t.name}
                        aria-label={`Task name: ${t.name}`}
                        onChange={(e) => updateTask(t.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Cadence">
                      <Select
                        value={t.cadence}
                        onChange={(e) => updateTask(t.id, { cadence: e.target.value as Cadence })}
                        aria-label={`Cadence for ${t.name}`}
                      >
                        {CADENCES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Mode">
                      <Select
                        value={mode}
                        onChange={(e) => updateTask(t.id, { mode: e.target.value as TaskMode })}
                        aria-label={`Mode for ${t.name}`}
                      >
                        {TASK_MODES.map((taskMode) => (
                          <option key={taskMode} value={taskMode}>
                            {taskMode}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <button
                      type="button"
                      onClick={() => deleteTask(t.id)}
                      className="flex h-11 w-11 items-center justify-center rounded-ui-lg text-dim transition hover:bg-rose-400/10 hover:text-rose-400 sm:h-9 sm:w-9"
                      aria-label={`Delete task ${t.name}`}
                    >
                      ✕
                    </button>
                  </div>

                  {hasConditionalControls && (
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-white/[0.08] pt-3 sm:grid-cols-3">
                      {t.cadence === 'custom' && (
                        <>
                          <Field label="Cycle days">
                            <NumInput
                              aria-label={`Cycle days for ${t.name}`}
                              value={String(t.intervalDays)}
                              onChange={(e) =>
                                updateTask(t.id, { intervalDays: Math.max(1, intOr(e.target.value, 2)) })
                              }
                            />
                          </Field>
                          <Field label="Timeline window">
                            <Toggle
                              checked={t.timelineLinked !== false}
                              onChange={(v) => updateTask(t.id, { timelineLinked: v ? undefined : false })}
                              label="Follow matching event"
                            />
                          </Field>
                          {t.timelineLinked !== false && (
                            <Field label="Timeline match">
                              <TextInput
                                placeholder="Auto (task name)"
                                aria-label={`Timeline match for ${t.name}`}
                                value={t.timelineMatch ?? ''}
                                onChange={(e) => updateTask(t.id, { timelineMatch: e.target.value || undefined })}
                              />
                            </Field>
                          )}
                        </>
                      )}
                      {mode === 'timer' && (
                        <Field label="Timer minutes">
                          <NumInput
                            aria-label={`Timer minutes for ${t.name}`}
                            value={String(t.timerDurationMinutes ?? 20 * 60)}
                            onChange={(e) =>
                              updateTask(t.id, {
                                timerDurationMinutes: Math.max(1, intOr(e.target.value, 20 * 60)),
                              })
                            }
                          />
                        </Field>
                      )}
                      {mode === 'count' && (
                        <Field label="Count target">
                          <NumInput
                            aria-label={`Count target for ${t.name}`}
                            value={String(t.countTarget ?? 1)}
                            onChange={(e) =>
                              updateTask(t.id, {
                                countTarget: Math.min(365, Math.max(1, intOr(e.target.value, 1))),
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_112px_auto]">
              <Field label="New task">
                <TextInput
                  placeholder="New task…"
                  aria-label="New task name"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                />
              </Field>
              <Field label="Cadence">
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
              </Field>
              <Btn
                className="shrink-0"
                onClick={() => {
                  if (!newTask.trim()) return;
                  addTask(game.id, newTask.trim(), newTaskCadence);
                  setNewTask('');
                }}
              >
                + Task
              </Btn>
            </div>
            <p className="text-label text-dim">Events → Timeline tab · focus, teams, currency & stats → Stats tab.</p>
          </div>
        </>
      )}

      {section === 'display' && (
        <>
          <SectionTitle>Card display</SectionTitle>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle
                checked={!game.hideProgressRing}
                onChange={(v) => updateGame(game.id, { hideProgressRing: !v })}
                label="Daily progress ring"
              />
              <Toggle
                checked={!game.hideEventStrip}
                onChange={(v) => updateGame(game.id, { hideEventStrip: !v })}
                label="Active events strip"
              />
            </div>
            <p className="text-label text-dim">
              Turns whole blocks of the game card on or off. Individual energy bars, quick-spend buttons and tasks are
              removed above; individual events are edited on the Timeline.
            </p>
          </div>
        </>
      )}

      {section === 'alerts' && (
        <>
          <SectionTitle>Alert overrides</SectionTitle>
          <GameAlerts game={game} />
        </>
      )}

      {section === 'danger' && (
        <>
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
                    deleteGame(game.id);
                    close();
                  }}
                >
                  Really delete {game.short}
                </Btn>
                <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
              </>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
