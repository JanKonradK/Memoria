import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  availableQuests,
  CatalogQuestSchema,
  catalogLine,
  customLine,
  nextPartState,
  presetForGame,
  QUEST_KINDS,
  questMarkId,
  questMarkIndex,
  questMatches,
  questProgress,
  questTotals,
  type Game,
  type QuestKind,
  type QuestLine,
  type QuestState,
} from '@memoria/shared';
import { useApp } from '../store';
import { useNow } from '../hooks';
import { useGround } from '../theme';
import { assignGameInks } from '../game-color';
import { fmtDur } from '../util';
import { rosterGames } from './roster';
import { Btn, ConfirmAction, Field, Select, TextArea, TextInput } from './ui';
import { ProgressBar, Tick } from './primitives';
import '../history.css';
import '../quests.css';
import { SwipeRow } from '../swipe-row';

const catalogs = import.meta.glob<{ default: unknown }>('../data/quests/*.json');

export const KIND_LABELS: Record<QuestKind, string> = {
  main: 'Main story',
  world: 'World',
  story: 'Characters',
  side: 'Side',
  event: 'Events',
};

interface LoadedCatalog {
  key: string;
  lines: QuestLine[];
  reviewed: string | null;
  /** Entries the file carried that failed validation and were left out. */
  skipped: number;
  error: string;
}

/** The bundled catalog of one preset, validated quest by quest so one bad entry costs only itself. */
function useCatalog(key: string | null): LoadedCatalog | null {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null);
  useEffect(() => {
    let live = true;
    const load = key ? catalogs[`../data/quests/${key}.json`] : undefined;
    if (!key || !load) {
      setLoaded(key ? { key, lines: [], reviewed: null, skipped: 0, error: '' } : null);
      return;
    }
    load()
      .then((module) => {
        const raw = module.default as { reviewed?: unknown; quests?: unknown };
        const quests = Array.isArray(raw?.quests) ? raw.quests : [];
        const lines: QuestLine[] = [];
        const seen = new Set<string>();
        let skipped = 0;
        for (const item of quests) {
          const parsed = CatalogQuestSchema.safeParse(item);
          if (!parsed.success || seen.has(parsed.data.id)) skipped++;
          else {
            seen.add(parsed.data.id);
            lines.push(catalogLine(parsed.data));
          }
        }
        if (live)
          setLoaded({
            key,
            lines,
            reviewed: typeof raw?.reviewed === 'string' ? raw.reviewed : null,
            skipped,
            error: '',
          });
      })
      .catch(
        () =>
          live &&
          setLoaded({ key, lines: [], reviewed: null, skipped: 0, error: 'The quest list could not be loaded.' }),
      );
    return () => {
      live = false;
    };
  }, [key]);
  return loaded?.key === key ? loaded : null;
}

type StatusFilter = 'all' | 'open' | 'started' | 'done';

/**
 * A game's Quests tab: a companion to its story. Every main-story act,
 * world-quest series and character story, with the parts a player ticks off,
 * partly or fully, and who is in them. Progress is per account and syncs.
 */
export function GameQuestsView({ game }: { game: Game }) {
  const games = useApp((s) => s.state.games);
  const ground = useGround();
  const roster = useMemo(() => rosterGames(games), [games]);
  const inks = useMemo(() => assignGameInks(roster, ground), [roster, ground]);
  return (
    <div className="quests-page">
      <GameQuests game={game} ink={inks[game.id] ?? game.color} />
    </div>
  );
}

