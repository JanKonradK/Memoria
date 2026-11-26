import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { gameRim, gameTitleInk, mix } from '../game-color';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { cssEasing, duration, easing } from '../motion';
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
 * are a measurement; `NA`, `EU`, `ASIA` and `UTC` are words.
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

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-meta font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** A field's box, without its vertical padding: one line sits in --control-h, a textarea pads itself. */
const fieldCls =
  'ui-input min-h-(--control-h) w-full rounded-ui-lg bg-fill-2 px-3 text-body text-fg ring-1 ring-line-edge outline-none placeholder:text-muted focus:bg-fill-3 transition';
const inputCls = `${fieldCls} py-1`;

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
  /** The `<optgroup>` label this option sits under. */
  group?: string;
}

function collectOptions(children: ReactNode, group?: string): SelectOpt[] {
  const out: SelectOpt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean; label?: string };
    if (child.type === 'option') {
      out.push({ value: String(props.value ?? ''), label: props.children, disabled: Boolean(props.disabled), group });
    } else if (props.children) {
      out.push(...collectOptions(props.children, child.type === 'optgroup' ? props.label : group));
    }
  });
  return out;
}

/** Options in runs that share a group, in order, so each run gets one heading. */
function groupRuns(options: SelectOpt[]): { group?: string; options: SelectOpt[] }[] {
  const runs: { group?: string; options: SelectOpt[] }[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }
  return runs;
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
            {groupRuns(opts).map((run, index) => (
              <SelectPrimitive.Group key={`${run.group ?? ''}-${index}`}>
                {run.group && (
                  <SelectPrimitive.Label className="px-3 pb-1 pt-2 text-label font-semibold text-muted">
                    {run.group}
                  </SelectPrimitive.Label>
                )}
                {run.options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={toRadixValue(option.value)}
                    disabled={option.disabled}
                    textValue={typeof option.label === 'string' ? option.label : undefined}
                    className="relative flex min-h-(--control-h) cursor-default select-none items-center rounded-ui-md px-3 py-1.5 pr-8 text-body text-fg-soft [overflow-wrap:anywhere] outline-none transition data-[disabled]:opacity-40 data-[highlighted]:bg-fill-3 data-[state=checked]:bg-fill-4 data-[state=checked]:font-semibold"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2 text-accent">
                      ✓
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
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
    <textarea {...props} className={`${fieldCls} min-h-20 resize-y py-2 text-meta ${props.className ?? ''}`} />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  ariaDescribedBy,
  disabled,
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** While a change is still being applied, so a second press cannot race it. */
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-h-(--control-h) items-center gap-2 text-body text-fg-soft ${className}`}>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="ui-switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-ui-full bg-fill-3 transition-colors duration-(--dur-fast) disabled:opacity-40 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-accent-2"
        aria-label={ariaLabel ?? label}
        aria-describedby={ariaDescribedBy}
      >
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-ui-full bg-fg shadow transition duration-(--dur-fast) data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-accent" />
      </SwitchPrimitive.Root>
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * The selected-option plate shared by `Segmented` and the editor's tab strip.
 * Measured from the selected control and slid there with a CSS transform, so
 * neither control needs the motion library's layout animations. It appears in
 * place, and slides only from the second position on.
 */
export function useSlidingIndicator(
  containerRef: RefObject<HTMLElement | null>,
  selected: string,
  selectedKey: string,
  reduced: boolean,
): CSSProperties {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const node = container.querySelector<HTMLElement>(selected);
      if (!node) {
        setBox(null);
        return;
      }
      // The control's padding box, inside any border it keeps for its own states.
      const next = {
        x: node.offsetLeft + node.clientLeft,
        y: node.offsetTop + node.clientTop,
        w: node.clientWidth,
        h: node.clientHeight,
      };
      setBox((prev) =>
        prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    // The options, not the (aria-hidden) indicator: it resizes on every slide,
    // and measuring it each frame would read layout for nothing.
    for (const child of Array.from(container.children)) if (!child.hasAttribute('aria-hidden')) observer.observe(child);
    return () => observer.disconnect();
  }, [containerRef, selected, selectedKey]);
  useEffect(() => {
    if (!box || placed) return;
    const frame = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(frame);
  }, [box, placed]);
  const motion = `${duration.base}s ${cssEasing(easing.move)}`;
  return box
    ? {
        width: box.w,
        height: box.h,
        transform: `translate(${box.x}px, ${box.y}px)`,
        transition: placed && !reduced ? `transform ${motion}, width ${motion}, height ${motion}` : 'none',
      }
    : { display: 'none' };
}

/** The plate itself: drawn once behind the options, then slid between them. */
export const INDICATOR_CLASS =
  'pointer-events-none absolute left-0 top-0 rounded-ui-md border border-line-strong bg-surface-2';

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
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const indicator = useSlidingIndicator(rootRef, '[data-state="on"]', value, reducedMotion);

  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      ref={rootRef}
      // The track is --control-h tall, level with a Btn, Select or TextInput beside it (index.css).
      className="ui-segmented relative inline-flex min-h-(--control-h) items-stretch rounded-ui-md border border-line-hairline bg-inset"
      aria-label={ariaLabel}
    >
      <span aria-hidden className={INDICATOR_CLASS} style={indicator} />
      {options.map((option) => {
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="relative rounded-ui-md border border-transparent px-3 text-meta font-semibold text-muted transition-colors hover:text-fg-soft disabled:cursor-default disabled:hover:text-muted data-[state=on]:text-fg"
          >
            <span className="relative z-10">{option.label}</span>
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

let silentFocusTarget: HTMLElement | null = null;

/** Move focus back after closing an overlay without popping any tooltip on that control. */
export function focusSilently(target: HTMLElement): void {
  silentFocusTarget = target;
  try {
    target.focus({ preventScroll: true });
  } finally {
    silentFocusTarget = null;
  }
}

function isFocusVisible(node: HTMLElement): boolean {
  try {
    return node.matches(':focus-visible');
  } catch {
    // Environments without :focus-visible support (jsdom) cannot distinguish pointer vs keyboard focus.
    return true;
  }
}

/** Radix tooltip used for terse countdown abbreviations and icon-only affordances. */
export function Tooltip({
  children,
  content,
  side,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  // A tip is a hover thing. On a touch screen a tap would flash it for a moment
  // over the thing being opened, so there the control stands alone.
  const hover = useMediaQuery('(hover: hover) and (pointer: fine)');
  // A tip with nothing to say stays closed rather than showing an empty bubble.
  if (!hover || content == null || content === '') return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        asChild
        onFocus={(event) => {
          const focused = event.target instanceof HTMLElement ? event.target : event.currentTarget;
          if ((silentFocusTarget && event.currentTarget.contains(silentFocusTarget)) || !isFocusVisible(focused)) {
            event.preventDefault();
          }
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
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

export type BtnKind = 'primary' | 'ghost' | 'danger' | 'quiet';
export type BtnSize = 'md' | 'sm' | 'icon';

const BTN_KINDS: Record<BtnKind, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 ring-1 ring-line-edge',
  ghost: 'bg-fill-2 text-fg-soft ring-1 ring-line-hairline hover:bg-fill-3',
  danger: 'bg-danger/15 text-danger-fg ring-1 ring-danger/30 hover:bg-danger/25',
  // No fill and no edge at rest: an action that sits among words, not beside fields.
  quiet: 'text-fg-soft hover:bg-fill-2 hover:text-fg',
};
const BTN_SIZES: Record<BtnSize, string> = {
  md: 'min-h-(--control-h) px-3 py-1',
  sm: 'min-h-(--control-h-sm) px-2.5 py-0.5',
  icon: 'inline-grid size-(--control-h) place-items-center p-0',
};

/** A button's look, for the few controls that must be another element (a file picker's label). */
export function btnClass(kind: BtnKind = 'ghost', size: BtnSize = 'md'): string {
  return `btn-compact rounded-ui-md text-caption font-semibold transition active:scale-[0.97] disabled:opacity-40 ${BTN_SIZES[size]} ${BTN_KINDS[kind]}`;
}

export function Btn({
  children,
  onClick,
  type = 'button',
  kind = 'ghost',
  size = 'md',
  className = '',
  disabled,
  ...props
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: BtnKind;
  /** `md` is --control-h, level with a field; `sm` sits inside a dense row; `icon` is square. */
  size?: BtnSize;
  className?: string;
  disabled?: boolean;
} & React.ComponentPropsWithRef<'button'>) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${btnClass(kind, size)} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A file picker that looks, sizes and focuses like a `Btn`. The input stays in
 * the tab order (sr-only, never `hidden`: display:none drops it out and the
 * label is not focusable), and the label draws the one focus ring.
 */
export function FileButton({
  children,
  accept,
  onFile,
  kind = 'ghost',
  size = 'md',
  disabled,
  className = '',
}: {
  children: ReactNode;
  accept: string;
  onFile: (file: File | undefined) => void;
  kind?: BtnKind;
  size?: BtnSize;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={`focus-ring-group inline-flex items-center justify-center ${btnClass(kind, size)} ${
        disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'
      } ${className}`}
    >
      {children}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared at once, so choosing the same file again still reports it.
          event.target.value = '';
          onFile(file);
        }}
      />
    </label>
  );
}

/**
 * A delete that asks first. The button itself becomes the question and the way
 * back appears beside it, so nothing is removed by one stray press.
 */
export function ConfirmDelete({
  label = 'Delete',
  what,
  onConfirm,
  className = '',
  disabled,
}: {
  label?: string;
  /** Names the thing for assistive tech, e.g. "task Daily Commissions". */
  what: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ConfirmAction
      kind="danger"
      label={label}
      confirmLabel="Confirm delete"
      ariaLabel={`Delete ${what}`}
      confirmAriaLabel={`Confirm delete ${what}`}
      cancelAriaLabel={`Keep ${what}`}
      onConfirm={onConfirm}
      className={className}
      disabled={disabled}
    />
  );
}

/** The same ask-first step for anything else that discards what the owner set up. */
export function ConfirmAction({
  label,
  confirmLabel,
  cancelLabel = 'Keep',
  ariaLabel,
  confirmAriaLabel,
  cancelAriaLabel,
  kind = 'ghost',
  onConfirm,
  className = '',
  disabled,
}: {
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  ariaLabel?: string;
  confirmAriaLabel?: string;
  cancelAriaLabel?: string;
  /** How the button looks before it is pressed. The question is always the danger style. */
  kind?: 'ghost' | 'danger';
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <Btn
        kind={asking ? 'danger' : kind}
        disabled={disabled}
        aria-label={asking ? confirmAriaLabel : ariaLabel}
        onClick={() => {
          if (!asking) return setAsking(true);
          setAsking(false);
          onConfirm();
        }}
      >
        {asking ? confirmLabel : label}
      </Btn>
      {asking && (
        <Btn aria-label={cancelAriaLabel} onClick={() => setAsking(false)}>
          {cancelLabel}
        </Btn>
      )}
    </span>
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
