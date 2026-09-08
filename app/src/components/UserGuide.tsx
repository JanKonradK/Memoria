import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, m, usePresence } from 'motion/react';
import { useUI, type Tab } from '../ui-store';
import { useApp } from '../store';
import { useReducedMotion } from '../hooks';
import { Btn } from './ui';
import { Logo } from './Logo';

type Step = { title: string; body: string; target: string; tab: Tab; focus?: boolean };
type Bounds = { x: number; y: number; width: number; height: number };

/** A tour of the real controls. No cloned screens or sample progress. */
export function UserGuide({ open }: { open: boolean }) {
  const [present, safeToRemove] = usePresence();
  const reduced = useReducedMotion();
  const finishTour = useUI((s) => s.finishTour);
  const games = useApp((s) => s.state.games);
  const firstGameId = games.find((game) => !game.deleted)?.id;
  const original = useRef({ tab: useUI.getState().tab, focus: useUI.getState().focusedGameId });
  const [index, setIndex] = useState(0);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [readyTarget, setReadyTarget] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [panelHeight, setPanelHeight] = useState(250);
  const panelRef = useRef<HTMLDivElement>(null);
  const maskId = useId().replaceAll(':', '');
  const steps = useMemo<Step[]>(
    () => [
      {
        title: 'Your daily run starts here',
        body: 'I’m Memoria. I keep your games, energy and deadlines in one place. Let’s take a quick look around.',
        target: '[data-tour="pages"]',
        tab: 'home',
      },
      {
        title: 'Build your roster',
        body: 'Use Add to choose a game from its preset. This is also where you add events and reminders. Each account can have its own server and nickname.',
        target: '[data-tour="add"]',
        tab: 'home',
      },
      {
        title: 'One game, your full attention',
        body: 'Choose a game here to focus the whole workspace. Your choice follows you between pages. All games brings the roster back.',
        target: '[data-tour="focus"]',
        tab: 'home',
      },
      ...(firstGameId
        ? [
            {
              title: 'Keep an eye on your energy',
              body: 'Enter the value shown in your game. Use the minus buttons or quick spends after a run. Weekly stock, such as City Stamina, starts full and refills at its weekly reset.',
              target: '[data-tour="resources"]',
              tab: 'home' as const,
              focus: true,
            },
            {
              title: 'Check it off',
              body: 'Click a task when it is done. Counters track each run. Start a timer after using or collecting an item; its red, unchecked ring means it is ready again.',
              target: '[data-tour="tasks"]',
              tab: 'home' as const,
              focus: true,
            },
          ]
        : []),
      {
        title: 'See what is coming',
        body: 'Each bar is an event. Select it to edit its dates or notes. The small check beside it marks it done. The red line is now.',
        target: '[data-tour="timeline"]',
        tab: 'timeline',
      },
      {
        title: 'Find the window you need',
        body: 'Switch between Timeline and List here. The magnifying glass finds an event by name. The history button includes finished events.',
        target: '[data-tour="timeline-tools"]',
        tab: 'timeline',
      },
      {
        title: 'Make yourself at home',
        body: 'Choose where Tonight sits, edit your games, and export a backup here. You can replay this tour with User guide. You’re ready to cook.',
        target: '[data-tour="settings"]',
        tab: 'settings',
      },
    ],
    [firstGameId],
  );
  const step = steps[index]!;
  const close = () => {
    finishTour();
    useUI.getState().setTab(original.current.tab);
    useUI.getState().setFocusedGameId(original.current.focus);
  };

  useEffect(() => {
    if (!present) return;
    const ui = useUI.getState();
    ui.setTab(step.tab);
    ui.setFocusedGameId(step.focus && firstGameId ? firstGameId : original.current.focus);
    setReadyTarget(null);
    let frame = 0;
    let retries = 0;
    let observed: Element | null = null;
    const observer = new ResizeObserver(() => measure());
    const measure = () => {
      if (panelRef.current) setPanelHeight(panelRef.current.offsetHeight);
      // Custom games can have no resources or tasks. Keep those steps usable
      // by highlighting their workspace once the route has settled.
      const target =
        document.querySelector<HTMLElement>(step.target) ??
        (retries >= 44 && step.focus ? document.getElementById('main-content') : null);
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport((old) => (old.width === width && old.height === height ? old : { width, height }));
      if (!target || target.getBoundingClientRect().width === 0) return;
      setReadyTarget(step.target);
      if (observed !== target) {
        if (observed) observer.unobserve(observed);
        observed = target;
        observer.observe(target);
        const box = target.getBoundingClientRect();
        if (box.top < 0 || box.top >= height) target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
      const r = target.getBoundingClientRect();
      const x = Math.max(6, r.left - 5);
      const y = Math.max(6, r.top - 5);
      const next = {
        x,
        y,
        width: Math.max(0, Math.min(width - 6, r.right + 5) - x),
        height: Math.max(0, Math.min(height - 6, r.bottom + 5) - y),
      };
      setBounds((old) =>
        old && Object.keys(next).every((key) => old[key as keyof Bounds] === next[key as keyof Bounds]) ? old : next,
      );
    };
    // Lazy routes and their first animation need more than one measurement.
    const settle = () => {
      measure();
      if (++retries < 45) frame = requestAnimationFrame(settle);
    };
    if (panelRef.current) observer.observe(panelRef.current);
    frame = requestAnimationFrame(settle);
    const mutation = new MutationObserver(measure);
    const root = document.getElementById('root');
    if (root) mutation.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, present, firstGameId]);

  // Keep the dialogue near the target, within the viewport at browser zoom.
  const panelWidth = Math.min(400, viewport.width - 24);
  const panelLeft = bounds
    ? Math.max(12, Math.min(viewport.width - panelWidth - 12, bounds.x))
    : (viewport.width - panelWidth) / 2;
  const below = bounds ? bounds.y + bounds.height + 16 : 100;
  const panelTop =
    bounds && below + panelHeight <= viewport.height - 12 ? below : Math.max(12, viewport.height - panelHeight - 16);
  const transition = { duration: reduced ? 0 : 0.18, ease: 'easeOut' as const };

  return (
    <Dialog.Root
      open={open && present}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal forceMount>
        <AnimatePresence onExitComplete={safeToRemove ?? undefined}>
          {open && present && (
            <m.div
              key="tour"
              data-layer="tour"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              className="fixed inset-0 z-[70]"
            >
              <Dialog.Overlay asChild>
                <div className="fixed inset-0">
                  <svg aria-hidden className="absolute inset-0 h-full w-full">
                    <defs>
                      <mask id={maskId}>
                        <rect width="100%" height="100%" fill="white" />
                        {bounds && <m.rect animate={bounds} transition={transition} rx="10" fill="black" />}
                      </mask>
                    </defs>
                    <rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask={`url(#${maskId})`} />
                    {bounds && (
                      <m.rect
                        data-tour-highlight
                        animate={bounds}
                        transition={transition}
                        rx="10"
                        fill="none"
                        stroke="var(--color-accent-fg)"
                        strokeWidth="2"
                      />
                    )}
                  </svg>
                </div>
              </Dialog.Overlay>
              <Dialog.Content
                ref={panelRef}
                onPointerDownOutside={(event) => event.preventDefault()}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  panelRef.current?.focus();
                }}
                tabIndex={-1}
                className="tour-dialog fixed rounded-ui-xl border border-line-strong bg-popover p-5 text-fg shadow-float outline-none"
                style={{
                  left: panelLeft,
                  top: panelTop,
                  width: panelWidth,
                  maxHeight: viewport.height - 24,
                  overflowY: 'auto',
                }}
              >
                <div className="mb-3 flex items-center gap-2 text-caption font-semibold text-accent-fg">
                  <Logo className="[&>svg]:h-4 [&>svg]:w-8" />
                  <span>MEMORIA · QUICK START</span>
                  <span className="ml-auto text-muted">
                    {index + 1} / {steps.length}
                  </span>
                </div>
                <div aria-live="polite" aria-atomic="true">
                  <Dialog.Title className="text-heading font-semibold">{step.title}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-body leading-relaxed text-fg-soft">
                    {step.body}
                  </Dialog.Description>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button className="mr-auto min-h-9 text-meta text-muted hover:text-fg" onClick={close}>
                    Let me cook
                  </button>
                  {index > 0 && <Btn onClick={() => setIndex((current) => current - 1)}>Back</Btn>}
                  <Btn
                    kind="primary"
                    disabled={readyTarget !== step.target}
                    onClick={() => (index === steps.length - 1 ? close() : setIndex((current) => current + 1))}
                  >
                    {index === steps.length - 1 ? 'Finish' : 'Next'}
                  </Btn>
                </div>
              </Dialog.Content>
            </m.div>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
