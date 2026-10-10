import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { LaunchButton, LaunchSettings } from '../src/components/GameLaunch';
import { TooltipProvider } from '../src/components/ui';
import { initGameLaunch, useGameLaunch } from '../src/game-launch';
import { useReadings } from '../src/readings';

const game = makeGame({ id: 'hsr', name: 'Honkai: Star Rail' });
const host = {
  list: vi.fn(async () => ({ targets: {} as Record<string, string> })),
  choose: vi.fn(async () => ({ targets: { hsr: 'launcher.exe' } })),
  clear: vi.fn(async () => ({ targets: {} })),
  start: vi.fn(async () => ({ started: 'launcher.exe' })),
};
const show = () =>
  render(
    <TooltipProvider>
      <LaunchButton game={game} />
      <LaunchSettings game={game} />
    </TooltipProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  useGameLaunch.setState({ available: false, targets: {}, busy: null });
  useReadings.setState({ notice: null });
});
afterEach(() => vi.unstubAllGlobals());

it('renders nothing where the game cannot be started', () => {
  initGameLaunch();
  show();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('asks once what starts the game, then launches it by id', async () => {
  vi.stubGlobal('memoriaDesktop', { version: 1, launch: host });
  initGameLaunch();
  show();
  expect(screen.queryByRole('button', { name: 'Launch Honkai: Star Rail' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Set up launch' }));
  const launch = await screen.findByRole('button', { name: 'Launch Honkai: Star Rail' });
  expect(host.choose).toHaveBeenCalledExactlyOnceWith('hsr');
  expect(screen.getByRole('group', { name: 'Launch settings for Honkai: Star Rail' })).toHaveTextContent(
    'Launch starts launcher.exe',
  );
  fireEvent.click(launch);
  await waitFor(() => expect(useReadings.getState().notice?.text).toBe('Starting launcher.exe.'));
  // Only the id crosses to the desktop shell. The path never comes from the page.
  expect(host.start).toHaveBeenCalledExactlyOnceWith('hsr');
});

it('reports why Windows refused, without the bridge prefix', async () => {
  host.start.mockRejectedValueOnce(
    new Error(
      "Error invoking remote method 'memoria:launch-start': Error: launcher.exe is no longer there. Choose it again.",
    ),
  );
  vi.stubGlobal('memoriaDesktop', { version: 1, launch: host });
  useGameLaunch.setState({ available: true, targets: { hsr: 'launcher.exe' } });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Launch Honkai: Star Rail' }));
  await waitFor(() =>
    expect(useReadings.getState().notice).toMatchObject({
      tone: 'error',
      text: 'launcher.exe is no longer there. Choose it again.',
    }),
  );
  expect(screen.getByRole('button', { name: 'Launch Honkai: Star Rail' })).toBeEnabled();
});

it('removes the target from the card settings', async () => {
  vi.stubGlobal('memoriaDesktop', { version: 1, launch: host });
  useGameLaunch.setState({ available: true, targets: { hsr: 'launcher.exe' } });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByRole('button', { name: 'Set up launch' });
  expect(host.clear).toHaveBeenCalledExactlyOnceWith('hsr');
});
