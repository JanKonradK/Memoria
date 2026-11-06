/**
 * The servers each game runs, so an account is set up on the one its player
 * actually uses. Several servers share a clock (Asia, TW/HK/MO and China are all
 * UTC+8), so the server is stored by id on the game, next to its timezone.
 *
 * IANA `Etc/` zones invert the sign: `Etc/GMT-8` is UTC+8.
 */
export interface GameServer {
  id: string;
  /** Shown in pickers. */
  label: string;
  /** Shown on chips beside the game's name. */
  short: string;
  tz: string;
}

const AMERICA: GameServer = { id: 'na', label: 'America', short: 'NA', tz: 'Etc/GMT+5' };
const EUROPE: GameServer = { id: 'eu', label: 'Europe', short: 'EU', tz: 'Etc/GMT-1' };
const ASIA: GameServer = { id: 'asia', label: 'Asia', short: 'ASIA', tz: 'Etc/GMT-8' };
const CHINA: GameServer = { id: 'cn', label: 'China', short: 'CN', tz: 'Etc/GMT-8' };

const HOYO: GameServer[] = [
  AMERICA,
  EUROPE,
  ASIA,
  { id: 'tw', label: 'TW, HK, MO', short: 'TW/HK/MO', tz: 'Etc/GMT-8' },
  CHINA,
];

const NIKKE_TZ = 'Etc/GMT-9';

export const GAME_SERVERS: Readonly<Record<string, readonly GameServer[]>> = {
  genshin: HOYO,
  hsr: HOYO,
  zzz: HOYO,
  wuwa: [
    AMERICA,
    EUROPE,
    ASIA,
    { id: 'hmt', label: 'HMT', short: 'HMT', tz: 'Etc/GMT-8' },
    { id: 'sea', label: 'SEA', short: 'SEA', tz: 'Etc/GMT-8' },
    CHINA,
  ],
  // NTE's Europe server follows summer time, unlike the fixed HoYo and Kuro clocks.
  nte: [{ ...EUROPE, tz: 'Europe/Warsaw' }, AMERICA, ASIA],
  lads: [{ ...EUROPE, tz: 'Etc/GMT-2' }, { ...AMERICA, tz: 'Etc/GMT+7' }, ASIA],
  uma: [{ id: 'global', label: 'Global', short: 'GLOBAL', tz: 'Etc/GMT' }],
  // Every NIKKE region runs on one UTC+9 clock; the region still tells accounts apart.
  nikke: [
    { id: 'na', label: 'North America', short: 'NA', tz: NIKKE_TZ },
    { id: 'eu', label: 'Europe', short: 'EU', tz: NIKKE_TZ },
    { id: 'jp', label: 'Japan', short: 'JP', tz: NIKKE_TZ },
    { id: 'kr', label: 'Korea', short: 'KR', tz: NIKKE_TZ },
    { id: 'sea', label: 'SEA', short: 'SEA', tz: NIKKE_TZ },
    { id: 'global', label: 'Global', short: 'GLOBAL', tz: NIKKE_TZ },
  ],
  endfield: [
    { id: 'amer', label: 'Americas and Europe', short: 'AM/EU', tz: 'Etc/GMT+5' },
    { ...ASIA, tz: 'Etc/GMT-8' },
  ],
};

/** The servers a preset game runs; empty for a game typed in by hand. */
export function serversFor(presetKey: string | undefined): readonly GameServer[] {
  return (presetKey && GAME_SERVERS[presetKey]) || [];
}

/**
 * The server a game is on: the one it names, or else the only one on its
 * clock. Undefined when that is ambiguous (an account from before servers were
 * stored, on a clock several servers share) or its timezone is none of them.
 */
export function gameServer(game: { presetKey?: string; server?: string; tz: string }): GameServer | undefined {
  const servers = serversFor(game.presetKey);
  const named = servers.find((server) => server.id === game.server && server.tz === game.tz);
  if (named) return named;
  const sameClock = servers.filter((server) => server.tz === game.tz);
  return sameClock.length === 1 ? sameClock[0] : undefined;
}
