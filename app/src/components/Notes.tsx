import { useDeferredValue, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { noteMatches, sortNotes, type Game, type Note, type NoteSort } from '@memoria/shared';
import { gameInk } from '../game-color';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useGround } from '../theme';
import { useUI, type NotesView } from '../ui-store';
import { openGame } from '../workspace-navigation';
import { GameLogo } from './GameLogo';
import { GameScope } from './GameScope';
import { MENU, MENU_ITEM, NoteCard } from './notes/NoteCard';
import { NotesWall } from './notes/NotesWall';
import { useIdentityColors } from './roster';
import { PageBar, PageBarEnd, PageTitle } from './shell/PageBar';
import { Btn, Page, TextInput, Tooltip } from './ui';
import '../notes.css';

const SORTS: { value: NoteSort; label: string }[] = [
  { value: 'manual', label: 'Newest first' },
  { value: 'edited', label: 'Last edited' },
  { value: 'title', label: 'Title A–Z' },
];
const GROUPS: { value: NotesView['group']; label: string }[] = [
  { value: 'game', label: 'By game' },
  { value: 'wall', label: 'Wall' },
];
const DENSITIES: { value: NotesView['density']; label: string }[] = [
  { value: 'comfortable', label: 'Full' },
  { value: 'compact', label: 'Compact' },
];

