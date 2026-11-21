import { describe, expect, it } from 'vitest';
import {
  adoptGameNotes,
  checklistCount,
  emptyState,
  legacyNoteId,
  mergeState,
  nextNoteSort,
  noteLines,
  noteMatches,
  normalizeState,
  sortNotes,
  toggleChecklistLine,
  type AppState,
  type Game,
  type Note,
} from '../src';

const game = (id: string, notes?: string) => ({ id, name: id, notes, updatedAt: 1 }) as unknown as Game;
const withGames = (games: Game[], notes: Note[] = []): AppState => ({ ...emptyState(), games, notes });

const note = (over: Partial<Note> & { id: string }): Note => ({
  gameId: null,
  title: '',
  body: '',
  sort: 0,
  updatedAt: 1,
  ...over,
});

describe('notes', () => {
  it("moves a game's old notes into a note of its own and clears the old text", () => {
    const state = withGames([game('g1', 'Farm crowns'), game('g2', '')]);
    const next = adoptGameNotes(state, 50);
    expect(next.notes).toEqual([
      { id: legacyNoteId('g1'), gameId: 'g1', title: '', body: 'Farm crowns', sort: 0, updatedAt: 50 },
    ]);
    expect(next.games[0]!.notes).toBe('');
    // Nothing left to move: the same state comes back.
    expect(adoptGameNotes(next, 60)).toBe(next);
  });

  it('two devices moving the same notes end with one note', () => {
    const a = adoptGameNotes(withGames([game('g1', 'Farm crowns')]), 50);
    const b = adoptGameNotes(withGames([game('g1', 'Farm crowns')]), 70);
    const ids = [...a.notes, ...b.notes].map((item) => item.id);
    expect(new Set(ids).size).toBe(1);
  });

  it('keeps a note that already exists, even deleted', () => {
    const state = withGames(
      [game('g1', 'stale')],
      [note({ id: legacyNoteId('g1'), gameId: 'g1', body: 'gone', deleted: true })],
    );
    const next = adoptGameNotes(state, 50);
    expect(next.notes).toHaveLength(1);
    expect(next.notes[0]!.deleted).toBe(true);
    expect(next.games[0]!.notes).toBe('');
  });

  it('survives validation and merges by id', () => {
    const a = { ...emptyState(), notes: [note({ id: 'n1', title: 'Old', updatedAt: 1, color: 'amber' })] };
    const b = { ...emptyState(), notes: [note({ id: 'n1', title: 'New', updatedAt: 2, pinned: true })] };
    const merged = mergeState(a, b);
    expect(merged.notes).toHaveLength(1);
    expect(merged.notes[0]).toMatchObject({ title: 'New', pinned: true });
    // A bad colour drops that row, not the whole state.
    const bad = normalizeState({
      ...emptyState(),
      notes: [{ ...note({ id: 'x' }), color: 'plaid' }, note({ id: 'y' })],
    });
    expect(bad.notes.map((item) => item.id)).toEqual(['y']);
    // A document from before notes existed loads with none.
    const { notes: _drop, ...old } = emptyState();
    void _drop;
    expect(normalizeState(old).notes).toEqual([]);
  });

  it('reads and ticks checklist lines', () => {
    const body = 'Shopping\n- [ ] Resin\n- [x] Crowns\n  * [ ] Nested';
    expect(checklistCount(body)).toEqual({ done: 1, total: 3 });
    expect(noteLines(body).map((line) => line.done)).toEqual([undefined, false, true, false]);
    expect(toggleChecklistLine(body, 1)).toBe('Shopping\n- [x] Resin\n- [x] Crowns\n  * [ ] Nested');
    expect(toggleChecklistLine(body, 2)).toBe('Shopping\n- [ ] Resin\n- [ ] Crowns\n  * [ ] Nested');
    expect(toggleChecklistLine(body, 3)).toBe('Shopping\n- [ ] Resin\n- [x] Crowns\n  - [x] Nested');
    expect(toggleChecklistLine(body, 0)).toBe(body);
  });

  it('sorts pinned first, then by the chosen order', () => {
    const notes = [
      note({ id: 'a', title: 'Beta', sort: 1, updatedAt: 30 }),
      note({ id: 'b', title: 'alpha', sort: 3, updatedAt: 10 }),
      note({ id: 'c', title: 'Gamma', sort: 2, updatedAt: 20, pinned: true }),
    ];
    expect(sortNotes(notes, 'manual').map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(sortNotes(notes, 'edited').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(sortNotes(notes, 'title').map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(nextNoteSort(notes)).toBe(4);
  });

  it('matches a search on title, body and the game', () => {
    const item = note({ id: 'a', title: 'Routes', body: 'Sumeru loop' });
    expect(noteMatches(item, 'sumeru')).toBe(true);
    expect(noteMatches(item, 'genshin', { name: 'Genshin Impact' })).toBe(true);
    expect(noteMatches(item, 'zzz', { name: 'Genshin Impact' })).toBe(false);
  });
});
