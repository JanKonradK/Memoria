import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  checklistCount,
  NOTE_COLORS,
  noteLines,
  toggleChecklistLine,
  type Game,
  type Note,
  type NoteColor,
} from '@memoria/shared';
import { gameInk } from '../../game-color';
import { useApp } from '../../store';
import { SwipeRow } from '../../swipe-row';
import { useGround } from '../../theme';
import { useUI } from '../../ui-store';
import { Ago } from '../Ago';
import { GameLogo } from '../GameLogo';

/** A note's own colours: fixed hues that read on every palette, light or dark. */
const NOTE_INK: Record<Exclude<NoteColor, 'game'>, string> = {
  red: 'oklch(0.68 0.17 25)',
  amber: 'oklch(0.78 0.14 75)',
  green: 'oklch(0.72 0.14 155)',
  blue: 'oklch(0.68 0.13 245)',
  violet: 'oklch(0.66 0.15 295)',
  pink: 'oklch(0.72 0.15 350)',
};
const COLOR_NAME: Record<NoteColor, string> = {
  game: 'Game colour',
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  pink: 'Pink',
};

export function noteInk(color: NoteColor | undefined, game: Game | undefined, ground: string): string | undefined {
  if (!color) return undefined;
  if (color === 'game') return game ? gameInk(game, ground) : undefined;
  return NOTE_INK[color];
}

const MENU_ITEM =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-ui-sm px-3 text-body text-fg-soft outline-none transition-colors data-[highlighted]:bg-fill-2 data-[highlighted]:text-fg fine:min-h-9';
const MENU = 'popover-motion z-50 min-w-48 rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong';

/** A note's name in a sentence: its title, or its first words. */
export function noteName(note: Pick<Note, 'title' | 'body'>): string {
  const title = note.title.trim();
  if (title) return title;
  const first =
    note.body
      .trim()
      .split('\n')[0]
      ?.replace(/^[-*]\s\[[ xX]\]\s?/, '') ?? '';
  return first ? (first.length > 40 ? `${first.slice(0, 40)}…` : first) : 'Empty note';
}

/** A box that grows with what is typed into it. */
function autosize(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = 'auto';
  node.style.height = `${node.scrollHeight + 2}px`;
}

/**
 * One note, read or written in place. Reading, its checklist lines are boxes to
 * tick; pressing the text (or the pencil) opens it for writing, and leaving it
 * (Done, Esc, or a press elsewhere) saves. A note left empty is removed.
 */
