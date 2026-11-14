import { useUI, type HintKey } from '../ui-store';

const HINT_TEXT: Record<HintKey, string> = {
  energy: 'Type the number your game shows. Memoria counts it up and warns you before it caps.',
  tasks: 'Tick a task when you finish it. It comes back at the next reset.',
  events: 'Events live here, by game. Open one for its details, or mark it done.',
};

/**
 * A first-run hint shown where the thing it explains is, once. Only a new
 * install sees them: someone who already uses the app does not need them.
 */
export function Hint({ id, className = '' }: { id: HintKey; className?: string }) {
  const show = useUI((s) => s.hintsArmed && !s.hintsSeen[id]);
  const dismiss = useUI((s) => s.dismissHint);
  if (!show) return null;
  return (
    <div
      role="note"
      data-hint={id}
      className={`flex items-start gap-3 rounded-ui-md border border-line-hairline bg-fill-1 px-3 py-2 text-meta text-fg-soft ${className}`}
    >
      <p className="min-w-0 flex-1 py-1.5">{HINT_TEXT[id]}</p>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded-ui-md px-2 font-semibold text-fg hover:bg-fill-2 md:min-h-8"
        onClick={() => dismiss(id)}
      >
        Got it
      </button>
    </div>
  );
}
