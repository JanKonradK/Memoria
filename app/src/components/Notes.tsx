import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react';
import { noteMatches, sortNotes, type Game, type Note, type NoteSort } from '@memoria/shared';
import { gameInk } from '../game-color';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useGround } from '../theme';
import { useUI, type NotesView } from '../ui-store';
import { openGame } from '../workspace-navigation';
import { GameLogo } from './GameLogo';
import { NoteCard } from './notes/NoteCard';
import { NotesWall } from './notes/NotesWall';
import { useIdentityColors } from './roster';
import { PageBar, PageBarEnd, PageTitle } from './shell/PageBar';
import { Page, Segmented, Select, TextInput } from './ui';
import '../notes.css';

const SORTS: { value: NoteSort; label: string }[] = [
  { value: 'manual', label: 'Newest first' },
  { value: 'edited', label: 'Last edited' },
  { value: 'title', label: 'Title A–Z' },
];

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
  const withNotes = new Set(notes.map((note) => note.gameId));
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

  // By game: general notes first, then each game in the rail's order. Without a
  // search every game shows, so each has its place to write in.
  const groups: { id: string | null; game?: Game; notes: Note[] }[] = [
    { id: null, notes: shown.filter((note) => note.gameId == null) },
    ...games.map((game) => ({ id: game.id, game, notes: shown.filter((note) => note.gameId === game.id) })),
  ].filter(
    (group) =>
      (filter === 'all' || filter === (group.id ?? 'general')) &&
      (group.notes.length > 0 || (!search && (group.id != null || filter === 'general'))),
  );

  const newIn = filter === 'all' || filter === 'general' ? null : filter;
  const count = notes.length;

  return (
    <Page className="notes-page">
      <PageBar>
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
          <NewNoteButton onClick={() => newNote(newIn)} />
        </PageBarEnd>
      </PageBar>

      <div className="notes-tools">
        <div className="notes-filters" role="group" aria-label="Show notes for">
          <FilterChip current={filter === 'all'} onClick={() => setView({ filter: 'all' })}>
            All
          </FilterChip>
          <FilterChip current={filter === 'general'} onClick={() => setView({ filter: 'general' })}>
            General
          </FilterChip>
          {games.map((game) => (
            <FilterChip
              key={game.id}
              current={filter === game.id}
              faint={!withNotes.has(game.id)}
              ink={gameInk(game, ground)}
              onClick={() => setView({ filter: game.id })}
              label={`${game.name}${game.accountLabel?.trim() ? `, ${game.accountLabel.trim()}` : ''}`}
            >
              <GameLogo game={game} size={20} />
              <span aria-hidden>{game.short.trim() || game.name}</span>
            </FilterChip>
          ))}
        </div>
        <div className="notes-controls">
          <div className="notes-sort">
            <Select
              aria-label="Sort notes"
              value={view.sort}
              onChange={(event) => setView({ sort: event.target.value as NoteSort })}
            >
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </Select>
          </div>
          <Segmented<NotesView['group']>
            ariaLabel="Arrange notes"
            value={view.group}
            onChange={(group) => setView({ group })}
            options={[
              { value: 'game', label: 'By game' },
              { value: 'wall', label: 'Wall' },
            ]}
          />
          <Segmented<NotesView['density']>
            ariaLabel="Note size"
            value={view.density}
            onChange={(density) => setView({ density })}
            options={[
              { value: 'comfortable', label: 'Full' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </div>
      </div>

      {count === 0 && !editing ? (
        <div className="notes-empty">
          <p className="text-body text-fg-soft">Builds, routes, what to do next: write it down here.</p>
          <NewNoteButton onClick={() => newNote(newIn)} label="Write the first note" />
        </div>
      ) : search && shown.length === 0 ? (
        <p className="notes-empty text-body text-muted">Nothing matches “{search}”.</p>
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
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
                        <path
                          d="M5.5 2.5h6L15 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 15.5v-11.5a1.5 1.5 0 0 1 1.5-1.5zM7 10h6M7 13h4"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
                {group.notes.length === 0 ? (
                  <button type="button" className="notes-group-empty" onClick={() => newNote(group.id)}>
                    Write a note
                  </button>
                ) : (
                  <div className="notes-group-list" role="list" aria-label={`${group.game?.name ?? 'General'} notes`}>
                    {group.notes.map((note) => (
                      <div key={note.id} role="listitem">
                        {card(note, false)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ),
          }))}
        />
      )}
    </Page>
  );
}

function FilterChip({
  current,
  faint,
  ink,
  label,
  onClick,
  children,
}: {
  current: boolean;
  faint?: boolean;
  ink?: string;
  label?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="notes-chip"
      aria-pressed={current}
      aria-label={label}
      data-faint={faint || undefined}
      style={ink ? ({ '--chip-ink': ink } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
    </button>
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
