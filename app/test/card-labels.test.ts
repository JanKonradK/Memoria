import { createElement, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { emptyState, type Game, type GameUrgency } from '@memoria/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { GameControlsView, type GameControlActions } from '../src/components/GameCard';
import { TooltipProvider } from '../src/components/ui';
import { formatCardTimeLeft, NexusLayout, serverRegionLabel } from '../src/components/NexusLayout';
import { useApp } from '../src/store';

/**
 * Radix tooltips need their provider, which the app mounts once at the root in
 * main.tsx. Rendering a card fragment straight into jsdom skips it, so every
 * render in this file goes through the same wrapper the real tree has.
 */
function renderCard(element: ReactElement) {
  return render(createElement(TooltipProvider, null, element));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const game: Game = {
  id: 'genshin-eu',
  name: 'Genshin Impact',
  short: 'GI',
  color: '#f8efdb',
  color2: '#d8c9b4',
  color3: '#2f4078',
  icon: '',
  platform: 'both',
  tz: 'Etc/GMT-1',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 1,
};

function controls(): GameControlActions {
  const store = useApp.getState();
  return {
    setTaskDone: store.setTaskDone,
    restartTaskTimer: store.restartTaskTimer,
    advanceTaskTimer: store.advanceTaskTimer,
    setTaskCount: store.setTaskCount,
    setEnergy: store.setEnergy,
    adjustEnergy: store.adjustEnergy,
  };
}

afterEach(() => useApp.setState({ state: emptyState() }));

describe('formatCardTimeLeft', () => {
  // The owner's rule: hours while inside 100 hours, days and hours beyond it.
  // fmtDur in util.ts switches to days at 24h and has many other callers, so
  // this card needs its own formatter rather than a change to that one.
  it('counts in hours right up to the boundary', () => {
    expect(formatCardTimeLeft(2 * HOUR)).toBe('2h');
    expect(formatCardTimeLeft(48 * HOUR)).toBe('48h');
    expect(formatCardTimeLeft(99 * HOUR)).toBe('99h');
  });

  it('switches to days and hours AT one hundred hours, not before', () => {
    // 99h is the last hours-only value; 100h is the first day value. An
    // off-by-one here is invisible in a screenshot and wrong every fifth day.
    expect(formatCardTimeLeft(99 * HOUR + 59 * MINUTE)).toBe('99h');
    expect(formatCardTimeLeft(100 * HOUR)).toBe('4d 4h');
    expect(formatCardTimeLeft(101 * HOUR)).toBe('4d 5h');
  });

  it('drops to minutes below an hour, and never shows a bare zero', () => {
    expect(formatCardTimeLeft(59 * MINUTE)).toBe('59m');
    expect(formatCardTimeLeft(MINUTE)).toBe('1m');
    expect(formatCardTimeLeft(30_000)).toBe('<1m');
  });

  it('says now once the moment has passed', () => {
    expect(formatCardTimeLeft(0)).toBe('now');
    expect(formatCardTimeLeft(-5 * HOUR)).toBe('now');
  });
});

describe('serverRegionLabel', () => {
  // A fixed August instant: the reference servers use fixed offsets, but the
  // real IANA zones below are in daylight saving here, which is the case the
  // offset-based mapping exists to survive.
  const august = Date.UTC(2026, 7, 5, 12);

  it('reads the preset servers, whose Etc zones carry INVERTED signs', () => {
    // Etc/GMT-1 really is UTC+1. Reading the name instead of the offset is the
    // trap this mapping is written to avoid.
    expect(serverRegionLabel('Etc/GMT-1', august)).toBe('EU');
    expect(serverRegionLabel('Etc/GMT+5', august)).toBe('NA');
    expect(serverRegionLabel('Etc/GMT-8', august)).toBe('ASIA');
  });

  it('places real zones by their live offset, not by their name', () => {
    expect(serverRegionLabel('America/Los_Angeles', august)).toBe('NA');
    expect(serverRegionLabel('America/New_York', august)).toBe('NA');
    expect(serverRegionLabel('Europe/Warsaw', august)).toBe('EU');
    expect(serverRegionLabel('Asia/Tokyo', august)).toBe('ASIA');
  });

  it('never invents a region it cannot justify', () => {
    expect(serverRegionLabel('Etc/UTC', august)).toBe('UTC');
    // Half-hour and far-flung zones fall back to a plain offset rather than
    // being forced into one of three buckets they do not belong to.
    expect(serverRegionLabel('Asia/Kolkata', august)).toMatch(/^UTC[+−-]5:30$/);
    expect(serverRegionLabel('Pacific/Auckland', august)).toMatch(/^UTC[+−-]/);
  });

  it('degrades to a label rather than throwing on a bad zone', () => {
    expect(serverRegionLabel('Not/AZone', august)).toBe('Server');
  });
});

describe('game card account labels', () => {
  it('renders no placeholder or divider when an account label is absent', () => {
    const state = { ...emptyState(), games: [game] };
    const entry: GameUrgency = { game, next: null, actions: [] };
    useApp.setState({ state });

    const nexus = renderCard(
      createElement(NexusLayout, {
        state,
        entries: [entry],
        displayIds: [game.id],
        now: Date.UTC(2026, 7, 5, 12),
        gameControlActions: controls(),
        onEditGame: () => {},
        onOpenGameEvent: () => {},
        onOpenEvent: () => {},
        onToggleEvent: () => {},
        onOpenTimeline: () => {},
      }),
    );
    expect(screen.queryByText('+ label')).not.toBeInTheDocument();
    expect(screen.getByText(game.name).parentElement?.querySelector('.bg-line-edge')).toBeNull();
    nexus.unmount();

    renderCard(
      createElement(GameControlsView, {
        entry,
        state,
        actions: controls(),
        now: Date.UTC(2026, 7, 5, 12),
        onEditGame: () => {},
        onOpenEvent: () => {},
      }),
    );
    expect(screen.queryByText('+ label')).not.toBeInTheDocument();
    expect(screen.getByText(game.name).parentElement?.querySelector('.bg-line-edge')).toBeNull();
  });

  it('keeps the divider and real account label when one is present', () => {
    const labelledGame = { ...game, accountLabel: 'Main EU' };
    const state = { ...emptyState(), games: [labelledGame] };
    const entry: GameUrgency = { game: labelledGame, next: null, actions: [] };
    useApp.setState({ state });

    renderCard(
      createElement(GameControlsView, {
        entry,
        state,
        actions: controls(),
        now: Date.UTC(2026, 7, 5, 12),
        onEditGame: () => {},
        onOpenEvent: () => {},
      }),
    );

    expect(screen.getByText('Main EU')).toBeInTheDocument();
    expect(screen.getByText(game.name).parentElement?.querySelector('.bg-line-edge')).not.toBeNull();
  });
});

describe('game card reset labels', () => {
  it('renders the same summer reset one hour apart in Dublin and Warsaw', () => {
    const now = Date.UTC(2026, 7, 5, 12);
    const stateFor = (localTz: string) => ({
      ...emptyState(),
      games: [game],
      settings: { ...emptyState().settings, localTz },
    });
    const entry: GameUrgency = { game, next: null, actions: [] };

    const dublinState = stateFor('Europe/Dublin');
    useApp.setState({ state: dublinState });
    const dublin = renderCard(
      createElement(GameControlsView, {
        entry,
        state: dublinState,
        actions: controls(),
        now,
        onEditGame: () => {},
        onOpenEvent: () => {},
      }),
    );
    expect(screen.getByText('reset 04:00')).toBeInTheDocument();
    dublin.unmount();

    const warsawState = stateFor('Europe/Warsaw');
    useApp.setState({ state: warsawState });
    renderCard(
      createElement(GameControlsView, {
        entry,
        state: warsawState,
        actions: controls(),
        now,
        onEditGame: () => {},
        onOpenEvent: () => {},
      }),
    );
    expect(screen.getByText('reset 05:00')).toBeInTheDocument();
  });

  it.each([
    ['EU', 'Etc/GMT-1', Date.UTC(2026, 7, 5, 12), '05:00'],
    ['NA', 'Etc/GMT+5', Date.UTC(2026, 0, 5, 12), '10:00'],
    ['ASIA', 'Etc/GMT-8', Date.UTC(2026, 7, 5, 12), '22:00'],
  ] as const)('shows the next 04:00 %s reset in Warsaw time', (region, tz, now, localTime) => {
    const serverGame = { ...game, id: `genshin-${region}`, tz };
    const state = {
      ...emptyState(),
      games: [serverGame],
      settings: { ...emptyState().settings, localTz: 'Europe/Warsaw' },
    };
    const entry: GameUrgency = { game: serverGame, next: null, actions: [] };
    useApp.setState({ state });

    const view = renderCard(
      createElement(GameControlsView, {
        entry,
        state,
        actions: controls(),
        now,
        onEditGame: () => {},
        onOpenEvent: () => {},
      }),
    );

    expect(screen.getByText(`reset ${localTime}`)).toBeInTheDocument();
    view.unmount();
  });
});
