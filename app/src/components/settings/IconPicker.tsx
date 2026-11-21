import * as Popover from '@radix-ui/react-dropdown-menu';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import type { Game } from '@memoria/shared';
import { GAME_GLYPHS, GLYPH_IDS, LOGO_STYLES, type GlyphId, type LogoStyle } from '../../game-glyphs';
import { ICON_SETS, NavIcon, type NavGlyph } from '../../nav-icons';
import { useApp } from '../../store';
import { useUI } from '../../ui-store';
import { GameLogo, logoKey } from '../GameLogo';
import { useIdentityColors } from '../roster';
import { Select } from '../ui';
import { SettingRow } from './SettingRow';
import './looks-settings.css';

const PREVIEW: NavGlyph[] = ['today', 'calendar', 'notes', 'games', 'settings'];
const SAMPLE = { name: 'Sample Game', short: 'SG', color: '#e8c66a', color2: '#3d6bd8' };

/** The places' icon sets, each shown as its five icons; choosing one applies it everywhere. */
export function IconSetRow() {
  const iconSet = useUI((s) => s.iconSet);
  const setIconSet = useUI((s) => s.setIconSet);
  return (
    <SettingRow label="Icons" control="below">
      <ToggleGroupPrimitive.Root
        type="single"
        value={iconSet}
        onValueChange={(next) => {
          if (next) setIconSet(next as typeof iconSet);
        }}
        aria-label="Icons"
        className="icon-set-grid"
      >
        {ICON_SETS.map((set) => (
          <ToggleGroupPrimitive.Item key={set.id} value={set.id} className="icon-set-option">
            <span aria-hidden className="icon-set-preview">
              {PREVIEW.map((glyph, index) => (
                <span key={glyph} data-current={index === 0 || undefined}>
                  <NavIcon glyph={glyph} set={set.id} />
                </span>
              ))}
            </span>
            <span className="icon-set-name">{set.name}</span>
            <span className="icon-set-blurb say">{set.blurb}</span>
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
    </SettingRow>
  );
}

/**
 * How game icons look: one style for every game, and any game's own choice
 * over it (its style, and its symbol when it wears one).
 */
export function GameIconsRow() {
  const logoStyle = useUI((s) => s.logoStyle);
  const setLogoStyle = useUI((s) => s.setLogoStyle);
  const gameIcons = useUI((s) => s.gameIcons);
  const setGameIcon = useUI((s) => s.setGameIcon);
  const all = useApp((s) => s.state.games);
  const identity = useIdentityColors(all);
  const games = all
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort)
    .map((game) => ({ ...game, ...(identity[game.id] ?? {}) }));
  // Every account of one game shares its coin, so each game is listed once.
  const seen = new Set<string>();
  const distinct = games.filter((game) => {
    const key = logoKey(game);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sample = distinct[0] ?? SAMPLE;

  return (
    <>
      <SettingRow label="Game icons" control="below">
        <ToggleGroupPrimitive.Root
          type="single"
          value={logoStyle}
          onValueChange={(next) => {
            if (next) setLogoStyle(next as LogoStyle);
          }}
          aria-label="Game icons"
          className="icon-set-grid"
        >
          {LOGO_STYLES.map((style) => (
            <ToggleGroupPrimitive.Item key={style.id} value={style.id} className="icon-set-option">
              <span aria-hidden className="logo-style-preview">
                <GameLogo game={sample} size={40} variant={style.id} glyph="star" />
                {distinct[1] && <GameLogo game={distinct[1]} size={40} variant={style.id} glyph="moon" />}
              </span>
              <span className="icon-set-name">{style.name}</span>
              <span className="icon-set-blurb say">{style.blurb}</span>
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      </SettingRow>
      {distinct.length > 0 && (
        <SettingRow label="Each game" hint="Give any game a style or symbol of its own." control="below">
          <ul className="game-icon-list">
            {distinct.map((game) => {
              const key = logoKey(game);
              const choice = gameIcons[key] ?? {};
              const style = choice.style ?? logoStyle;
              return (
                <li key={key} className="game-icon-row">
                  <GameLogo game={game} size={40} />
                  <span className="game-icon-name">{game.name}</span>
                  <Select
                    aria-label={`${game.name} icon style`}
                    value={choice.style ?? 'default'}
                    onChange={(event) => {
                      const value = event.target.value;
                      setGameIcon(key, {
                        ...choice,
                        style: value === 'default' ? undefined : (value as LogoStyle),
                      });
                    }}
                  >
                    <option value="default">
                      Like the rest ({LOGO_STYLES.find((item) => item.id === logoStyle)!.name})
                    </option>
                    {LOGO_STYLES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                  {style === 'symbol' && (
                    <GlyphPicker
                      game={game}
                      value={choice.glyph ?? 'star'}
                      onChange={(glyph) => setGameIcon(key, { ...choice, glyph })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </SettingRow>
      )}
    </>
  );
}

function GlyphPicker({ game, value, onChange }: { game: Game; value: GlyphId; onChange: (glyph: GlyphId) => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="glyph-trigger" aria-label={`${game.name} symbol: ${GAME_GLYPHS[value].name}`}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d={GAME_GLYPHS[value].d} fill="currentColor" fillRule="evenodd" />
          </svg>
          <span className="say">Symbol</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="popover-motion z-50 rounded-ui-lg bg-popover p-2 shadow-float ring-1 ring-line-strong"
        >
          <Popover.RadioGroup className="glyph-grid" value={value} onValueChange={(next) => onChange(next as GlyphId)}>
            {GLYPH_IDS.map((id) => (
              <Popover.RadioItem key={id} value={id} className="glyph-option" aria-label={GAME_GLYPHS[id].name}>
                <GameLogo game={game} size={36} variant="symbol" glyph={id} />
              </Popover.RadioItem>
            ))}
          </Popover.RadioGroup>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
