import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLook, DEFAULT_DETAIL, DEFAULT_LOOK, isLookId, LOOK_IDS, LOOKS } from '../src/looks';
import { useUI } from '../src/ui-store';

afterEach(() => {
  localStorage.clear();
  useUI.setState({ look: DEFAULT_LOOK, detail: DEFAULT_DETAIL, shelfOpen: false, railGamesOpen: true });
  applyLook(DEFAULT_LOOK, DEFAULT_DETAIL);
});

describe('looks', () => {
  it('lists every look once, Classic first', () => {
    expect(LOOKS.map((look) => look.id)).toEqual([...LOOK_IDS]);
    expect(LOOKS[0]!.id).toBe('classic');
    expect(new Set(LOOK_IDS).size).toBe(LOOK_IDS.length);
  });

  it('puts the look and the detail level on the page', async () => {
    useUI.getState().setLook('hud');
    useUI.getState().setDetail('minimal');
    expect(document.documentElement.dataset.detail).toBe('minimal');
    // The look waits for its own stylesheet, then swaps.
    await vi.waitFor(() => expect(document.documentElement.dataset.look).toBe('hud'));
  });

  it('wears the last look chosen, however the stylesheets arrive', async () => {
    useUI.getState().setLook('paper');
    useUI.getState().setLook('neon');
    useUI.getState().setLook('classic');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.documentElement.dataset.look).toBe('classic');
  });

  it('keeps a stored look and detail, and falls back from unknown ones', () => {
    localStorage.setItem(
      'memoria-ui',
      JSON.stringify({ state: { look: 'paper', detail: 'minimal', railGamesOpen: false }, version: 0 }),
    );
    useUI.persist.rehydrate();
    expect(useUI.getState().look).toBe('paper');
    expect(useUI.getState().detail).toBe('minimal');
    expect(useUI.getState().railGamesOpen).toBe(false);

    localStorage.setItem('memoria-ui', JSON.stringify({ state: { look: 'vaporwave', detail: 'loud' }, version: 0 }));
    useUI.persist.rehydrate();
    expect(useUI.getState().look).toBe(DEFAULT_LOOK);
    expect(useUI.getState().detail).toBe(DEFAULT_DETAIL);
    expect(useUI.getState().railGamesOpen).toBe(true);
    expect(isLookId('vaporwave')).toBe(false);
  });
});

describe('the dock shelf', () => {
  it('opens only when asked, and any route change lowers it, a picked game included', () => {
    useUI.getState().setTab('home');
    expect(useUI.getState().shelfOpen).toBe(false);
    useUI.getState().setShelfOpen(true);
    useUI.getState().setTab('home');
    expect(useUI.getState().shelfOpen).toBe(false);
    useUI.getState().setShelfOpen(true);
    useUI.getState().setTab('notes');
    expect(useUI.getState().shelfOpen).toBe(false);
    useUI.getState().setShelfOpen(true);
    useUI.getState().openSettings('appearance');
    expect(useUI.getState().shelfOpen).toBe(false);
  });

  it('remembers the last game for Alt+4 toward Games', () => {
    useUI.getState().setFocusedGameId('g1');
    useUI.getState().setFocusedGameId(null);
    expect(useUI.getState().lastGameId).toBe('g1');
  });
});