/** The general notes' mark: their group's heading, and General's toggle in the game filter. */
function GeneralMark() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M5.5 2.5h6L15 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 15.5v-11.5a1.5 1.5 0 0 1 1.5-1.5zM7 10h6M7 13h4"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One choice in the View menu: a labelled set of radio items, the chosen one ticked. */
function ViewChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <>
      <Menu.Label className="px-3 pb-1 pt-2 text-label text-muted">{label}</Menu.Label>
      <Menu.RadioGroup aria-label={label} value={value} onValueChange={(next) => onChange(next as T)}>
        {options.map((option) => (
          <Menu.RadioItem
            key={option.value}
            value={option.value}
            className={`${MENU_ITEM} data-[state=checked]:text-fg`}
            // The menu stays open, so all three can be set in one visit.
            onSelect={(event) => event.preventDefault()}
          >
            <span className="min-w-0 flex-1">{option.label}</span>
            <Menu.ItemIndicator className="text-accent-fg">
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="icon h-4 w-4"
                aria-hidden
              >
                <path d="m5 10.5 3.5 3.5L15 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Menu.ItemIndicator>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </>
  );
}

/** How the page lays notes out (grouped or a wall), their order and their size, in one menu. */
function ViewMenu({ view, setView }: { view: NotesView; setView: (patch: Partial<NotesView>) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Btn className="notes-view inline-flex shrink-0 items-center gap-1.5" aria-label="View options">
          View
          <svg viewBox="0 0 20 20" className="icon h-3 w-3 text-muted" fill="currentColor" aria-hidden>
            <path d="M5.5 7.5l4.5 5 4.5-5z" />
          </svg>
        </Btn>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={MENU}>
          <ViewChoice label="Arrange" value={view.group} options={GROUPS} onChange={(group) => setView({ group })} />
          <Menu.Separator className="my-1 h-px bg-line" />
          <ViewChoice label="Sort" value={view.sort} options={SORTS} onChange={(sort) => setView({ sort })} />
          <Menu.Separator className="my-1 h-px bg-line" />
          <ViewChoice
            label="Note size"
            value={view.density}
            options={DENSITIES}
            onChange={(density) => setView({ density })}
          />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Every live game in the rail's order, in its identity colours. */
function useGames(): Game[] {
  const all = useApp((s) => s.state.games);
  const identity = useIdentityColors(all);
  return useMemo(
    () =>
      all
        .filter((game) => !game.deleted)
        .sort((a, b) => a.sort - b.sort)
        .map((game) => ({ ...game, ...(identity[game.id] ?? {}) })),
    [all, identity],
  );
}

function useLiveNotes(): Note[] {
  const notes = useApp((s) => s.state.notes);
  return useMemo(() => notes.filter((note) => !note.deleted), [notes]);
}

/** Starts a note and opens it for writing. */
function useNewNote(setEditing: (id: string) => void) {
  const saveNote = useApp((s) => s.saveNote);
  return (gameId: string | null) => setEditing(saveNote({ gameId }));
}

function NewNoteButton({
  onClick,
  label = 'New note',
  quiet,
}: {
  onClick: () => void;
  label?: string;
  quiet?: boolean;
}) {
  return (
    <button type="button" className={quiet ? 'notes-add-quiet' : 'notes-new'} onClick={onClick}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
        <path d="M10 4.5v11M4.5 10h11" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className={quiet ? 'sr-only' : undefined}>{label}</span>
    </button>
  );
}

/**
 * Every note, for every game and for none. By game, each game's notes stack
 * under its name; as a wall, every note stands on its own with its game named.
 * Notes are pinned, coloured, sorted, filtered and searched, and written in place.
 */
export function NotesPage() {
  const now = useNow(60_000);
  const games = useGames();
  const notes = useLiveNotes();
  const view = useUI((s) => s.notesView);
  const setView = useUI((s) => s.setNotesView);
  const ground = useGround();
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim());
  const [editing, setEditing] = useState<string | null>(null);
  const newNote = useNewNote(setEditing);
  const gameOf = (id: string | null) => (id ? games.find((game) => game.id === id) : undefined);

  // A game that has gone takes its filter with it.
  const filter = view.filter === 'all' || view.filter === 'general' || gameOf(view.filter) ? view.filter : 'all';
  const inFilter = (note: Note) =>
    filter === 'all' || (filter === 'general' ? note.gameId == null : note.gameId === filter);
  const shown = sortNotes(
    notes.filter((note) => inFilter(note) && (note.id === editing || noteMatches(note, search, gameOf(note.gameId)))),
    view.sort,
  );
  const compact = view.density === 'compact';

  const card = (note: Note, showGame: boolean) => (
    <NoteCard
      note={note}
      game={gameOf(note.gameId)}
      games={games}
      now={now}
      showGame={showGame}
      compact={compact}
      editing={editing === note.id}
      onEditing={(on) => setEditing(on ? note.id : null)}
    />
  );

  // By game: general notes first, then each game in the rail's order. Only
  // groups with notes show; + Note writes into the game chosen above.
  const groups: { id: string | null; game?: Game; notes: Note[] }[] = [
    { id: null, notes: shown.filter((note) => note.gameId == null) },
    ...games.map((game) => ({ id: game.id, game, notes: shown.filter((note) => note.gameId === game.id) })),
  ].filter((group) => (filter === 'all' || filter === (group.id ?? 'general')) && group.notes.length > 0);

  const newIn = filter === 'all' || filter === 'general' ? null : filter;
  const count = notes.length;
  const chosen = newIn ? gameOf(newIn) : undefined;
  const general: ReactNode = (
    <Tooltip content={filter === 'general' ? "Show every game's notes" : 'Show only general notes'}>
      <button
        type="button"
        className="calendar-game-toggle"
        aria-pressed={filter === 'general'}
        aria-label="General"
        onClick={() => setView({ filter: filter === 'general' ? 'all' : 'general' })}
      >
        <GeneralMark />
      </button>
    </Tooltip>
  );

  return (
    <Page className="notes-page">
      {/* One toolbar: search, whose notes, how they are laid out, and a new note. */}
      <PageBar className="notes-bar">
        <PageTitle sub={count ? `${count} ${count === 1 ? 'note' : 'notes'}` : undefined}>Notes</PageTitle>
        <PageBarEnd>
          {count > 0 && (
            <TextInput
              type="search"
              className="notes-search"
              placeholder="Search notes"
              aria-label="Search notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <GameScope
            className="notes-scope"
            label="Show notes for"
            lead={general}
            pick={{
              chosen: chosen?.id ?? null,
              onPick: (gameId) => setView({ filter: gameId ?? 'all' }),
              verb: 'notes',
            }}
          />
          <ViewMenu view={view} setView={setView} />
          <NewNoteButton onClick={() => newNote(newIn)} />
        </PageBarEnd>
      </PageBar>

      {count === 0 && !editing ? (
        <div className="notes-empty">
          <p className="text-body text-fg-soft">Builds, routes, what to do next: write it down here.</p>
          <NewNoteButton onClick={() => newNote(newIn)} label="Write the first note" />
        </div>
      ) : search && shown.length === 0 ? (
        <p className="notes-empty text-body text-muted">Nothing matches “{search}”.</p>
      ) : view.group === 'game' && groups.length === 0 ? (
        <div className="notes-empty">
          <p className="text-body text-fg-soft">
            {chosen
              ? `No notes for ${chosen.name} yet.`
              : filter === 'general'
                ? 'No general notes yet.'
                : 'No notes here yet.'}
          </p>
          <NewNoteButton onClick={() => newNote(newIn)} label="Write a note" />
        </div>
      ) : view.group === 'wall' ? (
        shown.length === 0 ? (
          <p className="notes-empty text-body text-muted">No notes here yet.</p>
        ) : (
          <NotesWall
            label="Notes"
            min={compact ? 240 : 288}
            items={shown.map((note) => ({ key: note.id, node: card(note, true) }))}
          />
        )
      ) : (
        <NotesWall
          min={compact ? 280 : 320}
          gap={24}
          items={groups.map((group) => ({
            key: group.id ?? 'general',
            node: (
              <section
                className="notes-group"
                aria-labelledby={`notes-group-${group.id ?? 'general'}`}
                style={group.game ? ({ '--group-ink': gameInk(group.game, ground) } as CSSProperties) : undefined}
              >
                <header className="notes-group-head">
                  {group.game ? (
                    <GameLogo game={group.game} size={32} />
                  ) : (
                    <span aria-hidden className="notes-group-mark">
                      <GeneralMark />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 id={`notes-group-${group.id ?? 'general'}`} className="notes-group-name">
                      {group.game ? group.game.name : 'General'}
                    </h2>
                    {group.game?.accountLabel?.trim() && (
                      <p className="notes-group-account">{group.game.accountLabel.trim()}</p>
                    )}
                  </div>
                  {group.game && (
                    <button
                      type="button"
                      className="notes-group-open"
                      onClick={() => openGame(group.game!.id)}
                      aria-label={`Open ${group.game.name}`}
                    >
                      Open
                    </button>
                  )}
                  <NewNoteButton
                    quiet
                    label={`New note for ${group.game ? group.game.name : 'General'}`}
                    onClick={() => newNote(group.id)}
                  />
                </header>
                <div className="notes-group-list" role="list" aria-label={`${group.game?.name ?? 'General'} notes`}>
                  {group.notes.map((note) => (
                    <div key={note.id} role="listitem">
                      {card(note, false)}
                    </div>
                  ))}
                </div>
              </section>
            ),
          }))}
        />
      )}
    </Page>
  );
}

/** A game's own Notes tab: its notes, written and kept the same way. */
export function GameNotes({ game }: { game: Game }) {
  const now = useNow(60_000);
  const games = useGames();
  const all = useLiveNotes();
  const sort = useUI((s) => s.notesView.sort);
  const compact = useUI((s) => s.notesView.density === 'compact');
  const [editing, setEditing] = useState<string | null>(null);
  const newNote = useNewNote(setEditing);
  const notes = sortNotes(
    all.filter((note) => note.gameId === game.id),
    sort,
  );
  const shown = games.find((item) => item.id === game.id) ?? game;
  return (
    <section className="game-notes-tab" aria-label={`${game.name} notes`}>
      <div className="game-notes-bar">
        <NewNoteButton onClick={() => newNote(game.id)} />
      </div>
      {notes.length === 0 ? (
        <button type="button" className="notes-group-empty game-notes-empty" onClick={() => newNote(game.id)}>
          Write the first note for {game.name}
        </button>
      ) : (
        <NotesWall
          label={`${game.name} notes`}
          min={compact ? 240 : 300}
          items={notes.map((note) => ({
            key: note.id,
            node: (
              <NoteCard
                note={note}
                game={shown}
                games={games}
                now={now}
                showGame={false}
                compact={compact}
                editing={editing === note.id}
                onEditing={(on) => setEditing(on ? note.id : null)}
              />
            ),
          }))}
        />
      )}
    </section>
  );
}
