import { useId, useLayoutEffect, useState, type ReactNode } from 'react';
import type { GameEditorSection } from '../../ui-store';
import type { Cadence, Game } from '@memoria/shared';
import { missingPresetTasks, presetForGame } from '@memoria/shared';
import { FONT_OPTIONS, titleFont } from '../../fonts';
import { gameTitleInk, trioOf, type GameColors } from '../../game-color';
import { useApp } from '../../store';
import { useGround } from '../../theme';
import { fileToImageDataUrl, intOr, localResetLabel } from '../../util';
import { ResourceEditor } from '../game-detail/ResourceEditor';
import { GameEvents } from '../GameEvents';
import { useGameDraft } from '../game-detail/useGameDraft';
import { serverRegionLabel } from '../NexusLayout';
import { TrackingItem } from './TrackingItem';
import { TASK_CADENCES as CADENCES, TaskFields, taskSettingsSummary } from './TaskFields';
import { createReminderDraft, GameReminders, reminderDraftChanged } from './GameReminders';
import { EditorTabPanel, EditorTabs, type EditorTab } from './EditorTabs';
import {
  Btn,
  COMPACT_INPUT,
  Field,
  GameBadge,
  NumInput,
  SectionTitle,
  Select,
  serverLabelClass,
  TextArea,
  TextInput,
  Toggle,
  TOUCH_BUTTON,
} from '../ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SETTINGS_DRAFT_FIELDS = ['name', 'short', 'notes'] as const;

type EditorTabId = GameEditorSection;
const EDITOR_TABS: readonly EditorTab<EditorTabId>[] = [
  { id: 'resources', label: 'Energy' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'events', label: 'Events' },
  { id: 'resets', label: 'Resets' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'spend', label: 'Quick spend' },
  { id: 'game', label: 'Game' },
];

/**
 * The trio, in the three jobs DESIGN.md gives it. `color3` had no control at
 * all until now, which is why `gameRim` — the card edge and the badge, the two
 * things a user picks a game out of a rail by — was reading a colour nobody
 * could change.
 */
const TRIO_SLOTS = [
  { slot: 'primary', field: 'color', label: 'Primary', hint: 'Card wash and timeline bar' },
  { slot: 'secondary', field: 'color2', label: 'Secondary', hint: 'Title ink and the lead tube' },
  { slot: 'accent', field: 'color3', label: 'Accent', hint: 'Badge rim and small highlights' },
] as const;

/** The ✕ at the end of an editable row — same control for a quick spend and a task. */
function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-compact flex h-11 w-11 items-center justify-center rounded-ui-md text-caption text-dim transition hover:bg-danger/10 hover:text-danger sm:h-8 sm:w-8"
      aria-label={label}
    >
      ✕
    </button>
  );
}

/**
 * What the game will look like, while it is still being typed.
 *
 * Fed by the DRAFT for text and by the store for colour, because both are now
 * instant: the draft commits inside the change handler and a colour write lands
 * as the picker moves. So this is not a second copy of the truth — it is the
 * same truth, rendered beside the fields that set it.
 */
function GamePreview({ game, name, short }: { game: Game; name: string; short: string }) {
  const localTz = useApp((store) => store.state.settings.localTz);
  const ground = useGround();
  const colors: GameColors = { color: game.color, color2: game.color2, color3: game.color3 };
  const now = Date.now();
  const server = serverRegionLabel(game.tz, now);
  // A name is never blank on a card, so it is never blank here either.
  const displayName = name.trim() || game.name.trim() || 'Untitled game';
  const displayShort = short.trim() || game.short.trim() || '?';

  return (
    <div className="flex items-center gap-3 rounded-ui-lg bg-fill-1 px-3 py-2 ring-1 ring-line-hairline">
      <GameBadge short={displayShort} color={game.color} color2={game.color2} color3={game.color3} size="lg" />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-title font-semibold"
          style={{ fontFamily: titleFont(game.titleFont), color: gameTitleInk(colors, ground) }}
        >
          {displayName}
        </p>
        <p className="text-label text-muted">
          <span className={serverLabelClass(server)}>{server}</span> · resets{' '}
          <span className="numeral">{localResetLabel(game, localTz, now)}</span> local
        </p>
      </div>
      <span className="shrink-0 text-label font-semibold uppercase tracking-wider text-muted">Preview</span>
    </div>
  );
}

