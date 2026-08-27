import { useState } from 'react';
import type { Cadence, Game, TaskMode } from '@memoria/shared';
import { missingPresetTasks } from '@memoria/shared';
import { FONT_OPTIONS } from '../../fonts';
import { useApp } from '../../store';
import { fileToImageDataUrl, intOr } from '../../util';
import { ResourceEditor } from '../game-detail/ResourceEditor';
import { useGameDraft } from '../game-detail/useGameDraft';
import { Btn, Field, NumInput, SectionTitle, Select, TextArea, TextInput, Toggle } from '../ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Cycle' },
];
const TASK_MODES: { value: TaskMode; label: string }[] = [
  { value: 'check', label: 'Checkbox' },
  { value: 'timer', label: 'Timer' },
  { value: 'count', label: 'Counter' },
];
const SETTINGS_DRAFT_FIELDS = ['name', 'short', 'notes'] as const;

export function GameEditor({ game }: { game: Game }) {
  const state = useApp((store) => store.state);
  const updateGame = useApp((store) => store.updateGame);
  const upsertChip = useApp((store) => store.upsertChip);
  const deleteChip = useApp((store) => store.deleteChip);
  const addTask = useApp((store) => store.addTask);
  const addMissingPresetTasks = useApp((store) => store.addMissingPresetTasks);
  const updateTask = useApp((store) => store.updateTask);
  const deleteTask = useApp((store) => store.deleteTask);
  const [imageError, setImageError] = useState('');
  const [newTask, setNewTask] = useState('');
  const [newTaskCadence, setNewTaskCadence] = useState<Cadence>('daily');
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipDelta, setNewChipDelta] = useState('-20');
  const { changeDraft, commitDraft, draft } = useGameDraft(game, SETTINGS_DRAFT_FIELDS);
  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const chips = state.chips.filter((c) => c.gameId === game.id && !c.deleted).sort((a, b) => a.sort - b.sort);
  const tasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted).sort((a, b) => a.sort - b.sort);
  // Presets grow with the games; a game added last month keeps the routine list
  // it was born with, so offer the difference rather than silently backfilling.
  const presetGap = missingPresetTasks(
    game,
    state.tasks.filter((task) => task.gameId === game.id),
  ).length;

  return (
    <div className="space-y-6 pt-4">
      <section>
        <SectionTitle>Game</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <TextInput
              className="sm:!min-h-8 sm:!py-1"
              value={draft.name}
              onChange={(event) => changeDraft('name', event.target.value)}
              onBlur={commitDraft}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Short label (shown as the game's badge)">
              <TextInput
                className="sm:!min-h-8 sm:!py-1"
                value={draft.short}
                onChange={(event) => changeDraft('short', event.target.value)}
                onBlur={commitDraft}
              />
            </Field>
            <p className="mt-1 text-label text-dim">
              Two to four characters. Give each account its own badge so you can tell them apart at a glance.
            </p>
          </div>
          <Field label="Accent color">
            <input
              type="color"
              value={game.color}
              onChange={(event) => updateGame(game.id, { color: event.target.value })}
              className="h-11 w-16 cursor-pointer rounded-ui-lg bg-fill-2 ring-1 ring-line-hairline sm:h-8 sm:w-14"
            />
          </Field>
          <Field label="Accent color 2 (gradient partner)">
            <input
              type="color"
              value={game.color2 ?? game.color}
              onChange={(event) => updateGame(game.id, { color2: event.target.value })}
              className="h-11 w-16 cursor-pointer rounded-ui-lg bg-fill-2 ring-1 ring-line-hairline sm:h-8 sm:w-14"
            />
          </Field>
          <Field label="Title font">
            <Select
              className="sm:!min-h-8 sm:!py-1"
              value={game.titleFont ?? ''}
              onChange={(event) => updateGame(game.id, { titleFont: event.target.value || undefined })}
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
          <div className="sm:col-span-2">
            <span className="mb-1 block text-label font-semibold uppercase tracking-wider text-muted">
              Card artwork
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="btn-compact inline-flex min-h-11 w-fit cursor-pointer items-center justify-center self-start rounded-ui-md bg-fill-2 px-3 py-1 text-caption font-semibold text-fg-soft ring-1 ring-line-hairline sm:min-h-8">
                {game.image ? 'Replace image' : 'Choose image'}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    setImageError('');
                    const file = event.target.files?.[0];
                    if (file) {
                      void fileToImageDataUrl(file)
                        .then((image) => {
                          setImageError('');
                          updateGame(game.id, { image });
                        })
                        .catch((error: unknown) => {
                          setImageError(
                            error instanceof Error ? error.message : 'The selected image could not be decoded.',
                          );
                        });
                    }
                  }}
                />
              </label>
              {game.image && (
                <Btn
                  className="!min-h-11 sm:!min-h-8"
                  onClick={() => {
                    setImageError('');
                    updateGame(game.id, { image: undefined });
                  }}
                >
                  Remove image
                </Btn>
              )}
            </div>
            {imageError && (
              <p className="mt-1 text-label text-danger-fg" role="alert">
                {imageError}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Resets and status</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Daily reset hour">
            <NumInput
              className="sm:!min-h-8 sm:!py-1"
              value={String(game.dailyResetHour)}
              min={0}
              max={23}
              onChange={(event) =>
                updateGame(game.id, {
                  dailyResetHour: Math.min(23, Math.max(0, intOr(event.target.value, 4))),
                })
              }
            />
          </Field>
          <Field label="Weekly reset day">
            <Select
              className="sm:!min-h-8 sm:!py-1"
              value={String(game.weeklyResetDay)}
              onChange={(event) => updateGame(game.id, { weeklyResetDay: intOr(event.target.value, 1) })}
            >
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={String(index + 1)}>
                  {day}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly reset day">
            <NumInput
              className="sm:!min-h-8 sm:!py-1"
              value={String(game.monthlyResetDay)}
              min={1}
              max={28}
              onChange={(event) =>
                updateGame(game.id, {
                  monthlyResetDay: Math.min(28, Math.max(1, intOr(event.target.value, 1))),
                })
              }
            />
          </Field>
          <div className="flex items-end pb-1 sm:col-span-3">
            <Toggle
              checked={game.paused}
              onChange={(value) => updateGame(game.id, { paused: value })}
              label="Paused"
              className="sm:!min-h-8"
            />
          </div>
          <Field label="Notes" className="sm:col-span-3">
            <TextArea
              value={draft.notes}
              onChange={(event) => changeDraft('notes', event.target.value)}
              onBlur={commitDraft}
            />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle>Energy resources</SectionTitle>
        <ResourceEditor game={game} resources={resources} />
      </section>

      <section>
        <SectionTitle>Quick spend</SectionTitle>
        <div className="space-y-2">
          {chips.map((chip) => (
            <div key={chip.id} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-center gap-2">
              <TextInput
                className="sm:!min-h-8 sm:!py-1"
                value={chip.label}
                aria-label="Quick spend label"
                onChange={(event) => upsertChip({ id: chip.id, gameId: game.id, label: event.target.value })}
              />
              <NumInput
                className="sm:!min-h-8 sm:!py-1"
                value={String(chip.delta)}
                aria-label={`${chip.label} energy change`}
                onChange={(event) =>
                  upsertChip({ id: chip.id, gameId: game.id, delta: intOr(event.target.value, chip.delta) })
                }
              />
              <button
                type="button"
                onClick={() => deleteChip(chip.id)}
                className="btn-compact flex h-11 w-11 items-center justify-center rounded-ui-md text-caption text-dim transition hover:bg-danger/10 hover:text-danger sm:h-8 sm:w-8"
                aria-label={`Delete quick spend ${chip.label}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_88px_auto]">
            <TextInput
              className="sm:!min-h-8 sm:!py-1"
              placeholder="Label, e.g. Domain"
              value={newChipLabel}
              onChange={(event) => setNewChipLabel(event.target.value)}
            />
            <NumInput
              className="sm:!min-h-8 sm:!py-1"
              value={newChipDelta}
              aria-label="Energy change"
              onChange={(event) => setNewChipDelta(event.target.value)}
            />
            <Btn
              className="!min-h-11 sm:!min-h-8"
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
              + Quick spend
            </Btn>
          </div>
          <p className="text-label text-dim">
            One-tap adjustments for the first energy resource. Use negative values for spending.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle>Tasks</SectionTitle>
        <div className="space-y-3">
          {tasks.map((task) => {
            const mode = task.mode ?? 'check';
            const hasConditionalControls = task.cadence === 'custom' || mode === 'timer' || mode === 'count';

            return (
              <div key={task.id} className="rounded-ui-xl bg-fill-1 p-3 ring-1 ring-line-hairline">
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_128px_128px_auto]">
                  <Field label="Name">
                    <TextInput
                      className="sm:!min-h-8 sm:!py-1"
                      value={task.name}
                      aria-label={`Task name: ${task.name}`}
                      onChange={(event) => updateTask(task.id, { name: event.target.value })}
                    />
                  </Field>
                  <Field label="Cadence">
                    <Select
                      className="sm:!min-h-8 sm:!py-1"
                      value={task.cadence}
                      onChange={(event) => updateTask(task.id, { cadence: event.target.value as Cadence })}
                      aria-label={`Cadence for ${task.name}`}
                    >
                      {CADENCES.map((cadence) => (
                        <option key={cadence.value} value={cadence.value}>
                          {cadence.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Mode">
                    <Select
                      className="sm:!min-h-8 sm:!py-1"
                      value={mode}
                      onChange={(event) => updateTask(task.id, { mode: event.target.value as TaskMode })}
                      aria-label={`Mode for ${task.name}`}
                    >
                      {TASK_MODES.map((taskMode) => (
                        <option key={taskMode.value} value={taskMode.value}>
                          {taskMode.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <button
                    type="button"
                    onClick={() => deleteTask(task.id)}
                    className="btn-compact flex h-11 w-11 items-center justify-center rounded-ui-md text-caption text-dim transition hover:bg-danger/10 hover:text-danger sm:h-8 sm:w-8"
                    aria-label={`Delete task ${task.name}`}
                  >
                    ✕
                  </button>
                </div>

                {hasConditionalControls && (
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line-hairline pt-3 sm:grid-cols-3">
                    {task.cadence === 'custom' && (
                      <>
                        <Field label="Cycle days">
                          <NumInput
                            className="sm:!min-h-8 sm:!py-1"
                            aria-label={`Cycle days for ${task.name}`}
                            value={String(task.intervalDays)}
                            onChange={(event) =>
                              updateTask(task.id, { intervalDays: Math.max(1, intOr(event.target.value, 2)) })
                            }
                          />
                        </Field>
                        <Field label="Timeline window">
                          <Toggle
                            checked={task.timelineLinked !== false}
                            onChange={(value) => updateTask(task.id, { timelineLinked: value ? undefined : false })}
                            label="Follow matching event"
                            className="sm:!min-h-8"
                          />
                        </Field>
                        {task.timelineLinked !== false && (
                          <Field label="Timeline match">
                            <TextInput
                              className="sm:!min-h-8 sm:!py-1"
                              placeholder="Auto (task name)"
                              aria-label={`Timeline match for ${task.name}`}
                              value={task.timelineMatch ?? ''}
                              onChange={(event) =>
                                updateTask(task.id, { timelineMatch: event.target.value || undefined })
                              }
                            />
                          </Field>
                        )}
                      </>
                    )}
                    {mode === 'timer' && (
                      <>
                        <Field label="Timer minutes">
                          <NumInput
                            className="sm:!min-h-8 sm:!py-1"
                            aria-label={`Timer minutes for ${task.name}`}
                            value={String(task.timerDurationMinutes ?? 20 * 60)}
                            onChange={(event) =>
                              updateTask(task.id, {
                                timerDurationMinutes: Math.max(1, intOr(event.target.value, 20 * 60)),
                              })
                            }
                          />
                        </Field>
                        <Field label="Timer step minutes">
                          <NumInput
                            className="sm:!min-h-8 sm:!py-1"
                            aria-label={`Timer step minutes for ${task.name}`}
                            placeholder="No step"
                            value={task.timerStepMinutes ?? ''}
                            onChange={(event) => {
                              const value = event.target.value.trim();
                              updateTask(task.id, {
                                timerStepMinutes: value ? Math.max(1, intOr(value, 1)) : undefined,
                              });
                            }}
                          />
                        </Field>
                      </>
                    )}
                    {mode === 'count' && (
                      <Field label="Count target">
                        <NumInput
                          className="sm:!min-h-8 sm:!py-1"
                          aria-label={`Count target for ${task.name}`}
                          value={String(task.countTarget ?? 1)}
                          onChange={(event) =>
                            updateTask(task.id, {
                              countTarget: Math.min(365, Math.max(1, intOr(event.target.value, 1))),
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
                className="sm:!min-h-8 sm:!py-1"
                placeholder="New task…"
                aria-label="New task name"
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
              />
            </Field>
            <Field label="Cadence">
              <Select
                className="w-full sm:!min-h-8 sm:w-28 sm:!py-1"
                value={newTaskCadence}
                onChange={(event) => setNewTaskCadence(event.target.value as Cadence)}
                aria-label="New task cadence"
              >
                {CADENCES.map((cadence) => (
                  <option key={cadence.value} value={cadence.value}>
                    {cadence.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Btn
              className="!min-h-11 shrink-0 sm:!min-h-8"
              onClick={() => {
                if (!newTask.trim()) return;
                addTask(game.id, newTask.trim(), newTaskCadence);
                setNewTask('');
              }}
            >
              + Task
            </Btn>
          </div>
          {presetGap > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-ui-lg bg-fill-1 px-3 py-2 ring-1 ring-line-hairline">
              <p className="min-w-0 flex-1 text-label text-muted">
                This game's preset has {presetGap} {presetGap === 1 ? 'routine' : 'routines'} you are not tracking.
              </p>
              <Btn className="!min-h-11 sm:!min-h-8" onClick={() => addMissingPresetTasks(game.id)}>
                + Add {presetGap}
              </Btn>
            </div>
          )}
          <p className="text-label text-dim">Events are edited on the Timeline tab.</p>
        </div>
      </section>
    </div>
  );
}
