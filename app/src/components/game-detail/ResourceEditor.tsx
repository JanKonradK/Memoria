import { useState } from 'react';
import type { Game, Resource, ResourceKind } from '@technogg/shared';
import { effectiveReserveRegenMinutes } from '@technogg/shared';
import { useApp } from '../../store';
import { intOr } from '../../util';
import { RESOURCE_ICON_KEYS, ResourceIcon } from '../ResourceIcon';
import { Btn, Field, NumInput, Select, TextInput } from '../ui';

const RESOURCE_KINDS: ResourceKind[] = ['regen', 'weekly', 'counter'];

export function ResourceEditor({ game, resources }: { game: Game; resources: Resource[] }) {
  const app = useApp();
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [reserveOpen, setReserveOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {resources.map((r) => {
        const kind = r.kind ?? 'regen';
        const showReserveFields = r.reserveCap > 0 || reserveOpen[r.id];

        return (
          <div key={r.id} className="rounded-ui-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIconPickerFor((cur) => (cur === r.id ? null : r.id))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg bg-white/[0.06] ring-1 ring-white/10 transition hover:bg-white/10 sm:h-9 sm:w-9"
                style={{ boxShadow: iconPickerFor === r.id ? `inset 0 0 0 1.5px ${game.color}` : undefined }}
                aria-label={`Icon for ${r.name}`}
              >
                <ResourceIcon iconKey={r.icon} color={game.color} size={18} />
              </button>
              <TextInput
                className="min-w-32 flex-1"
                value={r.name}
                aria-label="Resource name"
                onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, name: e.target.value })}
              />
              <Select
                className="w-32 shrink-0"
                value={kind}
                aria-label={`Kind for ${r.name}`}
                onChange={(e) =>
                  app.upsertResource({ id: r.id, gameId: game.id, kind: e.target.value as ResourceKind })
                }
              >
                {RESOURCE_KINDS.map((resourceKind) => (
                  <option key={resourceKind} value={resourceKind}>
                    {resourceKind}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => app.deleteResource(r.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg text-title text-dim transition hover:bg-rose-400/10 hover:text-rose-400 sm:h-9 sm:w-9"
                aria-label={`Delete ${r.name}`}
              >
                ✕
              </button>
            </div>

            {iconPickerFor === r.id && (
              <div className="mt-2 flex flex-wrap gap-1.5 rounded-ui-xl bg-white/[0.04] p-2 ring-1 ring-white/10">
                {RESOURCE_ICON_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      app.upsertResource({ id: r.id, gameId: game.id, icon: key });
                      setIconPickerFor(null);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-ui-lg bg-white/[0.06] ring-1 transition hover:bg-white/10 sm:h-9 sm:w-9"
                    style={{
                      boxShadow:
                        r.icon === key ? `inset 0 0 0 1.5px ${game.color}` : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                    }}
                    aria-label={key}
                  >
                    <ResourceIcon iconKey={key} color={game.color} size={18} />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Cap">
                <NumInput
                  value={String(r.cap)}
                  onChange={(e) => app.upsertResource({ id: r.id, gameId: game.id, cap: intOr(e.target.value, r.cap) })}
                />
              </Field>
              <Field label="Min/pt">
                <NumInput
                  value={String(r.regenMinutes)}
                  disabled={kind !== 'regen'}
                  onChange={(e) =>
                    app.upsertResource({
                      id: r.id,
                      gameId: game.id,
                      regenMinutes: intOr(e.target.value, r.regenMinutes),
                    })
                  }
                />
              </Field>
              {!showReserveFields && (
                <div className="flex items-end sm:col-start-3">
                  <Btn className="w-full" onClick={() => setReserveOpen((cur) => ({ ...cur, [r.id]: true }))}>
                    + Add reserve
                  </Btn>
                </div>
              )}

              {showReserveFields && (
                <div className="col-span-full mt-2 grid grid-cols-1 gap-3 border-t border-white/[0.08] pt-2 sm:grid-cols-3">
                  <Field label="Reserve cap">
                    <NumInput
                      value={String(r.reserveCap)}
                      onChange={(e) =>
                        app.upsertResource({
                          id: r.id,
                          gameId: game.id,
                          reserveCap: intOr(e.target.value, r.reserveCap),
                        })
                      }
                    />
                  </Field>
                  <Field label="Reserve label">
                    <TextInput
                      value={r.reserveLabel ?? ''}
                      onChange={(e) =>
                        app.upsertResource({ id: r.id, gameId: game.id, reserveLabel: e.target.value || undefined })
                      }
                    />
                  </Field>
                  <Field label="Rsv min/pt">
                    <NumInput
                      value={r.reserveRegenMinutes == null ? '' : String(r.reserveRegenMinutes)}
                      placeholder={String(effectiveReserveRegenMinutes(r))}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        app.upsertResource({
                          id: r.id,
                          gameId: game.id,
                          reserveRegenMinutes:
                            value === '' ? undefined : Math.max(1, intOr(value, effectiveReserveRegenMinutes(r))),
                        });
                      }}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <Btn onClick={() => app.upsertResource({ gameId: game.id, name: 'Energy' })}>+ Resource</Btn>
      <p className="text-label text-dim">
        Min/pt = minutes per point of regen. 0 = doesn't regenerate. Rsv min/pt = minutes per reserve point once the bar
        is capped (defaults to double Min/pt — reserve fills at half speed).
      </p>
    </div>
  );
}
