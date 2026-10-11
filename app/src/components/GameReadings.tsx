import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useMemo, useRef, useState } from 'react';
import {
  extractScreenshotRatios,
  parseScreenshotReadings,
  planGameImport,
  type Game,
  type GameImportBatch,
} from '@memoria/shared';
import { useApp } from '../store';
import { useDerived } from '../selectors';
import { useGameConnections } from '../game-connections';
import { isDesktopApp } from '../desktop-host';
import { servedByLauncher } from '../launcher';
import { isNativeApp } from '../native';
import { readingSource, type ReadingKind } from '../reading-source';
import {
  canReadImages,
  chooseNativeScreenshot,
  closeReadings,
  editDraftText,
  fetchAccountReading,
  openReadings,
  receiveScreenshotFiles,
  saveAccountReading,
  saveDraft,
  startTextReading,
  supportsAccount,
  undoReading,
  useReadings,
  type ReadingDraft,
} from '../readings';
import { GameConnections } from './GameConnections';
import { Btn, Field, NumInput, Select, TextInput, Tooltip, TOUCH_BUTTON } from './ui';

/** An account reading arrives by itself; the others are things the player did. */
export const SOURCE_ICON: Record<ReadingKind, string> = {
  account: 'M4 8a6 6 0 0 1 10.5-3.5L16 6m0-3.5V6h-3.5M16 12a6 6 0 0 1-10.5 3.5L4 14m0 3.5V14h3.5',
  screenshot: 'M3 6.5h3l1.5-2h5l1.5 2h3v9H3zM10 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  manual: 'M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z',
  estimate: 'M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
};

