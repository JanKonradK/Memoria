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
    fingerprint: 'a'.repeat(64),
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
    fireEvent.click(screen.getByRole('button', { name: 'Connect another device' }));
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
  expect(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  expect(screen.getAllByText('Not synced since Memoria started')).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Reset device connection' }));
  });
  expect(screen.getByRole('button', { name: 'Connect my phone or tablet' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('saves the relay address on the PC and explains a refused one', async () => {
  const off = { url: null as string | null, state: 'off', error: null as string | null };
  let status = {
    enabled: true,
    fingerprint: 'a'.repeat(64),
    addresses: ['http://192.168.1.2:17820'],
    code: null,
    expiresAt: null,
    devices: [{ id: 'one', name: 'Android phone', pairedAt: Date.now() }],
    relay: off,
  };
  const sent: unknown[] = [];
  launcher.mockImplementation(async (_path, options?: { body: string }) => {
    if (!options) return { ok: true, json: async () => status };
    const body = JSON.parse(options.body) as { url: string };
    sent.push(body);
    if (!body.url.startsWith('https://'))
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'Enter the relay address, starting with https://.' }),
      };
    status = { ...status, relay: { url: body.url, state: 'connected', error: null } };
    return { ok: true, json: async () => status };
  });
  await act(async () => {
    render(<DeviceSync />);
  });
  fireEvent.click(screen.getByText('Sync away from home'));
  expect(screen.getByText(/Off\. Phones sync only on the same Wi-Fi/)).toBeVisible();
  const field = screen.getByLabelText('Relay address');
  fireEvent.change(field, { target: { value: 'http://relay.example' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('starting with https://');
  fireEvent.change(field, { target: { value: 'https://memoria-relay.example.workers.dev' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
  expect(sent.at(-1)).toEqual({ action: 'relay', url: 'https://memoria-relay.example.workers.dev' });
  expect(screen.getByText(/Connected\. Paired phones sync through it/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible();
});