function GameQuests({ game, ink }: { game: Game; ink: string }) {
  const presetKey = game.presetKey ?? presetForGame(game)?.key ?? null;
  const catalog = useCatalog(presetKey);
  const marks = useApp((s) => s.state.questMarks);
  const customQuests = useApp((s) => s.state.customQuests);
  const index = useMemo(() => questMarkIndex(marks, game.id), [marks, game.id]);
  const lines = useMemo(
    () => [
      ...(catalog?.lines ?? []),
      ...customQuests.filter((quest) => !quest.deleted && quest.gameId === game.id).map(customLine),
    ],
    [catalog, customQuests, game.id],
  );
  const [kind, setKind] = useState<QuestKind | 'all' | 'mine'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const title = game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name;
  const kinds = QUEST_KINDS.filter((k) => lines.some((line) => line.kind === k));
  const totals = questTotals(lines, game.id, index);
  const started = lines.filter((line) => questProgress(line, game.id, index).status === 'started');
  const next = availableQuests(lines, game.id, index).slice(0, 4);

  const shown = lines.filter((line) => {
    if (kind === 'mine' ? !line.custom : kind !== 'all' && line.kind !== kind) return false;
    const progress = questProgress(line, game.id, index).status;
    if (status === 'open' && (progress === 'done' || progress === 'skipped')) return false;
    if (status === 'started' && progress !== 'started') return false;
    if (status === 'done' && progress !== 'done' && progress !== 'skipped') return false;
    return questMatches(line, query);
  });
  const groups: { name: string; lines: QuestLine[] }[] = [];
  for (const line of shown) {
    const name = line.custom ? 'Added by you' : `${KIND_LABELS[line.kind]}${line.series ? ` · ${line.series}` : ''}`;
    const last = groups.at(-1);
    if (last?.name === name) last.lines.push(line);
    else groups.push({ name, lines: [line] });
  }
  const toggle = (id: string) =>
    setOpen((current) => {
      const nextOpen = new Set(current);
      if (nextOpen.has(id)) nextOpen.delete(id);
      else nextOpen.add(id);
      return nextOpen;
    });
  const reveal = (id: string) => {
    setKind('all');
    setStatus('all');
    setQuery('');
    setOpen((current) => new Set(current).add(id));
    requestAnimationFrame(() =>
      document.getElementById(`quest-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  };

  return (
    <section aria-label={`${title} quests`}>
      <div className="quests-summary">
        <div className="min-w-0 flex-1">
          <h2 className="text-lead font-semibold text-fg">Story progress</h2>
          {lines.length > 0 && (
            <p className="text-meta text-muted">
              <span className="numeral">
                {totals.done}/{totals.lines}
              </span>{' '}
              lines
              {totals.started > 0 && (
                <>
                  {' · '}
                  <span className="numeral">{totals.started}</span> started
                </>
              )}
              {' · '}
              <span className="numeral">
                {totals.partsDone}/{totals.parts}
              </span>{' '}
              parts
            </p>
          )}
        </div>
        {lines.length > 0 && (
          <ProgressBar
            variant="ring"
            value={totals.parts ? totals.partsDone / totals.parts : 0}
            color={ink}
            size={48}
            role="img"
            aria-label={`${Math.round((totals.parts ? totals.partsDone / totals.parts : 0) * 100)}% of parts done`}
          >
            <span className="text-caption font-semibold tabular-nums text-fg-soft">
              {Math.round((totals.parts ? totals.partsDone / totals.parts : 0) * 100)}%
            </span>
          </ProgressBar>
        )}
      </div>

      <EventsNow game={game} ink={ink} />

      {catalog?.error && <p className="mt-4 text-body text-danger-fg">{catalog.error}</p>}
      {catalog && !catalog.error && !catalog.lines.length && (
        <p className="quests-empty text-body text-muted">
          There is no quest list for {game.name} yet. Add the quest lines you are following and tick them off here.
        </p>
      )}

      {(started.length > 0 || next.length > 0) && (
        <div className="quests-next">
          {started.length > 0 && (
            <div>
              <h2 className="quests-subhead">Continue</h2>
              <ul className="quests-chips">
                {started.slice(0, 6).map((line) => (
                  <li key={line.id}>
                    <button type="button" className="quests-chip" onClick={() => reveal(line.id)}>
                      {line.title}
                      <span className="tabular-nums text-muted">
                        {questProgress(line, game.id, index).done}/{line.parts.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {next.length > 0 && (
            <div>
              <h2 className="quests-subhead">Ready to start</h2>
              <ul className="quests-chips">
                {next.map((line) => (
                  <li key={line.id}>
                    <button type="button" className="quests-chip" onClick={() => reveal(line.id)}>
                      {line.title}
                      {line.region && <span className="text-muted">{line.region}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="quests-tools">
        <TextInput
          type="search"
          placeholder="Search quests, places, characters"
          aria-label="Search quests"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="quests-search"
        />
        <Select
          aria-label="Kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
          className="!w-40"
        >
          <option value="all">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
          {customQuests.some((quest) => !quest.deleted && quest.gameId === game.id) && (
            <option value="mine">Added by you</option>
          )}
        </Select>
        <Select
          aria-label="Progress"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className="!w-36"
        >
          <option value="all">Any progress</option>
          <option value="open">Not finished</option>
          <option value="started">In progress</option>
          <option value="done">Finished</option>
        </Select>
        <Btn onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          {adding ? 'Close' : 'Add a quest line'}
        </Btn>
      </div>
      {adding && <CustomQuestForm game={game} onDone={() => setAdding(false)} />}

      {lines.length > 0 && !shown.length && <p className="quests-empty text-body text-muted">No quest matches.</p>}
      {groups.map((group) => (
        <section key={group.name} className="quests-group" aria-label={group.name}>
          <h2 className="quests-subhead">{group.name}</h2>
          <ul className="quests-list">
            {group.lines.map((line) => (
              <QuestRow
                key={line.id}
                line={line}
                game={game}
                ink={ink}
                marks={index}
                open={open.has(line.id)}
                onToggle={() => toggle(line.id)}
                onFind={(name) => setQuery(name)}
                titleOf={(id) => lines.find((other) => other.id === id)?.title ?? id}
                onReveal={reveal}
              />
            ))}
          </ul>
        </section>
      ))}
      {catalog?.reviewed && (
        <p className="mt-6 text-label text-muted">
          Quest list researched {catalog.reviewed} from community wikis. Names and parts can lag a new version; your own
          quest lines fill the gaps.
          {catalog.skipped > 0 && ` ${catalog.skipped} damaged entries were left out.`}
        </p>
      )}
    </section>
  );
}

function stateLabel(state: QuestState | undefined): string {
  return state === 'done' ? 'done' : state === 'partial' ? 'partly done' : state === 'skipped' ? 'skipped' : 'not done';
}

function QuestRow({
  line,
  game,
  ink,
  marks,
  open,
  onToggle,
  onFind,
  titleOf,
  onReveal,
}: {
  line: QuestLine;
  game: Game;
  ink: string;
  marks: Map<string, QuestState>;
  open: boolean;
  onToggle: () => void;
  onFind: (name: string) => void;
  titleOf: (id: string) => string;
  onReveal: (id: string) => void;
}) {
  const setQuestMarks = useApp((s) => s.setQuestMarks);
  const deleteCustomQuest = useApp((s) => s.deleteCustomQuest);
  const progress = questProgress(line, game.id, marks);
  const own = marks.get(questMarkId(game.id, line.id));
  const finished = progress.status === 'done' || progress.status === 'skipped';
  const panelId = `quest-panel-${line.id.replace(/[^a-z0-9-]/gi, '-')}`;
  // Games without version numbers date their story content instead.
  const version = line.version ? (/^\d{4}-/.test(line.version) ? line.version : `v${line.version}`) : null;
  const meta = [line.region, version, `${progress.done}/${progress.total}`].filter(Boolean);

  const finishAll = () => setQuestMarks(game.id, [{ questId: line.id, state: 'done' }]);
  const clearAll = () =>
    setQuestMarks(game.id, [
      { questId: line.id, state: null },
      ...line.parts.map((part) => ({ questId: line.id, partId: part.id, state: null })),
    ]);

  return (
    <li id={`quest-${line.id}`} className="quests-row look-row" data-status={progress.status}>
      <SwipeRow
        className="quests-row-head"
        ink={ink}
        right={finished ? null : { label: 'Done', run: finishAll }}
        left={finished || progress.status === 'started' ? { label: 'Clear', run: clearAll } : null}
      >
        <button
          type="button"
          className="group quests-tick"
          role="checkbox"
          aria-checked={finished ? 'true' : progress.status === 'started' ? 'mixed' : 'false'}
          aria-label={`${line.title}: ${finished ? 'finished' : progress.status === 'started' ? 'in progress' : 'not started'}`}
          onClick={() => (finished ? setQuestMarks(game.id, [{ questId: line.id, state: null }]) : finishAll())}
        >
          <Tick color={ink} checked={finished} fraction={finished ? undefined : progress.ratio} checkEnter="pop" />
        </button>
        <button
          type="button"
          className="quests-row-title"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className={`text-body font-medium ${finished ? 'text-muted line-through decoration-1' : 'text-fg'}`}>
            {line.title}
          </span>
          <span className="text-meta tabular-nums text-muted">
            {own === 'skipped' ? 'Skipped · ' : ''}
            {meta.join(' · ')}
          </span>
        </button>
      </SwipeRow>
      {open && (
        <div id={panelId} className="quests-panel">
          {line.summary && <p className="text-body text-fg-soft">{line.summary}</p>}
          {line.notes && <p className="whitespace-pre-wrap text-body text-fg-soft">{line.notes}</p>}
          {line.start && (
            <p className="text-meta text-muted">
              <span className="font-semibold text-fg-soft">How to start: </span>
              {line.start}
            </p>
          )}
          {line.requires.length > 0 && (
            <p className="text-meta text-muted">
              <span className="font-semibold text-fg-soft">After: </span>
              {line.requires.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <button type="button" className="quests-link" onClick={() => onReveal(id)}>
                    {titleOf(id)}
                  </button>
                </span>
              ))}
            </p>
          )}
          {line.characters.length > 0 && (
            <div className="quests-people" aria-label="Characters">
              {line.characters.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="quests-person"
                  onClick={() => onFind(name)}
                  aria-label={`Find quests with ${name}`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <ol className="quests-parts">
            {line.parts.map((part, index) => {
              const state = marks.get(questMarkId(game.id, line.id, part.id));
              const covered = own === 'done' || own === 'skipped';
              const shown = covered ? own : state;
              const partDone = shown === 'done' || shown === 'skipped';
              const mark = (to: QuestState | null) => () =>
                setQuestMarks(game.id, [{ questId: line.id, partId: part.id, state: to }]);
              return (
                <SwipeRow
                  as="li"
                  key={part.id}
                  className="quests-part"
                  data-state={shown ?? 'open'}
                  ink={ink}
                  right={covered || partDone ? null : { label: 'Done', run: mark('done') }}
                  left={covered || !shown ? null : { label: 'Clear', run: mark(null) }}
                >
                  <button
                    type="button"
                    className="group quests-tick"
                    role="checkbox"
                    aria-checked={
                      shown === 'done' || shown === 'skipped' ? 'true' : shown === 'partial' ? 'mixed' : 'false'
                    }
                    aria-label={`${part.title}: ${stateLabel(shown)}. Press to mark ${stateLabel(nextPartState(state) ?? undefined)}.`}
                    disabled={covered}
                    onClick={() =>
                      setQuestMarks(game.id, [{ questId: line.id, partId: part.id, state: nextPartState(state) }])
                    }
                  >
                    <Tick
                      color={ink}
                      checked={shown === 'done' || shown === 'skipped'}
                      fraction={shown === 'partial' ? 0.5 : undefined}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-fg">
                      <span className="mr-1.5 tabular-nums text-muted">{index + 1}.</span>
                      {part.title}
                      {shown === 'partial' && <span className="quests-partial">partly done</span>}
                    </p>
                    {(part.characters.length > 0 || part.note) && (
                      <p className="text-meta text-muted">
                        {part.characters.join(', ')}
                        {part.characters.length > 0 && part.note ? ' · ' : ''}
                        {part.note}
                      </p>
                    )}
                  </div>
                </SwipeRow>
              );
            })}
          </ol>
          <p className="text-label text-muted">Press a part once for done, again for partly done, again to clear.</p>
          <div className="flex flex-wrap items-center gap-2">
            {!finished && <Btn onClick={finishAll}>Mark all done</Btn>}
            {own !== 'skipped' && !finished && (
              <Btn onClick={() => setQuestMarks(game.id, [{ questId: line.id, state: 'skipped' }])}>Skip</Btn>
            )}
            {(progress.done > 0 || progress.partial > 0 || own) && (
              <ConfirmAction label="Clear progress" confirmLabel="Clear" onConfirm={clearAll} />
            )}
            {line.url && (
              <a className="quests-link ml-auto text-meta" href={line.url} target="_blank" rel="noreferrer">
                Open the wiki page ↗
              </a>
            )}
            {line.custom && (
              <ConfirmAction
                label="Delete quest line"
                confirmLabel="Delete"
                onConfirm={() => deleteCustomQuest(line.id.slice(3))}
              />
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** The game's events running now, with their parts, so event quests sit next to the story. */
function EventsNow({ game, ink }: { game: Game; ink: string }) {
  const events = useApp((s) => s.state.events);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const now = useNow(60_000);
  const live = events
    .filter(
      (event) =>
        !event.deleted && event.gameId === game.id && event.type === 'event' && event.start <= now && event.end > now,
    )
    .sort((a, b) => a.end - b.end);
  if (!live.length) return null;
  return (
    <section className="quests-group" aria-label="Events running now">
      <h2 className="quests-subhead">Events running now</h2>
      <ul className="quests-list">
        {live.map((event) => {
          const parts = event.parts ?? 0;
          const partsDone = Math.min(parts, event.partsDone ?? 0);
          return (
            <li
              key={event.id}
              className="quests-row"
              data-status={event.done ? 'done' : partsDone ? 'started' : 'todo'}
            >
              <div className="quests-row-head">
                <button
                  type="button"
                  className="group quests-tick"
                  role="checkbox"
                  aria-checked={event.done ? 'true' : partsDone ? 'mixed' : 'false'}
                  aria-label={`${event.name}: ${event.done ? 'done' : 'not done'}`}
                  onClick={() => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done })}
                >
                  <Tick
                    color={ink}
                    checked={!!event.done}
                    fraction={!event.done && parts ? partsDone / parts : undefined}
                  />
                </button>
                <div className="quests-row-title">
                  <span
                    className={`text-body font-medium ${event.done ? 'text-muted line-through decoration-1' : 'text-fg'}`}
                  >
                    {event.name}
                  </span>
                  <span className="text-meta tabular-nums text-muted">
                    ends in {fmtDur(event.end - now)}
                    {parts > 0 && ` · ${partsDone}/${parts} parts`}
                  </span>
                </div>
                {parts > 0 && !event.done && (
                  <div className="flex gap-1">
                    <Btn
                      aria-label={`One part fewer for ${event.name}`}
                      disabled={partsDone === 0}
                      onClick={() => upsertEvent({ id: event.id, gameId: event.gameId, partsDone: partsDone - 1 })}
                    >
                      −
                    </Btn>
                    <Btn
                      aria-label={`One more part done for ${event.name}`}
                      onClick={() =>
                        upsertEvent({
                          id: event.id,
                          gameId: event.gameId,
                          partsDone: partsDone + 1,
                          ...(partsDone + 1 >= parts ? { done: true } : {}),
                        })
                      }
                    >
                      +
                    </Btn>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CustomQuestForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const saveCustomQuest = useApp((s) => s.saveCustomQuest);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<QuestKind>('world');
  const [series, setSeries] = useState('');
  const [parts, setParts] = useState('');
  const [characters, setCharacters] = useState('');
  const [notes, setNotes] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const partList = parts
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((part, index) => ({ id: String(index + 1), title: part.slice(0, 300) }));
    saveCustomQuest({
      gameId: game.id,
      title: title.trim().slice(0, 300),
      kind,
      ...(series.trim() ? { series: series.trim().slice(0, 200) } : {}),
      ...(partList.length ? { parts: partList } : {}),
      ...(characters.trim()
        ? {
            characters: characters
              .split(',')
              .map((name) => name.trim().slice(0, 100))
              .filter(Boolean)
              .slice(0, 40),
          }
        : {}),
      ...(notes.trim() ? { notes: notes.trim().slice(0, 20_000) } : {}),
    });
    onDone();
  };
  return (
    <form className="quests-form" onSubmit={submit} aria-label="Add a quest line">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Quest line">
          <TextInput required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as QuestKind)}>
            {QUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Region or series">
          <TextInput maxLength={200} value={series} onChange={(e) => setSeries(e.target.value)} />
        </Field>
      </div>
      <Field label="Parts, one per line">
        <TextArea rows={4} value={parts} onChange={(e) => setParts(e.target.value)} />
      </Field>
      <Field label="Characters, separated by commas">
        <TextInput maxLength={2000} value={characters} onChange={(e) => setCharacters(e.target.value)} />
      </Field>
      <Field label="Notes">
        <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Btn kind="primary" type="submit" disabled={!title.trim()}>
          Add quest line
        </Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
    </form>
  );
}
