import { useId, useState } from 'react';
import { checklistFor, effectiveResourceKind } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, NumInput } from './ui';

/**
 * A game started on this PC a couple of minutes ago: the check-in. It lists the
 * dailies still owed, so they get done this session, and takes the energy the
 * player can read on screen — one number and one tap, without opening the page.
 */
export function SessionSheet({ open, gameId }: { open: boolean; gameId: string }) {
  const state = useApp((s) => s.state);
  const setEnergy = useApp((s) => s.setEnergy);
  const completeDailies = useApp((s) => s.completeDailies);
  const closeSheet = useUI((s) => s.closeSheet);
  const formId = useId();
  const game = state.games.find((item) => item.id === gameId && !item.deleted);
  const resource = state.resources
    .filter((item) => item.gameId === gameId && !item.deleted && effectiveResourceKind(item) === 'regen')
    .sort((a, b) => a.sort - b.sort)[0];
  const [value, setValue] = useState('');
  const [dailiesDone, setDailiesDone] = useState(false);
  if (!game) return null;
  const left = checklistFor(state, game, Date.now()).filter((item) => item.cadence === 'daily' && !item.done);
  const save = () => {
    if (resource && value.trim() !== '') setEnergy(resource.id, Math.min(resource.cap, Math.max(0, intOr(value, 0))));
    if (dailiesDone) completeDailies(game.id);
    closeSheet();
  };
  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title={`${game.name} check-in`}
      footer={
        <div className="flex w-full gap-2">
          <Btn className="flex-1" onClick={closeSheet}>
            Not now
          </Btn>
          <Btn kind="primary" type="submit" form={formId} className="flex-1">
            Save
          </Btn>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {left.length > 0 ? (
          <div>
            <p className="text-meta text-muted">Still to do today</p>
            <ul className="mt-1 space-y-0.5 text-body text-fg">
              {left.map((item) => (
                <li key={item.taskId}>{item.name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-meta text-muted">Dailies are done. Record your energy while it is on screen.</p>
        )}
        {resource && (
          <Field label={`${resource.name} now`}>
            <NumInput
              autoFocus
              min={0}
              max={resource.cap}
              value={value}
              placeholder={`0–${resource.cap}`}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        )}
        {left.length > 0 && (
          <label className="flex min-h-11 items-center gap-3 text-body text-fg">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={dailiesDone}
              onChange={(event) => setDailiesDone(event.target.checked)}
            />
            Already done them
          </label>
        )}
      </form>
    </Sheet>
  );
}
