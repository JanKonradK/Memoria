import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import {
  BACKDROPS,
  findMarkColour,
  MARK_BACKINGS,
  MARK_COLOURS,
  MARK_SHADINGS,
  type BackdropId,
  type BrandOption,
  type MarkBackingId,
  type MarkColourId,
  type MarkShadingId,
} from '../../brand';
import {
  isLockedByStorePreview,
  STORE_PRO_BADGE,
  STORE_PRO_FEATURES,
  STORE_PRO_HINT,
  type FeatureTier,
} from '../../entitlements';
import { useUI } from '../../ui-store';
import { Logo } from '../Logo';
import { Toggle } from '../ui';
import { SettingRow } from './SettingRow';
import './looks-settings.css';

/**
 * The store preview's gate for one picker. Off (the default) it never stands
 * in the way. On, a Pro option is still offered and focusable, but choosing it
 * leaves the setting as it was and says why, next to the picker.
 */
export function useProGate() {
  const previewStoreLocks = useUI((s) => s.previewStoreLocks);
  const [blocked, setBlocked] = useState(false);
  const noticeId = useId();
  const locked = (tier: FeatureTier) => isLockedByStorePreview(tier, previewStoreLocks);
  return {
    locked,
    noticeId,
    /** Shown only while the preview is on, so turning it off clears it. */
    notice: blocked && previewStoreLocks,
    /** Applies a choice, unless the preview locks it. */
    choose(tier: FeatureTier, apply: () => void) {
      if (locked(tier)) return setBlocked(true);
      setBlocked(false);
      apply();
    },
    /** What a Pro option carries for assistive tech and styling. */
    itemProps(tier: FeatureTier) {
      const isLocked = locked(tier);
      return {
        'aria-disabled': isLocked || undefined,
        'aria-describedby': isLocked ? noticeId : undefined,
        'data-locked': isLocked ? 'true' : undefined,
      } as const;
    },
  };
}

/** The quiet tag on a Pro option. Part of the option's name, so it is read too. */
export function ProBadge({ tier }: { tier: FeatureTier }) {
  if (tier !== 'pro') return null;
  return <span className="pro-pill">{STORE_PRO_BADGE}</span>;
}

/** Why a Pro choice did not apply. A live region from the start, so the words are announced when they arrive. */
export function ProNotice({ id, shown }: { id: string; shown: boolean }) {
  return (
    <p id={id} role="status" className="pro-notice text-meta">
      {shown ? STORE_PRO_HINT : ''}
    </p>
  );
}

const optionName = (label: string, tier: FeatureTier) => (tier === 'pro' ? `${label}, ${STORE_PRO_BADGE}` : label);

