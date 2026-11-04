import { useId, type ReactNode } from 'react';

/**
 * One setting: its name and a short note on the left, the control on the right.
 * Rows stack under each other with a hairline between them; on a phone the
 * control drops under the text when the two do not fit side by side.
 */
export function SettingRow({
  label,
  hint,
  children,
  control = 'end',
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
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
        {hint && <p className="aside text-meta text-muted">{hint}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
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
