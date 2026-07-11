import { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import type { AppState, Game, Resource } from '@technogg/shared';
import { checklistFor, latestSnapshots, projectEnergy, type ChecklistItem } from '@technogg/shared';
import { countdown, pad } from '../format.js';
import { store } from '../store.js';

type Field = { kind: 'res'; res: Resource } | { kind: 'task'; item: ChecklistItem };

const STEP: Record<string, number> = { a: -10, s: -1, d: +1, f: +10 };

function ResField({
  res,
  state,
  now,
  focused,
  buffer,
}: {
  res: Resource;
  state: AppState;
  now: number;
  focused: boolean;
  buffer: string | undefined;
}) {
  const proj = projectEnergy(res, latestSnapshots(state.snapshots).get(res.id), now);
  const shown = buffer !== undefined ? buffer : proj.hasSnapshot ? String(proj.value) : '—';
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>{focused ? '❯ ' : '  '}</Text>
      <Text>{pad(res.name, 18)}</Text>
      <Text color={focused ? 'cyan' : undefined} bold={focused} inverse={focused}>
        {` ${shown} `}
      </Text>
      <Text dimColor>/{res.cap}</Text>
      {res.regenMinutes > 0 && proj.hasSnapshot && buffer === undefined ? (
        proj.isFull ? (
          <Text color="red" bold>
          {'  FULL'}
          </Text>
        ) : (
          <Text dimColor>{`  caps ${countdown(proj.msToFull ?? 0)}`}</Text>
        )
      ) : null}
      {buffer !== undefined ? <Text color="yellow">{'  *'}</Text> : null}
    </Box>
  );
}

function TaskField({ item, now, focused }: { item: ChecklistItem; now: number; focused: boolean }) {
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>{focused ? '❯ ' : '  '}</Text>
      <Text color={item.done ? 'green' : undefined}>{item.done ? '[✓] ' : '[ ] '}</Text>
      <Text color={item.done ? 'green' : undefined} dimColor={item.done}>
        {pad(item.name, 34)}
      </Text>
      <Text dimColor>
        {item.cadence} · resets {countdown(item.resetAt - now)}
      </Text>
    </Box>
  );
}

export function Entry({
  game,
  state,
  now,
  onDone,
  onBack,
}: {
  game: Game;
  state: AppState;
  now: number;
  onDone: () => void;
  onBack: () => void;
}) {
  const resources = useMemo(
    () => state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort),
    [state.resources, game.id],
  );
  const items = checklistFor(state, game, now);
  const fields: Field[] = [
    ...resources.map((res): Field => ({ kind: 'res', res })),
    ...items.map((item): Field => ({ kind: 'task', item })),
  ];
  const { isRawModeSupported } = useStdin();
  const [focus, setFocus] = useState(0);
  const [buffers, setBuffers] = useState<Record<string, string>>({});

  const commit = () => {
    for (const [resId, buf] of Object.entries(buffers)) {
      if (buf === '') continue;
      const n = Number.parseInt(buf, 10);
      if (Number.isFinite(n)) store.setEnergy(resId, n);
    }
    onDone();
  };

  useInput((input, key) => {
    const field = fields[focus];
    if (key.escape) return onBack();
    if (key.return) return commit();
    if (key.upArrow || (key.shift && key.tab)) return setFocus((f) => (f - 1 + fields.length) % fields.length);
    if (key.downArrow || key.tab) return setFocus((f) => (f + 1) % fields.length);

    if (field?.kind === 'task' && input === ' ') {
      store.setTaskDone(field.item.taskId, field.item.periodKey, !field.item.done);
      return;
    }
    if (field?.kind === 'res') {
      const { res } = field;
      if (/^\d$/.test(input)) {
        setBuffers((b) => ({ ...b, [res.id]: ((b[res.id] ?? '') + input).slice(0, 5) }));
      } else if (key.backspace || key.delete) {
        setBuffers((b) => ({ ...b, [res.id]: (b[res.id] ?? '').slice(0, -1) }));
      } else if (STEP[input.toLowerCase()] !== undefined && !key.ctrl && !key.meta) {
        const cur = buffers[res.id] !== undefined && buffers[res.id] !== ''
          ? Number.parseInt(buffers[res.id], 10)
          : store.projectedValue(res, now);
        setBuffers((b) => ({ ...b, [res.id]: String(Math.max(0, cur + STEP[input.toLowerCase()])) }));
      }
    }
  }, { isActive: isRawModeSupported === true });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={game.color} bold>
          {game.icon} {game.name}
        </Text>
        <Text dimColor> — type what's left, tick what's done</Text>
      </Box>
      {fields.map((f, i) =>
        f.kind === 'res' ? (
          <ResField key={f.res.id} res={f.res} state={state} now={now} focused={i === focus} buffer={buffers[f.res.id]} />
        ) : (
          <TaskField key={f.item.taskId} item={f.item} now={now} focused={i === focus} />
        ),
      )}
      <Box marginTop={1}>
        <Text dimColor>digits set · A/S/D/F −10/−1/+1/+10 · space tick · ↑↓ move · Enter save · Esc back</Text>
      </Box>
    </Box>
  );
}