/** One row of brand options: a card per option, each showing itself. */
function BrandOptions<Id extends string>({
  label,
  hint,
  options,
  value,
  onChoose,
  preview,
  className = 'brand-grid',
}: {
  label: string;
  hint: string;
  options: readonly (Pick<BrandOption<Id>, 'id' | 'label' | 'tier'> & { blurb?: string })[];
  value: Id;
  onChoose: (id: Id) => void;
  preview: (id: Id) => ReactNode;
  className?: string;
}) {
  const gate = useProGate();
  return (
    <SettingRow label={label} hint={hint} control="below">
      <div className="brand-picker">
        <ToggleGroupPrimitive.Root
          type="single"
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.id === next);
            if (option) gate.choose(option.tier, () => onChoose(option.id));
          }}
          aria-label={label}
          className={className}
        >
          {options.map((option) => (
            <ToggleGroupPrimitive.Item
              key={option.id}
              value={option.id}
              className="brand-option"
              aria-label={optionName(option.label, option.tier)}
              {...gate.itemProps(option.tier)}
            >
              {preview(option.id)}
              <span className="brand-option-name">
                <span className="brand-option-label">{option.label}</span>
                <ProBadge tier={option.tier} />
              </span>
              {option.blurb && <span className="brand-option-blurb say">{option.blurb}</span>}
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
        <ProNotice id={gate.noticeId} shown={gate.notice} />
      </div>
    </SettingRow>
  );
}

/** The mark as chosen, on the chosen backdrop, with what each choice is called. */
export function BrandStage() {
  const markColour = useUI((s) => s.markColour);
  const markShading = useUI((s) => s.markShading);
  const markBacking = useUI((s) => s.markBacking);
  const backdrop = useUI((s) => s.backdrop);
  const colour = findMarkColour(markColour);
  const shading = MARK_SHADINGS.find((option) => option.id === markShading)!;
  const tile = MARK_BACKINGS.find((option) => option.id === markBacking)!;
  const ground = BACKDROPS.find((option) => option.id === backdrop)!;
  const pro = [colour, shading, tile, ground].filter((choice) => choice.tier === 'pro').length;
  return (
    <div className="brand-stage-card" role="group" aria-label="Your mark">
      <div className="brand-stage backdrop-preview" data-backdrop={backdrop} data-backing={markBacking}>
        <Logo className="brand-stage-logo" interactive />
      </div>
      <div className="brand-stage-text">
        <p className="text-body font-semibold text-fg">{colour.label}</p>
        <p className="text-meta text-muted">
          {shading.label} · {tile.label} · {ground.label}
        </p>
        <p className="brand-stage-tier text-meta text-fg-soft">
          {pro === 0 ? (
            'Every choice here is free'
          ) : (
            <>
              <span className="pro-pill">{STORE_PRO_BADGE}</span>{' '}
              {pro === 1 ? 'One choice here is' : `${pro} choices here are`} Pro, free to use during the preview
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Settings → Appearance: the mark's stage, then its colour, lighting and tile, and the app's backdrop. */
export function MarkPicker() {
  const markColour = useUI((s) => s.markColour);
  const markShading = useUI((s) => s.markShading);
  const markBacking = useUI((s) => s.markBacking);
  const backdrop = useUI((s) => s.backdrop);
  const setMarkColour = useUI((s) => s.setMarkColour);
  const setMarkShading = useUI((s) => s.setMarkShading);
  const setMarkBacking = useUI((s) => s.setMarkBacking);
  const setBackdrop = useUI((s) => s.setBackdrop);
  return (
    <>
      <BrandStage />
      <BrandOptions<MarkColourId>
        label="Logo colour"
        hint="The mark's metal, in the rail, the intro and here."
        options={MARK_COLOURS}
        value={markColour}
        onChoose={setMarkColour}
        className="brand-grid brand-grid-compact"
        preview={(id) => (
          <span
            aria-hidden
            className="mark-colour-swatch"
            data-colour={id}
            style={{ background: findMarkColour(id).previewCss } as CSSProperties}
          />
        )}
      />
      <BrandOptions<MarkShadingId>
        label="Logo shading"
        hint="How the light falls on it."
        options={MARK_SHADINGS}
        value={markShading}
        onChoose={setMarkShading}
        preview={(id) => (
          <span aria-hidden className="brand-option-preview">
            <Logo shading={id} backing="bare" className="brand-option-logo" />
          </span>
        )}
      />
      <BrandOptions<MarkBackingId>
        label="Logo tile"
        hint="Open, or set on a squircle."
        options={MARK_BACKINGS}
        value={markBacking}
        onChoose={setMarkBacking}
        preview={(id) => (
          <span aria-hidden className="brand-option-preview">
            <Logo backing={id} className="brand-option-logo" />
          </span>
        )}
      />
      <BrandOptions<BackdropId>
        label="Backdrop"
        hint="Laid over the look's ground, behind every page."
        options={BACKDROPS}
        value={backdrop}
        onChoose={setBackdrop}
        preview={(id) => <span aria-hidden className="backdrop-preview backdrop-swatch" data-backdrop={id} />}
      />
    </>
  );
}

/** The store tiers, previewed: off, everything works; on, Pro options say so instead of applying. */
export function StorePreviewRow() {
  const previewStoreLocks = useUI((s) => s.previewStoreLocks);
  const setPreviewStoreLocks = useUI((s) => s.setPreviewStoreLocks);
  const hintId = useId();
  return (
    <>
      <SettingRow
        label="Preview Store locks"
        hint={
          <span id={hintId}>
            Everything stays usable while this is off. On, it shows which looks, palettes, logo finishes and backdrops
            would come with Memoria Pro on the Microsoft Store and Google Play. Nothing you already use changes.
          </span>
        }
      >
        <Toggle
          checked={previewStoreLocks}
          ariaLabel="Preview Store locks"
          ariaDescribedBy={hintId}
          onChange={setPreviewStoreLocks}
        />
      </SettingRow>
      <SettingRow label="Memoria Pro" hint="Planned for the Microsoft Store and Google Play releases." control="below">
        <details className="pro-features">
          <summary className="text-meta font-semibold text-fg-soft">What Pro includes</summary>
          <ul className="pro-feature-list">
            {STORE_PRO_FEATURES.map((feature) => (
              <li key={feature.id} className="pro-feature">
                <span className="text-meta font-semibold text-fg">{feature.label}</span>
                <span className="text-meta text-muted">{feature.blurb}</span>
                {feature.status === 'planned' && <span className="pro-feature-planned text-caption">Planned</span>}
              </li>
            ))}
          </ul>
        </details>
      </SettingRow>
    </>
  );
}
