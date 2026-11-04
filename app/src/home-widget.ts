import { registerPlugin } from '@capacitor/core';
import {
  buildUrgencyContext,
  gameGlance,
  presetForGame,
  urgencyOrder,
  type AppState,
  type Game,
} from '@memoria/shared';
import { logoRing } from './game-logo-colors';
import { isNativeApp } from './native';
import { useApp } from './store';
import { useUI } from './ui-store';
import { openGame } from './workspace-navigation';

const HomeWidget = registerPlugin<{ update(options: { snapshot: string }): Promise<void> }>('HomeWidget');

/** Four rows of two. */
const CELLS = 8;
/** Coin images are drawn at this many pixels square. */
const COIN_PX = 112;

/**
 * What the Android home screen widget draws: Today's most urgent active games,
 * each with its logo, account, main energy meter and daily progress. The widget
 * moves energy forward by the clock and empties the dailies ring at reset.
 */
export function widgetSnapshot(state: AppState, now: number) {
  const context = buildUrgencyContext(state, now);
  const rows = urgencyOrder(state, now, context)
    .filter((entry) => !entry.game.paused)
    .slice(0, CELLS)
    .map(({ game }) => {
      const dailies = (context.checklistByGame.get(game.id) ?? []).filter((item) => item.cadence === 'daily');
      return {
        id: game.id,
        logoKey: logoSide(game),
        label: game.accountLabel || game.short,
        ring: logoRing(game)[0],
        meter: gameGlance(state, game, now, context).energy[0] ?? null,
        dailyDone: dailies.filter((item) => item.done).length,
        dailyTotal: dailies.length,
        /** When the current dailies reset; the widget treats them as undone after it. */
        dailyResetAt: dailies.length ? Math.min(...dailies.map((item) => item.resetAt)) : null,
      };
    });
  return { generatedAt: now, rows };
}

/** The coin side the app shows for this game, as a cache key. */
function logoSide(game: Game): string {
  const key = game.presetKey ?? game.id;
  const back = Boolean(useUI.getState().logoFlipped[key]);
  return `${key}:${back ? 'back' : 'front'}:${game.short}:${game.name}`;
}

const coins = new Map<string, string>();

/** The game's coin as the app draws it: its name on a dark disc, as a PNG without the data URL prefix. */
async function coinImage(game: Game): Promise<string> {
  const key = logoSide(game);
  const cached = coins.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = COIN_PX;
  const draw = canvas.getContext('2d');
  if (!draw) return '';
  const half = COIN_PX / 2;
  const back = key.includes(':back:');
  draw.fillStyle = back ? '#1f2026' : '#16171b';
  draw.beginPath();
  draw.arc(half, half, half, 0, Math.PI * 2);
  draw.fill();
  draw.fillStyle = '#f4f4f6';
  const { LOGO_ART } = await import('./game-logo-art');
  // Games added before presets were linked still match theirs by name.
  const artKey = game.presetKey ?? presetForGame(game)?.key;
  const art = artKey ? LOGO_ART[artKey] : undefined;
  if (art) {
    // The artwork's coin is the disc at 116..908 in its 1024 box.
    draw.scale(COIN_PX / 792, COIN_PX / 792);
    draw.translate(-116, -116);
    draw.fill(new Path2D(back ? art.back : art.front));
  } else {
    const text = game.short;
    draw.font = `bold ${Math.round(COIN_PX * 0.3)}px sans-serif`;
    draw.textAlign = 'center';
    draw.textBaseline = 'middle';
    const width = draw.measureText(text).width;
    if (width > COIN_PX * 0.8) draw.font = `bold ${Math.floor((COIN_PX * 0.3 * COIN_PX * 0.8) / width)}px sans-serif`;
    draw.fillText(text, half, half);
  }
  const png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  coins.set(key, png);
  return png;
}

async function pushSnapshot() {
  const state = useApp.getState().state;
  const snapshot = widgetSnapshot(state, Date.now());
  const rows = await Promise.all(
    snapshot.rows.map(async (row) => {
      const game = state.games.find((item) => item.id === row.id)!;
      return { ...row, logo: await coinImage(game).catch(() => '') };
    }),
  );
  await HomeWidget.update({ snapshot: JSON.stringify({ ...snapshot, rows }) });
}

/** `memoria://game/<id>` opens that game; anything else opens Today. */
function openFromWidget(url: string) {
  const match = /^memoria:\/\/game\/(.+)$/.exec(url);
  const gameId = match ? decodeURIComponent(match[1]!) : null;
  if (gameId && useApp.getState().state.games.some((game) => game.id === gameId && !game.deleted)) openGame(gameId);
  else if (url.startsWith('memoria://')) useUI.getState().setTab('today');
}

export function initHomeWidget(): () => void {
  if (!isNativeApp) return () => undefined;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void pushSnapshot().catch(() => undefined), 1500);
  };
  const stopApp = useApp.subscribe((next, prior) => {
    if (next.state !== prior.state) push();
  });
  // A flipped coin shows its other side on the widget too.
  const stopUI = useUI.subscribe((next, prior) => {
    if (next.logoFlipped !== prior.logoFlipped) push();
  });
  document.addEventListener('visibilitychange', push);
  push();
  const listener = import('@capacitor/app').then(async ({ App }) => {
    const launch = await App.getLaunchUrl().catch(() => undefined);
    if (active && launch?.url) openFromWidget(launch.url);
    return App.addListener('appUrlOpen', ({ url }) => {
      if (active) openFromWidget(url);
    });
  });
  return () => {
    active = false;
    clearTimeout(timer);
    stopApp();
    stopUI();
    document.removeEventListener('visibilitychange', push);
    void listener.then((handle) => handle.remove()).catch(() => undefined);
  };
}
