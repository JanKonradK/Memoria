import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../reporting';
import { Btn } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TechnoGG render failed', error, info);
    void reportClientError(error, info.componentStack ?? 'render');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12">
        <section className="glass gold-hairline w-full max-w-lg rounded-3xl p-6" role="alert">
          <p className="text-xs font-bold uppercase tracking-widest text-rose-300">Something went wrong</p>
          <h1 className="mt-2 text-xl font-black text-slate-100">The interface could not finish rendering.</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your local data has not been deleted. Reload the app first; if this keeps happening, export a backup from
            Settings after the app recovers.
          </p>
          <details className="mt-4 rounded-xl bg-black/30 p-3 text-xs text-slate-400">
            <summary className="cursor-pointer font-semibold text-slate-300">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
          </details>
          <div className="mt-5">
            <Btn kind="primary" onClick={() => window.location.reload()}>
              Reload app
            </Btn>
          </div>
        </section>
      </main>
    );
  }
}
