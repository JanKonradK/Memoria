import { DateTime } from 'luxon';
import { detectLocalTz, PRESETS, type GamePreset } from '@memoria/shared';
import { useState } from 'react';
import { isNativeApp } from '../native';
import { serverChoices } from '../server-choice';
import { useApp } from '../store';
import '../onboarding.css';
import { resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE } from '../timezone';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { GameLogo } from './GameLogo';
import { HomeTimeZoneField } from './HomeTimeZoneField';
import { Btn, NumInput, Segmented, TextInput } from './ui';

/** The server region a player in this timezone most likely plays on. */
function nearestRegion(tz: string): 'EU' | 'NA' | 'Asia' {
  const hours = DateTime.now().setZone(tz).offset / 60;
  if (hours <= -2) return 'NA';
  if (hours <= 4) return 'EU';
  return 'Asia';
}

function defaultServer(preset: GamePreset, homeTz: string): string {
  const options = serverChoices({ name: preset.name, short: preset.short, presetKey: preset.key, tz: preset.tz });
  return options.find((option) => option.label === nearestRegion(homeTz) && !option.disabled)?.value ?? preset.tz;
}

/**
 * First run, in two steps: pick the games you play, then set each one up —
 * server, nickname, current energy — so the dashboard is right from the start.
 */