export function SourceIcon({ kind }: { kind: ReadingKind }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="icon h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor">
      <path d={SOURCE_ICON[kind]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function localDateTime(at: number): string {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Where the card's energy number came from, in the card's own status line.
 *
 * The number beside it is always a projection from this reading, so the line
 * names the source and its age rather than repeating "estimated" on every card.
 */
export function ReadingStatus({ game, now }: { game: Game; now: number }) {
  const derived = useDerived(now);
  const { resource } = derived.primaryEnergy(game.id);
  const automatic = useGameConnections((store) =>
    store.connections.some((connection) => connection.gameId === game.id && connection.autoRefresh),
  );
  if (!resource) return null;
  const source = readingSource(derived.snaps.get(resource.id), now);
  if (!source) return <span data-reading-status>No reading yet</span>;
  return (
    <Tooltip content={`${resource.name} is estimated forward from this reading.`}>
      <span data-reading-status className="inline-flex items-center gap-1">
        <SourceIcon kind={source.kind} />
        {source.label} · {source.age}
        {automatic && ' · auto'}
      </span>
    </Tooltip>
  );
}

const ITEM =
  'flex min-h-11 cursor-pointer items-center rounded-ui-sm px-3 text-body text-fg-soft outline-none transition-colors data-[highlighted]:bg-fill-2 data-[highlighted]:text-fg sm:min-h-9';

/** Every way a reading reaches this game, behind one control. */
export function ReadingsMenu({ game }: { game: Game }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useReadings((store) => store.busy);
  const connected = useGameConnections((store) => store.connections.some((item) => item.gameId === game.id));
  const hasHistory = useApp((store) => store.importHistory.some((entry) => entry.gameId === game.id));
  const images = canReadImages();
  const accounts = supportsAccount(game.id) && (servedByLauncher() || isNativeApp || isDesktopApp());
  // Chosen now, run once the menu has released focus, so a picker or panel can take it.
  const pending = useRef<'fetch' | 'image' | 'text' | 'account' | 'history' | null>(null);
  const run = (action: NonNullable<typeof pending.current>) => {
    if (action === 'fetch') void fetchAccountReading(game.id);
    else if (action === 'image') {
      if (isNativeApp) void chooseNativeScreenshot(game.id);
      else fileInput.current?.click();
    } else if (action === 'text') startTextReading(game.id);
    else openReadings(game.id, action);
  };

  return (
    <DropdownMenuPrimitive.Root>
      <input
        hidden
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg"
        aria-label={`Screenshot for ${game.name}`}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void receiveScreenshotFiles(files, game.id);
        }}
      />
      <DropdownMenuPrimitive.Trigger asChild>
        <Btn className={`${TOUCH_BUTTON} group inline-flex items-center gap-1.5`} aria-busy={busy}>
          Readings
          <svg
            width="10"
            height="10"
            viewBox="0 0 20 20"
            aria-hidden
            className="text-muted transition duration-(--dur-fast) group-data-[state=open]:rotate-180"
            fill="currentColor"
          >
            <path d="M5.5 7.5l4.5 5 4.5-5z" />
          </svg>
        </Btn>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            const action = pending.current;
            pending.current = null;
            if (!action) return;
            event.preventDefault();
            requestAnimationFrame(() => run(action));
          }}
          className="popover-motion z-50 min-w-52 rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
        >
          {connected && (
            <DropdownMenuPrimitive.Item
              className={ITEM}
              onSelect={() => {
                pending.current = 'fetch';
              }}
            >
              Fetch from account
            </DropdownMenuPrimitive.Item>
          )}
          {images && (
            <DropdownMenuPrimitive.Item
              className={ITEM}
              onSelect={() => {
                pending.current = 'image';
              }}
            >
              Read a screenshot
            </DropdownMenuPrimitive.Item>
          )}
          <DropdownMenuPrimitive.Item
            className={ITEM}
            onSelect={() => {
              pending.current = 'text';
            }}
          >
            Enter screenshot text
          </DropdownMenuPrimitive.Item>
          {accounts && (
            <DropdownMenuPrimitive.Item
              className={ITEM}
              onSelect={() => {
                pending.current = 'account';
              }}
            >
              {connected ? 'Account settings' : 'Connect account'}
            </DropdownMenuPrimitive.Item>
          )}
          {hasHistory && (
            <DropdownMenuPrimitive.Item
              className={ITEM}
              onSelect={() => {
                pending.current = 'history';
              }}
            >
              Recent imports
            </DropdownMenuPrimitive.Item>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/** The one reading Memoria would not save by itself, laid out for a yes or a correction. */
function ReadingReview({ game, draft }: { game: Game; draft: ReadingDraft }) {
  const state = useApp((store) => store.state);
  const { text } = draft;
  // Kept to the millisecond. The field shows minutes, and typing in it is the only thing that rounds.
  const [capturedAt, setCapturedAt] = useState(draft.capturedAt);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { value?: number | null; reserve?: number | null }>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState('');
  // Open when the text is the thing to fix; a click decides after that.
  const [textOpen, setTextOpen] = useState(!draft.text.trim());

  const resources = state.resources.filter((resource) => resource.gameId === game.id && !resource.deleted);
  const ratios = useMemo(() => extractScreenshotRatios(text), [text]);
  const timeValid = Number.isFinite(capturedAt) && capturedAt <= Date.now();

  const { batch, conflict, unlabelled } = useMemo(() => {
    const parsed = parseScreenshotReadings(state, game.id, text, timeValid ? capturedAt : draft.capturedAt);
    // A ratio the parser already tied to a labelled resource needs no second answer.
    // Nor does one that no tracked resource could hold: there is nothing to choose.
    const loose = ratios.filter(
      (ratio) =>
        resources.some((entry) => entry.cap === ratio.cap) &&
        !parsed.resources?.some(
          (item) =>
            item.value === ratio.value && resources.find((entry) => entry.id === item.resourceId)?.cap === ratio.cap,
        ),
    );
    const assigned = new Set<string>();
    let clash = false;
    for (const ratio of loose) {
      const resourceId = assignments[`${ratio.value}/${ratio.cap}`];
      if (!resourceId) continue;
      const resource = resources.find((item) => item.id === resourceId);
      if (!resource || resource.cap !== ratio.cap || assigned.has(resourceId)) {
        clash = true;
        continue;
      }
      assigned.add(resourceId);
      parsed.resources = [
        ...(parsed.resources ?? []).filter((item) => item.resourceId !== resourceId),
        { resourceId, value: ratio.value, confidence: 0.85 },
      ];
    }
    // An assignment changes what the evidence says, so it is a new import.
    if (assigned.size) parsed.id = crypto.randomUUID();
    const next: GameImportBatch = {
      ...parsed,
      resources: parsed.resources
        ?.filter((item) => !skipped.includes(item.resourceId))
        .map((item) => ({ ...item, ...edits[item.resourceId], confirmed: true })),
      tasks: parsed.tasks
        ?.filter((item) => !skipped.includes(item.taskId))
        .map((item) => ({ ...item, confirmed: true })),
    };
    return { batch: next, conflict: clash, unlabelled: loose };
    // `resources` is derived from `state` on every render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, capturedAt, draft.capturedAt, edits, game.id, ratios, skipped, state, text, timeValid]);

  const plan = useMemo(() => planGameImport(state, batch, Date.now()), [batch, state]);
  const ready = timeValid && !conflict && plan.resources.length + plan.tasks.length > 0;
  const reset = () => {
    setEdits({});
    setSkipped([]);
    setError('');
  };
  const number = (value: string) => (value === '' ? null : Number(value));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!timeValid) setError('The capture time cannot be in the future.');
        else if (conflict) setError('Assign each resource once, with a matching maximum value.');
        else if (!saveDraft(batch)) setError('Nothing was saved. Check the values and try again.');
      }}
    >
      <p className="text-meta text-muted">{draft.reason}</p>
      {batch.resources?.map((item) => {
        const resource = resources.find((entry) => entry.id === item.resourceId);
        if (!resource) return null;
        return (
          <div key={item.resourceId} className="flex flex-wrap items-end gap-3">
            <Field className="min-w-0 flex-1 basis-32" label={`${resource.name} / ${resource.cap}`}>
              <NumInput
                min={0}
                max={resource.cap}
                value={item.value ?? ''}
                onChange={(event) =>
                  setEdits({
                    ...edits,
                    [item.resourceId]: { ...edits[item.resourceId], value: number(event.target.value) },
                  })
                }
              />
            </Field>
            {item.reserve != null && (
              <Field className="min-w-0 flex-1 basis-32" label={resource.reserveLabel || 'Reserve'}>
                <NumInput
                  min={0}
                  max={resource.reserveCap}
                  value={item.reserve}
                  onChange={(event) =>
                    setEdits({
                      ...edits,
                      [item.resourceId]: { ...edits[item.resourceId], reserve: number(event.target.value) },
                    })
                  }
                />
              </Field>
            )}
            <Btn
              className={TOUCH_BUTTON}
              aria-label={`Skip ${resource.name}`}
              onClick={() => setSkipped([...skipped, item.resourceId])}
            >
              Skip
            </Btn>
          </div>
        );
      })}
      {unlabelled.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-meta font-semibold text-fg-soft">Values without a label</legend>
          {unlabelled.map((ratio) => {
            const key = `${ratio.value}/${ratio.cap}`;
            const options = resources.filter((resource) => resource.cap === ratio.cap);
            return (
              <Field key={key} label={`${ratio.value} / ${ratio.cap}`}>
                <Select
                  value={assignments[key] ?? ''}
                  onChange={(event) => {
                    setAssignments({ ...assignments, [key]: event.target.value });
                    reset();
                  }}
                >
                  <option value="">Not a tracked value</option>
                  {options.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          })}
        </fieldset>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-0 flex-1 basis-48" label="Taken">
          <TextInput
            type="datetime-local"
            required
            max={localDateTime(Date.now())}
            value={Number.isFinite(capturedAt) ? localDateTime(capturedAt) : ''}
            onChange={(event) => {
              setCapturedAt(new Date(event.target.value).getTime());
              setError('');
            }}
          />
        </Field>
        <Btn className={TOUCH_BUTTON} onClick={() => setCapturedAt(Date.now())}>
          Just now
        </Btn>
      </div>
      <details className="text-body" open={textOpen} onToggle={(event) => setTextOpen(event.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer py-2 text-meta font-semibold text-fg-soft sm:min-h-9">
          Screenshot text
        </summary>
        <textarea
          aria-label="Screenshot text"
          className="ui-input min-h-28 w-full rounded-ui-lg bg-fill-2 p-3 text-body text-fg ring-1 ring-line-edge"
          maxLength={30000}
          value={text}
          placeholder={`${resources[0]?.name ?? 'Energy'} 120 / ${resources[0]?.cap ?? 200}`}
          onChange={(event) => {
            editDraftText(event.target.value);
            setAssignments({});
            reset();
          }}
        />
      </details>
      {plan.issues.length > 0 && (
        <ul className="space-y-1 text-meta text-warn-fg">
          {plan.issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-meta text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" kind="primary" className={TOUCH_BUTTON} disabled={!ready}>
          Save {plan.resources.length + plan.tasks.length || ''}{' '}
          {plan.resources.length + plan.tasks.length === 1 ? 'reading' : 'readings'}
        </Btn>
        <Btn className={TOUCH_BUTTON} onClick={closeReadings}>
          Discard
        </Btn>
      </div>
    </form>
  );
}

function ReadingHistory({ game }: { game: Game }) {
  const entries = useApp((store) => store.importHistory).filter((entry) => entry.gameId === game.id);
  if (!entries.length) return <p className="text-meta text-muted">No imports yet.</p>;
  return (
    <ul className="divide-y divide-line-hairline">
      {entries.map((entry) => (
        <li key={entry.batchId} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-body text-fg-soft">
              {entry.source.kind === 'account' ? 'Account' : 'Screenshot'} · {entry.applied} saved
            </p>
            <p className="text-caption text-muted">
              {new Date(entry.importedAt).toLocaleString()}
              {entry.undoneAt != null && ' · undone'}
            </p>
          </div>
          <Btn
            className={TOUCH_BUTTON}
            disabled={entry.undoneAt != null}
            aria-label={`Undo import from ${new Date(entry.importedAt).toLocaleString()}`}
            onClick={() => undoReading(entry.batchId)}
          >
            Undo
          </Btn>
        </li>
      ))}
    </ul>
  );
}

const PANEL_TITLE = { review: 'Check this reading', account: 'Account', history: 'Recent imports' } as const;

/** Opens inside the card, under its controls: a review, the account, or past imports. */
/** The menu that opens a panel can sit at the foot of the page, so a new panel is brought into view. */
const reveal = (node: HTMLElement | null) => node?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });

export function ReadingsPanel({ game }: { game: Game }) {
  const panel = useReadings((store) => (store.panel?.gameId === game.id ? store.panel : null));
  const draft = useReadings((store) => (store.draft?.gameId === game.id ? store.draft : null));
  if (!panel || (panel.view === 'review' && !draft)) return null;
  return (
    <section
      ref={reveal}
      className="game-panel relative z-20 border-b border-line py-4"
      aria-label={`${PANEL_TITLE[panel.view]} for ${game.name}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-fg">{PANEL_TITLE[panel.view]}</h3>
        {panel.view !== 'review' && (
          <Btn className={TOUCH_BUTTON} onClick={closeReadings}>
            Close
          </Btn>
        )}
      </div>
      {panel.view === 'review' && draft && <ReadingReview key={draft.id} game={game} draft={draft} />}
      {panel.view === 'account' && <GameConnections key={game.id} gameId={game.id} onReview={saveAccountReading} />}
      {panel.view === 'history' && <ReadingHistory game={game} />}
    </section>
  );
}
