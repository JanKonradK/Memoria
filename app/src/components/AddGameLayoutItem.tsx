import { useState, type FormEvent } from 'react';
import type { Cadence } from '@memoria/shared';
import { useApp } from '../store';
import { intOr } from '../util';
import { Btn, COMPACT_INPUT, Field, NumInput, Select, TextInput, TOUCH_BUTTON } from './ui';

type ItemKind = 'task' | 'counter' | 'energy';

const ITEM_KINDS: { value: ItemKind; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'counter', label: 'Counter' },
  { value: 'energy', label: 'Energy' },
];

/** Only the fixed cadences. A cycle task needs an interval, which belongs in the game editor. */
const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** `shortText` in the shared schema. A longer name would fail validation on the next save. */
const NAME_MAX = 500;

/**
 * Add one task or resource to a game without leaving its layout editor.
 *
 * The store's `addTask` and `upsertResource` return nothing, so the new id is
 * read back out of the store instead: the task by diffing the game's task ids
 * across the call, the resource by minting the id here first. Both are
 * synchronous — zustand has applied the mutation by the time the setter
 * returns — so `onAdded` can hand the caller a widget id in the same tick.
 */
export function AddGameLayoutItem({
  gameId,
  onAdded,
  onClose,
}: {
  gameId: string;
  onAdded: (widgetId: string) => void;
  onClose: () => void;
}) {
  const gameExists = useApp((store) => store.state.games.some((game) => game.id === gameId && !game.deleted));
  const addTask = useApp((store) => store.addTask);
  const upsertResource = useApp((store) => store.upsertResource);

  const [kind, setKind] = useState<ItemKind>('task');
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [cap, setCap] = useState('100');
  const [regenMinutes, setRegenMinutes] = useState('6');
  const [error, setError] = useState('');

  // The game can be deleted from another view while this form sits open.
  if (!gameExists) {
    return (
      <div className="rounded-ui-lg bg-fill-1 p-3 ring-1 ring-line-hairline">
        <p className="text-meta text-muted">This game is no longer tracked.</p>
        <Btn className={`mt-2 ${TOUCH_BUTTON}`} onClick={onClose}>
          Close
        </Btn>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name.');
    if (trimmed.length > NAME_MAX) return setError(`Keep the name under ${NAME_MAX} characters.`);

    const capValue = intOr(cap, 0);
    const regenValue = intOr(regenMinutes, 0);
    if (kind !== 'task' && capValue <= 0) return setError('Capacity must be 1 or more.');
    if (kind === 'energy' && regenValue <= 0) return setError('Minutes per point must be 1 or more.');

    // Re-read the store rather than trust the render this handler closed over.
    const state = useApp.getState().state;
    if (!state.games.some((game) => game.id === gameId && !game.deleted)) {
      return setError('This game is no longer tracked.');
    }

    if (kind === 'task') {
      const before = new Set(state.tasks.map((task) => task.id));
      addTask(gameId, trimmed, cadence);
      const added = useApp
        .getState()
        .state.tasks.find((task) => task.gameId === gameId && !task.deleted && !before.has(task.id));
      if (!added) return setError('Could not add the task. Try again.');
      setError('');
      setName('');
      onAdded(`task:${added.id}`);
      return;
    }

    // Minting the id here keeps `upsertResource` on its insert path; an id that
    // already exists would patch that resource instead of adding a new one.
    const id = crypto.randomUUID();
    if (state.resources.some((resource) => resource.id === id)) {
      return setError('Could not add the resource. Try again.');
    }
    upsertResource({
      id,
      gameId,
      name: trimmed,
      cap: capValue,
      regenMinutes: kind === 'energy' ? regenValue : 0,
      reserveCap: 0,
      kind: kind === 'energy' ? 'regen' : 'counter',
    });
    setError('');
    setName('');
    onAdded(`resource:${id}`);
  };

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 items-end gap-2 rounded-ui-lg bg-fill-1 p-3 ring-1 ring-line-hairline sm:grid-cols-2"
    >
      <Field label="Type">
        <Select
          className={COMPACT_INPUT}
          value={kind}
          aria-label="New item type"
          onChange={(event) => {
            setKind(event.target.value as ItemKind);
            setError('');
          }}
        >
          {ITEM_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Name">
        <TextInput
          className={COMPACT_INPUT}
          value={name}
          maxLength={NAME_MAX}
          placeholder={kind === 'task' ? 'Daily commissions…' : 'Resin…'}
          aria-label="New item name"
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
      </Field>
      {kind === 'task' ? (
        <Field label="Cadence" className="sm:col-start-1">
          <Select
            className={`w-full sm:w-28 ${COMPACT_INPUT}`}
            value={cadence}
            aria-label="New task cadence"
            onChange={(event) => setCadence(event.target.value as Cadence)}
          >
            {CADENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Cap" className="sm:col-start-1">
            <NumInput
              className={COMPACT_INPUT}
              min={1}
              value={cap}
              aria-label="New resource cap"
              onChange={(event) => {
                setCap(event.target.value);
                setError('');
              }}
            />
          </Field>
          {kind === 'energy' && (
            <Field label="Minutes per point">
              <NumInput
                className={COMPACT_INPUT}
                min={1}
                value={regenMinutes}
                aria-label="New resource minutes per point"
                onChange={(event) => {
                  setRegenMinutes(event.target.value);
                  setError('');
                }}
              />
            </Field>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Btn type="submit" kind="primary" className={`shrink-0 ${TOUCH_BUTTON}`}>
          Add
        </Btn>
        <Btn className={`shrink-0 ${TOUCH_BUTTON}`} onClick={onClose}>
          Cancel
        </Btn>
      </div>
      {error && (
        <p role="alert" className="text-label text-danger-fg sm:col-span-2">
          {error}
        </p>
      )}
      <p className="text-label text-muted sm:col-span-2">
        {kind === 'task'
          ? 'Tasks reset on their cadence. After adding one, edit its timer or counter rules here.'
          : kind === 'counter'
            ? 'A counter holds a manual count. Set its starting value on the card.'
            : 'Energy refills at the rate you set, up to its cap.'}
      </p>
    </form>
  );
}
