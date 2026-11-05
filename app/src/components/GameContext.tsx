import { useState } from 'react';
import { DateTime } from 'luxon';
import { presetForGame, type AppState, type Game } from '@memoria/shared';
import { lastAiredStream, nextBroadcast, useCatchUpUnread } from '../catch-up-status';
import { useUI } from '../ui-store';
import { fmtDur } from '../util';
import { useGameDraft } from './game-detail/useGameDraft';
import { Btn } from './ui';

const NOTES_FIELDS = ['notes'] as const;

function StreamLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="game-context-block" aria-label={label}>
      <h3 className="game-context-label">{label}</h3>
      {children}
    </section>
  );
}

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
 * The left column of a game's page: the last livestream and the next one, a
 * way into Catch up, and the player's own notes.
 */
export function GameContext({ game, state, now }: { game: Game; state: AppState; now: number }) {
  const openSheet = useUI((ui) => ui.openSheet);
  const { total, unread } = useCatchUpUnread(game);
  const [notesFocused, setNotesFocused] = useState(false);
  // Another device's edit refreshes the box, but never while it is being typed in.
  const [notesKey, setNotesKey] = useState(game.notes ?? '');
  if (!notesFocused && notesKey !== (game.notes ?? '')) setNotesKey(game.notes ?? '');
  const preset = presetForGame(game)?.key;
  const last = lastAiredStream(preset, now);
  const next = nextBroadcast(state, game.id, now);
  const zone = state.settings.localTz;
  const at = (ms: number, format: string) => DateTime.fromMillis(ms, { zone }).toFormat(format);

  return (
    <aside className="game-context" aria-label={`${game.name} livestreams and notes`}>
      <StreamLine label="Last livestream">
        {last?.stream ? (
          <a
            className="game-context-stream"
            data-art={last.artwork ? '' : undefined}
            href={last.stream.replay}
            target="_blank"
            rel="noreferrer"
          >
            {last.artwork && (
              <img src={last.artwork.src} alt="" width={1280} height={720} className="game-context-thumb" />
            )}
            <span className="min-w-0">
              <span className="block text-body font-semibold text-fg">
                Version {last.version}
                {last.title ? ` · ${last.title}` : ''}
              </span>
              <span className="aside block text-meta text-muted">
                {at(Date.parse(last.stream.aired), 'd LLL')} · Watch replay ↗
              </span>
            </span>
          </a>
        ) : (
          <p className="aside text-meta text-muted">No recap for this game yet.</p>
        )}
      </StreamLine>

      <StreamLine label="Next livestream">
        {next ? (
          <div>
            <p className="text-body text-fg">{next.event.name.replace(/\s*—\s*predicted window/i, '')}</p>
            <p className="numeral text-meta text-fg-soft">
              {next.estimated
                ? `Estimated ${at(next.event.start, 'd LLL')}–${at(next.event.end, 'd LLL')}`
                : next.event.start <= now
                  ? 'Live now'
                  : `${at(next.event.start, 'ccc d LLL · HH:mm')} · in ${fmtDur(next.event.start - now)}`}
            </p>
            <p className="aside text-caption text-muted">{next.estimated ? 'Predicted' : 'Announced'}</p>
          </div>
        ) : (
          <p className="aside text-meta text-muted">Not announced yet.</p>
        )}
      </StreamLine>

      {total > 0 && (
        <Btn className="justify-self-start" onClick={() => openSheet({ kind: 'catchUp', gameId: game.id })}>
          Catch up{unread > 0 ? ` · ${unread} new` : ''}
        </Btn>
      )}

      <div onFocus={() => setNotesFocused(true)} onBlur={() => setNotesFocused(false)}>
        <GameNotes key={`${game.id}:${notesKey}`} game={game} />
      </div>
    </aside>
  );
}
