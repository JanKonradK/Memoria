import type { AppState, Game, Note } from './types';

/**
 * Notes: the player's own writing, for a game or for none. These helpers are
 * pure, so the Notes page, a game's Notes tab and the tests share them.
 */

/** The id a game's old single notes box becomes: the same on every device. */
export function legacyNoteId(gameId: string): string {
  return `notes-${gameId}`;
}

/**
 * Moves each game's old notes text into a note of its own and clears the old
 * field. Every device derives the same id, so two devices doing this at once
 * still end with one note. A game whose note already exists (even deleted)
 * keeps that note, and its old text is only cleared.
 */
export function adoptGameNotes(state: AppState, at: number): AppState {
  const known = new Set(state.notes.map((note) => note.id));
  const adopted: Note[] = [];
  let changed = false;
  const games = state.games.map((game) => {
    if (game.deleted || game.notes == null || game.notes === '') return game;
    changed = true;
    const id = legacyNoteId(game.id);
    if (!known.has(id) && game.notes.trim())
      adopted.push({ id, gameId: game.id, title: '', body: game.notes, sort: 0, updatedAt: at });
    return { ...game, notes: '', updatedAt: at };
  });
  return changed ? { ...state, games, notes: [...state.notes, ...adopted] } : state;
}

/** One line of a note's body read as a checklist item, or null for a plain line. */
export interface ChecklistLine {
  /** Index of the line in the body. */
  line: number;
  done: boolean;
  text: string;
}

const CHECK = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;

/** Every line, as text or as a checklist item. */
export function noteLines(body: string): (ChecklistLine | { line: number; text: string; done?: undefined })[] {
  return body.split('\n').map((raw, line) => {
    const match = CHECK.exec(raw);
    return match ? { line, done: match[2] !== ' ', text: match[3]! } : { line, text: raw };
  });
}

/** How many checklist items the body holds and how many are ticked. */
export function checklistCount(body: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const raw of body.split('\n')) {
    const match = CHECK.exec(raw);
    if (!match) continue;
    total += 1;
    if (match[2] !== ' ') done += 1;
  }
  return { done, total };
}

/** The body with one checklist line ticked or unticked; any other line is left as it is. */
export function toggleChecklistLine(body: string, line: number): string {
  const lines = body.split('\n');
  const match = CHECK.exec(lines[line] ?? '');
  if (!match) return body;
  lines[line] = `${match[1]}- [${match[2] === ' ' ? 'x' : ' '}] ${match[3]}`;
  return lines.join('\n');
}

export type NoteSort = 'manual' | 'edited' | 'title';

/** Pinned notes first, then the chosen order. */
export function sortNotes<N extends Note>(notes: readonly N[], sort: NoteSort): N[] {
  const by =
    sort === 'edited'
      ? (a: N, b: N) => b.updatedAt - a.updatedAt
      : sort === 'title'
        ? (a: N, b: N) =>
            (a.title.trim() || a.body.trim()).localeCompare(b.title.trim() || b.body.trim(), undefined, {
              sensitivity: 'base',
            })
        : (a: N, b: N) => b.sort - a.sort || b.updatedAt - a.updatedAt;
  return [...notes].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || by(a, b) || a.id.localeCompare(b.id),
  );
}

/** Whether a note matches a search: its title, its body, or the game it is about. */
export function noteMatches(note: Note, query: string, game?: Pick<Game, 'name' | 'accountLabel'>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [note.title, note.body, game?.name ?? '', game?.accountLabel ?? ''].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

/** The sort a new note takes so it lands first in the player's own order. */
export function nextNoteSort(notes: readonly Note[]): number {
  return notes.reduce((top, note) => Math.max(top, note.sort), 0) + 1;
}
