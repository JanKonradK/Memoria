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
import { Ring } from './Ring';

/**
 * Single page-width container shared by every tab so all edges and shell
 * clearance align at any viewport. `className` is for vertical spacing only —
 * width and horizontal padding overrides won't win against the defaults reliably.
 */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  // The full window is the canvas: chrome now lives in the app bar at the top
  // edge, so there is no floating rail to reserve clearance for and no reason to
  // cap the width. The bottom padding is ordinary breathing room, not a keep-out
  // zone for something overlapping the page.
  return <div className={`w-full px-3 pb-8 pt-3 sm:px-4 ${className}`}>{children}</div>;
}

/**
 * Game identity mark: the game's short code in its accent color. Replaces the
 * old emoji icons everywhere — reads instantly at a glance and never depends
 * on the user having set an icon.
 *
 * The badge reads the ground itself rather than taking it as a prop. Ten call
 * sites across six files pass nothing but the game, and none of them has any
 * business knowing what the badge is being painted against — the theme is not
 * their concern, and threading it through would have made a theme change touch
 * every one of them.
 */
export function GameBadge({
  short,
  color,
  color2,
  color3,
  size = 'md',
  progress,
  className = '',
}: {
  short: string;
  color: string;
  color2?: string;
  color3?: string;
  size?: 'sm' | 'md' | 'lg';
  /** 0..1 — closes the ring's gap. Pass where checklist data is already to hand. */
  progress?: number;
  className?: string;
}) {
  // An INCOMPLETE RING around the short code. Shorts are user-editable and
  // arbitrary (the presets alone include 'WuWa'), so a strict circle would clip
  // worse than the old hexagon did. The ring is a stadium: circular caps, flat
  // edges that stretch to the label. Sized to its own content via inline-flex
  // padding rather than an estimated per-character width, because estimating
  // undercounts wide glyphs like W.
  //
  // Three steps, one letter-spacing. The sizes used to run 20/24/32 against
  // three different tracking values chosen per size, which is two scales doing
  // one job; md moves to 26 so the steps are even.
  const badgeHeights = { sm: 20, md: 26, lg: 32 } as const;
  const strokeWidths = { sm: 1.5, md: 1.75, lg: 2 } as const;
  const textSizes = { sm: 'text-caption', md: 'text-caption', lg: 'text-label' };
  const height = badgeHeights[size];
  const strokeWidth = strokeWidths[size];
  const c2 = color2 ?? color;
  // Default leaves a deliberate gap so the "incomplete" language reads even
  // where no progress data is available.
  const sweep = progress == null ? 0.82 : Math.min(1, Math.max(0, progress));

  // Every surface here used to be `tint()`, which is a white-ish alpha over
  // whatever is behind it. On charcoal that lifts; on cream it evaporates, and
  // a pale primary drew a white badge on a white ground. Mixing toward the
  // actual ground gives the same softening in either direction.
  const ground = useGround();
  const ink = gameTitleInk({ color, color2, color3 }, ground);
  const rim = gameRim({ color, color2, color3 }, ground);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center align-middle font-black tracking-wider ${textSizes[size]} ${className}`}
      style={{
        height,
        minWidth: height,
        paddingInline: height * 0.42,
        borderRadius: height / 2,
        background: `linear-gradient(135deg, ${mix(rim, ground, 0.1)}, ${mix(c2, ground, 0.16)})`,
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0">
        <Ring
          size={height}
          width="fluid"
          strokeWidth={strokeWidth}
          sweep={sweep}
          stroke={[ink, rim]}
          track={mix(rim, ground, 0.22)}
        />
      </span>
      <span className="relative leading-none" style={{ color: ink }}>
        {short}
      </span>
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
  'min-h-11 w-full rounded-ui-lg bg-fill-2 px-3 py-2 text-body text-fg ring-1 ring-line-edge outline-none placeholder:text-muted focus:bg-fill-3 transition sm:min-h-9';

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
          className="fade-in z-[80] max-h-60 w-[var(--radix-select-trigger-width)] min-w-max overflow-hidden rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
        >
          <SelectPrimitive.Viewport className="max-h-60 overflow-y-auto scrollbar-thin">
            {opts.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadixValue(option.value)}
                disabled={option.disabled}
                textValue={typeof option.label === 'string' ? option.label : undefined}
                className="relative flex min-h-11 cursor-default select-none items-center rounded-ui-md px-3 py-2 pr-8 text-body text-fg-soft outline-none transition data-[disabled]:opacity-40 data-[highlighted]:bg-fill-3 data-[state=checked]:bg-fill-4 data-[state=checked]:font-semibold sm:min-h-9 sm:py-1.5"
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
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  ariaLabel?: string;
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
      className="inline-flex rounded-ui-full border border-line-hairline bg-inset p-[3px]"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="relative min-h-8 rounded-ui-full border border-transparent px-3 text-meta font-semibold text-muted transition-colors hover:text-fg-soft disabled:cursor-default disabled:hover:text-muted data-[state=on]:text-fg"
          >
            {option.value === value && (
              <m.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-ui-full border border-line-strong bg-surface-2"
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
  kind = 'ghost',
  className = '',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
}) {
  const base =
    'btn-compact min-h-8 rounded-ui-md px-3 py-1 text-caption font-semibold transition active:scale-[0.97] disabled:opacity-40';
  const kinds = {
    primary: 'bg-gradient-to-br from-accent to-accent-2 text-fg-invert hover:brightness-110 ring-1 ring-line-edge',
    ghost: 'bg-fill-2 text-fg-soft ring-1 ring-line-hairline hover:bg-fill-3',
    danger: 'bg-danger/15 text-danger-fg ring-1 ring-danger/30 hover:bg-danger/25',
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${kinds[kind]} ${className}`}>
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
  return (
    <Heading className="mb-2 mt-6 text-meta font-bold uppercase tracking-widest text-muted first:mt-0">
      {children}
    </Heading>
  );
}
