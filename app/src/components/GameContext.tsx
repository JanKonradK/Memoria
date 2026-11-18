import { useState } from 'react';
import { DateTime } from 'luxon';
import { presetForGame, type AppState, type Game } from '@memoria/shared';
import { lastAiredStream, nextBroadcast } from '../catch-up-status';
import { fmtDur } from '../util';
import { useGameDraft } from './game-detail/useGameDraft';

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
 * The left column of a game's page: the last livestream and the next one when
 * there are any, and the player's own notes.
 */
export function GameContext({ game, state, now }: { game: Game; state: AppState; now: number }) {
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
      {last?.stream && (
        <StreamLine label="Last livestream">
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
              <span className="block text-meta text-muted">
                {at(Date.parse(last.stream.aired), 'd LLL')} · Watch replay ↗
              </span>
            </span>
          </a>
        </StreamLine>
      )}

      {next && (
        <StreamLine label="Next livestream">
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
        </StreamLine>
      )}

      <div onFocus={() => setNotesFocused(true)} onBlur={() => setNotesFocused(false)}>
        <GameNotes key={`${game.id}:${notesKey}`} game={game} />
      </div>
    </aside>
  );
}
