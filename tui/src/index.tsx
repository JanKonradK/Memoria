import { readFileSync } from 'node:fs';
import { render } from 'ink';
import { PRESETS } from '@technogg/shared';
import { detectGame, gameByArg } from './detect.js';
import { dataDir, loadConfig, saveConfig, store } from './store.js';
import { App } from './ui/App.js';

const HELP = `⚡ TechnoGG TUI

tg                    dashboard (jumps straight to entry if a game is running)
tg <game>             open a game's entry directly, e.g. tg gi / tg hsr / tg zzz
tg seed               add the 5 preset games (fresh start)
tg import <file>      merge a JSON backup exported from the PWA (Settings → Export)
tg sync               one-shot sync with the worker, then exit
tg config <url> <token>   set the sync server (stored in ${dataDir()})
tg help               this text

Data lives in ${dataDir()}\\state.json — same format as the PWA export.`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  store.load();

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }

  if (cmd === 'seed') {
    const have = new Set(store.state.games.filter((g) => !g.deleted).map((g) => g.name));
    const added = PRESETS.filter((p) => !have.has(p.name));
    for (const p of added) store.addGameFromPreset(p);
    console.log(added.length > 0 ? `Added: ${added.map((p) => p.short).join(', ')}` : 'All presets already added.');
    return;
  }

  if (cmd === 'import') {
    const file = rest[0];
    if (!file) return void console.error('Usage: tg import <backup.json>');
    const ok = store.importJson(readFileSync(file, 'utf8'));
    console.log(ok ? `Imported and merged ${file}.` : `Could not parse ${file}.`);
    return;
  }

  if (cmd === 'sync') {
    await store.sync();
    console.log(
      store.syncStatus === 'ok'
        ? 'Synced.'
        : store.syncStatus === 'error'
          ? `Sync failed: ${store.syncError}`
          : 'No sync server configured — tg config <url> <token>',
    );
    return;
  }

  if (cmd === 'config') {
    const [url, token] = rest;
    if (!url || !token) {
      const cur = loadConfig();
      console.log(cur.url ? `Sync server: ${cur.url} (token set)` : 'No sync server configured.');
      console.log('Usage: tg config <url> <token>');
      return;
    }
    saveConfig({ url, token });
    console.log(`Saved. Will sync with ${url}`);
    return;
  }

  let initial = null;
  let detectedName: string | null = null;
  if (cmd) {
    initial = gameByArg(store.state, cmd);
    if (!initial) {
      console.error(`No game matches "${cmd}". Games: ${store.state.games.filter((g) => !g.deleted).map((g) => g.short).join(', ') || '(none)'}`);
      process.exitCode = 1;
      return;
    }
  } else {
    initial = await detectGame(store.state);
    detectedName = initial?.name ?? null;
  }

  render(<App initialGameId={initial?.id ?? null} detectedName={detectedName} />);
}

void main();
