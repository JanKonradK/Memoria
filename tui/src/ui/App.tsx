import { useEffect, useReducer, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { urgencyOrder } from '@technogg/shared';
import { loadConfig, store } from '../store.js';
import { Dashboard } from './Dashboard.js';
import { Entry } from './Entry.js';

type View = { kind: 'dash' } | { kind: 'entry'; gameId: string; initial: boolean };

export function App({ initialGameId, detectedName }: { initialGameId: string | null; detectedName: string | null }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>(
    initialGameId ? { kind: 'entry', gameId: initialGameId, initial: true } : { kind: 'dash' },
  );
  const [selected, setSelected] = useState(0);

  useEffect(() => store.subscribe(force), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void store.sync();
  }, []);

  const state = store.state;
  const order = urgencyOrder(state, now);

  useInput((input, key) => {
    if (view.kind !== 'dash') return;
    if (input === 'q' || (key.ctrl && input === 'c')) return exit();
    if (input === 's') return void store.sync();
    if (key.upArrow || input === 'k') return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow || input === 'j') return setSelected((i) => Math.min(order.length - 1, i + 1));
    if (/^[1-9]$/.test(input)) {
      const idx = Number(input) - 1;
      if (order[idx]) setView({ kind: 'entry', gameId: order[idx].game.id, initial: false });
      return;
    }
    if (key.return && order[selected]) {
      setView({ kind: 'entry', gameId: order[selected].game.id, initial: false });
    }
  }, { isActive: isRawModeSupported === true });

  const syncCfg = loadConfig();
  const syncLabel =
    store.syncStatus === 'syncing'
      ? 'sync…'
      : store.syncStatus === 'ok'
        ? 'synced ✓'
        : store.syncStatus === 'error'
          ? `sync error: ${store.syncError}`
          : syncCfg.url
            ? 'sync idle'
            : 'local only';

  if (view.kind === 'entry') {
    const game = state.games.find((g) => g.id === view.gameId && !g.deleted);
    if (!game) {
      setView({ kind: 'dash' });
      return null;
    }
    return (
      <Box flexDirection="column" padding={1}>
        {view.initial && detectedName ? (
          <Box marginBottom={1}>
            <Text color="magenta">⚡ detected {detectedName} running</Text>
          </Box>
        ) : null}
        <Entry
          game={game}
          state={state}
          now={now}
          onDone={() => {
            void store.sync().finally(() => {
              if (view.initial) exit();
            });
            if (!view.initial) setView({ kind: 'dash' });
          }}
          onBack={() => setView({ kind: 'dash' })}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          ⚡ TechnoGG
        </Text>
        <Text dimColor>  {syncLabel}</Text>
      </Box>
      {order.length === 0 ? (
        <Text dimColor>No games yet — run `tg seed` for the 5 presets or `tg import &lt;backup.json&gt;`.</Text>
      ) : (
        <Dashboard state={state} now={now} selected={selected} />
      )}
      <Box marginTop={1}>
        <Text dimColor>↑↓/jk select · Enter open · 1-{Math.max(1, order.length)} jump · s sync · q quit</Text>
      </Box>
    </Box>
  );
}
