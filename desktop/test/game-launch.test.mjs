import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameLaunch } from '../game-launch.mjs';

let directory;
const exe = path.resolve('/games/Star Rail/launcher.exe');
const make = (options = {}) => {
  const pick = vi.fn(async () => exe);
  const open = vi.fn(async () => '');
  const launch = createGameLaunch({
    dataDir: directory,
    pick,
    open,
    exists: () => true,
    platform: 'win32',
    ...options,
  });
  return { launch, pick: options.pick ?? pick, open: options.open ?? open };
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'memoria-launch-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('game launch targets', () => {
  it('stores the chosen program per game and reports only its file name', async () => {
    const { launch } = make();
    expect(launch.list()).toEqual({ targets: {} });
    expect(await launch.choose('hsr')).toEqual({ targets: { hsr: 'launcher.exe' } });
    expect(JSON.parse(await readFile(path.join(directory, 'launch-targets.json'), 'utf8'))).toEqual({ hsr: exe });
    // A new instance reads the same file: the choice survives a restart.
    expect(make().launch.list()).toEqual({ targets: { hsr: 'launcher.exe' } });
  });

  it('keeps the existing target when the picker is cancelled', async () => {
    const { launch } = make();
    await launch.choose('hsr');
    const cancelled = make({ pick: vi.fn(async () => undefined) });
    expect(await cancelled.launch.choose('hsr')).toEqual({ targets: { hsr: 'launcher.exe' } });
  });

  it.each(['notes.txt', 'run.bat', 'setup.ps1', 'relative.exe'])('refuses %s as a target', async (name) => {
    const target = name === 'relative.exe' ? name : path.resolve('/games', name);
    const { launch } = make({ pick: vi.fn(async () => target) });
    await expect(launch.choose('hsr')).rejects.toThrow('Choose a program');
    expect(launch.list()).toEqual({ targets: {} });
  });

  it('starts only the path the player chose, through the shell', async () => {
    const { launch, open } = make();
    await launch.choose('hsr');
    expect(await launch.start('hsr')).toEqual({ started: 'launcher.exe' });
    expect(open).toHaveBeenCalledExactlyOnceWith(exe);
  });

  it('never starts anything for a game with no target, or for a path from the caller', async () => {
    const { launch, open } = make();
    await launch.choose('hsr');
    await expect(launch.start('zzz')).rejects.toThrow('Choose what starts this game first.');
    await expect(launch.start(exe)).rejects.toThrow('Choose what starts this game first.');
    await expect(launch.start({ path: exe })).rejects.toThrow('Choose what starts this game first.');
    expect(open).not.toHaveBeenCalled();
  });

  it('says so when the program has moved or Windows refuses it', async () => {
    const missing = make({ exists: () => false });
    await missing.launch.choose('hsr');
    await expect(missing.launch.start('hsr')).rejects.toThrow('launcher.exe is no longer there. Choose it again.');
    expect(missing.open).not.toHaveBeenCalled();
    const refused = make({ open: vi.fn(async () => 'Access is denied.') });
    await expect(refused.launch.start('hsr')).rejects.toThrow('Windows could not start launcher.exe.');
  });

  it('removes a target and ignores entries a hand-edited file should not hold', async () => {
    await writeFile(
      path.join(directory, 'launch-targets.json'),
      JSON.stringify({ hsr: exe, script: path.resolve('/games/run.bat'), relative: 'game.exe', bad: 7 }),
    );
    const { launch } = make();
    expect(launch.list()).toEqual({ targets: { hsr: 'launcher.exe' } });
    expect(launch.clear('hsr')).toEqual({ targets: {} });
    expect(JSON.parse(await readFile(path.join(directory, 'launch-targets.json'), 'utf8'))).toEqual({});
  });

  it('is unavailable outside Windows', async () => {
    const { launch } = make({ platform: 'linux' });
    await expect(launch.choose('hsr')).rejects.toThrow('Starting a game needs the Windows app.');
    await expect(launch.start('hsr')).rejects.toThrow('Starting a game needs the Windows app.');
  });
});
