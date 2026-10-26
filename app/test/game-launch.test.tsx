import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { LaunchButton, LaunchSettings } from '../src/components/GameLaunch';
import { TooltipProvider } from '../src/components/ui';
import { initGameLaunch, useGameLaunch } from '../src/game-launch';

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
  useGameLaunch.setState({ available: false, targets: {}, busy: null, notice: null });
});
afterEach(() => vi.unstubAllGlobals());

it('renders nothing where the game cannot be started', () => {
  initGameLaunch();
  show();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('shows Launch only once its target is chosen in the card settings, then launches by id', async () => {
  vi.stubGlobal('memoriaDesktop', { version: 1, launch: host });
  initGameLaunch();
  show();
  expect(screen.queryByRole('button', { name: 'Launch Honkai: Star Rail' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
  const launch = await screen.findByRole('button', { name: 'Launch Honkai: Star Rail' });
  expect(host.choose).toHaveBeenCalledExactlyOnceWith('hsr');
  expect(screen.getByRole('group', { name: 'Launch settings for Honkai: Star Rail' })).toHaveTextContent(
    'Launch starts launcher.exe',
  );
  fireEvent.click(launch);
  await waitFor(() => expect(useGameLaunch.getState().notice?.text).toBe('Starting launcher.exe.'));
  // Only the id crosses to the desktop shell. The path never comes from the page.
  expect(host.start).toHaveBeenCalledExactlyOnceWith('hsr');
});

it('reports why Windows refused', async () => {
  host.start.mockRejectedValueOnce(new Error('launcher.exe is no longer there. Choose it again.'));
  vi.stubGlobal('memoriaDesktop', { version: 1, launch: host });
  useGameLaunch.setState({ available: true, targets: { hsr: 'launcher.exe' } });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Launch Honkai: Star Rail' }));
  await waitFor(() =>
    expect(useGameLaunch.getState().notice).toMatchObject({
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
  await screen.findByRole('button', { name: 'Choose' });
  expect(screen.queryByRole('button', { name: 'Launch Honkai: Star Rail' })).not.toBeInTheDocument();
  expect(host.clear).toHaveBeenCalledExactlyOnceWith('hsr');
});
