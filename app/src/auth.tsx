import {
  AuthenticateWithRedirectCallback,
  ClerkProvider,
  SignInButton,
  SignUpButton,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/react';
// v6's default `useSignIn` is the new signals API, which has no `authenticateWithRedirect`.
// The classic hook (stable) lives at the /legacy entry and shares the same ClerkProvider
// context, so we keep the redirect-based Google flow on it.
import { useSignIn } from '@clerk/react/legacy';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { configureHostedSession } from './auth-session';
import { reportClientError } from './reporting';
import { useApp } from './store';
import { ANONYMOUS_IDENTITY, DESKTOP_LAUNCHER_ORIGIN, LOCAL_IDENTITY } from './storage-identity';
import { resetSyncState } from './sync';

interface SessionContextValue {
  hosted: boolean;
  userId: string | null;
  displayName: string;
  signOut: () => Promise<void>;
  manageAccount: () => void;
}

const SessionContext = createContext<SessionContextValue>({
  hosted: false,
  userId: null,
  displayName: 'Local mode',
  signOut: async () => undefined,
  manageAccount: () => undefined,
});

const LEGAL: Record<string, { title: string; sections: Array<[string, string]> }> = {
  '/privacy': {
    title: 'Privacy',
    sections: [
      [
        'Data we store',
        'Account identity is handled by Clerk. Void stores your planner document in Cloudflare D1 and keeps an offline copy in this browser.',
      ],
      [
        'Integrations',
        'Notification credentials are encrypted with AES-GCM on the server and excluded from normal sync responses and exports.',
      ],
      [
        'Retention and deletion',
        'Alert-delivery records expire automatically. Deleting your account removes its document, encrypted credentials and alert records immediately.',
      ],
      [
        'Contact',
        'Before public launch, the operator contact and jurisdiction-specific privacy contact must be added here.',
      ],
    ],
  },
  '/terms': {
    title: 'Terms',
    sections: [
      [
        'Service',
        'Void is a free planning tool provided without guarantees of uninterrupted availability. Fair-use limits protect the shared service.',
      ],
      [
        'Your account',
        'You are responsible for account security and for ensuring information you enter or connect may lawfully be processed.',
      ],
      ['Affiliation', 'Void is not affiliated with HoYoverse or other game publishers.'],
      [
        'Launch review',
        'These terms are operational draft copy and require legal review before registration is opened publicly.',
      ],
    ],
  },
  '/security': {
    title: 'Security and data flow',
    sections: [
      [
        'Offline first',
        'Edits are written to IndexedDB first. Signed-in devices send a Clerk session token to the Cloudflare Worker for tenant-scoped synchronization.',
      ],
      ['Isolation', 'Every D1 document, secret and alert-ledger query is keyed by the authenticated Clerk user ID.'],
      [
        'Credentials',
        'Integration credentials are encrypted server-side, never returned after connection, and omitted from standard account exports.',
      ],
      [
        'Deletion',
        'The account screen can remove cloud data, credentials, alert records and the Clerk identity. Local browser data is cleared on successful deletion.',
      ],
    ],
  },
};

function LegalPage({ document }: { document: (typeof LEGAL)[string] }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-14">
      <a href="/" className="text-body font-semibold text-violet-300">
        ← Void
      </a>
      <h1 className="mt-6 text-3xl font-black text-fg">{document.title}</h1>
      <div className="mt-8 space-y-4">
        {document.sections.map(([title, body]) => (
          <section key={title} className="glass gold-hairline rounded-ui-card p-5">
            <h2 className="font-black text-slate-100">{title}</h2>
            <p className="mt-2 text-body leading-6 text-muted">{body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

function StatusPage() {
  const [status, setStatus] = useState<'checking' | 'operational' | 'unavailable'>('checking');
  useEffect(() => {
    void fetch('/api/ready')
      .then((response) => setStatus(response.ok ? 'operational' : 'unavailable'))
      .catch(() => setStatus('unavailable'));
  }, []);
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 py-14">
      <a href="/" className="text-body font-semibold text-violet-300">
        ← Void
      </a>
      <h1 className="mt-6 text-3xl font-black text-fg">Service status</h1>
      <section className="glass gold-hairline mt-8 rounded-ui-card p-5" role="status">
        <p
          className={`font-black ${
            status === 'operational'
              ? 'text-emerald-300'
              : status === 'unavailable'
                ? 'text-rose-300'
                : 'text-slate-300'
          }`}
        >
          {status === 'operational'
            ? 'All systems operational'
            : status === 'unavailable'
              ? 'Service check unavailable'
              : 'Checking service…'}
        </p>
        <p className="mt-2 text-body text-muted">
          Offline app data remains available even during a cloud-service interruption.
        </p>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function ContinueWithGoogleButton() {
  const { isLoaded, signIn } = useSignIn();
  const [busy, setBusy] = useState(false);

  async function startGoogleSignIn() {
    if (!isLoaded || !signIn) return;
    setBusy(true);
    try {
      // Clerk verifies the resulting session token the same way regardless of the
      // sign-in strategy, so no Worker-side change is needed for Google.
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      });
    } catch (error) {
      setBusy(false);
      void reportClientError(error instanceof Error ? error : new Error(String(error)), 'google sign-in');
    }
  }

  return (
    <button
      type="button"
      onClick={startGoogleSignIn}
      disabled={!isLoaded || busy}
      className="inline-flex min-h-11 items-center gap-3 rounded-ui-xl bg-white px-5 py-3 text-body font-bold text-slate-800 ring-1 ring-black/10 disabled:opacity-60"
    >
      <GoogleIcon />
      {busy ? 'Redirecting…' : 'Continue with Google'}
    </button>
  );
}

function SsoCallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-body text-muted" role="status">
      Completing sign-in…
      <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
    </div>
  );
}

function PublicLanding() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-5 py-16">
      <div className="max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-fuchsia-300">Offline-first gacha planner</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-fg sm:text-6xl">
          Know what resets next. Waste less energy.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-title">
          Void keeps server resets, energy caps, dailies and events together across your games. Your browser remains
          usable offline; an account adds encrypted cloud sync and closed-app alerts.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ContinueWithGoogleButton />
          <SignUpButton mode="modal">
            <button
              type="button"
              className="min-h-11 rounded-ui-xl bg-gradient-to-br from-accent to-accent-2 px-5 py-3 text-body font-bold text-white ring-1 ring-white/20"
            >
              Create free account
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button
              type="button"
              className="min-h-11 rounded-ui-xl bg-white/[0.06] px-5 py-3 text-body font-bold text-slate-100 ring-1 ring-white/15"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
      <div className="mt-14 grid gap-3 sm:grid-cols-3">
        {[
          ['Server-aware', 'Daily, weekly and event windows use each game server’s clock.'],
          ['Works offline', 'Entries stay available in IndexedDB even when the network is unavailable.'],
          ['Private by design', 'Integration credentials are encrypted server-side and excluded from normal exports.'],
        ].map(([title, body]) => (
          <section key={title} className="glass gold-hairline rounded-ui-card p-5">
            <h2 className="font-black text-slate-100">{title}</h2>
            <p className="mt-2 text-body leading-6 text-muted">{body}</p>
          </section>
        ))}
      </div>
      <nav className="mt-8 flex flex-wrap gap-4 text-xs text-dim" aria-label="Legal">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/security">Security and data flow</a>
        <a href="/status">Status</a>
      </nav>
    </main>
  );
}

function ClerkGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const storeIdentity = useApp((state) => state.identity);
  const setIdentity = useApp((state) => state.setIdentity);
  const identity = auth.isLoaded && auth.isSignedIn && auth.userId ? `user:${auth.userId}` : ANONYMOUS_IDENTITY;

  configureHostedSession({
    hosted: true,
    userId: auth.userId ?? null,
    getToken: auth.getToken,
  });

  useEffect(() => {
    resetSyncState();
    void setIdentity(identity);
  }, [identity, setIdentity]);

  if (!auth.isLoaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-body text-muted" role="status">
        Loading account…
      </div>
    );
  }
  if (storeIdentity !== identity) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-body text-muted" role="status">
        Loading account data…
      </div>
    );
  }
  if (!auth.isSignedIn) return <PublicLanding />;

  const signOut = async () => {
    resetSyncState();
    await setIdentity(ANONYMOUS_IDENTITY);
    try {
      await clerk.signOut();
    } catch (error) {
      resetSyncState();
      await setIdentity(identity);
      throw error;
    }
  };

  return (
    <SessionContext.Provider
      value={{
        hosted: true,
        userId: auth.userId ?? null,
        displayName: user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || 'Account',
        signOut,
        manageAccount: () => clerk.openUserProfile(),
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

function LocalIdentityGate({ children }: { children: ReactNode }) {
  const identity = useApp((state) => state.identity);
  const setIdentity = useApp((state) => state.setIdentity);

  useEffect(() => {
    resetSyncState();
    void setIdentity(LOCAL_IDENTITY);
  }, [setIdentity]);

  if (identity !== LOCAL_IDENTITY) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-body text-muted" role="status">
        Loading local data…
      </div>
    );
  }
  return children;
}

export function AuthShell({ children }: { children: ReactNode }) {
  if (window.location.pathname === '/status') return <StatusPage />;
  const legal = LEGAL[window.location.pathname];
  if (legal) return <LegalPage document={legal} />;
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey || DESKTOP_LAUNCHER_ORIGIN.test(window.location.origin)) {
    configureHostedSession({ hosted: false, userId: null });
    return (
      <SessionContext.Provider value={{ ...useLocalSession }}>
        <LocalIdentityGate>{children}</LocalIdentityGate>
      </SessionContext.Provider>
    );
  }
  if (window.location.pathname === '/sso-callback') {
    return (
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        <SsoCallback />
      </ClerkProvider>
    );
  }
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkGate>{children}</ClerkGate>
    </ClerkProvider>
  );
}

const useLocalSession: SessionContextValue = {
  hosted: false,
  userId: null,
  displayName: 'Local mode',
  signOut: async () => undefined,
  manageAccount: () => undefined,
};

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
