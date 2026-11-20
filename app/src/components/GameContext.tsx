import { useState } from 'react';
import type { Game } from '@memoria/shared';
import { useGameDraft } from './game-detail/useGameDraft';
import '../notes.css';

const NOTES_FIELDS = ['notes'] as const;
/** What the game's notes field takes: the same limit its sync schema holds it to. */
export const NOTES_MAX = 20_000;

function NotesField({ game, label, grow }: { game: Game; label?: string; grow?: boolean }) {
  const { draft, changeDraft, commitDraft } = useGameDraft(game, NOTES_FIELDS);
  const id = `notes-${game.id}`;
  return (
    <div className="game-context-block">
      {label ? (
        <label htmlFor={id} className="game-context-label">
          {label}
        </label>
      ) : null}
      <textarea
        id={id}
        className="game-notes"
        data-grow={grow || undefined}
        aria-label={label ? undefined : `${game.name} notes`}
        value={draft.notes}
        maxLength={NOTES_MAX}
        rows={grow ? 14 : 6}
        placeholder="Anything to remember for this account: builds, routes, what to do next…"
        onChange={(event) => changeDraft('notes', event.target.value)}
        onBlur={commitDraft}
      />
    </div>
  );
}

/**
 * The player's own notes for one game: plain text, saved as they type and
 * synced like the rest of the game. Used on the game's Notes tab and on the
 * Notes page that gathers every game's.
 */
export function GameNotesEditor({ game, label, grow }: { game: Game; label?: string; grow?: boolean }) {
  const [focused, setFocused] = useState(false);
  // Another device's edit refreshes the box, but never while it is being typed in.
  const [key, setKey] = useState(game.notes ?? '');
  if (!focused && key !== (game.notes ?? '')) setKey(game.notes ?? '');
  return (
    <div onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <NotesField key={`${game.id}:${key}`} game={game} label={label} grow={grow} />
    </div>
  );
}
