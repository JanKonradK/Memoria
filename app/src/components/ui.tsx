import { Children, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { tint } from '../util';

/**
 * Single page-width container shared by the header and every tab so all edges
 * align at any viewport. `className` is for vertical spacing only — width and
 * horizontal padding overrides won't win against the defaults reliably.
 */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[2160px] px-3 sm:px-6 ${className}`}>{children}</div>;
}

/**
 * Game identity mark: the game's short code in its accent color. Replaces the
 * old emoji icons everywhere — reads instantly at a glance and never depends
 * on the user having set an icon.
 */
export function GameBadge({
  short,
  color,
  color2,
  size = 'md',
  className = '',
}: {
  short: string;
  color: string;
  color2?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = { sm: 'h-4 px-1 text-micro', md: 'h-5 px-1.5 text-[0.5625rem]', lg: 'h-7 px-2 text-label' };
  const c2 = color2 ?? color;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-ui-sm font-black uppercase tracking-wider ${sizes[size]} ${className}`}
      style={{
        color,
        background: `linear-gradient(135deg, ${tint(color, 0.16)}, ${tint(c2, 0.26)})`,
        boxShadow: `inset 0 0 0 1px ${tint(color, 0.45)}`,
      }}
    >
      {short}
    </span>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-label font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'min-h-11 w-full rounded-ui-lg bg-white/[0.09] px-3 py-2 text-body text-fg ring-1 ring-white/15 outline-none placeholder:text-dim focus:bg-white/[0.12] transition sm:min-h-9';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="numeric"
      {...props}
      className={`${inputCls} tabular-nums ${props.className ?? ''}`}
    />
  );
}

interface SelectOpt {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

function collectOptions(children: ReactNode): SelectOpt[] {
  const out: SelectOpt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
    if (child.type === 'option') {
      out.push({ value: String(props.value ?? ''), label: props.children, disabled: Boolean(props.disabled) });
    } else if (props.children) {
      out.push(...collectOptions(props.children));
    }
  });
  return out;
}

const RADIX_EMPTY_VALUE = '__technogg_empty_value__';
const toRadixValue = (value: string) => (value === '' ? RADIX_EMPTY_VALUE : value);
const fromRadixValue = (value: string) => (value === RADIX_EMPTY_VALUE ? '' : value);

/** Radix-backed select with the existing `<Select><option /></Select>` call-site API. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { value, defaultValue, onChange, children, className = '', disabled, name, required } = props;
  const ariaLabel = props['aria-label'];
  const opts = collectOptions(children);
  const current = opts.find((o) => o.value === String(value ?? ''));

  return (
    <SelectPrimitive.Root
      value={value == null ? undefined : toRadixValue(String(value))}
      defaultValue={defaultValue == null ? undefined : toRadixValue(String(defaultValue))}
      disabled={disabled}
      name={name}
      required={required}
      onValueChange={(next) =>
        onChange?.({ target: { value: fromRadixValue(next) } } as unknown as React.ChangeEvent<HTMLSelectElement>)
      }
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={`${inputCls} group flex items-center justify-between gap-2 text-left disabled:opacity-40 ${className}`}
      >
        <SelectPrimitive.Value>
          <span className="truncate">{current?.label ?? <span className="text-dim">—</span>}</span>
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            className="shrink-0 text-muted transition duration-200 group-data-[state=open]:rotate-180"
            fill="currentColor"
            aria-hidden
          >
            <path d="M5.5 7.5l4.5 5 4.5-5z" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="fade-in z-[80] max-h-60 w-[var(--radix-select-trigger-width)] min-w-max overflow-hidden rounded-ui-lg bg-popover p-1 shadow-2xl ring-1 ring-white/20"
        >
          <SelectPrimitive.Viewport className="max-h-60 overflow-y-auto scrollbar-thin">
            {opts.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadixValue(option.value)}
                disabled={option.disabled}
                textValue={typeof option.label === 'string' ? option.label : undefined}
                className="relative flex min-h-11 cursor-default select-none items-center rounded-ui-md px-3 py-2 pr-8 text-body text-fg-soft outline-none transition data-[disabled]:opacity-40 data-[highlighted]:bg-white/10 data-[state=checked]:bg-white/15 data-[state=checked]:font-semibold sm:min-h-9 sm:py-1.5"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 text-accent">
                  ✓
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} min-h-20 resize-y font-mono text-xs ${props.className ?? ''}`} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-body text-slate-300 sm:min-h-9">
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-ui-full bg-white/10 transition-colors duration-200 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-accent-2"
        aria-label={ariaLabel ?? label}
      >
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-ui-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
      </SwitchPrimitive.Root>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="inline-flex rounded-ui-lg bg-white/[0.06] p-0.5 ring-1 ring-white/10"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className="h-7 rounded-ui-md px-3 text-xs font-semibold text-muted transition hover:text-fg-soft data-[state=on]:bg-white/15 data-[state=on]:text-white"
          >
            {option.label}
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

/** Radix tooltip used for terse countdown abbreviations and icon-only affordances. */
export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          collisionPadding={8}
          className="fade-in z-[90] max-w-64 rounded-ui-sm bg-surface-2 px-2 py-1 text-caption text-fg-soft shadow-xl ring-1 ring-line"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-2" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Btn({
  children,
  onClick,
  kind = 'ghost',
  className = '',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'min-h-11 rounded-ui-lg px-4 py-2 text-body font-semibold transition active:scale-[0.97] disabled:opacity-40 sm:min-h-9';
  const kinds = {
    primary:
      'bg-gradient-to-br from-accent to-accent-2 text-white hover:brightness-110 shadow-lg shadow-accent-2/25 ring-1 ring-white/15',
    ghost: 'bg-white/[0.06] text-fg-soft ring-1 ring-white/10 hover:bg-white/[0.1]',
    danger: 'bg-danger/15 text-rose-200 ring-1 ring-rose-400/30 hover:bg-danger/25',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`${base} ${kinds[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-widest text-muted first:mt-0">{children}</h3>;
}
