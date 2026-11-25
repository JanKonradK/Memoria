import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyBrand,
  BACKDROPS,
  BRAND_STORAGE_KEY,
  DEFAULT_BACKDROP,
  DEFAULT_MARK_BACKING,
  DEFAULT_MARK_COLOUR,
  DEFAULT_MARK_SHADING,
  findMarkColour,
  isBackdropId,
  isMarkBackingId,
  isMarkColourId,
  isMarkShadingId,
  MARK_BACKINGS,
  MARK_COLOURS,
  MARK_SHADINGS,
  MARK_SHADING_IDS,
  MARK_BACKING_IDS,
} from '../src/brand';
import {
  isLockedByStorePreview,
  STORE_PRO_FEATURES,
  STORE_PRO_HINT,
  tierForLook,
  tierForPalette,
} from '../src/entitlements';
import { DEFAULT_LOOK, LOOK_IDS } from '../src/looks';
import { DEFAULT_PALETTE, FAMILIES } from '../src/palettes';
import { useUI } from '../src/ui-store';
import { Logo } from '../src/components/Logo';
import { LookPicker } from '../src/components/settings/LookPicker';
import { MarkPicker, StorePreviewRow } from '../src/components/settings/MarkPicker';
import { MARK_HEIGHT, MARK_WIDTH } from '../src/components/mark-path';

const BRAND_DEFAULTS = {
  markColour: DEFAULT_MARK_COLOUR,
  markShading: DEFAULT_MARK_SHADING,
  markBacking: DEFAULT_MARK_BACKING,
  backdrop: DEFAULT_BACKDROP,
  previewStoreLocks: false,
} as const;

afterEach(() => {
  useUI.setState({ ...BRAND_DEFAULTS, look: DEFAULT_LOOK, palette: DEFAULT_PALETTE });
  document.documentElement.removeAttribute('data-backdrop');
  document.documentElement.style.removeProperty('--splash-mark-fill');
  localStorage.clear();
});

const tiers = (options: readonly { tier: string }[]) => ({
  free: options.filter((option) => option.tier === 'free').length,
  pro: options.filter((option) => option.tier === 'pro').length,
});

describe('brand presets and store tiers', () => {
  it('starts on the signature mark with nothing locked', () => {
    expect(BRAND_DEFAULTS).toEqual({
      markColour: 'gilded',
      markShading: 'luminous',
      markBacking: 'bare',
      backdrop: 'default',
      previewStoreLocks: false,
    });
    const state = useUI.getState();
    expect(state.markColour).toBe('gilded');
    expect(state.markShading).toBe('luminous');
    expect(state.markBacking).toBe('bare');
    expect(state.backdrop).toBe('default');
    expect(state.previewStoreLocks).toBe(false);
  });

  it('splits every collection into free and Pro, with every default free', () => {
    expect(tiers(MARK_COLOURS)).toEqual({ free: 3, pro: 6 });
    expect(tiers(MARK_SHADINGS)).toEqual({ free: 2, pro: 3 });
    expect(tiers(MARK_BACKINGS)).toEqual({ free: 2, pro: 2 });
    expect(tiers(BACKDROPS)).toEqual({ free: 2, pro: 4 });
    expect(MARK_COLOURS.filter((colour) => colour.tier === 'free').map((colour) => colour.id)).toEqual([
      'gilded',
      'ivory',
      'accent',
    ]);
    expect(findMarkColour(DEFAULT_MARK_COLOUR).stops).toEqual(['#ffffff', '#fff6dc', '#e8b45a', '#c99138']);
    for (const [options, id] of [
      [MARK_COLOURS, DEFAULT_MARK_COLOUR],
      [MARK_SHADINGS, DEFAULT_MARK_SHADING],
      [MARK_BACKINGS, DEFAULT_MARK_BACKING],
      [BACKDROPS, DEFAULT_BACKDROP],
    ] as const) {
      expect((options as readonly { id: string; tier: string }[]).find((option) => option.id === id)?.tier).toBe(
        'free',
      );
    }
    expect(tierForLook(DEFAULT_LOOK)).toBe('free');
    expect(tierForPalette(DEFAULT_PALETTE)).toBe('free');
    expect(tierForPalette('not-a-palette')).toBe('free');
    expect(LOOK_IDS.filter((look) => tierForLook(look) === 'pro').length).toBeGreaterThan(0);
    const proFamilies = FAMILIES.filter((family) => tierForPalette(family.flavours[0]!.id) === 'pro');
    expect(proFamilies.length).toBeGreaterThan(0);
    expect(proFamilies.length).toBeLessThan(FAMILIES.length);
  });

  it('locks only Pro options, and only while the store preview is on', () => {
    expect(isLockedByStorePreview('pro', false)).toBe(false);
    expect(isLockedByStorePreview('free', false)).toBe(false);
    expect(isLockedByStorePreview('free', true)).toBe(false);
    expect(isLockedByStorePreview('pro', true)).toBe(true);
  });

  it('lists the planned Pro app features beside the appearance ones', () => {
    expect(STORE_PRO_FEATURES.some((feature) => feature.kind === 'appearance')).toBe(true);
    expect(STORE_PRO_FEATURES.filter((feature) => feature.kind === 'app').map((feature) => feature.id)).toEqual([
      'pro.background-schedules',
      'pro.archive',
      'pro.card-themes',
    ]);
    expect(new Set(STORE_PRO_FEATURES.map((feature) => feature.id)).size).toBe(STORE_PRO_FEATURES.length);
  });

  it('recognises only its own ids', () => {
    expect(isMarkColourId('rose-gold')).toBe(true);
    expect(isMarkColourId('gold')).toBe(false);
    expect(isMarkShadingId('chiseled')).toBe(true);
    expect(isMarkShadingId(3)).toBe(false);
    expect(isMarkBackingId('tinted')).toBe(true);
    expect(isMarkBackingId(null)).toBe(false);
    expect(isBackdropId('astral-grid')).toBe(true);
    expect(isBackdropId('grid')).toBe(false);
  });
});

