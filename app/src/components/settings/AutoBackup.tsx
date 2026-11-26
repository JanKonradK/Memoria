import { useEffect } from 'react';
import { chooseAutoBackupFolder, refreshAutoBackup, stopAutoBackup, useAutoBackup } from '../../auto-backup';
import { useApp } from '../../store';
import { fmtClock } from '../../util';
import { Btn } from '../ui';
import { SettingRow } from './SettingRow';

/** Android: one backup file kept current in a folder picked through the system picker. */
export function AutoBackupRow() {
  const { status, busy, error } = useAutoBackup();
  const zone = useApp((store) => store.state.settings.localTz);
  useEffect(() => {
    void refreshAutoBackup();
  }, []);
  const on = status?.enabled === true;
  const problem = error || status?.error || '';

  return (
    <>
      <SettingRow
        label="Automatic backup"
        hintKind={on ? 'fact' : 'say'}
        hint={
          on ? (
            <span role="status">
              {status.folderName ?? 'Folder'} ·{' '}
              {status.lastBackupAt ? `✓ ${fmtClock(status.lastBackupAt, zone)}` : 'Not saved yet'}
            </span>
          ) : (
            'A copy in a folder of your choice, kept current.'
          )
        }
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Btn disabled={busy} onClick={() => void chooseAutoBackupFolder()}>
            {on ? 'Change folder…' : 'Choose folder…'}
          </Btn>
          {on && (
            <Btn disabled={busy} onClick={() => void stopAutoBackup()}>
              Stop
            </Btn>
          )}
        </div>
      </SettingRow>
      {problem && (
        <p role="alert" className="settings-note text-body text-danger-fg">
          {problem}
        </p>
      )}
    </>
  );
}
