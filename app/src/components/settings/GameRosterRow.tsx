import { useEffect, useState } from 'react';
import type { Game } from '@memoria/shared';
import { useApp } from '../../store';
import { useUI } from '../../ui-store';
import { serverChoices } from '../../server-choice';
import { localResetLabel } from '../../util';
import type { GameColors } from '../../game-color';
import { GameLogo } from '../GameLogo';
import { Pill } from '../primitives';
import { Btn, Segmented, TextInput } from '../ui';

/**
 * One game in Settings, with the two things people change most — the nickname
 * and the server — right on the row. Everything else is one step further, in
 * the game's full editor.
 */
export function GameRosterRow({ game, colors, localTz }: { game: Game; colors: GameColors; localTz: string }) {
  const updateGame = useApp((store) => store.updateGame);
  const openSheet = useUI((ui) => ui.openSheet);
  const [nickname, setNickname] = useState(game.accountLabel ?? '');
  // A change from elsewhere (the editor, another device) replaces the field
  // unless it is being typed in.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setNickname(game.accountLabel ?? '');
  }, [game.accountLabel, typing]);

  const commit = () => {
    setTyping(false);
    const next = nickname.trim();
    if (next !== (game.accountLabel ?? '')) updateGame(game.id, { accountLabel: next });
    setNickname(next);
  };
  const label = `${game.name}${game.accountLabel ? `, ${game.accountLabel}` : ''}`;

  return (
    <li className="settings-roster-row">
      <GameLogo game={{ ...game, ...colors }} size={48} className="settings-roster-logo shrink-0" />
      <div className="settings-roster-name min-w-0">
        <div className="flex items-center gap-2">
          <span className="min-w-0 text-body font-semibold text-fg [overflow-wrap:anywhere]">{game.name}</span>
          {game.paused && <Pill variant="paused">paused</Pill>}
        </div>
        <span className="aside block text-label text-muted">
          resets <span className="numeral">{localResetLabel(game, localTz, Date.now())}</span>
        </span>
      </div>
      <label className="settings-roster-field settings-roster-nickname">
        <span className="text-label text-muted">Nickname</span>
        <TextInput
          className="!min-h-11 sm:!min-h-9 sm:!py-1"
          value={nickname}
          placeholder="None"
          aria-label={`Nickname for ${game.name}`}
          onFocus={() => setTyping(true)}
          onChange={(event) => setNickname(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setNickname(game.accountLabel ?? '');
              setTyping(false);
            }
          }}
        />
      </label>
      <div className="settings-roster-field settings-roster-server">
        <span className="text-label text-muted" aria-hidden>
          Server
        </span>
        <Segmented
          ariaLabel={`Server for ${label}`}
          options={serverChoices(game)}
          value={game.tz}
          onChange={(tz) => updateGame(game.id, { tz })}
        />
      </div>
      <Btn
        className="settings-roster-edit !min-h-11 sm:!min-h-9"
        aria-label={`Game settings for ${label}`}
        onClick={() => openSheet({ kind: 'game', gameId: game.id })}
      >
        Edit…
      </Btn>
    </li>
  );
}
