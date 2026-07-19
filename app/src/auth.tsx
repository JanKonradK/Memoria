import { ClerkProvider, SignInButton, SignUpButton, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { configureHostedSession } from './auth-session';

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
        "Account identity is handled by Clerk. Techno's Library stores your planner document in Cloudflare D1 and keeps an offline copy in this browser.",
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
        "Techno's Library is a free planning tool provided without guarantees of uninterrupted availability. Fair-use limits protect the shared service.",
      ],
      [
        'Your account',
        'You are responsible for account security and for ensuring information you enter or connect may lawfully be processed.',
      ],
      ['Affiliation', "Techno's Library is not affiliated with HoYoverse or other game publishers."],
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
      <a href="/" className="text-sm font-semibold text-violet-300">
        ← Techno's Library
      </a>
      <h1 className="mt-6 text-3xl font-black text-slate-50">{document.title}</h1>
      <div className="mt-8 space-y-4">
        {document.sections.map(([title, body]) => (
          <section key={title} className="glass gold-hairline rounded-3xl p-5">
            <h2 className="font-black text-slate-100">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
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
      <a href="/" className="text-sm font-semibold text-violet-300">
        ← Techno's Library
      </a>
      <h1 className="mt-6 text-3xl font-black text-slate-50">Service status</h1>
      <section className="glass gold-hairline mt-8 rounded-3xl p-5" role="status">
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
        <p className="mt-2 text-sm text-slate-400">
          Offline app data remains available even during a cloud-service interruption.
        </p>
      </section>
    </main>
  );
}

function PublicLanding() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-5 py-16">
      <div className="max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-fuchsia-300">Offline-first gacha planner</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-50 sm:text-6xl">
          Know what resets next. Waste less energy.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
          Techno's Library keeps server resets, energy caps, dailies and events together across your games. Your browser remains
          usable offline; an account adds encrypted cloud sync and closed-app alerts.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <SignUpButton mode="modal">
            <button
              type="button"
              className="min-h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-5 py-3 text-sm font-bold text-white ring-1 ring-white/20"
            >
              Create free account
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button
              type="button"
              className="min-h-11 rounded-2xl bg-white/[0.06] px-5 py-3 text-sm font-bold text-slate-100 ring-1 ring-white/15"
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
          <section key={title} className="glass gold-hairline rounded-3xl p-5">
            <h2 className="font-black text-slate-100">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
          </section>
        ))}
      </div>
      <nav className="mt-8 flex flex-wrap gap-4 text-xs text-slate-500" aria-label="Legal">
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

  configureHostedSession({
    hosted: true,
    userId: auth.userId ?? null,
    getToken: auth.getToken,
  });

  if (!auth.isLoaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-slate-400" role="status">
        Loading account…
      </div>
    );
  }
  if (!auth.isSignedIn) return <PublicLanding />;

  return (
    <SessionContext.Provider
      value={{
        hosted: true,
        userId: auth.userId ?? null,
        displayName: user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || 'Account',
        signOut: () => clerk.signOut(),
        manageAccount: () => clerk.openUserProfile(),
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  if (window.location.pathname === '/status') return <StatusPage />;
  const legal = LEGAL[window.location.pathname];
  if (legal) return <LegalPage document={legal} />;
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    configureHostedSession({ hosted: false, userId: null });
    return <SessionContext.Provider value={{ ...useLocalSession }}>{children}</SessionContext.Provider>;
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
