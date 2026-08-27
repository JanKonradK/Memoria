import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game } from '@memoria/shared';
import { useApp } from '../../store';

export type GameDraftField = 'name' | 'short' | 'accountLabel' | 'notes';
type GameDraft<Fields extends GameDraftField> = Record<Fields, string>;

function gameDraft<Fields extends GameDraftField>(
  game: Game | undefined,
  fields: readonly Fields[],
): GameDraft<Fields> {
  return Object.fromEntries(fields.map((field) => [field, game?.[field] ?? ''])) as GameDraft<Fields>;
}

export function useGameDraft<Fields extends GameDraftField>(
  game: Game | undefined,
  fields: readonly Fields[],
  active = true,
) {
  const updateGame = useApp((state) => state.updateGame);
  const gameId = game?.id ?? null;
  const [draft, setDraft] = useState<GameDraft<Fields>>(() => gameDraft(game, fields));
  const draftRef = useRef(draft);
  const draftGameIdRef = useRef(gameId);

  const commitDraft = useCallback(() => {
    const draftGameId = draftGameIdRef.current;
    if (!draftGameId) return;
    const current = useApp
      .getState()
      .state.games.find((candidate) => candidate.id === draftGameId && !candidate.deleted);
    if (!current) return;
    const pending = draftRef.current;
    const patch: Partial<Pick<Game, GameDraftField>> = {};
    for (const field of fields) {
      if (pending[field] !== (current[field] ?? '')) Object.assign(patch, { [field]: pending[field] });
    }
    if (Object.keys(patch).length > 0) updateGame(draftGameId, patch);
  }, [fields, updateGame]);

  const changeDraft = (field: Fields, value: string) => {
    const next = { ...draftRef.current, [field]: value };
    draftRef.current = next;
    setDraft(next);
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
    if (!active || !gameId) return;
    const timer = setTimeout(commitDraft, 300);
    return () => clearTimeout(timer);
  }, [active, commitDraft, draft, gameId]);

  useEffect(() => () => commitDraft(), [commitDraft]);

  return { changeDraft, commitDraft, draft };
}
