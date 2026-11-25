import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useEffect, type CSSProperties } from 'react';
import type { Game } from '@memoria/shared';

import { gameInk } from '../../game-color';
import { loadLookFaces, LOOKS, type Detail, type LookId } from '../../looks';
import { useApp } from '../../store';
import { useGround } from '../../theme';
import { useUI } from '../../ui-store';
import { GameLogo } from '../GameLogo';
import { NavIcon } from '../../nav-icons';
import { useIdentityColors } from '../roster';
import { Segmented, Toggle } from '../ui';
import { useMediaQuery } from '../../hooks';
import { buzz } from '../../haptics';
import { SettingRow } from './SettingRow';
import { ProBadge, ProNotice, useProGate } from './MarkPicker';
import { tierForLook } from '../../entitlements';
import '../today/today-steps.css';
import './looks-settings.css';

const PLACE_ICONS = ['calendar', 'games', 'today', 'notes', 'settings'] as const;

/** Stand-ins when there are no games yet, so every card still shows a row. */
const SAMPLE: Pick<Game, 'name' | 'short' | 'color' | 'color2' | 'color3' | 'titleFont'>[] = [
  { name: 'First Game', short: 'One', color: '#ff6fae', color2: '#7aa2ff' },
  { name: 'Second Game', short: 'Two', color: '#e8c66a', color2: '#3d6bd8' },
];

/**
 * A working miniature of one look: Today's first rows and the dock, drawn with
 * the app's own classes under that look, in the player's palette, theme and
 * games. Decorative: the card's label says which look it is.
 */
function LookPreview({ look, games }: { look: LookId; games: { logo: (typeof SAMPLE)[number]; ink: string }[] }) {
  const [first, second] = games;
  return (
    <span aria-hidden className="look-preview" data-look={look}>
      <span className="look-preview-page">
        <span className="page-title look-preview-title">
          <span className="look-preview-h1">Today</span>
        </span>
        <span className="today-steps-rule look-preview-rule">
          <span className="look-preview-h2" data-tone="rose">
            Within the hour
          </span>
        </span>
        <span
          className="today-step look-preview-step"
          data-tone="rose"
          style={{ '--step-ink': first!.ink } as CSSProperties}
        >
          <GameLogo game={first!.logo} size={26} />
          <span className="look-preview-text">
            <span className="today-step-what">{first!.logo.short}</span>
            <span className="meter look-preview-meter" style={{ '--meter-ink': first!.ink } as CSSProperties}>
              <span className="meter-fill" style={{ background: first!.ink, transform: 'scaleX(1)' }} />
            </span>
          </span>
          <span className="today-step-when" data-tone="rose">
            <b>Now</b>
          </span>
        </span>
        <span className="today-step look-preview-step" style={{ '--step-ink': second!.ink } as CSSProperties}>
          <GameLogo game={second!.logo} size={26} />
          <span className="look-preview-text">
            <span className="today-step-what">{second!.logo.short}</span>
            <span className="meter look-preview-meter" style={{ '--meter-ink': second!.ink } as CSSProperties}>
              <span className="meter-fill" style={{ background: second!.ink, transform: 'scaleX(0.62)' }} />
            </span>
          </span>
          <span className="today-step-when" data-tone="warn">
            <b>3h</b>
          </span>
        </span>
      </span>
      <span className="look-preview-dock">
        {PLACE_ICONS.map((glyph, index) => (
          <span key={glyph} className="look-preview-place" data-current={index === 2 || undefined}>
            <NavIcon glyph={glyph} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Every look as a card showing itself; choosing one applies it at once. */
export function LookPicker() {
  const look = useUI((s) => s.look);
  const setLook = useUI((s) => s.setLook);
  const ground = useGround();
  const allGames = useApp((s) => s.state.games);
  const identity = useIdentityColors(allGames);
  const live = allGames
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 2)
    .map((game) => ({ ...game, ...(identity[game.id] ?? {}) }));
  const picked = [...live, ...SAMPLE].slice(0, 2).map((logo) => ({ logo, ink: gameInk(logo, ground) }));
  const gate = useProGate();

  // The cards draw every look, so every look's faces are wanted here.
  useEffect(() => {
    for (const candidate of LOOKS) void loadLookFaces(candidate.id);
  }, []);

  return (
    <SettingRow label="Look" control="below">
      <div className="brand-picker">
        <ToggleGroupPrimitive.Root
          type="single"
          value={look}
          onValueChange={(next) => {
            if (next) gate.choose(tierForLook(next as LookId), () => setLook(next as LookId));
          }}
          aria-label="Look"
          className="look-grid"
        >
          {LOOKS.map((candidate) => (
            <ToggleGroupPrimitive.Item
              key={candidate.id}
              value={candidate.id}
              className="look-option"
              {...gate.itemProps(tierForLook(candidate.id))}
            >
              <LookPreview look={candidate.id} games={picked} />
              <span className="look-option-name">
                {candidate.name}
                <ProBadge tier={tierForLook(candidate.id)} />
              </span>
              <span className="look-option-blurb say">{candidate.blurb}</span>
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
        <ProNotice id={gate.noticeId} shown={gate.notice} />
      </div>
    </SettingRow>
  );
}

const DETAIL_OPTIONS: { value: Detail; label: string }[] = [
  { value: 'elaborate', label: 'Elaborate' },
  { value: 'minimal', label: 'Minimal' },
];

/** Words or no words: Minimal keeps the facts and the controls. */
export function DetailRow() {
  const detail = useUI((s) => s.detail);
  const setDetail = useUI((s) => s.setDetail);
  return (
    <SettingRow label="Detail" hint="Minimal hides explanations and labels; figures, names and times stay.">
      <Segmented ariaLabel="Detail" options={DETAIL_OPTIONS} value={detail} onChange={setDetail} />
    </SettingRow>
  );
}

/** Buzzes for swipes, scrubs and ticks. Only a touch screen has a motor to set. */
export function VibrationRow() {
  const touch = useMediaQuery('(pointer: coarse)');
  const vibration = useUI((s) => s.vibration);
  const setVibration = useUI((s) => s.setVibration);
  if (!touch) return null;
  return (
    <SettingRow label="Vibration" hint="A short buzz when a swipe completes, a bar is dragged or a tick is tapped.">
      <Toggle
        checked={vibration}
        ariaLabel="Vibration"
        onChange={(on) => {
          setVibration(on);
          if (on) buzz('success');
        }}
      />
    </SettingRow>
  );
}
