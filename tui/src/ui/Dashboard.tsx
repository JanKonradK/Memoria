import { Box, Text } from 'ink';
import type { AppState, Game, Resource } from '@technogg/shared';
import { checklistFor, latestSnapshots, projectEnergy, urgencyOrder } from '@technogg/shared';
import { countdown, pad } from '../format.js';

function ResourceCell({ res, state, now }: { res: Resource; state: AppState; now: number }) {
  const proj = projectEnergy(res, latestSnapshots(state.snapshots).get(res.id), now);
  if (!proj.hasSnapshot) return <Text dimColor>{res.name}: —</Text>;
  if (res.regenMinutes <= 0) {
    return (
      <Text dimColor>
        {proj.value}/{res.cap}
      </Text>
    );
  }
  if (proj.isFull) return <Text color="red" bold>{`${proj.value}/${res.cap} FULL`}</Text>;
  const soon = (proj.msToFull ?? Infinity) < 2 * 3_600_000;
  return (
    <Text color={soon ? 'yellow' : undefined}>
      {proj.value}/{res.cap}
      <Text dimColor> caps {countdown(proj.msToFull ?? 0)}</Text>
    </Text>
  );
}

function GameRow({ game, state, now, selected }: { game: Game; state: AppState; now: number; selected: boolean }) {
  const resources = state.resources
    .filter((r) => r.gameId === game.id && !r.deleted)
    .sort((a, b) => a.sort - b.sort);
  const items = checklistFor(state, game, now);
  const dailies = items.filter((i) => i.cadence === 'daily');
  const dailiesDone = dailies.filter((i) => i.done).length;
  const undone = items.filter((i) => !i.done);
  const nextUndone = undone.sort((a, b) => a.resetAt - b.resetAt)[0];
  const dailyUrgent = dailiesDone < dailies.length && dailies[0] && dailies[0].resetAt - now < 3 * 3_600_000;

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>{selected ? '❯ ' : '  '}</Text>
      <Text color={game.color} bold={selected}>
        {pad(`${game.icon} ${game.short}`, 9)}
      </Text>
      {game.paused ? (
        <Text dimColor>paused</Text>
      ) : (
        <>
          <Box width={34}>
            {resources.map((r, i) => (
              <Text key={r.id}>
                {i > 0 ? <Text dimColor> · </Text> : null}
                <ResourceCell res={r} state={state} now={now} />
              </Text>
            ))}
          </Box>
          <Box width={16}>
            {dailies.length > 0 ? (
              <Text color={dailiesDone === dailies.length ? 'green' : dailyUrgent ? 'red' : 'yellow'}>
                dailies {dailiesDone}/{dailies.length}
              </Text>
            ) : (
              <Text dimColor>no dailies</Text>
            )}
          </Box>
          {nextUndone ? (
            <Text dimColor>
              {nextUndone.name} resets <Text color="white">{countdown(nextUndone.resetAt - now)}</Text>
            </Text>
          ) : (
            <Text color="green">all clear ✓</Text>
          )}
        </>
      )}
    </Box>
  );
}

export function Dashboard({ state, now, selected }: { state: AppState; now: number; selected: number }) {
  const order = urgencyOrder(state, now);
  return (
    <Box flexDirection="column">
      {order.map((entry, i) => (
        <GameRow key={entry.game.id} game={entry.game} state={state} now={now} selected={i === selected} />
      ))}
    </Box>
  );
}
