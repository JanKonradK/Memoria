import { detectLocalTz, PRESETS } from '@memoria/shared';
import { useState } from 'react';
import { useApp } from '../store';
import '../surfaces.css';
import { gameShellVars } from '../theme';
import { resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE } from '../timezone';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { GameLogo } from './GameLogo';
import { HomeTimeZoneField } from './HomeTimeZoneField';
import { Btn, NumInput } from './ui';

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const addGameFromPreset = useApp((store) => store.addGameFromPreset);
  const setEnergyValue = useApp((store) => store.setEnergy);
  const updateSettings = useApp((store) => store.updateSettings);
  const theme = useUI((store) => store.theme);
  const [detectedTz] = useState(detectLocalTz);
  const [homeTzChoice, setHomeTzChoice] = useState(SYSTEM_TIMEZONE_VALUE);
  const [selected, setSelected] = useState<string[]>([]);
  const [energy, setEnergy] = useState<Record<string, string>>({});
  const chosenTz = homeTzChoice === SYSTEM_TIMEZONE_VALUE ? detectedTz : homeTzChoice;

  const finish = () => {
    updateSettings({ localTz: resolveHomeTimeZone(homeTzChoice) });
    for (const key of selected) {
      const preset = PRESETS.find((item) => item.key === key);
      if (!preset) continue;
      const gameId = addGameFromPreset(preset, {});
      const resource = useApp
        .getState()
        .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
      // A blank field is "I don't know yet", not zero. Committing 0 here would let
      // Memoria project a confident refill time from a reading the user never gave it.
      const entered = (energy[key] ?? '').trim();
      if (resource && entered !== '')
        setEnergyValue(resource.id, Math.min(resource.cap, Math.max(0, intOr(entered, 0))));
    }
    onComplete();
    useUI.getState().openSheet({ kind: 'guide' });
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-10 sm:px-5">
      <p className="text-label font-black uppercase tracking-[0.25em] text-accent-fg">Welcome to Memoria</p>
      <h1 className="mt-3 text-display font-black tracking-tight text-fg">Set up your first dashboard</h1>
      <p className="mt-2 max-w-2xl text-body leading-6 text-muted">
        Choose the games you actively play and enter the current value of their main energy. Server clocks and default
        resets are filled from the presets and can be changed later.
      </p>
      <section className="mt-7" aria-labelledby="onboarding-timezone-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="onboarding-timezone-heading" className="text-heading font-semibold text-fg-soft">
              Home timezone
            </h2>
            <p className="aside mt-1 text-meta text-muted">
              Memoria uses it to convert each game’s server reset into your own clock.
            </p>
          </div>
          <HomeTimeZoneField
            value={homeTzChoice}
            resolvedTz={chosenTz}
            detectedTz={detectedTz}
            onChange={setHomeTzChoice}
          />
        </div>
      </section>
      <div className="surface-list mt-7 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((game) => {
          const active = selected.includes(game.key);
          return (
            <section
              key={game.key}
              // min-w-0 because a grid item's default `min-width: auto` refuses
              // to shrink below its content: at 320px the logo, gap and padding
              // set a floor wider than a 288px column, and the whole page
              // scrolled sideways. The name inside already truncates.
              className="surface-row min-w-0"
              style={gameShellVars(game, theme)}
            >
              <button
                type="button"
                onClick={() =>
                  setSelected((items) =>
                    items.includes(game.key) ? items.filter((item) => item !== game.key) : [...items, game.key],
                  )
                }
                // The row's own corner is on the section around this button. The
                // radius here is for the focus ring, which follows the element's
                // own corner, so a keyboard user does not get a square outline.
                className="flex min-h-11 w-full items-center gap-3 rounded-ui-lg text-left"
                aria-pressed={active}
              >
                <GameLogo game={{ ...game, presetKey: game.key }} size={48} label="short" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-heading font-black text-fg-soft">{game.name}</span>
                  <span className="aside block text-meta text-muted">{active ? 'Selected' : 'Add game'}</span>
                </span>
              </button>
              {active && (
                <label className="mt-3 block text-label font-semibold text-muted">
                  Current {game.resources[0]?.name ?? 'energy'}
                  <NumInput
                    className="mt-1"
                    min={0}
                    max={game.resources[0]?.cap}
                    value={energy[game.key] ?? ''}
                    onChange={(event) => setEnergy({ ...energy, [game.key]: event.target.value })}
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
        <Btn
          onClick={() => {
            updateSettings({ localTz: detectLocalTz() });
            onComplete();
          }}
        >
          Skip for now
        </Btn>
      </div>
      <p className="mt-3 text-meta text-dim">
        Display preferences, backups and every game detail stay editable in Settings after setup.
      </p>
    </main>
  );
}
