import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextInput } from './ui';

export function ReminderSheet({ open }: { open: boolean }) {
  const state = useApp((s) => s.state);
  const addReminder = useApp((s) => s.addReminder);
  const closeSheet = useUI((s) => s.closeSheet);

  const games = state.games.filter((g) => !g.deleted).sort((a, b) => a.sort - b.sort);
  const [message, setMessage] = useState('');
  const [at, setAt] = useState(Date.now() + 3600_000);
  const [gameId, setGameId] = useState('');

  useEffect(() => {
    if (open) {
      setMessage('');
      setAt(Date.now() + 3600_000);
      setGameId('');
    }
  }, [open]);

  return (
    <Sheet open={open} onClose={closeSheet} title="New reminder">
      <div className="space-y-3">
        <Field label="Message">
          <TextInput
            placeholder="e.g. Spend starglitter before maintenance"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="When">
            <TextInput
              type="datetime-local"
              value={fmtDateTimeLocalInput(at, state.settings.localTz)}
              onChange={(e) => {
                const t = parseDateTimeLocalInput(e.target.value, state.settings.localTz);
                if (t != null) setAt(t);
              }}
            />
          </Field>
          <Field label="Game (optional)">
            <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
              <option value="">—</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Btn
          kind="primary"
          className="w-full"
          disabled={!message.trim()}
          onClick={() => {
            addReminder(message.trim(), at, gameId || null);
            closeSheet();
          }}
        >
          Add reminder
        </Btn>
        <p className="text-label text-dim">Shown in the in-app reminder lists until you delete it.</p>
      </div>
    </Sheet>
  );
}
