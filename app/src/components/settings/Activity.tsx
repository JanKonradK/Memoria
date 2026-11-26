import { useMemo, useState } from 'react';
import { dailyStreaks, UNKNOWN_DEVICE } from '@memoria/shared';
import { useNow } from '../../hooks';
import { useApp } from '../../store';
import { Btn, ConfirmAction } from '../ui';
import { SettingRow, SettingsGroup } from './SettingRow';

const days = (count: number) => `${count} day${count === 1 ? '' : 's'}`;

/** Days in a row with every daily done: any game, then each game. Hidden until a game has dailies. */
function Streaks() {
  const games = useApp((store) => store.state.games);
  const tasks = useApp((store) => store.state.tasks);
  const completions = useApp((store) => store.state.completions);
  const now = useNow(60_000);
  const summary = useMemo(() => dailyStreaks({ games, tasks, completions }, now), [games, tasks, completions, now]);
  if (!summary.games.length) return null;
  const name = (gameId: string) => {
    const game = games.find((item) => item.id === gameId);
    return game ? (game.accountLabel ? `${game.name} (${game.accountLabel})` : game.name) : gameId;
  };
  return (
    <SettingsGroup title="Daily streak">
      <div className="settings-rows">
        {summary.games.length > 1 && (
          <SettingRow label="Any game" hintKind="fact" hint={`Best ${days(summary.best)}`}>
            <span className="numeral text-body font-semibold text-fg">{days(summary.current)}</span>
          </SettingRow>
        )}
        {summary.games.map((streak) => (
          <SettingRow
            key={streak.gameId}
            label={name(streak.gameId)}
            hintKind="fact"
            hint={`${streak.today ? '✓ Today · ' : ''}Best ${days(streak.best)}`}
          >
            <span className="numeral text-body font-semibold text-fg">{days(streak.current)}</span>
          </SettingRow>
        ))}
      </div>
    </SettingsGroup>
  );
}

export function Activity() {
  const history = useApp((store) => store.history);
  const undo = useApp((store) => store.undoActivity);
  const restore = useApp((store) => store.restoreSavedCheckpoint);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(30);
  return (
    <>
      <Streaks />
      <SettingsGroup title="Recent changes">
        <div className="settings-note mb-2 space-y-1">
          <p className="text-meta text-muted">Kept on this device only. Older entries are removed to save space.</p>
          <p className="text-meta text-muted">
            This device: <span className="numeral">{history.deviceId}</span>
          </p>
          {message && (
            <p role="status" className="text-body text-fg">
              {message}
            </p>
          )}
        </div>
        {!history.journal.length && <p className="text-body text-muted">No changes yet.</p>}
        {[...history.journal]
          .reverse()
          .slice(0, limit)
          .map((entry) => {
            const devices = [
              ...new Set(
                entry.changes.map((change) => String((change.after ?? change.before)?.deviceId ?? UNKNOWN_DEVICE)),
              ),
            ];
            const deleted = entry.changes.some((change) => change.after?.deleted && !change.before?.deleted);
            return (
              <SettingRow
                key={entry.id}
                label={entry.label}
                hintKind="fact"
                hint={
                  <>
                    {new Date(entry.at).toLocaleString()} ·{' '}
                    {devices.map((device) => (device === history.deviceId ? 'This device' : device)).join(', ')} ·{' '}
                    {entry.changes.length} item{entry.changes.length === 1 ? '' : 's'}
                  </>
                }
              >
                <Btn
                  disabled={entry.undone}
                  onClick={() => {
                    undo(entry.id);
                    setMessage('Reversed fields that have no later edits.');
                  }}
                >
                  {entry.undone ? 'Undone' : deleted ? 'Restore this item' : 'Undo'}
                </Btn>
              </SettingRow>
            );
          })}
        {history.journal.length > limit && <Btn onClick={() => setLimit(limit + 30)}>Show more</Btn>}
      </SettingsGroup>
      <SettingsGroup title="Checkpoints">
        <p className="settings-note mb-2 text-meta text-muted">
          Saved each day and before imports, sync and migrations. Restore replaces current data and syncs the result to
          other devices.
        </p>
        {[...history.checkpoints].reverse().map((saved) => (
          <SettingRow key={saved.id} label={saved.label} hintKind="fact" hint={new Date(saved.at).toLocaleString()}>
            <ConfirmAction
              label="Restore checkpoint"
              confirmLabel="Replace current data"
              cancelLabel="Cancel"
              onConfirm={() => {
                restore(saved.id);
                setMessage('Checkpoint restored. This change will sync.');
              }}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
    </>
  );
}
