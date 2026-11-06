import { detectLocalTz, PRESETS } from '@memoria/shared';
import { useRef, useState } from 'react';
import { isNativeApp } from '../native';
import { gameServers, type ServerPick } from '../server-choice';
import { useApp } from '../store';
import '../onboarding.css';
import { resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE } from '../timezone';
import { useUI } from '../ui-store';
import { intOr } from '../util';
import { GameLogo } from './GameLogo';
import { HomeTimeZoneField } from './HomeTimeZoneField';
import { ServerSelect } from './ServerSelect';
import { Btn, NumInput, TextInput } from './ui';

type Account = { key: number; pick: ServerPick | null; nickname: string; energy: string };

const sameServer = (a: ServerPick | null, b: ServerPick | null) => a?.server === b?.server && a?.tz === b?.tz;

/** A second account on the same server with no nickname still needs a name to tell them apart. */
function labelFor(accounts: Account[], index: number): string | undefined {
  const own = accounts[index].nickname.trim();
  if (own) return own;
  const position = accounts
    .filter((account) => sameServer(account.pick, accounts[index].pick))
    .indexOf(accounts[index]);
  return position > 0 ? `Account ${position + 1}` : undefined;
}

/**
 * First run, in two steps: pick the games you play, then add an account for
 * each server you play them on — as many as you have, nothing chosen for you.
 */
export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const addGameFromPreset = useApp((store) => store.addGameFromPreset);
  const setEnergyValue = useApp((store) => store.setEnergy);
  const updateSettings = useApp((store) => store.updateSettings);
  const [detectedTz] = useState(detectLocalTz);
  const [homeTzChoice, setHomeTzChoice] = useState(SYSTEM_TIMEZONE_VALUE);
  const [step, setStep] = useState<'pick' | 'setup'>('pick');
  const [selected, setSelected] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Record<string, Account[]>>({});
  const nextKey = useRef(0);
  const chosenTz = homeTzChoice === SYSTEM_TIMEZONE_VALUE ? detectedTz : homeTzChoice;
  const picked = PRESETS.filter((preset) => selected.includes(preset.key));
  const missing = picked.find(
    (preset) => !(accounts[preset.key] ?? []).length || accounts[preset.key].some((account) => !account.pick),
  );
  const editAccounts = (key: string, change: (items: Account[]) => Account[]) =>
    setAccounts((all) => ({ ...all, [key]: change(all[key] ?? []) }));
  const addAccount = (key: string, pick: ServerPick | null) =>
    editAccounts(key, (items) => [...items, { key: nextKey.current++, pick, nickname: '', energy: '' }]);
  const editAccount = (key: string, account: number, patch: Partial<Account>) =>
    editAccounts(key, (items) => items.map((item) => (item.key === account ? { ...item, ...patch } : item)));

  const finish = () => {
    updateSettings({ localTz: resolveHomeTimeZone(homeTzChoice) });
    for (const preset of picked) {
      const list = accounts[preset.key] ?? [];
      list.forEach((account, index) => {
        if (!account.pick) return;
        const gameId = addGameFromPreset(preset, { ...account.pick, accountLabel: labelFor(list, index) });
        const resource = useApp
          .getState()
          .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
        // A blank field is "I don't know yet", not zero. Committing 0 here would let
        // Memoria project a confident refill time from a reading the user never gave it.
        const entered = account.energy.trim();
        if (resource && entered !== '')
          setEnergyValue(resource.id, Math.min(resource.cap, Math.max(0, intOr(entered, 0))));
      });
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
          <h1 className="text-display font-black tracking-tight text-fg">Where do you play?</h1>
          <p className="mt-2 max-w-2xl text-body text-muted">
            Add an account for each server you play on, and tap a server again for another account there. Energy is what
            the game shows right now; leave it blank if you are not sure. You can change all of it later in Settings.
          </p>

          <ul className="onboarding-setup" aria-label="Your games">
            {picked.map((game) => {
              const resource = game.resources.find((item) => item.regenMinutes > 0) ?? game.resources[0];
              const list = accounts[game.key] ?? [];
              const presetGame = { ...game, presetKey: game.key };
              return (
                <li key={game.key} className="onboarding-setup-game">
                  <div className="onboarding-setup-name">
                    <GameLogo game={presetGame} size={40} className="shrink-0" />
                    <h2 className="min-w-0 truncate text-body font-semibold text-fg">{game.name}</h2>
                  </div>
                  <div className="onboarding-servers" role="group" aria-label={`${game.name} servers`}>
                    {gameServers(presetGame).map((server) => {
                      const count = list.filter((account) => account.pick?.server === server.id).length;
                      return (
                        <button
                          key={server.id}
                          type="button"
                          className="onboarding-server"
                          data-active={count > 0 || undefined}
                          aria-label={`Add a ${game.name} account on ${server.label}${count ? ` (${count} added)` : ''}`}
                          onClick={() => addAccount(game.key, { server: server.id, tz: server.tz })}
                        >
                          <span aria-hidden>+</span> {server.label}
                          {count > 0 && <span className="onboarding-server-count numeral">×{count}</span>}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="onboarding-server"
                      aria-label={`Add a ${game.name} account on another server`}
                      onClick={() => addAccount(game.key, null)}
                    >
                      <span aria-hidden>+</span> Other
                    </button>
                  </div>
                  {list.length > 0 && (
                    <ol className="onboarding-accounts" aria-label={`${game.name} accounts`}>
                      {list.map((account, index) => {
                        const name = `${game.name} account ${index + 1}`;
                        return (
                          <li key={account.key} className="onboarding-account">
                            <label className="onboarding-field">
                              <span className="text-label text-muted">Server</span>
                              <ServerSelect
                                aria-label={`${name} server`}
                                game={presetGame}
                                value={account.pick}
                                onChange={(pick) => editAccount(game.key, account.key, { pick })}
                              />
                            </label>
                            <label className="onboarding-field">
                              <span className="text-label text-muted">Nickname (optional)</span>
                              <TextInput
                                aria-label={`${name} nickname`}
                                placeholder="Your in-game name"
                                value={account.nickname}
                                onChange={(event) =>
                                  editAccount(game.key, account.key, { nickname: event.target.value })
                                }
                              />
                            </label>
                            {resource && (
                              <label className="onboarding-field">
                                <span className="text-label text-muted">
                                  Current {resource.name} <span className="numeral">(max {resource.cap})</span>
                                </span>
                                <NumInput
                                  aria-label={`${name} current ${resource.name}`}
                                  min={0}
                                  max={resource.cap}
                                  placeholder="Not sure"
                                  value={account.energy}
                                  onChange={(event) =>
                                    editAccount(game.key, account.key, { energy: event.target.value })
                                  }
                                />
                              </label>
                            )}
                            <Btn
                              className="onboarding-account-remove"
                              aria-label={`Remove ${name}`}
                              onClick={() =>
                                editAccounts(game.key, (items) => items.filter((item) => item.key !== account.key))
                              }
                            >
                              Remove
                            </Btn>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>

          {missing && (
            <p className="mt-4 text-meta text-muted" role="status">
              {(accounts[missing.key] ?? []).length
                ? `Choose a server for each ${missing.name} account.`
                : `Tap the server you play ${missing.name} on.`}
            </p>
          )}

          <div className="onboarding-actions">
            <Btn kind="primary" disabled={Boolean(missing)} onClick={finish}>
              Create dashboard
            </Btn>
            <Btn onClick={() => setStep('pick')}>Back</Btn>
          </div>
        </>
      )}
    </main>
  );
}
