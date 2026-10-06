import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const launcher = vi.hoisted(() => vi.fn());
vi.mock('../src/launcher', () => ({ servedByLauncher: () => true, launcherFetch: launcher }));
vi.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AA==' }));
import { DeviceSync } from '../src/components/settings/DeviceSync';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  launcher.mockReset();
});

it('keeps an expired additional-phone code visible until a new phone connects', async () => {
  let status = {
    enabled: true,
    addresses: ['http://192.168.1.2:17820'],
    code: null as string | null,
    expiresAt: null as number | null,
    devices: [{ id: 'one', name: 'Android phone', pairedAt: Date.now() }],
  };
  launcher.mockImplementation(async (_path, options) => {
    if (options) status = { ...status, code: '12345678', expiresAt: Date.now() + 300000 };
    return { ok: true, json: async () => status };
  });
  await act(async () => {
    render(<DeviceSync />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Connect another phone' }));
  });
  expect(screen.getByRole('img')).toBeVisible();
  status = { ...status, code: null, expiresAt: null };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText('This code has expired.')).toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Show a new code' }));
  });
  expect(screen.getByRole('img')).toBeVisible();
  status = {
    ...status,
    code: null,
    expiresAt: null,
    devices: [...status.devices, { id: 'two', name: 'Android phone', pairedAt: Date.now() }],
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText('Your phone is connected')).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
});

it('offers explicit recovery when saved phone connection settings cannot be read', async () => {
  let error: string | null = 'Saved phone connections could not be read.';
  launcher.mockImplementation(async (_path, options) => {
    if (options) {
      expect(JSON.parse(options.body)).toEqual({ action: 'reset' });
      error = null;
    }
    return {
      ok: true,
      json: async () => ({ enabled: false, addresses: [], code: null, expiresAt: null, devices: [], error }),
    };
  });
  await act(async () => {
    render(<DeviceSync />);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reset phone connection' }));
  });
  expect(screen.getByRole('button', { name: 'Connect my phone' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});
