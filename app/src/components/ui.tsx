import { Children, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { m } from 'motion/react';
import { gameRim, gameTitleInk, mix } from '../game-color';
import { useReducedMotion } from '../hooks';
import { duration, easing } from '../motion';
import { useGround } from '../theme';

/**
 * Single page-width container shared by every tab so all edges and shell
 * clearance align at any viewport. `className` is for vertical spacing only —
 * width and horizontal padding overrides won't win against the defaults reliably.
 */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`app-page w-full px-3 pb-8 pt-3 sm:px-4 ${className}`}>{children}</div>;
}

/** Compact game identity, tinted against the current theme. */
export function GameBadge({
  short,
  color,
  color2,
  color3,
  size = 'md',
  interactive = false,
  className = '',
}: {
  short: string;
  color: string;
  color2?: string;
  color3?: string;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  className?: string;
}) {
  const height = { sm: 20, md: 26, lg: 32 }[size];
  const textSize = { sm: 'text-caption', md: 'text-meta', lg: 'text-body' }[size];
  const ground = useGround();
  const trio = { color, color2, color3 };
  const rim = gameRim(trio, ground);
  const fill = mix(rim, ground, 0.1);
  return (
    <span
      data-game-badge
      className={`inline-flex shrink-0 items-center justify-center rounded-ui-sm border align-middle font-semibold ${textSize} ${interactive ? 'transition-colors group-hover:border-current' : ''} ${className}`}
      style={{
        height,
        minWidth: height,
        paddingInline: height * 0.26,
        background: fill,
        color: gameTitleInk(trio, fill, 4.5),
        borderColor: mix(rim, ground, 0.25),
      }}
    >
      <span className="leading-none">{short}</span>
    </span>
  );
}

/**
 * A server label is `numeral` only when it is a real UTC offset. Those digits
 * are a measurement; `NA`, `EU`, `ASIA` and `UTC` are words. See The Mono Is For
 * Measurement Rule.
 */
export function serverLabelClass(label: string): string {
  return label.startsWith('UTC') && label !== 'UTC' ? 'numeral' : '';
}

/**
 * The server-region chip that rides beside a game's name on the card, the stage
 * summary, the timeline lane and every hub ticket.
 *
 * `sm` is the hub's tighter padding — the only difference between the four
 * copies this replaced, apart from the truncation the card needs.
 */
export function ServerChip({
  label,
  size = 'md',
  className = '',
  ...props
}: {
  label: string;
  size?: 'sm' | 'md';
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={`shrink-0 rounded-ui-sm border border-line-edge bg-inset text-caption font-semibold text-fg-soft ${
        size === 'sm' ? 'px-1 py-px' : 'px-1.5 py-0.5'
      } ${serverLabelClass(label)} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * Desktop-compact overrides for the 44px touch defaults. Dense editors — the
 * game editor, the resource editor, the Settings data column — opt out of the
 * touch height above `sm` rather than each field spelling the same two
 * overrides out.
 */
export const COMPACT_INPUT = 'sm:!min-h-8 sm:!py-1';
export const TOUCH_BUTTON = '!min-h-11 sm:!min-h-8';

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-meta font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'ui-input min-h-11 w-full rounded-ui-lg bg-fill-2 px-3 py-2 text-body text-fg ring-1 ring-line-edge outline-none placeholder:text-muted focus:bg-fill-3 transition sm:min-h-9';

export function TextInput(props: React.ComponentProps<'input'>) {
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

const RADIX_EMPTY_VALUE = '__void_empty_value__';
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
      onValueChange={(next) => {
        // A form's hidden native select can emit an empty reset during a
        // controlled update. Real empty options use our sentinel instead.
        if (next === '') return;
        onChange?.({ target: { value: fromRadixValue(next) } } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectPrimitive.Trigger
        id={props.id}
        aria-label={ariaLabel}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-errormessage={props['aria-errormessage']}
        className={`${inputCls} group flex min-w-0 items-center justify-between gap-2 text-left disabled:opacity-40 ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value>{current?.label ?? <span className="text-dim">—</span>}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            className="shrink-0 text-muted transition duration-(--dur-fast) group-data-[state=open]:rotate-180"
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
          className="popover-motion z-[80] max-h-[min(15rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-16px)] overflow-hidden rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
        >
          <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto scrollbar-thin">
            {opts.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadixValue(option.value)}
                disabled={option.disabled}
                textValue={typeof option.label === 'string' ? option.label : undefined}
                className="relative flex min-h-11 cursor-default select-none items-center rounded-ui-md px-3 py-2 pr-8 text-body text-fg-soft [overflow-wrap:anywhere] outline-none transition data-[disabled]:opacity-40 data-[highlighted]:bg-fill-3 data-[state=checked]:bg-fill-4 data-[state=checked]:font-semibold sm:min-h-9 sm:py-1.5"
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
  return (
    // No `font-mono` here: most textareas hold prose. Callers that hold code or
    // pasted data opt in themselves.
    <textarea {...props} className={`${inputCls} min-h-20 resize-y text-meta ${props.className ?? ''}`} />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  ariaDescribedBy,
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-h-11 items-center gap-2 text-body text-fg-soft sm:min-h-9 ${className}`}>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-ui-full bg-fill-3 transition-colors duration-(--dur-fast) data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-accent-2"
        aria-label={ariaLabel ?? label}
        aria-describedby={ariaDescribedBy}
      >
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-ui-full bg-fg shadow transition duration-(--dur-fast) data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-fg-invert" />
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
  /**
   * A disabled option is still rendered, and may still be the selected value.
   * That is the point: a control that can only express three of the states its
   * data can hold must show the fourth rather than quietly round it off.
   */
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const indicatorLayoutId = `${useId()}-segmented-indicator`;
  const reducedMotion = useReducedMotion();

  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="ui-segmented inline-flex rounded-ui-md border border-line-hairline bg-inset p-[3px]"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="relative min-h-8 rounded-ui-md border border-transparent px-3 text-meta font-semibold text-muted transition-colors hover:text-fg-soft disabled:cursor-default disabled:hover:text-muted data-[state=on]:text-fg"
          >
            {option.value === value && (
              <m.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-ui-md border border-line-strong bg-surface-2"
                layoutId={indicatorLayoutId}
                initial={false}
                transition={reducedMotion ? { duration: 0 } : { duration: duration.base, ease: easing.out }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
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
          className="fade-in z-[90] max-w-64 rounded-ui-sm bg-surface-2 px-2 py-1 text-caption text-fg-soft shadow-float ring-1 ring-line"
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
  type = 'button',
  kind = 'ghost',
  className = '',
  disabled,
  ...props
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
} & React.ComponentPropsWithRef<'button'>) {
  const base =
    'btn-compact min-h-8 rounded-ui-md px-3 py-1 text-caption font-semibold transition active:scale-[0.97] disabled:opacity-40';
  const kinds = {
    primary: 'bg-accent text-fg-invert hover:brightness-110 ring-1 ring-line-edge',
    ghost: 'bg-fill-2 text-fg-soft ring-1 ring-line-hairline hover:bg-fill-3',
    danger: 'bg-danger/15 text-danger-fg ring-1 ring-danger/30 hover:bg-danger/25',
  };
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${kinds[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Defaults to h3, which is right inside a sheet (the dialog title is the h2) and
 * under a panel heading. A section sitting directly under a page's own h1 must
 * pass level={2}, or the outline skips a level.
 */
export function SectionTitle({ children, level = 3 }: { children: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <Heading className="mb-2 mt-6 text-meta font-semibold text-muted first:mt-0">{children}</Heading>;
}
