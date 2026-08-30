import { useState } from 'react';
import type { Game, Resource, ResourceKind } from '@memoria/shared';
import { effectiveReserveRegenMinutes } from '@memoria/shared';
import { useApp } from '../../store';
import { intOr } from '../../util';
import { Btn, Field, NumInput, Select, TextInput } from '../ui';

const RESOURCE_KINDS: Array<{ value: ResourceKind; label: string }> = [
  { value: 'regen', label: 'Regenerates over time' },
  { value: 'weekly', label: 'Refills at weekly reset' },
  { value: 'counter', label: 'Manual count (no regen)' },
];

export function ResourceEditor({ game, resources }: { game: Game; resources: Resource[] }) {
  const upsertResource = useApp((store) => store.upsertResource);
  const deleteResource = useApp((store) => store.deleteResource);
  const [reserveOpen, setReserveOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {resources.map((r) => {
        const kind = r.kind ?? 'regen';
        const showReserveFields = r.reserveCap > 0 || reserveOpen[r.id];

        return (
          <div key={r.id} className="rounded-ui-xl bg-fill-1 p-3 ring-1 ring-line-hairline">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-32 flex-[2_1_10rem]">
                <TextInput
                  className="sm:!min-h-8 sm:!py-1"
                  value={r.name}
                  aria-label="Resource name"
                  onChange={(e) => upsertResource({ id: r.id, gameId: game.id, name: e.target.value })}
                />
              </Field>
              <Field label="Kind" className="min-w-52 flex-[2_1_13rem]">
                <Select
                  className="sm:!min-h-8 sm:!py-1"
                  value={kind}
                  aria-label={`Resource kind for ${r.name}`}
                  onChange={(e) => upsertResource({ id: r.id, gameId: game.id, kind: e.target.value as ResourceKind })}
                >
                  {RESOURCE_KINDS.map((resourceKind) => (
                    <option key={resourceKind.value} value={resourceKind.value}>
                      {resourceKind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cap" className="w-24 shrink-0">
                <NumInput
                  className="sm:!min-h-8 sm:!py-1"
                  value={String(r.cap)}
                  onChange={(e) => upsertResource({ id: r.id, gameId: game.id, cap: intOr(e.target.value, r.cap) })}
                />
              </Field>
              <Field label="Minutes per point" className="w-40 shrink-0">
                <NumInput
                  className="sm:!min-h-8 sm:!py-1"
                  value={String(r.regenMinutes)}
                  disabled={kind !== 'regen'}
                  onChange={(e) =>
                    upsertResource({
                      id: r.id,
                      gameId: game.id,
                      regenMinutes: intOr(e.target.value, r.regenMinutes),
                    })
                  }
                />
              </Field>
              {!showReserveFields && (
                <Btn
                  className="!min-h-11 shrink-0 sm:!min-h-8"
                  onClick={() => setReserveOpen((cur) => ({ ...cur, [r.id]: true }))}
                >
                  + Add reserve
                </Btn>
              )}
              <button
                type="button"
                onClick={() => deleteResource(r.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg text-title text-dim transition hover:bg-danger/10 hover:text-danger sm:h-8 sm:w-8"
                aria-label={`Delete ${r.name}`}
              >
                ✕
              </button>
            </div>

            {showReserveFields && (
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-hairline pt-2">
                <Field label="Reserve cap" className="w-28 shrink-0">
                  <NumInput
                    className="sm:!min-h-8 sm:!py-1"
                    value={String(r.reserveCap)}
                    onChange={(e) =>
                      upsertResource({
                        id: r.id,
                        gameId: game.id,
                        reserveCap: intOr(e.target.value, r.reserveCap),
                      })
                    }
                  />
                </Field>
                <Field label="Reserve label" className="min-w-36 flex-1">
                  <TextInput
                    className="sm:!min-h-8 sm:!py-1"
                    value={r.reserveLabel ?? ''}
                    onChange={(e) =>
                      upsertResource({ id: r.id, gameId: game.id, reserveLabel: e.target.value || undefined })
                    }
                  />
                </Field>
                <Field label="Reserve minutes per point" className="w-52 shrink-0">
                  <NumInput
                    className="sm:!min-h-8 sm:!py-1"
                    value={r.reserveRegenMinutes == null ? '' : String(r.reserveRegenMinutes)}
                    placeholder={String(effectiveReserveRegenMinutes(r))}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      upsertResource({
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
        );
      })}
      <Btn className="!min-h-11 sm:!min-h-8" onClick={() => upsertResource({ gameId: game.id, name: 'Energy' })}>
        + Resource
      </Btn>
      <p className="text-label text-dim">
        Minutes per point sets the regeneration rate. Use 0 for a resource that does not regenerate. Reserve minutes per
        point applies after the main resource reaches its cap. If left blank, it uses twice the main rate, so the
        reserve fills at half speed.
      </p>
    </div>
  );
}