export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const addGameFromPreset = useApp((store) => store.addGameFromPreset);
  const setEnergyValue = useApp((store) => store.setEnergy);
  const updateSettings = useApp((store) => store.updateSettings);
  const [detectedTz] = useState(detectLocalTz);
  const [homeTzChoice, setHomeTzChoice] = useState(SYSTEM_TIMEZONE_VALUE);
  const [step, setStep] = useState<'pick' | 'setup'>('pick');
  const [selected, setSelected] = useState<string[]>([]);
  const [energy, setEnergy] = useState<Record<string, string>>({});
  const [servers, setServers] = useState<Record<string, string>>({});
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const chosenTz = homeTzChoice === SYSTEM_TIMEZONE_VALUE ? detectedTz : homeTzChoice;
  const picked = PRESETS.filter((preset) => selected.includes(preset.key));

  const finish = () => {
    updateSettings({ localTz: resolveHomeTimeZone(homeTzChoice) });
    for (const preset of picked) {
      const gameId = addGameFromPreset(preset, {
        tz: servers[preset.key] ?? defaultServer(preset, chosenTz),
        accountLabel: nicknames[preset.key]?.trim() || undefined,
      });
      const resource = useApp
        .getState()
        .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
      // A blank field is "I don't know yet", not zero. Committing 0 here would let
      // Memoria project a confident refill time from a reading the user never gave it.
      const entered = (energy[preset.key] ?? '').trim();
      if (resource && entered !== '')
        setEnergyValue(resource.id, Math.min(resource.cap, Math.max(0, intOr(entered, 0))));
    }
    onComplete();
    useUI.getState().openSheet({ kind: 'guide' });
  };

  const skip = () => {
    updateSettings({ localTz: detectLocalTz() });
    onComplete();
    // On a phone the PC usually brings the games; elsewhere, show where things are.
    if (!isNativeApp) useUI.getState().openSheet({ kind: 'guide' });
  };

  return (
    <main className="onboarding">
      <p className="onboarding-step text-meta text-muted" aria-live="polite">
        Step {step === 'pick' ? 1 : 2} of 2
      </p>

      {step === 'pick' ? (
        <>
          <h1 className="text-display font-black tracking-tight text-fg">Which games do you play?</h1>
          <p className="mt-2 max-w-2xl text-body text-muted">
            Memoria tracks their energy, daily tasks, events and banners. You can add more later.
          </p>

          {isNativeApp && (
            // Setting up games here first would make a second copy of each one the PC already tracks.
            <section className="onboarding-pc" aria-labelledby="onboarding-pc-heading">
              <div>
                <h2 id="onboarding-pc-heading" className="text-body font-semibold text-fg">
                  Already using Memoria on your PC?
                </h2>
                <p className="text-meta text-muted">Connect to it instead, and your games come over.</p>
              </div>
              <Btn
                onClick={() => {
                  updateSettings({ localTz: resolveHomeTimeZone(homeTzChoice) });
                  onComplete();
                  useUI.getState().openSettings('sync');
                }}
              >
                Connect to PC
              </Btn>
            </section>
          )}

          <ul className="onboarding-games" aria-label="Games">
            {PRESETS.map((game) => {
              const active = selected.includes(game.key);
              return (
                <li key={game.key}>
                  <button
                    type="button"
                    className="onboarding-game"
                    aria-pressed={active}
                    onClick={() =>
                      setSelected((items) =>
                        items.includes(game.key) ? items.filter((item) => item !== game.key) : [...items, game.key],
                      )
                    }
                  >
                    <GameLogo game={{ ...game, presetKey: game.key }} size={48} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">{game.name}</span>
                    <span aria-hidden className="onboarding-check">
                      {active && (
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="h-4 w-4">
                          <path
                            d="m5 10.5 3.2 3L15 6.5"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <section className="onboarding-tz" aria-labelledby="onboarding-timezone-heading">
            <div>
              <h2 id="onboarding-timezone-heading" className="text-body font-semibold text-fg">
                Your timezone
              </h2>
              <p className="text-meta text-muted">Resets and countdowns are shown on this clock.</p>
            </div>
            <HomeTimeZoneField
              value={homeTzChoice}
              resolvedTz={chosenTz}
              detectedTz={detectedTz}
              onChange={setHomeTzChoice}
            />
          </section>

          <div className="onboarding-actions">
            <Btn kind="primary" disabled={selected.length === 0} onClick={() => setStep('setup')}>
              {selected.length === 0 ? 'Pick at least one game' : `Next: set up ${selected.length}`}
            </Btn>
            <Btn onClick={skip}>Skip for now</Btn>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-display font-black tracking-tight text-fg">Set up your games</h1>
          <p className="mt-2 max-w-2xl text-body text-muted">
            The server sets when each day resets. Energy is what the game shows right now; leave it blank if you are not
            sure. Everything here can be changed later in Settings.
          </p>

          <ul className="onboarding-setup" aria-label="Your games">
            {picked.map((game) => {
              const resource = game.resources.find((item) => item.regenMinutes > 0) ?? game.resources[0];
              const server = servers[game.key] ?? defaultServer(game, chosenTz);
              return (
                <li key={game.key} className="onboarding-setup-row">
                  <div className="onboarding-setup-name">
                    <GameLogo game={{ ...game, presetKey: game.key }} size={40} className="shrink-0" />
                    <h2 className="min-w-0 truncate text-body font-semibold text-fg">{game.name}</h2>
                  </div>
                  <div className="onboarding-field">
                    <span className="text-label text-muted" aria-hidden>
                      Server
                    </span>
                    <Segmented
                      ariaLabel={`${game.name} server`}
                      options={serverChoices({ name: game.name, short: game.short, presetKey: game.key, tz: server })}
                      value={server}
                      onChange={(tz) => setServers({ ...servers, [game.key]: tz })}
                    />
                  </div>
                  <label className="onboarding-field">
                    <span className="text-label text-muted">Nickname (optional)</span>
                    <TextInput
                      placeholder="Your in-game name"
                      value={nicknames[game.key] ?? ''}
                      onChange={(event) => setNicknames({ ...nicknames, [game.key]: event.target.value })}
                    />
                  </label>
                  {resource && (
                    <label className="onboarding-field">
                      <span className="text-label text-muted">
                        Current {resource.name} <span className="numeral">(max {resource.cap})</span>
                      </span>
                      <NumInput
                        min={0}
                        max={resource.cap}
                        placeholder="Not sure"
                        value={energy[game.key] ?? ''}
                        onChange={(event) => setEnergy({ ...energy, [game.key]: event.target.value })}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="onboarding-actions">
            <Btn kind="primary" onClick={finish}>
              Create dashboard
            </Btn>
            <Btn onClick={() => setStep('pick')}>Back</Btn>
          </div>
        </>
      )}
    </main>
  );
}
