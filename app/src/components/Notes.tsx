import { useDeferredValue, useState } from 'react';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { openGame } from '../workspace-navigation';
import { GameLogo } from './GameLogo';
import { GameNotesEditor } from './GameContext';
import { useIdentityColors } from './roster';
import { PageBar, PageBarEnd, PageTitle } from './shell/PageBar';
import { Page, TextInput } from './ui';

/**
 * Every game's notes on one page, in the rail's order. Each box is the same
 * notes a game's own Notes tab shows, so a line written here is there too.
 */
export function NotesPage() {
  const all = useApp((s) => s.state.games);
  const identity = useIdentityColors(all);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const games = all
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort)
    .map((game) => ({ ...game, ...(identity[game.id] ?? {}) }));
  const shown = search
    ? games.filter((game) =>
        [game.name, game.accountLabel ?? '', game.notes ?? ''].some((text) => text.toLowerCase().includes(search)),
      )
    : games;
  const written = games.filter((game) => game.notes?.trim()).length;

  return (
    <Page className="notes-page">
      <PageBar>
        <PageTitle sub={games.length ? `${written} of ${games.length} games have notes` : undefined}>Notes</PageTitle>
        {games.length > 1 && (
          <PageBarEnd>
            <TextInput
              type="search"
              className="notes-search"
              placeholder="Search notes"
              aria-label="Search notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </PageBarEnd>
        )}
      </PageBar>

      {games.length === 0 ? (
        <div className="notes-empty">
          <p className="text-body text-fg-soft">Add a game and its notes live here.</p>
          <button
            type="button"
            className="notes-empty-add"
            onClick={() => useUI.getState().openSheet({ kind: 'addGame' })}
          >
            Add a game
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="notes-empty text-body text-muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <div className="notes-grid">
          {shown.map((game) => {
            const account = game.accountLabel?.trim();
            return (
              <section key={game.id} className="notes-game" aria-labelledby={`notes-title-${game.id}`}>
                <header className="notes-game-head">
                  <GameLogo game={game} size={40} />
                  <div className="min-w-0 flex-1">
                    <h2 id={`notes-title-${game.id}`} className="notes-game-name">
                      {game.name}
                    </h2>
                    {account && <p className="notes-game-account">{account}</p>}
                  </div>
                  <button
                    type="button"
                    className="notes-game-open"
                    onClick={() => openGame(game.id)}
                    aria-label={`Open ${game.name}`}
                  >
                    Open
                  </button>
                </header>
                <GameNotesEditor game={game} />
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}
