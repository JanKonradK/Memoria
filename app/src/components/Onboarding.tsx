import { PRESETS } from '@technogg/shared';
import { useState } from 'react';
import { useApp } from '../store';
import { intOr } from '../util';
import { Btn, GameBadge, NumInput } from './ui';

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const app = useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [energy, setEnergy] = useState<Record<string, string>>({});

  const finish = () => {
    for (const key of selected) {
      const preset = PRESETS.find((item) => item.key === key);
      if (!preset) continue;
      const gameId = app.addGameFromPreset(preset, {});
      const resource = useApp
        .getState()
        .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
      if (resource) app.setEnergy(resource.id, Math.min(resource.cap, Math.max(0, intOr(energy[key] ?? '', 0))));
    }
    onComplete();
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-10 sm:px-5">
      <p className="text-xs font-black uppercase tracking-[0.25em] text-fuchsia-300">Welcome to Techno's Library</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-50">Set up your first dashboard</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Choose the games you actively play and enter the current value of their main energy. Server clocks and default
        resets are filled from the presets and can be changed later.
      </p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((preset) => {
          const active = selected.includes(preset.key);
          return (
            <section
              key={preset.key}
              className={`rounded-3xl p-4 ring-1 ${active ? 'bg-white/10 ring-white/25' : 'bg-white/[0.035] ring-white/10'}`}
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
                  <span className="block truncate font-black text-slate-100">{preset.name}</span>
                  <span className="text-xs text-slate-500">{active ? 'Selected' : 'Add game'}</span>
                </span>
              </button>
              {active && (
                <label className="mt-3 block text-xs font-semibold text-slate-400">
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
      <p className="mt-3 text-xs text-slate-500">
        Notification connections are optional and live in Settings after setup.
      </p>
    </main>
  );
}