/**
 * One slot of the trio: the native picker for choosing, a hex field for pasting
 * a colour someone gave you. Both write on every change rather than on close,
 * so the preview above has already moved before the picker is dismissed.
 *
 * The hex field keeps its own half-typed text — `#8b5` is not a colour yet, and
 * snapping the field back to the last valid value under the caret makes it
 * impossible to type into.
 */
function ColorSlot({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const labelId = useId();
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <span id={labelId} className="mb-1 block text-label font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="focus-ring-group flex items-center gap-2 rounded-ui-lg bg-fill-2 p-1 ring-1 ring-line-hairline transition duration-(--dur-fast) focus-within:ring-line-strong">
        <input
          type="color"
          value={value}
          aria-label={`${label} colour picker`}
          onChange={(event) => {
            setTyped(null);
            onChange(event.target.value);
          }}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-ui-sm bg-transparent sm:h-8 sm:w-8"
        />
        <input
          type="text"
          value={typed ?? value}
          aria-labelledby={labelId}
          spellCheck={false}
          autoComplete="off"
          className="numeral min-h-11 min-w-0 flex-1 bg-transparent px-1 text-body text-fg outline-none sm:min-h-8"
          onChange={(event) => {
            const next = event.target.value;
            setTyped(next);
            const candidate = next.trim().startsWith('#') ? next.trim() : `#${next.trim()}`;
            if (/^#[\da-f]{6}$/i.test(candidate)) onChange(candidate.toLowerCase());
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
      <p className="mt-1 text-label text-muted">{hint}</p>
    </div>
  );
}

export function GameEditor({
  game,
  initialSection,
  accountControls,
  serverControl,
  dangerControls,
  onDraftChange,
}: {
  game: Game;
  initialSection?: GameEditorSection;
  accountControls?: ReactNode;
  serverControl?: ReactNode;
  dangerControls?: ReactNode;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const state = useApp((store) => store.state);
  const updateGame = useApp((store) => store.updateGame);
  const upsertChip = useApp((store) => store.upsertChip);
  const deleteChip = useApp((store) => store.deleteChip);
  const addTask = useApp((store) => store.addTask);
  const addMissingPresetTasks = useApp((store) => store.addMissingPresetTasks);
  const deleteTask = useApp((store) => store.deleteTask);
  const [reminderDraft, setReminderDraft] = useState(() => createReminderDraft(state.settings.localTz));
  const [imageError, setImageError] = useState('');
  const [newTask, setNewTask] = useState('');
  const [newTaskCadence, setNewTaskCadence] = useState<Cadence>('daily');
  const [newChipLabel, setNewChipLabel] = useState('');
  const [newChipDelta, setNewChipDelta] = useState('-20');
  const dirty = Boolean(newTask.trim() || newChipLabel.trim() || reminderDraftChanged(reminderDraft));
  // The sheet must protect the draft before the next keyboard or close action.
  useLayoutEffect(() => onDraftChange?.(dirty), [dirty, onDraftChange]);
  // Zero delay: all three of these are on screen somewhere else while they are
  // being typed — the preview above, the sheet title, the roster row behind it.
  const { changeDraft, commitDraft, draft } = useGameDraft(game, SETTINGS_DRAFT_FIELDS, true, 0);
  const tabsId = useId();
  // Kept per game, not per editor: the sheet can swap games without unmounting,
  // and coming back to a game you were half way through editing on Tasks should
  // not start again at Game.
  const [tabByGame, setTabByGame] = useState<Partial<Record<string, EditorTabId>>>({});
  const tab = tabByGame[game.id] ?? initialSection ?? 'resources';
  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const chips = state.chips.filter((c) => c.gameId === game.id && !c.deleted).sort((a, b) => a.sort - b.sort);
  const tasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted).sort((a, b) => a.sort - b.sort);
  // Presets grow with the games; a game added last month keeps the routine list
  // it was born with, so offer the difference rather than silently backfilling.
  const presetGap = missingPresetTasks(
    game,
    state.tasks.filter((task) => task.gameId === game.id),
  ).length;
  const trio = trioOf(game);
  const preset = presetForGame({ name: game.name, short: game.short, presetKey: game.presetKey });
  const presetTrio = preset ? trioOf(preset) : null;
  const onPresetTrio =
    presetTrio !== null &&
    (['primary', 'secondary', 'accent'] as const).every(
      (role) => trio[role].trim().toLowerCase() === presetTrio[role].trim().toLowerCase(),
    );

  return (
    <div className="space-y-4">
      <EditorTabs
        idBase={tabsId}
        tabs={EDITOR_TABS}
        value={tab}
        onChange={(next) => setTabByGame((current) => ({ ...current, [game.id]: next }))}
        ariaLabel="Game settings sections"
        className="sticky top-0 z-10"
      />

      <EditorTabPanel idBase={tabsId} tab={tab}>
        {tab === 'events' && (
          <GameEvents
            key={game.id}
            game={game}
            now={Date.now()}
            onBeforeOpen={() => !dirty || window.confirm('Discard your unsaved changes?')}
          />
        )}
        {tab === 'game' && (
          <section>
            <GamePreview game={game} name={draft.name} short={draft.short} />
            <SectionTitle>Game identity</SectionTitle>
            <div className="mb-5">{accountControls}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <TextInput
                  className={COMPACT_INPUT}
                  value={draft.name}
                  onChange={(event) => changeDraft('name', event.target.value)}
                  onBlur={commitDraft}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Short label (shown as the game's badge)">
                  <TextInput
                    className={COMPACT_INPUT}
                    value={draft.short}
                    onChange={(event) => changeDraft('short', event.target.value)}
                    onBlur={commitDraft}
                  />
                </Field>
                <p className="mt-1 text-label text-muted">
                  Two to four characters. Give each account its own badge so you can tell them apart at a glance.
                </p>
              </div>

              <div className="sm:col-span-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {TRIO_SLOTS.map((entry) => (
                    <ColorSlot
                      key={entry.field}
                      label={entry.label}
                      hint={entry.hint}
                      value={trio[entry.slot]}
                      onChange={(hex) => updateGame(game.id, { [entry.field]: hex })}
                    />
                  ))}
                </div>
                {preset && presetTrio && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Btn
                      className={TOUCH_BUTTON}
                      disabled={onPresetTrio}
                      onClick={() =>
                        updateGame(game.id, {
                          color: presetTrio.primary,
                          color2: presetTrio.secondary,
                          color3: presetTrio.accent,
                        })
                      }
                    >
                      Restore {preset.name} colours
                    </Btn>
                    <p className="min-w-0 flex-1 text-label text-muted">
                      {onPresetTrio
                        ? `All three slots are ${preset.name}'s own colours.`
                        : `Puts all three slots back to ${preset.name}'s own colours.`}
                    </p>
                  </div>
                )}
              </div>

              <Field label="Title font">
                <Select
                  className={COMPACT_INPUT}
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
                      className={TOUCH_BUTTON}
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
        )}

        {tab === 'game' && dangerControls}

        {tab === 'reminders' && <GameReminders game={game} draft={reminderDraft} setDraft={setReminderDraft} />}

        {tab === 'resets' && (
          <section>
            <SectionTitle>Resets and status</SectionTitle>
            <p className="mb-4 text-meta text-muted">
              Reset times use the game server's clock. Your next daily reset is at{' '}
              <span className="numeral text-fg">{localResetLabel(game, state.settings.localTz, Date.now())}</span> in{' '}
              {state.settings.localTz}.
            </p>
            <div className="mb-4">{serverControl}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Daily reset hour">
                <NumInput
                  className={COMPACT_INPUT}
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
                  className={COMPACT_INPUT}
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
                  className={COMPACT_INPUT}
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
                  label="Pause tracking"
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
        )}

        {tab === 'resources' && (
          <section>
            <SectionTitle>Energy resources</SectionTitle>
            <p className="mb-3 text-meta text-muted">
              Set the capacity and refill rules for each resource. Open a row to edit it.
            </p>
            <ResourceEditor game={game} resources={resources} />
          </section>
        )}

        {tab === 'spend' && (
          <section>
            <SectionTitle>Quick spend</SectionTitle>
            <div className="space-y-2">
              {chips.map((chip) => (
                <div key={chip.id} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-center gap-2">
                  <TextInput
                    className={COMPACT_INPUT}
                    value={chip.label}
                    aria-label="Quick spend label"
                    onChange={(event) => upsertChip({ id: chip.id, gameId: game.id, label: event.target.value })}
                  />
                  <NumInput
                    className={COMPACT_INPUT}
                    value={String(chip.delta)}
                    aria-label={`${chip.label} energy change`}
                    onChange={(event) =>
                      upsertChip({ id: chip.id, gameId: game.id, delta: intOr(event.target.value, chip.delta) })
                    }
                  />
                  <RemoveRowButton label={`Delete quick spend ${chip.label}`} onClick={() => deleteChip(chip.id)} />
                </div>
              ))}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_88px_auto]">
                <TextInput
                  className={COMPACT_INPUT}
                  placeholder="Label, e.g. Domain"
                  value={newChipLabel}
                  onChange={(event) => setNewChipLabel(event.target.value)}
                />
                <NumInput
                  className={COMPACT_INPUT}
                  value={newChipDelta}
                  aria-label="Energy change"
                  onChange={(event) => setNewChipDelta(event.target.value)}
                />
                <Btn
                  className={TOUCH_BUTTON}
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
              <p className="text-label text-muted">
                One-tap adjustments for the first energy resource. Use negative values for spending.
              </p>
            </div>
          </section>
        )}

        {tab === 'tasks' && (
          <section>
            <SectionTitle>Tasks</SectionTitle>
            <p className="mb-3 text-meta text-muted">
              Build your routine with checkboxes, counters, or timers. Open a task to change its schedule.
            </p>
            <div className="space-y-3">
              {tasks.map((task) => (
                <TrackingItem key={task.id} name={task.name || 'Untitled task'} summary={taskSettingsSummary(task)}>
                  <TaskFields
                    task={task}
                    actions={<RemoveRowButton label={`Delete task ${task.name}`} onClick={() => deleteTask(task.id)} />}
                  />
                </TrackingItem>
              ))}
              <div className="grid grid-cols-1 items-end gap-2 border-t border-line-hairline pt-4 sm:grid-cols-[minmax(0,1fr)_112px_auto]">
                <Field label="New task">
                  <TextInput
                    className={COMPACT_INPUT}
                    placeholder="New task…"
                    aria-label="New task name"
                    value={newTask}
                    onChange={(event) => setNewTask(event.target.value)}
                  />
                </Field>
                <Field label="Cadence">
                  <Select
                    className={`w-full sm:w-28 ${COMPACT_INPUT}`}
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
                  className={`shrink-0 ${TOUCH_BUTTON}`}
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
                  <Btn className={TOUCH_BUTTON} onClick={() => addMissingPresetTasks(game.id)}>
                    + Add {presetGap}
                  </Btn>
                </div>
              )}
              <p className="text-label text-muted">Manage dates, banners, and event check-in rules on Events.</p>
            </div>
          </section>
        )}
      </EditorTabPanel>
    </div>
  );
}
