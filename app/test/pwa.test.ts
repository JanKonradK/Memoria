import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ flush: vi.fn(), update: vi.fn() }));
vi.mock('../src/store', () => ({ flushPersist: mocks.flush }));
vi.mock('virtual:pwa-register', () => ({ registerSW: () => mocks.update }));
import { applyPwaUpdate, initPwa } from '../src/pwa';

beforeEach(() => {
  mocks.flush.mockReset();
  mocks.update.mockReset();
  initPwa();
});

it('waits for pending local changes before activating an update', async () => {
  let release!: () => void;
  mocks.flush.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const update = applyPwaUpdate();
  expect(mocks.update).not.toHaveBeenCalled();
  release();
  await update;
  expect(mocks.update).toHaveBeenCalledWith(true);
});

it('keeps the current app open when saving fails', async () => {
  mocks.flush.mockRejectedValueOnce(new Error('Storage full'));
  await applyPwaUpdate();
  expect(mocks.update).not.toHaveBeenCalled();
});
