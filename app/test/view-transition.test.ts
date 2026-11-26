import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startViewTransitionOf } from '../src/view-transition';

function deferred() {
  let resolve!: () => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeViewTransitionWithTypes {
  get types(): Set<string> {
    return new Set<string>();
  }
}

describe('startViewTransitionOf', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.vt;
  });

  afterEach(() => {
    delete document.documentElement.dataset.vt;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('returns undefined when the browser lacks view transitions', () => {
    Reflect.set(document, 'startViewTransition', undefined);
    expect(startViewTransitionOf('game-logo', vi.fn())).toBeUndefined();
    expect(document.documentElement.dataset.vt).toBeUndefined();
  });

  it('passes types directly when ViewTransition.prototype.types exists', () => {
    vi.stubGlobal('ViewTransition', FakeViewTransitionWithTypes);
    const fakeTransition = { finished: Promise.resolve() } as unknown as ViewTransition;
    const start = vi.fn(() => fakeTransition);
    Reflect.set(document, 'startViewTransition', start);
    const update = vi.fn();

    const result = startViewTransitionOf('game-logo', update);

    expect(result).toBe(fakeTransition);
    expect(start).toHaveBeenCalledWith({ update, types: ['game-logo'] });
    expect(document.documentElement.dataset.vt).toBeUndefined();
  });

  it('falls back to data-vt when ViewTransition types are unsupported and cleans up on finish', async () => {
    vi.stubGlobal('ViewTransition', undefined);
    const fin = deferred();
    let seenVtDuringUpdate: string | undefined;
    const start = vi.fn((arg: unknown) => {
      seenVtDuringUpdate = document.documentElement.dataset.vt;
      (arg as () => void)();
      return { finished: fin.promise } as unknown as ViewTransition;
    });
    Reflect.set(document, 'startViewTransition', start);
    const update = vi.fn();

    startViewTransitionOf('look', update);

    expect(seenVtDuringUpdate).toBe('look');
    expect(update).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(update);
    expect(document.documentElement.dataset.vt).toBe('look');

    fin.resolve();
    await vi.waitFor(() => expect(document.documentElement.dataset.vt).toBeUndefined());
  });

  it('falls back cleanly when the options overload throws and keeps newer data-vt alive', async () => {
    vi.stubGlobal('ViewTransition', FakeViewTransitionWithTypes);
    const first = deferred();
    const second = deferred();
    const pending = [first.promise, second.promise];
    const start = vi.fn((arg: unknown) => {
      if (typeof arg !== 'function') throw new TypeError('Unsupported options');
      (arg as () => void)();
      return { finished: pending.shift()! } as unknown as ViewTransition;
    });
    Reflect.set(document, 'startViewTransition', start);

    startViewTransitionOf('game-logo', vi.fn());
    expect(document.documentElement.dataset.vt).toBe('game-logo');

    startViewTransitionOf('look', vi.fn());
    expect(document.documentElement.dataset.vt).toBe('look');

    first.reject(new Error('skipped'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.vt).toBe('look');

    second.resolve();
    await vi.waitFor(() => expect(document.documentElement.dataset.vt).toBeUndefined());
  });
});