describe('the brand on the page', () => {
  const root = document.documentElement;

  it('puts the backdrop on <html>, and takes it off for the look’s own ground', () => {
    useUI.getState().setBackdrop('nebula');
    expect(root.getAttribute('data-backdrop')).toBe('nebula');
    useUI.getState().setBackdrop('default');
    expect(root.hasAttribute('data-backdrop')).toBe(false);
  });

  it('colours the intro’s mark and remembers the brand for the next first paint', () => {
    useUI.getState().setMarkColour('emerald');
    useUI.getState().setMarkShading('sculpted');
    useUI.getState().setMarkBacking('gilded');
    useUI.getState().setBackdrop('horizon');
    const fill = findMarkColour('emerald').previewCss;
    expect(root.style.getPropertyValue('--splash-mark-fill')).toBe(fill);
    // The pre-paint script in index.html only accepts a plain linear-gradient.
    expect(fill).toMatch(/^linear-gradient\([\w\s#%(),.-]+\)$/);
    expect(JSON.parse(localStorage.getItem(BRAND_STORAGE_KEY)!)).toEqual({
      markColour: 'emerald',
      markShading: 'sculpted',
      markBacking: 'gilded',
      backdrop: 'horizon',
      splashFill: fill,
    });
  });

  it('gives every colour a fill the pre-paint script accepts', () => {
    for (const colour of MARK_COLOURS) expect(colour.previewCss).toMatch(/^linear-gradient\([\w\s#%(),.-]+\)$/);
  });

  it('applies without storage', () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() =>
        applyBrand({ markColour: 'ivory', markShading: 'flat', markBacking: 'bare', backdrop: 'starfield' }),
      ).not.toThrow();
      expect(root.getAttribute('data-backdrop')).toBe('starfield');
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });

  it('keeps stored choices and falls back from corrupt ones', () => {
    localStorage.setItem(
      'memoria-ui',
      JSON.stringify({
        state: {
          markColour: 'amethyst',
          markShading: 'celestial',
          markBacking: 'tinted',
          backdrop: 'astral-grid',
          previewStoreLocks: true,
        },
        version: 0,
      }),
    );
    useUI.persist.rehydrate();
    expect(useUI.getState()).toMatchObject({
      markColour: 'amethyst',
      markShading: 'celestial',
      markBacking: 'tinted',
      backdrop: 'astral-grid',
      previewStoreLocks: true,
    });

    localStorage.setItem(
      'memoria-ui',
      JSON.stringify({
        state: {
          markColour: 'plutonium',
          markShading: { evil: true },
          markBacking: 42,
          backdrop: 'url(https://example.com)',
          previewStoreLocks: 'yes',
        },
        version: 0,
      }),
    );
    useUI.persist.rehydrate();
    expect(useUI.getState()).toMatchObject(BRAND_DEFAULTS);
  });
});

describe('the mark', () => {
  it('draws every lighting on every tile from the real geometry', () => {
    for (const shading of MARK_SHADING_IDS) {
      for (const backing of MARK_BACKING_IDS) {
        const { container, unmount } = render(<Logo shading={shading} backing={backing} colour="celestial" />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe(backing === 'bare' ? `0 0 ${MARK_WIDTH} ${MARK_HEIGHT}` : '0 0 56 56');
        expect(svg.dataset.shading).toBe(shading);
        expect(svg.dataset.backing).toBe(backing);
        const drawn = [...svg.querySelectorAll('path')].filter((path) => !path.closest('defs'));
        // Flat is one silhouette (plus a tile); every other lighting stacks ribbons and eighteen shards.
        expect(drawn.length).toBeGreaterThanOrEqual(shading === 'flat' ? 1 : 21);
        for (const path of drawn) expect(path.getAttribute('d')?.length).toBeGreaterThan(10);
        expect(Boolean(svg.querySelector('.brand-mark-tile'))).toBe(backing !== 'bare');
        unmount();
      }
    }
  });

  it('keys its gradients and clips per instance, so two marks never share one', () => {
    const { container } = render(
      <>
        <Logo shading="chiseled" backing="gilded" />
        <Logo shading="chiseled" backing="gilded" />
        <Logo shading="celestial" backing="tinted" colour="accent" />
      </>,
    );
    const ids = [...container.querySelectorAll('defs [id]')].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(6);
    expect(new Set(ids).size).toBe(ids.length);
    // Every reference points into its own SVG.
    for (const svg of container.querySelectorAll('svg')) {
      const own = new Set([...svg.querySelectorAll('defs [id]')].map((node) => node.id));
      const references = [...svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]!);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(own.has(reference)).toBe(true);
    }
  });

  it('follows the player’s choice when no props are given', () => {
    useUI.setState({ markShading: 'flat', markBacking: 'obsidian', markColour: 'crimson' });
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg')!;
    expect(svg.dataset.shading).toBe('flat');
    expect(svg.dataset.backing).toBe('obsidian');
    expect(svg.dataset.colour).toBe('crimson');
  });
});

describe('Settings → Appearance', () => {
  it('applies any option while the store preview is off', () => {
    render(<MarkPicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Astral Gold-Cyan, Pro' }));
    expect(useUI.getState().markColour).toBe('celestial');
    fireEvent.click(screen.getByRole('radio', { name: 'Sculpted Relief, Pro' }));
    expect(useUI.getState().markShading).toBe('sculpted');
    fireEvent.click(screen.getByRole('radio', { name: 'Gilded Rim, Pro' }));
    expect(useUI.getState().markBacking).toBe('gilded');
    fireEvent.click(screen.getByRole('radio', { name: 'Void Nebula, Pro' }));
    expect(useUI.getState().backdrop).toBe('nebula');
    expect(document.documentElement.getAttribute('data-backdrop')).toBe('nebula');
    expect(screen.queryByText(STORE_PRO_HINT)).toBeNull();
    // The stage shows the mark as chosen, on the chosen backdrop.
    const stage = screen.getByRole('group', { name: 'Your mark' });
    expect(stage.querySelector('[data-backdrop="nebula"] svg[data-shading="sculpted"]')).not.toBeNull();
  });

  it('previews the store locks: a Pro option says why instead of applying', () => {
    render(
      <>
        <MarkPicker />
        <StorePreviewRow />
      </>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Preview Store locks' }));
    expect(useUI.getState().previewStoreLocks).toBe(true);

    const amethyst = screen.getByRole('radio', { name: 'Void Amethyst, Pro' });
    expect(amethyst).toHaveAttribute('aria-disabled', 'true');
    expect(amethyst).toHaveAttribute('data-locked', 'true');
    fireEvent.click(amethyst);
    expect(useUI.getState().markColour).toBe('gilded');
    const colours = screen.getByRole('radiogroup', { name: 'Logo colour' }).parentElement!;
    expect(within(colours).getByRole('status')).toHaveTextContent(STORE_PRO_HINT);
    expect(amethyst.getAttribute('aria-describedby')).toBe(within(colours).getByRole('status').id);

    // A free option still applies, and clears the notice.
    const ivory = screen.getByRole('radio', { name: 'Moonlight Ivory' });
    expect(ivory).not.toHaveAttribute('aria-disabled');
    fireEvent.click(ivory);
    expect(useUI.getState().markColour).toBe('ivory');
    expect(within(colours).getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('radio', { name: 'Drafting Matrix, Pro' }));
    expect(useUI.getState().backdrop).toBe('default');

    // Turning the preview off unlocks everything again.
    fireEvent.click(screen.getByRole('switch', { name: 'Preview Store locks' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Drafting Matrix, Pro' }));
    expect(useUI.getState().backdrop).toBe('astral-grid');
    expect(screen.queryByText(STORE_PRO_HINT)).toBeNull();
  });

  it('gates Pro looks the same way, and names what Pro includes', () => {
    useUI.setState({ previewStoreLocks: true });
    render(
      <>
        <LookPicker />
        <StorePreviewRow />
      </>,
    );
    const looks = screen.getByRole('radiogroup', { name: 'Look' });
    const neon = within(looks)
      .getAllByRole('radio')
      .find((item) => item.textContent?.includes('Neon'))!;
    expect(neon).toHaveAttribute('data-locked', 'true');
    fireEvent.click(neon);
    expect(useUI.getState().look).toBe(DEFAULT_LOOK);
    expect(screen.getByText(STORE_PRO_HINT)).toBeInTheDocument();

    const paper = within(looks)
      .getAllByRole('radio')
      .find((item) => item.textContent?.includes('Paper'))!;
    fireEvent.click(paper);
    expect(useUI.getState().look).toBe('paper');

    expect(screen.getByText('Background schedules')).toBeInTheDocument();
    expect(screen.getByText('Card themes')).toBeInTheDocument();
  });
});
