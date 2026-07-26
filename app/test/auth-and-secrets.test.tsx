import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthShell, useSession } from '../src/auth';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { migrateLegacySecrets, readLocalSecrets } from '../src/secret-store';

function SessionProbe() {
  const session = useSession();
  return <p>{session.hosted ? 'hosted' : session.displayName}</p>;
}

describe('local credential migration', () => {
  it('moves legacy credentials into the device-only store', () => {
    expect(
      migrateLegacySecrets({
        settings: {
          discordWebhook: 'https://discord.com/api/webhooks/1/secret',
        },
      }),
    ).toBe(true);
    expect(readLocalSecrets()).toMatchObject({
      discordWebhook: 'https://discord.com/api/webhooks/1/secret',
    });
  });
});

describe('public and local auth states', () => {
  it('keeps the app usable in explicit local mode without a Clerk key', async () => {
    render(
      <AuthShell>
        <SessionProbe />
      </AuthShell>,
    );
    // LocalIdentityGate is genuinely async: setIdentity awaits flushPersist before
    // swapping the storage pointers, so any pending write lands under the OLD
    // identity's key. The gate therefore opens a microtask later.
    expect(await screen.findByText('Local mode')).toBeInTheDocument();
  });

  it('serves public trust pages without requiring a session', () => {
    window.history.replaceState({}, '', '/security');
    render(
      <AuthShell>
        <SessionProbe />
      </AuthShell>,
    );
    expect(screen.getByRole('heading', { name: 'Security and data flow' })).toBeInTheDocument();
  });
});

describe('failure recovery', () => {
  it('shows an actionable render recovery screen without clearing local data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken() {
      throw new Error('test render failure');
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Your local data has not been deleted');
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeInTheDocument();
  });
});
