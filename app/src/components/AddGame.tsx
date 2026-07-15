import { useState } from 'react';
import type { GamePreset } from '@technogg/shared';
import { PRESETS, SERVER_TZ_OPTIONS } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { intOr, tint } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, GameBadge, NumInput, Select, TextInput } from './ui';

export function AddGameSheet({ open }: { open: boolean }) {
  const addGameFromPreset = useApp((s) => s.addGameFromPreset);
  const addBlankGame = useApp((s) => s.addBlankGame);
  const closeSheet = useUI((s) => s.closeSheet);
  const openSheet = useUI((s) => s.openSheet);

  const [picked, setPicked] = useState<GamePreset | null>(null);
  const [tz, setTz] = useState('');
  const [caps, setCaps] = useState<Record<number, string>>({});
  const [customName, setCustomName] = useState('');

  const reset = () => {
    setPicked(null);
    setTz('');
    setCaps({});
    setCustomName('');
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

  const createCustom = () => {
    const id = addBlankGame(customName.trim() || 'New game');
    reset();
    openSheet({ kind: 'game', gameId: id });
  };

  return (
    <Sheet open={open} onClose={close} wide title={picked ? `Add ${picked.name}` : 'Add a game'}>
      {!picked ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPicked(p);
                  setTz(p.tz);
                }}
                className="flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition hover:brightness-125 active:scale-95"
                style={{ background: tint(p.color, 0.08), boxShadow: `inset 0 0 0 1px ${tint(p.color, 0.25)}` }}
              >
                <GameBadge short={p.short} color={p.color} color2={p.color2} size="lg" />
                <span>
                  <span className="block text-sm font-bold text-slate-100">{p.name}</span>
                  <span className="block text-[11px] text-slate-400">{p.resources.map((r) => r.name).join(' + ')}</span>
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
      ) : (
        <>
          {picked.notes && (
            <p className="mb-4 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-400/20">
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
            <p className="text-[11px] text-slate-500">
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
      )}
    </Sheet>
  );
}
