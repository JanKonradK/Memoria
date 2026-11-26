import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  bankCounterOf,
  bankedCounterIds,
  checklistFor,
  EVENT_PROGRESS_LABEL,
  effectiveResourceKind,
  eventProgress,
  type EventProgress,
  type GameEvent,
  type OcrConfidence,
  type OcrEventCandidate,
  type OcrReadingCandidate,
  type OcrSavingsCandidate,
  type OcrTaskCandidate,
  type Resource,
  type Snapshot,
} from '@memoria/shared';
import {
  captureScreenshot,
  choosePendingScreenshotGame,
  connectorRuntime,
  dismissPendingScreenshot,
  useConnectors,
  type PendingScreenshot,
} from '../connectors';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { Ago } from './Ago';
import { Pill, Tick } from './primitives';
import { confirmDiscard, Sheet, SheetFooter } from './Sheet';
import { Btn, Field, NumInput, Segmented, Select } from './ui';

const CONFIDENCE_LABEL: Record<OcrConfidence, string> = {
  high: 'Clear match',
  medium: 'Likely match',
  low: 'Rough match',
};

const SAVINGS_MAX = 100_000_000;
/** A counter this small gets a chip per count (0 to 5 Condensed Resin), one tap each. */
const QUICK_MAX = 10;
const DAY_MS = 86_400_000;
const PROGRESS_OPTIONS = (['none', 'partial', 'done'] as const).map((value) => ({
  value,
  label: EVENT_PROGRESS_LABEL[value],
}));
const SAVINGS_FIELDS = [
  { field: 'currency', label: 'Premium currency' },
  { field: 'tickets', label: 'Pull tickets' },
] as const;

type SavingsField = (typeof SAVINGS_FIELDS)[number]['field'];

/**
 * Asks before a screenshot reading is saved. OCR only ever suggests: the
 * player picks the game, checks every number against the image, and saves
 * bars, tasks, endgame cycles and savings at once.
 */
export function ScreenshotConfirm() {
  const pending = useConnectors((store) => store.pendingScreenshot);
  if (!pending) return null;
  return <ScreenshotConfirmSheet pending={pending} />;
}

function ScreenshotConfirmSheet({ pending }: { pending: PendingScreenshot }) {
  const now = useNow(30_000);
  const [dirty, setDirty] = useState(false);
  const games = useApp((store) => store.state.games)
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort);
  const regions = pending.regionCount ?? 1;

  return (
    <Sheet open onClose={dismissPendingScreenshot} title="Confirm screenshot reading" dirty={dirty}>
      <div className="space-y-4">
        <Preview dataUrl={pending.dataUrl} />
        <p className="flex flex-wrap items-center gap-2 text-meta text-muted [overflow-wrap:anywhere]">
          <span>
            <Ago at={pending.observedAt} now={now} verb="Observed" /> · {pending.fileName}
          </span>
          {regions > 1 && <Pill>{regions} regions captured</Pill>}
        </p>
        <CaptureMore />
        <Field label="Game">
          <Select
            aria-label="Game"
            value={pending.gameId}
            onChange={(event) => choosePendingScreenshotGame(event.target.value)}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </Select>
        </Field>
        <RecognisedText lines={pending.lines} />
        {/* A new capture or game starts fresh; a region merged in keeps every edit. */}
        <ReadingsForm key={`${pending.gameId}:${pending.captureKey}`} pending={pending} onDirtyChange={setDirty} />
      </div>
    </Sheet>
  );
}

/** The capture, compact by default; a tap shows it whole. */
function Preview({ dataUrl }: { dataUrl?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!dataUrl) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? 'Shrink screenshot' : 'Expand screenshot'}
        onClick={() => setExpanded((open) => !open)}
        className="block w-full rounded-ui-lg"
      >
        <img
          src={dataUrl}
          alt=""
          className={`${expanded ? 'max-h-none' : 'max-h-56'} w-full rounded-ui-lg bg-fill-1 object-contain`}
        />
      </button>
      <p aria-hidden className="text-center text-caption text-muted">
        {expanded ? 'Tap to shrink' : 'Tap to expand'}
      </p>
    </div>
  );
}

