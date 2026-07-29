import { Ring } from './Ring';

/** A dashed incomplete ring, which reads as "empty slot". */
export function AddGameButton({ onAdd, size = 46 }: { onAdd: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label="Add game"
      className="group flex min-h-11 min-w-11 items-center justify-center rounded-ui-full transition active:scale-90"
    >
      <Ring
        size={size}
        strokeWidth={1.75}
        dashed
        stroke="rgba(200,180,255,0.42)"
        fill="rgba(255,255,255,0.025)"
        className="transition group-hover:brightness-150"
      >
        <span className="text-heading font-light leading-none text-fg-soft transition group-hover:text-white">+</span>
      </Ring>
    </button>
  );
}

/** Trailing grid slot for the narrow card grid; wide layouts add from the nav rail. */
export function AddGameCell({ onAdd, className = '' }: { onAdd: () => void; className?: string }) {
  return (
    <div className={`flex min-h-16 items-center justify-center ${className}`}>
      <AddGameButton onAdd={onAdd} />
    </div>
  );
}
