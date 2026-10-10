import { useCallback, useEffect, useMemo } from 'react';
import { useMediaQuery } from '../hooks';
import { useDerived } from '../selectors';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { GameControlsView } from './GameCard';
import { gameShellVars, useTheme } from '../theme';
import { useIdentityColors } from './roster';
import { Page } from './ui';
import { closeWorkspace, recordWorkspaceHistory } from '../workspace-navigation';

/** One game's full controls. Today is the overview this page returns to. */
export function GamePage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, entryById } = derived;
  // Individual selectors (zustand action refs are stable). Grouped into one
  // object for passing down to the game-control view.
  const upsertEvent = useApp((s) => s.upsertEvent);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const advanceTaskTimer = useApp((s) => s.advanceTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const actions = useMemo(
    () => ({
      state,
      upsertEvent,
      setTaskDone,
      restartTaskTimer,
      advanceTaskTimer,
      setTaskCount,
      setEnergy,
      adjustEnergy,
    }),
    [adjustEnergy, advanceTaskTimer, restartTaskTimer, setEnergy, setTaskCount, setTaskDone, state, upsertEvent],
  );
  const openSheet = useUI((s) => s.openSheet);
  const openGameEvent = useCallback(
    (eventId: string, gameId: string) => openSheet({ kind: 'event', eventId, gameId }),
    [openSheet],
  );
  const focusColumns = useMediaQuery('(min-width: 900px)');
  const focusedGameId = useUI((s) => s.focusedGameId);
  const focusedEntry = focusedGameId ? entryById.get(focusedGameId) : undefined;
  const workspaceId = focusedEntry?.game.id;
  const theme = useTheme();
  const identityColors = useIdentityColors(state.games);

  useEffect(() => {
    if (workspaceId) recordWorkspaceHistory(workspaceId);
  }, [workspaceId]);

  // Without a game there is no page. The shell sends this route back to Today.
  if (!focusedEntry) return null;

  return (
    <Page>
      <section
        key={focusedEntry.game.id}
        className="focus-workspace"
        style={gameShellVars(focusedEntry.game, theme, identityColors[focusedEntry.game.id])}
        aria-label={`${focusedEntry.game.name} focus workspace`}
      >
        <GameControlsView
          entry={focusedEntry}
          state={state}
          actions={actions}
          now={now}
          onBack={closeWorkspace}
          layout="focus"
          columns={focusColumns ? 2 : 1}
          onOpenEvent={openGameEvent}
        />
      </section>
    </Page>
  );
}