export function NoteCard({
  note,
  game,
  games,
  now,
  showGame,
  compact,
  editing,
  onEditing,
}: {
  note: Note;
  /** The game it is about, in its identity colours. */
  game?: Game;
  /** Every game, for Move to. */
  games: Game[];
  now: number;
  /** On the wall the card names its game; under a game's own heading it does not. */
  showGame: boolean;
  compact: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
}) {
  const saveNote = useApp((s) => s.saveNote);
  const deleteNote = useApp((s) => s.deleteNote);
  const ground = useGround();
  const ink = noteInk(note.color, game, ground);
  const count = checklistCount(note.body);
  const name = noteName(note);
  const empty = !note.title.trim() && !note.body.trim();

  const swipe = note.pinned
    ? { left: { label: 'Unpin', run: () => saveNote({ id: note.id, pinned: false }) } }
    : { right: { label: 'Pin', run: () => saveNote({ id: note.id, pinned: true }) } };

  return (
    <SwipeRow
      as="div"
      className="note"
      right={editing ? null : swipe.right}
      left={editing ? null : swipe.left}
      ink={ink}
      data-note={note.id}
      data-color={note.color ? '' : undefined}
      data-pinned={note.pinned || undefined}
      data-editing={editing || undefined}
      data-compact={(compact && !editing) || undefined}
      style={ink ? ({ '--note-ink': ink } as CSSProperties) : undefined}
    >
      <article className="note-inner" aria-label={name}>
        {editing ? (
          <NoteEditor note={note} onDone={() => onEditing(false)} />
        ) : (
          <>
            {note.pinned && (
              <svg viewBox="0 0 20 20" aria-hidden className="note-pin" fill="currentColor">
                <path d="M12.6 2.6a1 1 0 0 1 1.5 0l3.3 3.3a1 1 0 0 1 0 1.5l-2.6 1.4-2.9 2.9.3 2.8a1 1 0 0 1-1.7.8L7.6 12.4 4 16l-.9-.1-.1-.9 3.6-3.6-2.9-2.9a1 1 0 0 1 .8-1.7l2.8.3 2.9-2.9z" />
              </svg>
            )}
            {note.title.trim() && <h3 className="note-title">{note.title}</h3>}
            <div
              className="note-body"
              onClick={(event) => {
                // A press on the text opens it for writing; a tick or a selection does not.
                if ((event.target as HTMLElement).closest('button, a')) return;
                if (window.getSelection()?.toString()) return;
                onEditing(true);
              }}
            >
              {empty ? (
                <p className="note-placeholder">Empty note</p>
              ) : (
                noteLines(note.body).map((line) =>
                  line.done === undefined ? (
                    <p key={line.line} className="note-line">
                      {line.text || ' '}
                    </p>
                  ) : (
                    <button
                      key={line.line}
                      type="button"
                      role="checkbox"
                      aria-checked={line.done}
                      className="note-check"
                      onClick={() => saveNote({ id: note.id, body: toggleChecklistLine(note.body, line.line) })}
                    >
                      <span aria-hidden className="note-box">
                        {line.done && (
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6">
                            <path d="m5 10.5 3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="note-check-text">{line.text || ' '}</span>
                    </button>
                  ),
                )
              )}
            </div>
            <footer className="note-foot">
              {showGame && game && (
                <span className="note-game">
                  <GameLogo game={game} size={18} />
                  <span className="truncate">{game.short.trim() || game.name}</span>
                </span>
              )}
              {count.total > 0 && (
                <span className="note-count numeral" data-all={count.done === count.total || undefined}>
                  {count.done}/{count.total}
                </span>
              )}
              <Ago at={note.updatedAt} now={now} verb="Edited" className="note-ago" />
              <span className="flex-1" />
              <button type="button" className="note-icon" aria-label={`Edit ${name}`} onClick={() => onEditing(true)}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                  <path
                    d="M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <NoteMenu
                note={note}
                name={name}
                games={games}
                onDelete={() => {
                  deleteNote(note.id);
                  if (!empty) useUI.getState().showUndo('Note deleted', () => useApp.getState().restoreNote(note.id));
                }}
              />
            </footer>
          </>
        )}
      </article>
    </SwipeRow>
  );
}

function NoteEditor({ note, onDone }: { note: Note; onDone: () => void }) {
  const saveNote = useApp((s) => s.saveNote);
  const deleteNote = useApp((s) => s.deleteNote);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const draft = useRef({ title: note.title, body: note.body });
  useLayoutEffect(() => {
    draft.current = { title, body };
  }, [title, body]);
  const closed = useRef(false);

  // Where the caret goes once a change made by a button or a key is drawn.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    autosize(text.current);
    const node = text.current;
    if (node && caret.current != null) {
      node.focus();
      node.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [body]);
  useEffect(() => {
    const node = text.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);
  // Typing is kept as it goes, a moment after the last key, and on leaving.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (title !== note.title || body !== note.body) saveNote({ id: note.id, title, body });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [title, body, note.id, note.title, note.body, saveNote]);

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    const { title: t, body: b } = draft.current;
    if (!t.trim() && !b.trim()) deleteNote(note.id);
    else saveNote({ id: note.id, title: t, body: b });
    onDone();
  };
  // Unmounting (the page left mid-edit) still saves.
  useEffect(
    () => () => {
      if (closed.current) return;
      const { title: t, body: b } = draft.current;
      if (t.trim() || b.trim()) useApp.getState().saveNote({ id: note.id, title: t, body: b });
    },
    [note.id],
  );

  const addCheck = () => {
    const node = text.current;
    if (!node) return;
    const at = node.selectionStart;
    const lineStart = body.lastIndexOf('\n', at - 1) + 1;
    const next = /^\s*[-*]\s\[[ xX]\]\s?/.test(body.slice(lineStart))
      ? body
      : `${body.slice(0, lineStart)}- [ ] ${body.slice(lineStart)}`;
    caret.current = at + (next.length - body.length);
    setBody(next);
    if (next === body) {
      node.focus();
      node.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    // Enter on a checklist line starts the next one; on an empty one it ends the list.
    if (event.key !== 'Enter' || event.shiftKey || event.target !== text.current) return;
    const node = text.current!;
    const at = node.selectionStart;
    const lineStart = body.lastIndexOf('\n', at - 1) + 1;
    const line = body.slice(lineStart, at);
    const match = /^(\s*)[-*]\s\[[ xX]\]\s?(.*)$/.exec(line);
    if (!match || node.selectionEnd !== at) return;
    event.preventDefault();
    const next = match[2]!.trim()
      ? `${body.slice(0, at)}\n${match[1]}- [ ] ${body.slice(at)}`
      : `${body.slice(0, lineStart)}${body.slice(at)}`;
    caret.current = match[2]!.trim() ? at + match[1]!.length + 7 : lineStart;
    setBody(next);
  };

  return (
    <div
      ref={box}
      className="note-edit"
      onKeyDown={onKey}
      onBlur={(event) => {
        // Switching to another window (a game) is not leaving the note.
        if (!document.hasFocus()) return;
        const next = event.relatedTarget as Node | null;
        if (next && box.current?.contains(next)) return;
        finish();
      }}
    >
      <input
        className="note-title-input"
        aria-label="Title"
        placeholder="Title"
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            text.current?.focus();
          }
        }}
      />
      <textarea
        ref={text}
        className="note-body-input"
        aria-label="Note"
        placeholder="Write anything. Start a line with - [ ] for a checkbox."
        value={body}
        maxLength={20_000}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="note-edit-bar">
        <button type="button" className="note-tool" onClick={addCheck}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
            <rect x="3.5" y="3.5" width="13" height="13" rx="3" strokeWidth="1.6" />
            <path d="m7 10.2 2 2L13.2 8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Checklist
        </button>
        <span className="flex-1" />
        <button type="button" className="note-done" onClick={finish}>
          Done
        </button>
      </div>
    </div>
  );
}

