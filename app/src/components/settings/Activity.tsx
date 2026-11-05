import { useState } from 'react';
import { UNKNOWN_DEVICE } from '@memoria/shared';
import { useApp } from '../../store';
import { Btn, ConfirmAction, TOUCH_BUTTON } from '../ui';
import { SettingRow, SettingsGroup } from './SettingRow';

export function Activity() {
  const history = useApp((store) => store.history);
  const undo = useApp((store) => store.undoActivity);
  const restore = useApp((store) => store.restoreSavedCheckpoint);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(30);
  return (
    <>
      <p className="text-meta text-muted">
        Recent changes on this device. History stays here. Older entries are removed to save space.
      </p>
      <p className="mt-2 text-meta text-muted">This device: {history.deviceId}</p>
      {message && (
        <p role="status" className="mt-2 text-body text-fg">
          {message}
        </p>
      )}
      <SettingsGroup title="Recent changes">
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
                hint={
                  <>
                    {new Date(entry.at).toLocaleString()} ·{' '}
                    {devices.map((device) => (device === history.deviceId ? 'This device' : device)).join(', ')} ·{' '}
                    {entry.changes.length} item{entry.changes.length === 1 ? '' : 's'}
                  </>
                }
              >
                <Btn
                  className={TOUCH_BUTTON}
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
        {history.journal.length > limit && (
          <Btn className={TOUCH_BUTTON} onClick={() => setLimit(limit + 30)}>
            Show more
          </Btn>
        )}
      </SettingsGroup>
      <SettingsGroup title="Checkpoints">
        <p className="mb-2 text-meta text-muted">
          Saved each day and before imports, sync and migrations. Restore replaces current data and syncs the result to
          other devices.
        </p>
        {[...history.checkpoints].reverse().map((saved) => (
          <SettingRow key={saved.id} label={saved.label} hint={new Date(saved.at).toLocaleString()}>
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
