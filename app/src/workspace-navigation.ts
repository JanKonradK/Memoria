import { flushSync } from 'react-dom';
import { useUI } from './ui-store';

let active: Animation | undefined;
let morph: ViewTransition | undefined;
let rosterScroll = 0;
let historyReady = false;

/** Browser Back owns the same game-to-Today transition as the rail's Today button and Alt+Left. */
export function initWorkspaceHistory(): () => void {
  historyReady = true;
  // Focused games are session routes; a reload starts at the overview.
  history.replaceState({ ...history.state, memoriaWorkspace: null, memoriaTab: useUI.getState().tab }, '');
  let restoringOverlay = false;
  const onPopState = (event: PopStateEvent) => {
    if (restoringOverlay) {
      restoringOverlay = false;
      return;
    }
    const route = event.state as { memoriaWorkspace?: string | null; memoriaTab?: string } | null;
    if (!route || !Object.hasOwn(route, 'memoriaWorkspace')) return;
    const state = useUI.getState();
    if (
      state.sheet ||
      document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
    ) {
      // Back dismisses the top overlay first. Its Escape handler can refuse
      // dismissal when a draft has unsaved changes; keep the game route either way.
      restoringOverlay = true;
      history.forward();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
    const gameId = typeof route.memoriaWorkspace === 'string' ? route.memoriaWorkspace : null;
    navigateWorkspace(
      gameId,
      state.focusedGameId,
      () => {
        state.setFocusedGameId(gameId);
        state.setTab(gameId === null ? 'today' : 'home');
      },
      true,
    );
  };
  window.addEventListener('popstate', onPopState);
  return () => {
    historyReady = false;
    window.removeEventListener('popstate', onPopState);
  };
}

export function recordWorkspaceHistory(gameId: string): void {
  if (historyReady && history.state?.memoriaWorkspace !== gameId)
    history.pushState({ ...history.state, memoriaWorkspace: gameId, memoriaTab: 'home' }, '');
}

/** Leave a game's page for Today. Elsewhere this only clears the game filter. */
export function closeWorkspace(): void {
  const ui = useUI.getState();
  navigateWorkspace(null, ui.focusedGameId, () => {
    ui.setFocusedGameId(null);
    if (ui.tab === 'home') ui.setTab('today');
  });
}

/** Open one game's full page from anywhere in the app. */
export function openGame(gameId: string): void {
  const ui = useUI.getState();
  navigateWorkspace(gameId, null, () => {
    ui.setFocusedGameId(gameId);
    ui.setTab('home');
  });
}

/** Open a workspace without capturing and resizing the whole page. */
export function navigateWorkspace(
  gameId: string | null,
  previousId: string | null,
  update: () => void,
  fromHistory = false,
): void {
  active?.cancel();
  active = undefined;
  morph?.skipTransition();
  morph = undefined;
  const id = gameId ?? previousId;
  const findRow = () => (id ? document.querySelector<HTMLElement>(`[data-roster-game="${CSS.escape(id)}"]`) : null);
  const row = findRow();
  const originalFocus = document.activeElement;
  const fromRoster = gameId !== null && previousId === null && row !== null;
  const toRoster = gameId === null && previousId !== null && !!document.querySelector('.focus-workspace');
  if (fromRoster) {
    if (historyReady)
      history.replaceState({ ...history.state, memoriaTab: useUI.getState().tab, memoriaWorkspace: null }, '');
    rosterScroll = window.scrollY;
  }
  if (toRoster && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (toRoster && historyReady && !fromHistory && history.state?.memoriaWorkspace === previousId) {
    history.back();
    return;
  }

  // Clearing a filter on Calendar or Settings is not a roster navigation, nor is
  // a game opened from the rail while Today's list is not on screen. A game
  // still arrives at its heading, from the top, like every other way in.
  if (!fromRoster && !toRoster) {
    const before = useUI.getState();
    const switching = gameId !== null && (before.tab !== 'home' || before.focusedGameId !== gameId);
    flushSync(update);
    if (switching) {
      // A new route restores its own scroll; one game's page replacing another starts at the top.
      if (before.tab === 'home') {
        window.scrollTo({ top: 0, behavior: 'instant' });
        // One game to the next settles in rather than snapping. Opacity only,
        // so it stays on the compositor and costs a phone nothing.
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          document.querySelector<HTMLElement>('.focus-workspace')?.animate?.([{ opacity: 0.4 }, { opacity: 1 }], {
            duration: 160,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          });
        }
      }
      focusHeading(originalFocus);
    }
    return;
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const commit = () => arrive(update, toRoster, findRow, originalFocus, reducedMotion);
  if (reducedMotion || typeof document.startViewTransition !== 'function') {
    commit();
    return;
  }
  // The game's logo travels between its row and its page heading, so the eye
  // keeps hold of which game opened. Everything else arrives as before.
  const logoIn = (scope: Element | null) => scope?.querySelector<HTMLElement>('[data-game-logo]') ?? null;
  const source = logoIn(toRoster ? document.querySelector('.focus-workspace') : row);
  if (source) source.style.viewTransitionName = 'game-logo';
  let landed: HTMLElement | null = null;
  const transition = document.startViewTransition(() => {
    if (source) source.style.viewTransitionName = '';
    commit();
    landed = logoIn(toRoster ? findRow() : document.querySelector('.focus-workspace'));
    if (landed) landed.style.viewTransitionName = 'game-logo';
  });
  morph = transition;
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (landed) landed.style.viewTransitionName = '';
      if (morph === transition) morph = undefined;
    });
}

/**
 * Arrival on a game's page focuses its heading, unless the player has already
 * moved focus elsewhere. The page can be a lazy chunk still on its way, so a
 * missing heading is looked for again over the next few frames.
 */
function focusHeading(originalFocus: Element | null, tries = 10): void {
  if (document.activeElement !== originalFocus && document.activeElement !== document.body) return;
  const heading = document.querySelector<HTMLElement>('.focus-workspace h1');
  if (heading) heading.focus({ preventScroll: true });
  else if (tries > 0) requestAnimationFrame(() => focusHeading(originalFocus, tries - 1));
}

/** Commits the route change, then puts scroll, focus and the content's arrival where the new page needs them. */
function arrive(
  update: () => void,
  toRoster: boolean,
  findRow: () => HTMLElement | null,
  originalFocus: Element | null,
  reducedMotion: boolean,
): void {
  flushSync(update);
  const restoreFocus = document.activeElement === originalFocus || document.activeElement === document.body;
  if (toRoster) {
    window.scrollTo({ top: rosterScroll, behavior: 'instant' });
    if (restoreFocus) {
      // Back on the game's own row; without one (a narrow list, a deleted game) on the rail's Today.
      const target =
        findRow() ?? document.querySelector<HTMLElement>('nav[aria-label="Primary"] button[aria-current="page"]');
      target?.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (restoreFocus) focusHeading(document.activeElement);
  }

  if (reducedMotion) return;

  const destination = document.querySelector<HTMLElement>(toRoster ? '.today-page' : '.focus-workspace');
  if (!destination?.animate) return;
  // A short directional arrival explains forward/back navigation. Only the
  // content moves; the fixed rail never enters a snapshot or layer.
  // No fill mode leaves a visible, usable page if motion is interrupted.
  const animation = destination.animate(
    [
      { opacity: 0, transform: `translate3d(${toRoster ? -18 : 18}px, 0, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
  active = animation;
  void animation.finished
    .catch(() => undefined)
    .finally(() => {
      if (active === animation) active = undefined;
    });
}
