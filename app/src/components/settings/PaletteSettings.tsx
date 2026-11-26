import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

import { accentChoices, accentSwatch, FAMILIES, findPalette, resolveAccent, surfacesOf } from '../../palettes';
import { accentFor, useUI } from '../../ui-store';
import { Segmented, Tooltip } from '../ui';
import { tierForPalette } from '../../entitlements';
import { ProBadge, ProNotice, useProGate } from './MarkPicker';
import { SettingRow } from './SettingRow';

/** Colour palettes in the manner of an editor's colour themes, and the accent within one. */
export function PaletteSettings() {
  const theme = useUI((s) => s.theme);
  const palette = useUI((s) => s.palette);
  const accents = useUI((s) => s.accents);
  const setPalette = useUI((s) => s.setPalette);
  const setAccent = useUI((s) => s.setAccent);
  const { family, flavour } = findPalette(palette);
  const accent = resolveAccent(family, accentFor(accents, palette));
  const accentName = accentChoices(family).find((choice) => choice.id === accent)?.name;
  const gate = useProGate();

  return (
    <>
      <SettingRow
        label="Colours"
        hint={
          family.flavours.length > 1
            ? `Dark uses ${flavour.name}, light uses ${family.lightName}. Light or dark follows Theme.`
            : 'Light or dark follows Theme.'
        }
        control="below"
      >
        <div className="palette-settings">
          <ToggleGroupPrimitive.Root
            type="single"
            value={family.id}
            onValueChange={(next) => {
              const chosen = FAMILIES.find((candidate) => candidate.id === next);
              if (chosen) gate.choose(tierForPalette(chosen.flavours[0]!.id), () => setPalette(chosen.flavours[0]!.id));
            }}
            aria-label="Colour palette"
            className="palette-grid"
          >
            {FAMILIES.map((candidate) => {
              const shown = candidate.id === family.id ? flavour.id : candidate.flavours[0]!.id;
              const ground = surfacesOf(shown, theme).ground;
              const candidateAccent = resolveAccent(candidate, accentFor(accents, shown));
              const dots = [
                candidateAccent,
                ...candidate.accents.map((choice) => choice.id).filter((id) => id !== candidateAccent),
              ].slice(0, 4);
              return (
                <ToggleGroupPrimitive.Item
                  key={candidate.id}
                  value={candidate.id}
                  className="palette-option"
                  {...gate.itemProps(tierForPalette(shown))}
                >
                  <span aria-hidden className="palette-preview" style={{ background: ground }}>
                    <span className="palette-preview-text" style={{ color: accentSwatch(shown, theme, 'mono') }}>
                      Aa
                    </span>
                    <span className="palette-preview-dots">
                      {dots.map((id) => (
                        <span key={id} style={{ background: accentSwatch(shown, theme, id) }} />
                      ))}
                    </span>
                  </span>
                  <span className="palette-option-name text-meta font-semibold">
                    {candidate.name}
                    <ProBadge tier={tierForPalette(shown)} />
                  </span>
                </ToggleGroupPrimitive.Item>
              );
            })}
          </ToggleGroupPrimitive.Root>
          <ProNotice id={gate.noticeId} shown={gate.notice} />
          {family.flavours.length > 1 && (
            <Segmented
              ariaLabel={`${family.name} flavour`}
              options={family.flavours.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              value={flavour.id}
              onChange={setPalette}
            />
          )}
        </div>
      </SettingRow>
      <SettingRow label="Accent" hint={`${accentName}. Marks the selected tab, focus and links.`} control="below">
        <ToggleGroupPrimitive.Root
          type="single"
          value={accent}
          onValueChange={(next) => next && setAccent(next)}
          aria-label="Accent colour"
          className="accent-swatches"
        >
          {accentChoices(family).map((choice) => (
            <ToggleGroupPrimitive.Item
              key={choice.id}
              value={choice.id}
              aria-label={choice.name}
              className="accent-swatch"
            >
              {/* On the swatch, not the item: a tip's data-state would replace the item's on/off. */}
              <Tooltip content={choice.name}>
                <span aria-hidden style={{ background: accentSwatch(flavour.id, theme, choice.id) }} />
              </Tooltip>
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      </SettingRow>
    </>
  );
}
