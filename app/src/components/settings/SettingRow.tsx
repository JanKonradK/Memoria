import { useId, type ReactNode } from 'react';

/**
 * How a row's note reads. `say` explains, in the quiet italic voice, and
 * Minimal mode takes it off the screen. `fact` is something the row reports
 * (a count, a time, a schedule, a version) and `warn` is something that needs
 * doing: both stay on screen in every mode, upright, so a numeral is never
 * slanted and a permission problem is never hidden.
 */
export type HintKind = 'say' | 'fact' | 'warn';

const HINT_CLASS: Record<HintKind, string> = {
  say: 'say aside text-meta text-muted',
  fact: 'fact text-meta font-normal not-italic text-muted',
  warn: 'fact text-meta font-normal not-italic text-warn-fg',
};

/**
 * One setting: its name and a short note on the left, the control on the right.
 * Rows stack under each other with a hairline between them; on a phone the
 * control drops under the text when the two do not fit side by side.
 */
export function SettingRow({
  label,
  hint,
  hintKind = 'say',
  children,
  control = 'end',
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** `fact` and `warn` keep the note on screen in Minimal mode; see `HintKind`. */
  hintKind?: HintKind;
  /** A row that only reports, such as the version, has no control. */
  children?: ReactNode;
  /** `below` puts a wide control (buttons, a picker) under the text at every width. */
  control?: 'end' | 'below';
}) {
  const id = useId();
  return (
    <div className="settings-row" data-control={control} role="group" aria-labelledby={id}>
      <div className="settings-row-text">
        <p id={id} className="text-body font-semibold text-fg">
          {label}
        </p>
        {hint && <p className={HINT_CLASS[hintKind]}>{hint}</p>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

/** A pane's own subheading, for panes holding more than one group of rows. */
export function SettingsGroup({
  title,
  action,
  children,
}: {
  title: string;
  /** A control that belongs to the whole group, set at the end of its heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="settings-group min-w-0" aria-labelledby={headingId}>
      <div className="settings-group-heading">
        <h3 id={headingId} className="text-lead font-semibold text-fg">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
