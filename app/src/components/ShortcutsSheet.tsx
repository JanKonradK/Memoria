import { Fragment } from 'react';
import { useUI } from '../ui-store';
import { Sheet } from './Sheet';

/** One shortcut: the keys pressed together, then what they do. */
type Shortcut = { keys: string[]; does: string };

const GROUPS: { title: string; hint?: string; items: Shortcut[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Alt', '1'], does: 'Today' },
      { keys: ['Alt', '2'], does: 'Calendar' },
      { keys: ['Alt', '3'], does: 'Notes' },
      { keys: ['Alt', '4'], does: 'Games' },
      { keys: ['Alt', '5'], does: 'Settings' },
      { keys: ['Alt', '←'], does: 'Back from a game to Today' },
      { keys: ['Ctrl', '1–9'], does: 'Open your first to ninth game' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
  {
    title: 'Screenshots',
    items: [{ keys: ['Shift', 'S'], does: 'Snip screenshot reading (Windows app)' }],
  },
  {
    title: 'Energy',
    hint: 'While a bar’s value is being typed.',
    items: [
      { keys: ['A'], does: 'Down 10' },
      { keys: ['S'], does: 'Down 1' },
      { keys: ['D'], does: 'Up 1' },
      { keys: ['F'], does: 'Up 10' },
      { keys: ['Enter'], does: 'Save and go to the next bar' },
      { keys: ['Shift', 'Enter'], does: 'Save and go to the previous bar' },
      { keys: ['Esc'], does: 'Throw the typed value away' },
    ],
  },
  {
    title: 'Dialogs',
    items: [{ keys: ['Esc'], does: 'Close the open dialog' }],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-caption text-dim">
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && <span aria-hidden>+</span>}
          <kbd className="inline-flex min-w-7 justify-center rounded-ui-md bg-fill-2 px-1.5 py-0.5 font-sans text-caption font-semibold tabular-nums text-fg-soft ring-1 ring-line-hairline">
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** Every keyboard shortcut the app answers, grouped by where it works. */
export function ShortcutsSheet({ open }: { open: boolean }) {
  const closeSheet = useUI((s) => s.closeSheet);
  return (
    <Sheet open={open} onClose={closeSheet} title="Keyboard shortcuts">
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
            <h3 id={`shortcuts-${group.title}`} className="text-body font-bold text-fg">
              {group.title}
            </h3>
            {group.hint && <p className="mt-0.5 text-meta text-muted">{group.hint}</p>}
            <dl className="mt-2 divide-y divide-line-hairline">
              {group.items.map((item) => (
                <div
                  key={`${item.keys.join('+')}-${item.does}`}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <dt className="min-w-0 text-body text-fg-soft">{item.does}</dt>
                  <dd className="m-0">
                    <Keys keys={item.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
