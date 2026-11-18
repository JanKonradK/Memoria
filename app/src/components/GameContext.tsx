import { useState } from 'react';
import type { Game } from '@memoria/shared';
import { useGameDraft } from './game-detail/useGameDraft';

const NOTES_FIELDS = ['notes'] as const;

/** Plain text the player keeps for this account. Saved as they type, synced like the rest of the game. */
function GameNotes({ game }: { game: Game }) {
  const { draft, changeDraft, commitDraft } = useGameDraft(game, NOTES_FIELDS);
  return (
    <section className="game-context-block" aria-label="Notes">
      <label htmlFor={`notes-${game.id}`} className="game-context-label">
        Notes
      </label>
      <textarea
        id={`notes-${game.id}`}
        className="game-notes"
        value={draft.notes}
        maxLength={2000}
        rows={6}
        placeholder="Anything to remember for this account…"
        onChange={(event) => changeDraft('notes', event.target.value)}
        onBlur={commitDraft}
      />
    </section>
  );
}

/**
 * The side column of a game's page: the player's own notes. Livestreams live in
 * the game's Catch up, beside its version news and codes.
 */
export function GameContext({ game }: { game: Game }) {
  const [notesFocused, setNotesFocused] = useState(false);
  // Another device's edit refreshes the box, but never while it is being typed in.
  const [notesKey, setNotesKey] = useState(game.notes ?? '');
  if (!notesFocused && notesKey !== (game.notes ?? '')) setNotesKey(game.notes ?? '');

  return (
    <aside className="game-context" aria-label={`${game.name} notes`}>
      <div onFocus={() => setNotesFocused(true)} onBlur={() => setNotesFocused(false)}>
        <GameNotes key={`${game.id}:${notesKey}`} game={game} />
      </div>
    </aside>
  );
}
