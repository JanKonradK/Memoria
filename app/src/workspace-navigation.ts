import { flushSync } from 'react-dom';
import { useUI } from './ui-store';

let active: Animation | undefined;
let rosterScroll = 0;
let gamesScroll = 0;
let historyReady = false;

/** Browser Back owns the same game-to-overview transition as the back arrow. */
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
        state.setTab(gameId === null && route.memoriaTab === 'today' ? 'today' : 'home');
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

/** Open a workspace without capturing and resizing the whole page. */
export function navigateWorkspace(
  gameId: string | null,
  previousId: string | null,
  update: () => void,
  fromHistory = false,
): void {
  active?.cancel();
  active = undefined;
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
    gamesScroll = document.querySelector<HTMLElement>('.nexus-games-scroll')?.scrollTop ?? 0;
  }
  if (toRoster && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (toRoster && historyReady && !fromHistory && history.state?.memoriaWorkspace === previousId) {
    history.back();
    return;
  }

  flushSync(update);
  // Clearing a filter on Timeline or Settings is not a roster navigation.
  if (!fromRoster && !toRoster) return;
  const restoreFocus = document.activeElement === originalFocus || document.activeElement === document.body;
  if (toRoster) {
    window.scrollTo({ top: rosterScroll, behavior: 'instant' });
    const games = document.querySelector<HTMLElement>('.nexus-games-scroll');
    if (games) games.scrollTop = gamesScroll;
    if (restoreFocus) {
      const target =
        findRow() ?? document.querySelector<HTMLElement>('nav[aria-label="Primary"] button[aria-current="page"]');
      target?.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (restoreFocus) document.querySelector<HTMLElement>('[data-workspace-back]')?.focus({ preventScroll: true });
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const destination = document.querySelector<HTMLElement>(
    toRoster ? '.mobile-game-roster, .nexus-stage, .today-page' : '.focus-workspace',
  );
  if (!destination?.animate) return;
  // A short directional arrival explains forward/back navigation. Only the
  // content moves; the fixed dock and header never enter a snapshot or layer.
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
