import { PRESETS } from '@void/shared';
import { useState } from 'react';
import { useApp } from '../store';
import { intOr } from '../util';
import { Btn, GameBadge, NumInput } from './ui';

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const addGameFromPreset = useApp((store) => store.addGameFromPreset);
  const setEnergyValue = useApp((store) => store.setEnergy);
  const [selected, setSelected] = useState<string[]>([]);
  const [energy, setEnergy] = useState<Record<string, string>>({});

  const finish = () => {
    for (const key of selected) {
      const preset = PRESETS.find((item) => item.key === key);
      if (!preset) continue;
      const gameId = addGameFromPreset(preset, {});
      const resource = useApp
        .getState()
        .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
      // A blank field is "I don't know yet", not zero. Committing 0 here would let
      // Void project a confident refill time from a reading the user never gave it.
      const entered = (energy[key] ?? '').trim();
      if (resource && entered !== '')
        setEnergyValue(resource.id, Math.min(resource.cap, Math.max(0, intOr(entered, 0))));
    }
    onComplete();
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-10 sm:px-5">
      <p className="text-meta font-black uppercase tracking-[0.25em] text-accent-fg">Welcome to Void</p>
      <h1 className="mt-3 text-display font-black tracking-tight text-fg">Set up your first dashboard</h1>
      <p className="mt-2 max-w-2xl text-body leading-6 text-muted">
        Choose the games you actively play and enter the current value of their main energy. Server clocks and default
        resets are filled from the presets and can be changed later.
      </p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((preset) => {
          const active = selected.includes(preset.key);
          return (
            <section
              key={preset.key}
              className={`rounded-ui-card p-4 ring-1 ${active ? 'bg-fill-3 ring-line-strong' : 'bg-fill-1 ring-line-hairline'}`}
            >
              <button
                type="button"
                onClick={() =>
                  setSelected((items) =>
                    items.includes(preset.key) ? items.filter((item) => item !== preset.key) : [...items, preset.key],
                  )
                }
                className="flex min-h-11 w-full items-center gap-3 text-left"
                aria-pressed={active}
              >
                <GameBadge short={preset.short} color={preset.color} color2={preset.color2} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black text-fg-soft">{preset.name}</span>
                  <span className="text-meta text-dim">{active ? 'Selected' : 'Add game'}</span>
                </span>
              </button>
              {active && (
                <label className="mt-3 block text-meta font-semibold text-muted">
                  Current {preset.resources[0]?.name ?? 'energy'}
                  <NumInput
                    className="mt-1"
                    min={0}
                    max={preset.resources[0]?.cap}
                    value={energy[preset.key] ?? ''}
                    onChange={(event) => setEnergy({ ...energy, [preset.key]: event.target.value })}
                  />
                </label>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-7 flex flex-wrap gap-2">
        <Btn kind="primary" disabled={selected.length === 0} onClick={finish}>
          Create dashboard
        </Btn>
        <Btn onClick={onComplete}>Skip for now</Btn>
      </div>
      <p className="mt-3 text-meta text-dim">Display and sync preferences remain available in Settings after setup.</p>
    </main>
  );
}
