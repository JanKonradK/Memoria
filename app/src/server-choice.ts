import { DateTime } from 'luxon';
import { gameServer, presetForGame, SERVER_TZ_OPTIONS, serversFor, type GameServer } from '@memoria/shared';
import { offsetLabel, serverRegionLabel } from './server-region';

/** What a server picker sets on a game: one of its servers, or just a timezone. */
export type ServerPick = { server?: string; tz: string };
type GameLike = { name: string; short: string; presetKey?: string };

/** The preset key for a game, also for an old game saved before presetKey. */
export function presetKeyOf(game: GameLike): string | undefined {
  return game.presetKey ?? presetForGame(game)?.key;
}

export function gameServers(game: GameLike): readonly GameServer[] {
  return serversFor(presetKeyOf(game));
}

/** The chip beside a game's name: its server, or its clock when the server is unknown. */
export function gameServerLabel(game: GameLike & { server?: string; tz: string }, now: number): string {
  return gameServer({ ...game, presetKey: presetKeyOf(game) })?.short ?? serverRegionLabel(game.tz, now);
}

export function utcLabel(tz: string, now = Date.now()): string {
  const zone = DateTime.fromMillis(now, { zone: tz });
  return zone.isValid ? offsetLabel(zone.offset) : tz;
}

/** The `<select>` value for a pick: `server:<id>` for one of the game's servers, else `tz:<zone>`. */
export function serverValue(game: GameLike, pick: ServerPick | null): string {
  if (!pick) return '';
  const named = gameServer({ ...pick, presetKey: presetKeyOf(game) });
  return named ? `server:${named.id}` : `tz:${pick.tz}`;
}

export function parseServerValue(game: GameLike, value: string): ServerPick {
  if (value.startsWith('server:')) {
    const server = gameServers(game).find((item) => item.id === value.slice('server:'.length));
    if (server) return { server: server.id, tz: server.tz };
  }
  return { server: undefined, tz: value.replace(/^tz:/, '') };
}

/** Timezones offered under "Other", with the game's own one kept when it is none of them. */
export function otherZones(current: string | undefined): { label: string; tz: string }[] {
  return current && !SERVER_TZ_OPTIONS.some((option) => option.tz === current)
    ? [...SERVER_TZ_OPTIONS, { label: current, tz: current }]
    : SERVER_TZ_OPTIONS;
}
