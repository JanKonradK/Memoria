/** The app's view transitions, each scoped in CSS by its type. */
export type ViewTransitionKind = 'game-logo' | 'look';

/** The transition still holding data-vt, so an older one finishing never clears a newer one's. */
let marked: ViewTransition | undefined;

const typesSupported = () => typeof ViewTransition === 'function' && 'types' in ViewTransition.prototype;

/**
 * Starts a view transition of one kind. Its CSS rules match
 * `:active-view-transition-type(kind)`; a browser without transition types
 * (Chromium before 125, where the options form throws) runs the plain form and
 * carries the kind on <html> as data-vt until it is over. Undefined where the
 * browser has no view transitions at all: the caller just updates.
 */
export function startViewTransitionOf(kind: ViewTransitionKind, update: () => void): ViewTransition | undefined {
  if (typeof document.startViewTransition !== 'function') return undefined;
  if (typesSupported()) {
    try {
      return document.startViewTransition({ update, types: [kind] });
    } catch {
      // Named the options form but cannot take it: fall through to the plain one.
    }
  }
  const root = document.documentElement;
  // Before the old state is captured, so its rules already apply to it.
  root.dataset.vt = kind;
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(update);
  } catch (error) {
    delete root.dataset.vt;
    throw error;
  }
  marked = transition;
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (marked !== transition) return;
      marked = undefined;
      delete root.dataset.vt;
    });
  return transition;
}
