import { detectLocalTz, PRESETS } from '@memoria/shared';
import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { gameShellVars } from '../theme';
import { homeTimeZoneOptions, resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE, utcOffsetLabel } from '../timezone';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { Btn, GameBadge, NumInput, Select } from './ui';

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
  const timeZoneOptions = useMemo(() => homeTimeZoneOptions(chosenTz), [chosenTz]);

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
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-10 sm:px-5">
      <p className="text-label font-black uppercase tracking-[0.25em] text-accent-fg">Welcome to Memoria</p>
      <h1 className="mt-3 text-display font-black tracking-tight text-fg">Set up your first dashboard</h1>
      <p className="mt-2 max-w-2xl text-body leading-6 text-muted">
        Choose the games you actively play and enter the current value of their main energy. Server clocks and default
        resets are filled from the presets and can be changed later.
      </p>
      <section className="panel grain mt-7 rounded-ui-card p-4" aria-labelledby="onboarding-timezone-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="onboarding-timezone-heading" className="text-heading font-semibold text-fg-soft">
              Home timezone
            </h2>
            <p className="mt-1 text-meta text-muted">
              Memoria uses it to convert each game’s server reset into your own clock.
            </p>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1 sm:min-w-80">
            <Select
              aria-label="Home timezone"
              value={homeTzChoice}
              onChange={(event) => setHomeTzChoice(event.target.value)}
            >
              <option value={SYSTEM_TIMEZONE_VALUE}>Use system timezone ({detectedTz})</option>
              {timeZoneOptions.map((option) => (
                <option key={option.tz} value={option.tz}>
                  {option.label}
                </option>
              ))}
            </Select>
            <span className="numeral text-label text-dim">Current offset {utcOffsetLabel(chosenTz)}</span>
          </div>
        </div>
      </section>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((game) => {
          const active = selected.includes(game.key);
          return (
            <section
              key={game.key}
              // min-w-0 because a grid item's default `min-width: auto` refuses
              // to shrink below its content: at 320px the badge, gap and padding
              // set a floor of 311px against a 288px column, and the whole page
              // scrolled sideways. The name inside already truncates.
              className={`card-shell min-w-0 rounded-ui-card p-4 ring-1 ${active ? 'ring-line-strong' : 'ring-line-hairline'}`}
              style={gameShellVars(game, theme)}
            >
              <button
                type="button"
                onClick={() =>
                  setSelected((items) =>
                    items.includes(game.key) ? items.filter((item) => item !== game.key) : [...items, game.key],
                  )
                }
                // The visible corner belongs to the section around this button.
                // The radius here is for the focus ring, which follows the
                // element's own corner — without it a keyboard user gets a square
                // outline drawn inside a round card.
                className="flex min-h-11 w-full items-center gap-3 rounded-ui-lg text-left"
                aria-pressed={active}
              >
                <GameBadge short={game.short} color={game.color} color2={game.color2} color3={game.color3} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-heading font-black text-fg-soft">{game.name}</span>
                  <span className="text-meta text-dim">{active ? 'Selected' : 'Add game'}</span>
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