function NoteMenu({ note, name, games, onDelete }: { note: Note; name: string; games: Game[]; onDelete: () => void }) {
  const saveNote = useApp((s) => s.saveNote);
  const ground = useGround();
  const game = games.find((item) => item.id === note.gameId);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="note-icon" aria-label={`More for ${name}`}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <circle cx="5" cy="10" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="15" cy="10" r="1.5" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={MENU}>
          <Menu.Item className={MENU_ITEM} onSelect={() => saveNote({ id: note.id, pinned: !note.pinned })}>
            {note.pinned ? 'Unpin' : 'Pin to the top'}
          </Menu.Item>
          <Menu.Label className="px-3 pb-1 pt-2 text-label text-muted">Colour</Menu.Label>
          <Menu.RadioGroup
            className="note-swatches"
            value={note.color ?? 'none'}
            onValueChange={(value) =>
              saveNote({ id: note.id, color: value === 'none' ? undefined : (value as NoteColor) })
            }
          >
            {(['none', ...NOTE_COLORS] as const)
              .filter((color) => color !== 'game' || game)
              .map((color) => (
                <Menu.RadioItem
                  key={color}
                  value={color}
                  className="note-swatch"
                  aria-label={color === 'none' ? 'No colour' : COLOR_NAME[color]}
                  style={{ '--swatch': color === 'none' ? undefined : noteInk(color, game, ground) } as CSSProperties}
                  onSelect={(event) => event.preventDefault()}
                />
              ))}
          </Menu.RadioGroup>
          <Menu.Sub>
            <Menu.SubTrigger className={MENU_ITEM}>
              Move to
              <span className="ml-auto text-muted" aria-hidden>
                ›
              </span>
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className={MENU} sideOffset={4}>
                <Menu.RadioGroup
                  value={note.gameId ?? ''}
                  onValueChange={(value) => saveNote({ id: note.id, gameId: value || null })}
                >
                  <Menu.RadioItem value="" className={MENU_ITEM}>
                    General
                  </Menu.RadioItem>
                  {games.map((item) => (
                    <Menu.RadioItem key={item.id} value={item.id} className={MENU_ITEM}>
                      <GameLogo game={item} size={20} />
                      <span className="truncate">
                        {item.name}
                        {item.accountLabel?.trim() ? ` · ${item.accountLabel.trim()}` : ''}
                      </span>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Item
            className={MENU_ITEM}
            onSelect={() =>
              saveNote({
                gameId: note.gameId,
                title: note.title.trim() ? `${note.title} (copy)` : '',
                body: note.body,
                color: note.color,
              })
            }
          >
            Duplicate
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item className={`${MENU_ITEM} !text-danger-fg`} onSelect={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