/** Windows only: snip more of the screen into this reading, or read the whole game window. */
function CaptureMore() {
  const busy = useConnectors((store) => Boolean(store.busy.capture));
  if (connectorRuntime() !== 'desktop' || !window.memoriaDesktop?.connectors?.screenshot?.capture) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn disabled={busy} onClick={() => void captureScreenshot('snip')}>
        Snip another area
      </Btn>
      <Btn disabled={busy} onClick={() => void captureScreenshot('window')}>
        Read whole window
      </Btn>
      <span className="text-meta text-muted">Adds to this reading.</span>
    </div>
  );
}

/** What Windows read, region by region, so a missed number can be checked. */
function RecognisedText({ lines }: { lines?: string[] }) {
  const regions = useMemo(() => {
    const out: string[][] = [[]];
    for (const line of lines ?? []) {
      if (line.trim() === '') out.push([]);
      else out.at(-1)!.push(line);
    }
    return out.filter((region) => region.length > 0);
  }, [lines]);
  const count = regions.reduce((sum, region) => sum + region.length, 0);
  if (count === 0) return null;
  return (
    <details className="rounded-ui-md bg-fill-1 px-3 py-2">
      <summary className="cursor-pointer text-meta font-medium text-fg-soft">
        Recognised text ({count} {count === 1 ? 'line' : 'lines'})
      </summary>
      <div className="mt-2 space-y-3">
        {regions.map((region, i) => (
          <div key={i} className="space-y-1">
            {regions.length > 1 && <p className="text-caption font-semibold text-muted">Region {i + 1}</p>}
            <ul className="space-y-0.5 font-mono text-meta text-fg-soft [overflow-wrap:anywhere]">
              {region.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

interface BarDraft {
  on: boolean;
  value: string;
  reserve: string;
}

interface CountDraft {
  on: boolean;
  value: string;
}

interface EventDraft {
  on: boolean;
  progress: EventProgress;
}

type Edits<T> = Record<string, Partial<T>>;

/** An empty field is not a number; anything else must be a non-negative one within `max`. */
function parseAmount(text: string, max: number): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

/** Why a number field cannot be saved, or undefined when it can. */
function amountError(text: string, max: number, what: string): string | undefined {
  if (parseAmount(text, max) !== undefined) return undefined;
  return text.trim() === '' ? `Type a number from 0 to ${max}, or untick ${what}.` : `Use a number from 0 to ${max}.`;
}

/** The player's edits over the suggested values; an untouched field follows the suggestion, even after a merge. */
function draftOf<T>(seed: T, edit: Partial<T> | undefined): T {
  return edit ? { ...seed, ...edit } : seed;
}

function changed<T>(seeds: Map<string, T>, edits: Edits<T>): boolean {
  return Object.entries(edits).some(([id, edit]) => {
    const seed = seeds.get(id);
    return Object.entries(edit).some(([field, value]) => !seed || seed[field as keyof T] !== value);
  });
}

function readingsFor(pending: PendingScreenshot): OcrReadingCandidate[] {
  return pending.matches?.readings ?? pending.candidates;
}

/** The newest reading the player or an account gave each bar; estimates do not count. */
function latestRealReadings(snapshots: readonly Snapshot[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.provenance?.kind === 'estimate') continue;
    if (snap.takenAt > (out.get(snap.resourceId) ?? 0)) out.set(snap.resourceId, snap.takenAt);
  }
  return out;
}

function MatchHint({ match }: { match: { confidence: OcrConfidence; line: string } }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-meta text-muted">
      <Pill variant={match.confidence === 'high' ? 'neutral' : 'warn'}>{CONFIDENCE_LABEL[match.confidence]}</Pill>
      <span className="[overflow-wrap:anywhere]">Read “{match.line}”</span>
    </p>
  );
}

function ErrorNote({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="text-meta text-danger-fg">
      {text}
    </p>
  );
}

/** Whether a row is saved: the shared tick, in a 44px target on touch screens. */
function IncludeTick({ label, on, onToggle }: { label: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`Include ${label}`}
      onClick={() => onToggle(!on)}
      className="group -m-1.5 flex size-11 shrink-0 items-center justify-center rounded-ui-md transition hover:bg-fill-2 fine:m-0 fine:size-8"
    >
      <Tick color="var(--color-accent)" checked={on} />
    </button>
  );
}

/** One include toggle beside its fields; `after` holds a paired row of its own, never dimmed with this one. */
function Row({
  label,
  on,
  onToggle,
  children,
  after,
}: {
  label: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-ui-md bg-fill-1 p-3">
      <IncludeTick label={label} on={on} onToggle={onToggle} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`space-y-2 ${on ? '' : 'opacity-60'}`}>
          <p className="text-caption font-semibold text-fg-soft">{label}</p>
          {children}
        </div>
        {after}
      </div>
    </div>
  );
}

/** A denominator beside its field, kept on one line however narrow the sheet. */
function OutOf({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-body whitespace-nowrap text-muted tabular-nums">{children}</span>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={label}>
      <h3 className="text-meta font-medium text-muted">{label}</h3>
      {children}
    </section>
  );
}

/** Shows or hides rows the screenshot did not match, so any field can still be typed in. */
function MoreToggle({
  open,
  onToggle,
  show,
  hide,
}: {
  open: boolean;
  onToggle: () => void;
  show: string;
  hide: string;
}) {
  return (
    <Btn aria-expanded={open} onClick={onToggle}>
      {open ? hide : show}
    </Btn>
  );
}

interface TaskModel {
  taskId: string;
  taskName: string;
  action: 'done' | 'count';
  countTarget?: number;
  match?: OcrTaskCandidate;
  seed: CountDraft;
}

interface EventModel {
  event: GameEvent;
  match?: OcrEventCandidate;
  /** Set when the cycle is already at or past what the screenshot shows. */
  already?: string;
  seed: EventDraft;
}

interface SavingsModel {
  field: SavingsField;
  label: string;
  match?: OcrSavingsCandidate;
  seed: CountDraft;
}

function ReadingsForm({
  pending,
  onDirtyChange,
}: {
  pending: PendingScreenshot;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const formId = useId();
  const state = useApp((store) => store.state);
  const game = state.games.find((item) => item.id === pending.gameId && !item.deleted);
  const observedAt = pending.observedAt;
  const lines = pending.lines ?? [];

  // ---- Bars -------------------------------------------------------------
  const resources = useMemo(
    () =>
      state.resources
        .filter((res) => res.gameId === pending.gameId && !res.deleted && res.cap > 0)
        .sort((a, b) => a.sort - b.sort),
    [state.resources, pending.gameId],
  );
  const lastReal = useMemo(() => latestRealReadings(state.snapshots), [state.snapshots]);
  const readings = readingsFor(pending);

  // ---- Tasks ------------------------------------------------------------
  const liveTasks = new Map(
    state.tasks.filter((task) => task.gameId === pending.gameId && !task.deleted).map((task) => [task.id, task]),
  );
  const taskMatches = (pending.matches?.tasks ?? []).filter((match) => liveTasks.has(match.taskId));
  const matchedTaskIds = new Set(taskMatches.map((match) => match.taskId));
  const checklist = useMemo(() => (game ? checklistFor(state, game, observedAt) : []), [state, game, observedAt]);
  const tasks: TaskModel[] = [
    ...taskMatches.map((match) => ({
      taskId: match.taskId,
      taskName: match.taskName,
      action: match.action,
      ...(match.countTarget != null ? { countTarget: match.countTarget } : {}),
      match,
      seed: { on: true, value: match.countDone != null ? String(match.countDone) : '' },
    })),
    ...checklist
      .filter((item) => !item.done && !matchedTaskIds.has(item.taskId))
      .map((item) => ({
        taskId: item.taskId,
        taskName: item.name,
        action: item.mode === 'count' ? ('count' as const) : ('done' as const),
        ...(item.mode === 'count' ? { countTarget: item.countTarget } : {}),
        seed: { on: false, value: item.mode === 'count' ? String(item.countDone) : '' },
      })),
  ];

  // ---- Endgame cycles ---------------------------------------------------
  const cycles = state.events.filter(
    (event) => event.gameId === pending.gameId && !event.deleted && event.type === 'cycle',
  );
  const eventMatches = (pending.matches?.events ?? []).filter((match) =>
    cycles.some((event) => event.id === match.eventId),
  );
  const matchedEventIds = new Set(eventMatches.map((match) => match.eventId));
  const events: EventModel[] = [
    ...eventMatches.map((match) => {
      const event = cycles.find((item) => item.id === match.eventId)!;
      const current = eventProgress(event);
      // A screenshot never quietly lowers progress the player already saved.
      const already =
        current === 'done'
          ? 'Already marked done'
          : current === 'partial' && match.progress === 'partial'
            ? 'Already started'
            : undefined;
      return { event, match, ...(already ? { already } : {}), seed: { on: !already, progress: match.progress } };
    }),
    ...cycles
      .filter(
        (event) =>
          !matchedEventIds.has(event.id) &&
          event.start <= observedAt &&
          observedAt < event.end + DAY_MS &&
          (observedAt < event.end || eventProgress(event) !== 'done'),
      )
      .map((event) => {
        const current = eventProgress(event);
        return {
          event,
          ...(current === 'done' ? { already: 'Already marked done' } : {}),
          seed: { on: false, progress: 'done' as EventProgress },
        };
      }),
  ];

  // ---- Savings ----------------------------------------------------------
  const savingsMatches = pending.matches?.savings ?? [];
  const savings: SavingsModel[] = SAVINGS_FIELDS.map(({ field, label }) => {
    const match = savingsMatches.find((item) => item.field === field);
    return match
      ? { field, label: match.label, match, seed: { on: true, value: String(match.value) } }
      : { field, label, seed: { on: false, value: '' } };
  });

  // ---- Seeds: what the screenshot suggests ------------------------------
  const otherMatches = taskMatches.length + eventMatches.length + savingsMatches.length > 0;
  const matchedBarIds = new Set(readings.map((reading) => reading.resourceId));
  const fallback =
    matchedBarIds.size === 0
      ? (resources.find((res) => effectiveResourceKind(res) === 'regen') ?? resources[0])
      : undefined;
  const isStale = (res: Resource) => observedAt < (lastReal.get(res.id) ?? 0);
  const barSeeds = new Map<string, BarDraft>(
    resources.map((res) => {
      const value = readings.find((r) => r.resourceId === res.id && r.field === 'value');
      const reserve = readings.find((r) => r.resourceId === res.id && r.field === 'reserve');
      // A fallback bar for a tasks-only or endgame-only snip starts unticked, so Save is ready at once.
      const suggested = matchedBarIds.has(res.id) || (res.id === fallback?.id && !otherMatches);
      return [
        res.id,
        {
          on: suggested && !isStale(res),
          value: value ? String(Math.min(value.value, res.cap)) : '',
          reserve: reserve ? String(Math.min(reserve.value, res.reserveCap)) : '',
        },
      ];
    }),
  );
  const taskSeeds = new Map(tasks.map((task) => [task.taskId, task.seed]));
  const eventSeeds = new Map(events.map((item) => [item.event.id, item.seed]));
  const savingsSeeds = new Map(savings.map((item) => [item.field, item.seed]));

  const [barEdits, setBarEdits] = useState<Edits<BarDraft>>({});
  const [taskEdits, setTaskEdits] = useState<Edits<CountDraft>>({});
  const [eventEdits, setEventEdits] = useState<Edits<EventDraft>>({});
  const [savingsEdits, setSavingsEdits] = useState<Edits<CountDraft>>({});
  const [showBars, setShowBars] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showSavings, setShowSavings] = useState(false);

  const editor =
    <T,>(set: (update: (current: Edits<T>) => Edits<T>) => void) =>
    (id: string, patch: Partial<T>) =>
      set((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const patchBar = editor(setBarEdits);
  const patchTask = editor(setTaskEdits);
  const patchEvent = editor(setEventEdits);
  const patchSavings = editor(setSavingsEdits);

  const dirty =
    changed(barSeeds, barEdits) ||
    changed(taskSeeds, taskEdits) ||
    changed(eventSeeds, eventEdits) ||
    changed(savingsSeeds, savingsEdits);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const barDraft = (res: Resource) =>
    draftOf(barSeeds.get(res.id) ?? { on: false, value: '', reserve: '' }, barEdits[res.id]);
  const taskDraft = (task: TaskModel) => draftOf(task.seed, taskEdits[task.taskId]);
  const eventDraft = (item: EventModel) => draftOf(item.seed, eventEdits[item.event.id]);
  const savingsDraft = (item: SavingsModel) => draftOf(item.seed, savingsEdits[item.field]);

  // ---- What shows, and what saves ----------------------------------------
  // A counter banked from a bar (Condensed Resin) is read inside that bar's row, never as a row of its own.
  const banked = bankedCounterIds(resources);
  const barRows = resources.filter((res) => !banked.has(res.id));
  const bankOf = (res: Resource) => bankCounterOf(res, resources);
  const touched = (res: Resource | undefined) =>
    res !== undefined && (matchedBarIds.has(res.id) || barEdits[res.id] !== undefined);
  const shownBars = barRows.filter((res) => touched(res) || res.id === fallback?.id || touched(bankOf(res)));
  const visibleBars = showBars ? barRows : shownBars;
  const visibleBanks = [
    ...new Map(visibleBars.flatMap((res) => bankOf(res) ?? []).map((bank) => [bank.id, bank])).values(),
  ];
  const visibleTasks = tasks.filter((task) => task.match || showTasks || taskEdits[task.taskId] !== undefined);
  const visibleEvents = events.filter((item) => item.match || showEvents || eventEdits[item.event.id] !== undefined);
  const visibleSavings = savings.filter((item) => item.match || showSavings || savingsEdits[item.field] !== undefined);

  const barErrors = (res: Resource, draft: BarDraft) => ({
    value: draft.on ? amountError(draft.value, res.cap, 'this bar') : undefined,
    reserve:
      draft.on &&
      res.reserveCap > 0 &&
      draft.reserve.trim() !== '' &&
      parseAmount(draft.reserve, res.reserveCap) == null
        ? `Use a number from 0 to ${res.reserveCap}, or leave it blank.`
        : undefined,
  });
  const taskError = (task: TaskModel, draft: CountDraft) =>
    draft.on && task.action === 'count'
      ? amountError(draft.value, task.countTarget ?? SAVINGS_MAX, 'this task')
      : undefined;
  const savingsError = (draft: CountDraft) =>
    draft.on ? amountError(draft.value, SAVINGS_MAX, 'this count') : undefined;

  const chosenBars = [...visibleBars, ...visibleBanks].filter((res) => barDraft(res).on);
  const chosenTasks = visibleTasks.filter((task) => taskDraft(task).on);
  const chosenEvents = visibleEvents.filter((item) => eventDraft(item).on);
  const chosenSavings = visibleSavings.filter((item) => savingsDraft(item).on);
  const count = chosenBars.length + chosenTasks.length + chosenEvents.length + chosenSavings.length;
  const valid =
    count > 0 &&
    chosenBars.every((res) => {
      const errors = barErrors(res, barDraft(res));
      return !errors.value && !errors.reserve;
    }) &&
    chosenTasks.every((task) => !taskError(task, taskDraft(task))) &&
    chosenSavings.every((item) => !savingsError(savingsDraft(item)));

  const save = () => {
    if (!valid || !game) return;
    const store = useApp.getState();
    const lastEntry = store.history.journal.at(-1)?.id;
    const savingsInput: { currency?: number; tickets?: number } = {};
    for (const item of chosenSavings) savingsInput[item.field] = Number(savingsDraft(item).value);
    store.applyScreenshotReadings({
      gameId: pending.gameId,
      observedAt,
      provider: pending.source,
      readings: chosenBars.map((res) => {
        const draft = barDraft(res);
        const reserve = res.reserveCap > 0 ? parseAmount(draft.reserve, res.reserveCap) : undefined;
        return { resourceId: res.id, value: Number(draft.value), ...(reserve != null ? { reserve } : {}) };
      }),
      tasks: chosenTasks.map((task) =>
        task.action === 'count'
          ? { taskId: task.taskId, action: 'count' as const, countDone: Number(taskDraft(task).value) }
          : { taskId: task.taskId, action: 'done' as const },
      ),
      events: chosenEvents.map((item) => ({ eventId: item.event.id, progress: eventDraft(item).progress })),
      ...(chosenSavings.length ? { savings: savingsInput } : {}),
    });
    const entry = useApp.getState().history.journal.at(-1);
    const entryId = entry && entry.id !== lastEntry ? entry.id : undefined;
    const only =
      count === 1
        ? (chosenBars[0]?.name ??
          chosenTasks[0]?.taskName ??
          chosenEvents[0]?.event.name ??
          chosenSavings[0]?.label ??
          'a reading')
        : `${count} updates`;
    useUI.getState().showUndo(`Saved ${only} from a screenshot`, () => {
      if (entryId) useApp.getState().undoActivity(entryId);
    });
    dismissPendingScreenshot();
  };

  const dismiss = async () => {
    if (dirty && !(await confirmDiscard())) return;
    dismissPendingScreenshot();
  };

  const fieldId = (kind: string, id: string) => `${formId}-${kind}-${id}`;

  /** The counter a bar banks, read in the bar's own row with its own tick. */
  const bankRow = (bank: Resource) => {
    const draft = barDraft(bank);
    const errors = barErrors(bank, draft);
    const match = readings.find((r) => r.resourceId === bank.id && r.field === 'value');
    const errorId = fieldId('bar', `${bank.id}-value`);
    const quick = bank.cap > 0 && bank.cap <= QUICK_MAX ? Array.from({ length: bank.cap + 1 }, (_, n) => n) : [];
    return (
      <div className="flex items-start gap-3 border-t border-line-hairline pt-2">
        <IncludeTick label={bank.name} on={draft.on} onToggle={(on) => patchBar(bank.id, { on })} />
        <div className={`min-w-0 flex-1 space-y-2 ${draft.on ? '' : 'opacity-60'}`}>
          <div className="flex items-center gap-2">
            <NumInput
              aria-label={`${bank.name} value`}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={errors.value ? errorId : undefined}
              min={0}
              max={bank.cap}
              value={draft.value}
              placeholder="Keep as is"
              onChange={(event) => patchBar(bank.id, { value: event.target.value, on: true })}
              className="max-w-28"
            />
            <OutOf>
              / {bank.cap} {bank.name}
            </OutOf>
          </div>
          {quick.length > 0 && (
            <div role="group" aria-label={`${bank.name} count`} className="flex flex-wrap gap-1">
              {quick.map((n) => (
                <Btn
                  key={n}
                  aria-pressed={draft.value === String(n)}
                  onClick={() => patchBar(bank.id, { value: String(n), on: true })}
                  className="min-w-(--control-h) tabular-nums aria-pressed:bg-accent aria-pressed:text-on-accent"
                >
                  {n}
                </Btn>
              ))}
            </div>
          )}
          <ErrorNote id={errorId} text={errors.value} />
          {isStale(bank) && <p className="text-meta text-warn-fg">Older than your last reading</p>}
          {match && <MatchHint match={match} />}
        </div>
      </div>
    );
  };

  const barRow = (res: Resource) => {
    const draft = barDraft(res);
    const errors = barErrors(res, draft);
    const valueMatch = readings.find((r) => r.resourceId === res.id && r.field === 'value');
    const reserveMatch = readings.find((r) => r.resourceId === res.id && r.field === 'reserve');
    const hint = valueMatch ?? reserveMatch;
    const reserveLabel = res.reserveLabel || 'Reserve';
    const valueError = fieldId('bar', `${res.id}-value`);
    const reserveError = fieldId('bar', `${res.id}-reserve`);
    const bank = bankOf(res);
    return (
      <Row
        key={res.id}
        label={res.name}
        on={draft.on}
        onToggle={(on) => patchBar(res.id, { on })}
        after={bank && bankRow(bank)}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <NumInput
              aria-label={`${res.name} value`}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={errors.value ? valueError : undefined}
              min={0}
              max={res.cap}
              value={draft.value}
              onChange={(event) => patchBar(res.id, { value: event.target.value, on: true })}
              className="max-w-28"
            />
            <OutOf>/ {res.cap}</OutOf>
          </div>
          {res.reserveCap > 0 && (
            <div className="flex items-center gap-2">
              <NumInput
                aria-label={`${reserveLabel} value`}
                aria-invalid={errors.reserve ? true : undefined}
                aria-describedby={errors.reserve ? reserveError : undefined}
                min={0}
                max={res.reserveCap}
                value={draft.reserve}
                placeholder="Keep as is"
                onChange={(event) => patchBar(res.id, { reserve: event.target.value, on: true })}
                className="max-w-28"
              />
              <OutOf>
                / {res.reserveCap} {reserveLabel}
              </OutOf>
            </div>
          )}
        </div>
        <ErrorNote id={valueError} text={errors.value} />
        <ErrorNote id={reserveError} text={errors.reserve} />
        {isStale(res) && <p className="text-meta text-warn-fg">Older than your last reading</p>}
        {hint ? (
          <MatchHint match={hint} />
        ) : (
          <p className="text-meta text-muted">
            {lines.length
              ? 'No number on the screenshot matched this bar. Type what it shows.'
              : 'Type the number the screenshot shows.'}
          </p>
        )}
      </Row>
    );
  };

  const taskRow = (task: TaskModel) => {
    const draft = taskDraft(task);
    const error = taskError(task, draft);
    const errorId = fieldId('task', task.taskId);
    return (
      <Row key={task.taskId} label={task.taskName} on={draft.on} onToggle={(on) => patchTask(task.taskId, { on })}>
        {task.action === 'count' ? (
          <div className="flex items-center gap-2">
            <NumInput
              aria-label={`${task.taskName} done`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              min={0}
              max={task.countTarget}
              value={draft.value}
              onChange={(event) => patchTask(task.taskId, { value: event.target.value, on: true })}
              className="max-w-28"
            />
            {task.countTarget != null && <OutOf>/ {task.countTarget}</OutOf>}
          </div>
        ) : (
          <p className="text-body text-muted">Mark done</p>
        )}
        <ErrorNote id={errorId} text={error} />
        {task.match && <MatchHint match={task.match} />}
      </Row>
    );
  };

  const eventRow = (item: EventModel) => {
    const draft = eventDraft(item);
    return (
      <Row
        key={item.event.id}
        label={item.event.name}
        on={draft.on}
        onToggle={(on) => patchEvent(item.event.id, { on })}
      >
        {item.match && <p className="text-body font-semibold text-fg tabular-nums">{item.match.detail}</p>}
        <Segmented
          ariaLabel={`${item.event.name} progress`}
          options={PROGRESS_OPTIONS}
          value={draft.progress}
          onChange={(progress) => patchEvent(item.event.id, { progress, on: true })}
        />
        {item.already && <p className="text-meta text-muted">{item.already}</p>}
        {item.match && <MatchHint match={item.match} />}
      </Row>
    );
  };

  const savingsRow = (item: SavingsModel) => {
    const draft = savingsDraft(item);
    const error = savingsError(draft);
    const errorId = fieldId('savings', item.field);
    return (
      <Row key={item.field} label={item.label} on={draft.on} onToggle={(on) => patchSavings(item.field, { on })}>
        <NumInput
          aria-label={`${item.label} value`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          min={0}
          max={SAVINGS_MAX}
          value={draft.value}
          onChange={(event) => patchSavings(item.field, { value: event.target.value, on: true })}
          className="max-w-36"
        />
        <ErrorNote id={errorId} text={error} />
        {item.match && <MatchHint match={item.match} />}
      </Row>
    );
  };

  const hiddenBars = barRows.length > shownBars.length;
  const hiddenTasks = tasks.some((task) => !task.match);
  const hiddenEvents = events.some((item) => !item.match);
  const hiddenSavings = savings.some((item) => !item.match);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {resources.length > 0 && (
        <Section label="Bars & reserves">
          {visibleBars.map(barRow)}
          {hiddenBars && (
            <MoreToggle
              open={showBars}
              onToggle={() => setShowBars((open) => !open)}
              show="Include another bar"
              hide="Hide other bars"
            />
          )}
        </Section>
      )}
      {tasks.length > 0 && (
        <Section label="Tasks & dailies">
          {visibleTasks.map(taskRow)}
          {hiddenTasks && (
            <MoreToggle
              open={showTasks}
              onToggle={() => setShowTasks((open) => !open)}
              show="Include a task"
              hide="Hide other tasks"
            />
          )}
        </Section>
      )}
      {events.length > 0 && (
        <Section label="Endgame cycles">
          {visibleEvents.map(eventRow)}
          {hiddenEvents && (
            <MoreToggle
              open={showEvents}
              onToggle={() => setShowEvents((open) => !open)}
              show="Include an endgame cycle"
              hide="Hide other cycles"
            />
          )}
        </Section>
      )}
      <Section label="Savings">
        {visibleSavings.map(savingsRow)}
        {hiddenSavings && (
          <MoreToggle
            open={showSavings}
            onToggle={() => setShowSavings((open) => !open)}
            show="Include savings"
            hide="Hide other savings"
          />
        )}
      </Section>
      <SheetFooter status={count === 0 && <p className="text-meta text-muted">Tick at least one row to save.</p>}>
        <Btn onClick={() => void dismiss()}>Dismiss</Btn>
        <Btn kind="primary" type="submit" disabled={!valid}>
          {count > 1 ? `Save ${count} updates` : 'Save reading'}
        </Btn>
      </SheetFooter>
    </form>
  );
}
