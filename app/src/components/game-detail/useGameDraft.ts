import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game } from '@memoria/shared';
import { useApp } from '../../store';

export type GameDraftField = 'name' | 'short' | 'accountLabel' | 'notes';
type GameDraft<Fields extends GameDraftField> = Record<Fields, string>;

/** The default wait between a keystroke and the store, for fields that want one. */
export const DRAFT_COMMIT_DELAY_MS = 300;

function gameDraft<Fields extends GameDraftField>(
  game: Game | undefined,
  fields: readonly Fields[],
): GameDraft<Fields> {
  return Object.fromEntries(fields.map((field) => [field, game?.[field] ?? ''])) as GameDraft<Fields>;
}

/**
 * A local draft of a game's text fields that cannot lose what was typed.
 *
 * The draft exists because a controlled input reading straight from the store
 * fights the user: the store normalises, the sheet can swap games underneath,
 * and a deleted game must not be resurrected by a stray write. So the four
 * safety properties are the point of this hook, and all four survive whatever
 * `commitDelayMs` is set to — a pending edit is flushed before the game id
 * changes, again on unmount, and never onto a game that is gone.
 *
 * `commitDelayMs` is only about *when* the store hears about it:
 *
 * - `0` writes inside the change handler, so the live preview, the sheet title
 *   and every card carrying this game's name are exactly as current as the
 *   caret. This is what the game editor wants — a preview that trails the
 *   typing by a third of a second is a preview of the previous keystroke.
 * - `300` (the default) waits, which is right for a field whose value nothing
 *   else on screen is rendering while it is being typed.
 */
export function useGameDraft<Fields extends GameDraftField>(
  game: Game | undefined,
  fields: readonly Fields[],
  active = true,
  commitDelayMs: number = DRAFT_COMMIT_DELAY_MS,
) {
  const updateGame = useApp((state) => state.updateGame);
  const gameId = game?.id ?? null;
  const [draft, setDraft] = useState<GameDraft<Fields>>(() => gameDraft(game, fields));
  const draftRef = useRef(draft);
  const draftGameIdRef = useRef(gameId);
  const changedFields = useRef(new Set<Fields>());

  const commitDraft = useCallback(() => {
    const draftGameId = draftGameIdRef.current;
    if (!draftGameId || changedFields.current.size === 0) return;
    const current = useApp
      .getState()
      .state.games.find((candidate) => candidate.id === draftGameId && !candidate.deleted);
    if (!current) {
      changedFields.current.clear();
      return;
    }
    const pending = draftRef.current;
    const patch: Partial<Pick<Game, GameDraftField>> = {};
    for (const field of changedFields.current) {
      if (pending[field] !== (current[field] ?? '')) Object.assign(patch, { [field]: pending[field] });
    }
    if (Object.keys(patch).length > 0) updateGame(draftGameId, patch);
    changedFields.current.clear();
  }, [updateGame]);

  const changeDraft = (field: Fields, value: string) => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    changedFields.current.add(field);
    setDraft(next);
    // The ref is already the new value, so the commit sees this keystroke and
    // still diffs against the store — an unchanged field is never patched.
    if (commitDelayMs <= 0) commitDraft();
  };

  useEffect(() => {
    commitDraft();
    draftGameIdRef.current = gameId;
    if (!active || !gameId) return;
    const current = useApp.getState().state.games.find((candidate) => candidate.id === gameId && !candidate.deleted);
    const next = gameDraft(current, fields);
    draftRef.current = next;
    setDraft(next);
  }, [active, commitDraft, fields, gameId]);

  useEffect(() => {
    // Nothing to debounce when the change handler already wrote it through.
    if (!active || !gameId || commitDelayMs <= 0) return;
    const timer = setTimeout(commitDraft, commitDelayMs);
    return () => clearTimeout(timer);
  }, [active, commitDelayMs, commitDraft, draft, gameId]);

  useEffect(() => () => commitDraft(), [commitDraft]);

  return { changeDraft, commitDraft, draft };
}
