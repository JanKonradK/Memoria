import { useState } from 'react';
import type { Game, GamePreset } from '@void/shared';
import { PRESETS, presetForGame, SERVER_TZ_OPTIONS } from '@void/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { intOr, tint } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, GameBadge, NumInput, SectionTitle, Select, TextInput } from './ui';

export function AddGameSheet({ open }: { open: boolean }) {
  const games = useApp((s) => s.state.games);
  const addGameFromPreset = useApp((s) => s.addGameFromPreset);
  const addBlankGame = useApp((s) => s.addBlankGame);
  const setEnergy = useApp((s) => s.setEnergy);
  const closeSheet = useUI((s) => s.closeSheet);
  const openSheet = useUI((s) => s.openSheet);

  const [picked, setPicked] = useState<GamePreset | null>(null);
  const [sourceGame, setSourceGame] = useState<Game | null>(null);
  const [sourcePreset, setSourcePreset] = useState<GamePreset | null>(null);
  const [tz, setTz] = useState('');
  const [caps, setCaps] = useState<Record<number, string>>({});
  const [customName, setCustomName] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [short, setShort] = useState('');
  const [energy, setEnergyInput] = useState('');

  const trackedPresetGames = games.flatMap((game) => {
    if (game.deleted) return [];
    const preset = presetForGame(game);
    return preset ? [{ game, preset }] : [];
  });
  const sourceEnergyResource = sourcePreset?.resources.find((resource) => resource.regenMinutes > 0);

  const reset = () => {
    setPicked(null);
    setSourceGame(null);
    setSourcePreset(null);
    setTz('');
    setCaps({});
    setCustomName('');
    setAccountLabel('');
    setShort('');
    setEnergyInput('');
  };
  const close = () => {
    reset();
    closeSheet();
  };

  const confirm = () => {
    if (!picked) return;
    const capOverrides: Record<number, number> = {};
    for (const [i, v] of Object.entries(caps)) {
      const n = intOr(v, 0);
      if (n > 0) capOverrides[Number(i)] = n;
    }
    addGameFromPreset(picked, { tz: tz || undefined, capOverrides });
    close();
  };

  const confirmAccount = () => {
    if (!sourceGame || !sourcePreset) return;
    const gameId = addGameFromPreset(sourcePreset, {
      tz: tz || sourceGame.tz,
      accountLabel: accountLabel.trim() || undefined,
      short: short.trim() || sourceGame.short,
      name: sourceGame.name,
    });
    const entered = energy.trim();
    if (entered !== '') {
      const resource = useApp
        .getState()
        .state.resources.find((item) => item.gameId === gameId && !item.deleted && item.regenMinutes > 0);
      if (resource) setEnergy(resource.id, Math.min(resource.cap, Math.max(0, intOr(entered, 0))));
    }
    close();
  };

  const createCustom = () => {
    const id = addBlankGame(customName.trim() || 'New game');
    reset();
    openSheet({ kind: 'game', gameId: id });
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      wide
      title={sourceGame ? `Add ${sourceGame.name} account` : picked ? `Add ${picked.name}` : 'Add a game'}
    >
      {!picked && !sourceGame ? (
        <>
          {trackedPresetGames.length > 0 && (
            <>
              <SectionTitle>Add another account</SectionTitle>
              <div className="space-y-2">
                {trackedPresetGames.map(({ game, preset }) => (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => {
                      setSourceGame(game);
                      setSourcePreset(preset);
                      setTz(game.tz);
                      setShort(game.short);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-ui-lg bg-fill-1 px-3 py-2 text-left ring-1 ring-line-hairline transition hover:bg-fill-3 active:scale-95 sm:min-h-9"
                  >
                    <GameBadge short={game.short} color={game.color} color2={game.color2} />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-bold text-fg-soft">{game.name}</span>
                      {game.accountLabel && (
                        <span className="block truncate text-meta text-muted">{game.accountLabel}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <SectionTitle>Add a new game</SectionTitle>
            </>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPicked(p);
                  setTz(p.tz);
                }}
                className="flex items-center gap-3 rounded-ui-xl p-3 text-left ring-1 transition hover:brightness-125 active:scale-95"
                style={{ background: tint(p.color, 0.08), boxShadow: `inset 0 0 0 1px ${tint(p.color, 0.25)}` }}
              >
                <GameBadge short={p.short} color={p.color} color2={p.color2} size="lg" />
                <span>
                  <span className="block text-body font-bold text-fg-soft">{p.name}</span>
                  <span className="block text-label text-muted">{p.resources.map((r) => r.name).join(' + ')}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <TextInput
              placeholder="Custom game name…"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <Btn onClick={createCustom} className="shrink-0">
              + Custom
            </Btn>
          </div>
        </>
      ) : sourceGame && sourcePreset ? (
        <>
          <div className="space-y-3">
            <Field label="Account label">
              <TextInput
                placeholder="e.g. Alt NA"
                value={accountLabel}
                onChange={(event) => setAccountLabel(event.target.value)}
              />
              <span className="mt-1 block text-meta text-dim">
                Shown next to the game name so you can tell your accounts apart.
              </span>
            </Field>
            <Field label="Badge">
              <TextInput maxLength={4} value={short} onChange={(event) => setShort(event.target.value)} />
              <span className="mt-1 block text-meta text-dim">
                Two to four characters. Give this account its own badge.
              </span>
            </Field>
            <Field label="Server timezone">
              <Select value={tz} onChange={(event) => setTz(event.target.value)}>
                {SERVER_TZ_OPTIONS.map((option) => (
                  <option key={option.tz} value={option.tz}>
                    {option.label}
                  </option>
                ))}
                {!SERVER_TZ_OPTIONS.some((option) => option.tz === sourceGame.tz) && (
                  <option value={sourceGame.tz}>{sourceGame.tz}</option>
                )}
              </Select>
            </Field>
            {sourceEnergyResource && (
              <Field label={`Current ${sourceEnergyResource.name}`}>
                <NumInput min={0} value={energy} onChange={(event) => setEnergyInput(event.target.value)} />
              </Field>
            )}
          </div>
          <div className="mt-5 flex gap-2">
            <Btn
              onClick={() => {
                setSourceGame(null);
                setSourcePreset(null);
                setTz('');
                setAccountLabel('');
                setShort('');
                setEnergyInput('');
              }}
            >
              ← Back
            </Btn>
            <Btn kind="primary" className="flex-1" onClick={confirmAccount}>
              Add account
            </Btn>
          </div>
        </>
      ) : picked ? (
        <>
          {picked.notes && (
            <p className="mb-4 rounded-ui-lg bg-warn/10 px-3 py-2 text-meta text-warn-fg ring-1 ring-warn/20">
              {picked.notes}
            </p>
          )}
          <div className="space-y-3">
            <Field label="Server timezone">
              <Select value={tz} onChange={(e) => setTz(e.target.value)}>
                {SERVER_TZ_OPTIONS.map((o) => (
                  <option key={o.tz} value={o.tz}>
                    {o.label}
                  </option>
                ))}
                {!SERVER_TZ_OPTIONS.some((o) => o.tz === picked.tz) && <option value={picked.tz}>{picked.tz}</option>}
              </Select>
            </Field>
            {picked.resources.map((r, i) => (
              <Field key={r.name} label={`${r.name} cap${r.promptCap ? ' (yours!)' : ''}`}>
                <NumInput
                  value={caps[i] ?? String(r.cap)}
                  onChange={(e) => setCaps((c) => ({ ...c, [i]: e.target.value }))}
                />
              </Field>
            ))}
            <p className="text-label text-dim">
              Reset: {String(picked.dailyResetHour).padStart(2, '0')}:00 server · everything is editable later in the
              game editor.
            </p>
          </div>
          <div className="mt-5 flex gap-2">
            <Btn onClick={() => setPicked(null)}>← Back</Btn>
            <Btn kind="primary" className="flex-1" onClick={confirm}>
              Add {picked.short}
            </Btn>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
