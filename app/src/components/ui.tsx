import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { tint } from '../util';

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
  const sizes = { sm: 'h-4 px-1 text-[8px]', md: 'h-5 px-1.5 text-[9px]', lg: 'h-7 px-2 text-[11px]' };
  const c2 = color2 ?? color;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-black uppercase tracking-wider ${sizes[size]} ${className}`}
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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'min-h-11 w-full rounded-xl bg-white/[0.09] px-3 py-2 text-sm text-slate-50 ring-1 ring-white/15 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-astral)_70%,white)] focus:bg-white/[0.12] transition sm:min-h-9';

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
}

function collectOptions(children: ReactNode): SelectOpt[] {
  const out: SelectOpt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if (child.type === 'option') {
      out.push({ value: String(props.value ?? ''), label: props.children });
    } else if (props.children) {
      out.push(...collectOptions(props.children));
    }
  });
  return out;
}

/**
 * Fully custom dropdown (same `<Select><option/></Select>` API as a native
 * select). Native popup lists are OS-drawn and kept rendering white-on-white
 * on Windows regardless of CSS — so nothing native is used for the list.
 */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { value, onChange, children, className = '', disabled } = props;
  const ariaLabel = props['aria-label'];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const opts = collectOptions(children);
  const current = opts.find((o) => o.value === String(value ?? ''));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // keep the surrounding sheet open
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (v: string) => {
    setOpen(false);
    onChange?.({ target: { value: v } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          const i = Math.max(
            0,
            opts.findIndex((o) => o.value === String(value ?? '')),
          );
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = opts[(i + delta + opts.length) % opts.length];
            if (next) pick(next.value);
          } else if (e.key === 'Home' && opts[0]) {
            e.preventDefault();
            pick(opts[0].value);
          } else if (e.key === 'End' && opts.at(-1)) {
            e.preventDefault();
            pick(opts.at(-1)!.value);
          }
        }}
        className={`${inputCls} flex items-center justify-between gap-2 text-left disabled:opacity-40`}
      >
        <span className="truncate">{current?.label ?? <span className="text-slate-500">—</span>}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
          fill="currentColor"
          aria-hidden
        >
          <path d="M5.5 7.5l4.5 5 4.5-5z" />
        </svg>
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 top-full z-[60] mt-1 max-h-60 w-full min-w-max overflow-y-auto rounded-xl p-1 shadow-2xl ring-1 ring-white/20 scrollbar-thin"
          style={{ background: '#2b2347' }}
        >
          {opts.map((o) => {
            const selected = o.value === String(value ?? '');
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => pick(o.value)}
                className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm transition sm:min-h-9 sm:py-1.5 ${
                  selected ? 'bg-white/15 font-semibold text-white' : 'text-slate-100 hover:bg-white/10'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center gap-2 text-sm text-slate-300 sm:min-h-9"
      aria-pressed={checked}
      aria-label={ariaLabel ?? label}
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'bg-white/10'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
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
    <div
      className="inline-flex rounded-xl bg-white/[0.06] p-0.5 ring-1 ring-white/10"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`h-7 rounded-[10px] px-3 text-xs font-semibold transition ${
              active ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
    'min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-40 sm:min-h-9';
  const kinds = {
    primary:
      'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white hover:brightness-110 shadow-lg shadow-fuchsia-500/25 ring-1 ring-white/15',
    ghost: 'bg-white/[0.06] text-slate-200 ring-1 ring-white/10 hover:bg-white/[0.1]',
    danger: 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30 hover:bg-rose-500/25',
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
  return (
    <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-widest text-slate-400 first:mt-0">{children}</h3>
  );
}
