import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ getStatus: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => host,
}));
vi.mock('../src/native', () => ({ isNativeApp: true }));

/** A fresh copy of the modules, so each case asks the host again. */
async function load() {
  vi.resetModules();
  const entitlements = await import('../src/entitlements');
  const { updateTarget } = await import('../src/app-update-state');
  return { ...entitlements, updateTarget };
}

beforeEach(() => {
  host.getStatus.mockReset();
});

describe('Android build entitlements', () => {
  it('offers no updater until the host says which build this is', async () => {
    host.getStatus.mockReturnValue(new Promise(() => undefined));
    const { updateTarget, useEntitlements } = await load();
    expect(useEntitlements.getState().distribution).toBe('unknown');
    expect(updateTarget()).toBe('none');
  });

  it('keeps the Google Play build away from GitHub updates', async () => {
    host.getStatus.mockResolvedValue({ distribution: 'play', tier: 'free', proUnlocked: false, billingReady: false });
    const { initEntitlements, isPlayStoreBuild, updateTarget } = await load();
    await expect(initEntitlements()).resolves.toEqual({
      distribution: 'play',
      tier: 'free',
      proUnlocked: false,
      billingReady: false,
    });
    expect(isPlayStoreBuild()).toBe(true);
    expect(updateTarget()).toBe('none');
  });

  it('lets the GitHub build update itself, and treats a host without the plugin as that build', async () => {
    host.getStatus.mockResolvedValue({ distribution: 'direct' });
    const direct = await load();
    await direct.initEntitlements();
    expect(direct.updateTarget()).toBe('android');

    host.getStatus.mockRejectedValue(new Error('"Entitlements" plugin is not implemented on android'));
    const older = await load();
    await older.initEntitlements();
    expect(older.isPlayStoreBuild()).toBe(false);
    expect(older.updateTarget()).toBe('android');
    // Asked once: a second call reuses the answer.
    await older.initEntitlements();
    expect(host.getStatus).toHaveBeenCalledTimes(2);
  });

  it('never unlocks or sells anything yet, whatever the host claims', async () => {
    host.getStatus.mockResolvedValue({ distribution: 'play', tier: 'gold', proUnlocked: 'yes', billingReady: 1 });
    const { initEntitlements } = await load();
    await expect(initEntitlements()).resolves.toMatchObject({ tier: 'free', proUnlocked: false, billingReady: false });
  });
});
