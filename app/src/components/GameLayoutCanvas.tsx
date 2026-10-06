import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import { moveLayoutItem, type GameLayoutItem } from '@memoria/shared';
import { useReducedMotion } from '../hooks';
import { duration, easing } from '../motion';
import { Btn, Field, TextInput, TOUCH_BUTTON } from './ui';
import { AddGameLayoutItem } from './AddGameLayoutItem';

export type GameWidget = {
  name: string;
  summary?: string;
  content: ReactNode;
  available: boolean;
  rename?: (name: string) => void;
  editor?: ReactNode;
  remove?: () => () => void;
};
type Pending = {
  id: string;
  pointer: number;
  x: number;
  y: number;
  pointerType: string;
  timer: ReturnType<typeof setTimeout>;
};

type Drag = {
  id: string;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  moved: boolean;
  original: GameLayoutItem[];
  preview: GameLayoutItem[];
  slots: { id: string; rect: DOMRect }[];
  scroller: HTMLElement;
  scrollTop: number;
};

function scrollParent(node: HTMLElement): HTMLElement {
  let parent = node.parentElement;
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight)
      return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

/** A single-column game layout. Drag changes presentation, never tracking values. */
export function GameLayoutCanvas({
  items,
  widgets,
  editing,
  onChange,
  gameId,
  onAdded,
}: {
  items: GameLayoutItem[];
  widgets: Map<string, GameWidget>;
  editing: boolean;
  onChange: (items: GameLayoutItem[]) => void;
  gameId: string;
  onAdded: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const suppressClick = useRef(false);
  const gesture = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<GameLayoutItem[] | null>(null);
  const [selected, setSelected] = useState('');
  const [deleted, setDeleted] = useState<{ name: string; undo: () => void } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const help = useId();
  const displayed = (preview ?? items).filter((item) => !item.hidden && (editing || widgets.get(item.id)?.available));
  const hidden = items.filter((item) => item.hidden);
  useEffect(() => {
    if (!selected || !editing) return;
    const editor = root.current?.querySelector<HTMLElement>('[data-item-editor]');
    editor?.querySelector<HTMLElement>('input, button, [role="combobox"]')?.focus();
  }, [selected, editing]);
  const closeItem = () => {
    const id = selected;
    setSelected('');
    requestAnimationFrame(() => editButtons.current.get(id)?.focus({ preventScroll: true }));
  };
  const clearPending = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  };
  // The first movement still scrolls normally. Only an activated hold owns touch movement.
  useEffect(() => {
    const node = root.current;
    const preventScroll = (event: TouchEvent) => {
      if (gesture.current && event.cancelable) event.preventDefault();
    };
    node?.addEventListener('touchmove', preventScroll, { passive: false });
    return () => {
      node?.removeEventListener('touchmove', preventScroll);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      gesture.current = null;
    };
  }, []);

  const lift = () => {
    const held = pending.current;
    if (!held || !root.current) return;
    clearPending();
    const slots = [...root.current.querySelectorAll<HTMLElement>('[data-layout-item]')].map((node) => ({
      id: node.dataset.layoutItem!,
      rect: node.getBoundingClientRect(),
    }));
    const box = slots.find((slot) => slot.id === held.id)?.rect;
    if (!box) return;
    const scroller = scrollParent(root.current);
    const current: Drag = {
      id: held.id,
      pointer: held.pointer,
      startX: held.x,
      startY: held.y,
      x: held.x,
      y: held.y,
      left: box.left,
      top: box.top,
      width: box.width,
      moved: false,
      original: items,
      preview: items,
      slots,
      scroller,
      scrollTop: scroller.scrollTop,
    };
    gesture.current = current;
    suppressClick.current = true;
    root.current.setPointerCapture(held.pointer);
    setDrag(current);
    setAnnouncement(`${widgets.get(held.id)?.name} lifted. Drag to move, release to place.`);
  };

  const updateDrag = () => {
    const current = gesture.current;
    if (!current) return;
    const deltaScroll = current.scroller.scrollTop - current.scrollTop;
    if (Math.hypot(current.x - current.startX, current.y - current.startY) > 5 || deltaScroll !== 0)
      current.moved = true;
    if (current.moved) {
      const distance = ({ rect }: Drag['slots'][number]) => {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2 - deltaScroll;
        return Math.hypot(current.x - cx, current.y - cy);
      };
      const target = current.slots.reduce((best, slot) => (distance(slot) < distance(best) ? slot : best));
      current.preview = moveLayoutItem(
        current.original,
        current.id,
        current.original.findIndex((item) => item.id === target.id),
      );
      setPreview(current.preview);
    }
    setDrag({ ...current });
  };

  useEffect(() => {
    if (!drag) return;
    let frame: number;
    const scroll = () => {
      const current = gesture.current;
      if (!current) return;
      const rect =
        current.scroller === document.scrollingElement
          ? { top: 0, bottom: innerHeight }
          : current.scroller.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"]')?.getBoundingClientRect();
      const header = document.querySelector('header')?.getBoundingClientRect();
      const top = Math.max(header?.bottom ?? 0, rect.top);
      const bottom = Math.min(innerHeight, rect.bottom, nav && nav.top > innerHeight / 2 ? nav.top : innerHeight);
      const speed = current.y < top + 64 ? -10 : current.y > bottom - 64 ? 10 : 0;
      if (speed && current.moved) {
        const before = current.scroller.scrollTop;
        current.scroller.scrollTop += speed;
        if (before !== current.scroller.scrollTop) updateDrag();
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
    // A drag owns this loop until release, not until the next pointer position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);

  const endDrag = (cancel: boolean) => {
    clearPending();
    const current = gesture.current;
    gesture.current = null;
    if (current && root.current?.hasPointerCapture(current.pointer))
      root.current.releasePointerCapture(current.pointer);
    if (current?.moved && !cancel) {
      onChange(current.preview);
      setAnnouncement(
        `${widgets.get(current.id)?.name} moved to position ${current.preview.filter((item) => !item.hidden).findIndex((item) => item.id === current.id) + 1}.`,
      );
    }
    setDrag(null);
    setPreview(null);
  };

  const move = (id: string, delta: number) => {
    const visible = items.filter((item) => !item.hidden);
    const index = visible.findIndex((item) => item.id === id);
    const target = visible[index + delta];
    if (!target) return;
    onChange(
      moveLayoutItem(
        items,
        id,
        items.findIndex((item) => item.id === target.id),
      ),
    );
    setAnnouncement(`${widgets.get(id)?.name} moved to position ${index + delta + 1}.`);
  };
  const patch = (id: string, changes: Partial<GameLayoutItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  return (
    <div
      className="mt-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (gesture.current || pending.current || selected)) {
          event.preventDefault();
          event.stopPropagation();
          endDrag(true);
          closeItem();
        }
      }}
    >
      {editing && (
        <div className="mb-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p id={help} className="text-meta text-muted">
              Select Edit to change an item. Hold its handle to move it, or use the move buttons.
              <span className="sr-only"> You can also focus a handle and press Arrow Up or Arrow Down.</span>
            </p>
            <Btn
              ref={addButton}
              className={TOUCH_BUTTON}
              aria-expanded={paletteOpen}
              onClick={() => setPaletteOpen(!paletteOpen)}
            >
              Add item
            </Btn>
          </div>
          {paletteOpen && (
            <div className="space-y-3 border-y border-line-edge py-3">
              <AddGameLayoutItem
                gameId={gameId}
                onClose={() => setPaletteOpen(false)}
                onAdded={(id) => {
                  onAdded(id);
                  setPaletteOpen(false);
                  setSelected(id);
                }}
              />
              {hidden.length > 0 && (
                <div className="border-t border-line-hairline pt-3">
                  <p className="mb-2 text-meta text-muted">Hidden items</p>
                  <div className="flex flex-wrap gap-2">
                    {hidden.map((item) => (
                      <Btn
                        key={item.id}
                        onClick={() => {
                          patch(item.id, { hidden: false });
                          setPaletteOpen(false);
                          setAnnouncement(`${widgets.get(item.id)?.name} restored.`);
                        }}
                      >
                        Restore {widgets.get(item.id)?.name}
                      </Btn>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {deleted && (
            <div className="flex items-center justify-between gap-2 text-meta" role="status">
              <span>{deleted.name} deleted.</span>
              <Btn
                onClick={() => {
                  deleted.undo();
                  setDeleted(null);
                }}
              >
                Undo delete
              </Btn>
            </div>
          )}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div
        ref={root}
        className="game-widget-grid grid grid-cols-1 items-start gap-3"
        onContextMenu={(event) => {
          if (editing) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onPointerMove={(event) => {
          const held = pending.current;
          if (held?.pointer === event.pointerId && Math.hypot(event.clientX - held.x, event.clientY - held.y) > 8) {
            if (held.pointerType === 'mouse') lift();
            else {
              clearPending();
              suppressClick.current = true;
            }
          }
          const current = gesture.current;
          if (!current || current.pointer !== event.pointerId) return;
          current.x = event.clientX;
          current.y = event.clientY;
          updateDrag();
        }}
        onPointerUp={(event) => {
          if (gesture.current?.pointer === event.pointerId) endDrag(false);
          else clearPending();
        }}
        onPointerLeave={() => {
          if (pending.current) clearPending();
        }}
        onPointerCancel={() => endDrag(true)}
        onLostPointerCapture={() => {
          if (gesture.current || pending.current) endDrag(true);
        }}
      >
        {displayed.map((item, index) => {
          const widget = widgets.get(item.id);
          if (!widget) return null;
          const expanded = editing && selected === item.id;
          const editorId = `${help}-${item.id}`;
          return (
            <m.div
              key={item.id}
              layout={editing && !reduced ? 'position' : false}
              initial={false}
              transition={{ layout: { duration: duration.base, ease: easing.out } }}
              data-layout-item={item.id}
              className={`game-widget min-w-0 rounded-ui-lg ${editing ? 'border border-line-edge bg-fill-1 p-3' : 'py-1'}`}
              style={{ opacity: drag?.id === item.id ? 0.35 : 1 }}
            >
              {editing ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-11 w-11 shrink-0 cursor-grab select-none items-center justify-center rounded-ui-md text-muted hover:bg-fill-2 active:cursor-grabbing"
                    style={{ touchAction: 'pan-y', scrollMarginBlock: '8rem' }}
                    aria-label={`Move ${widget.name}`}
                    aria-describedby={help}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    onKeyDown={(event) => {
                      if (event.altKey || event.ctrlKey || event.metaKey) return;
                      const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key)
                        ? -1
                        : ['ArrowDown', 'ArrowRight'].includes(event.key)
                          ? 1
                          : 0;
                      if (delta) {
                        event.preventDefault();
                        move(item.id, delta);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (!event.isPrimary || event.button !== 0 || gesture.current || !root.current) return;
                      event.stopPropagation();
                      if (event.pointerType === 'mouse') event.preventDefault();
                      event.currentTarget.focus({ preventScroll: true });
                      suppressClick.current = false;
                      clearPending();
                      pending.current = {
                        id: item.id,
                        pointer: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        pointerType: event.pointerType,
                        timer: setTimeout(lift, 400),
                      };
                    }}
                  >
                    <svg viewBox="0 0 20 20" className="icon h-4 w-4" fill="currentColor" aria-hidden>
                      {[5, 10, 15].map((y) => (
                        <g key={y}>
                          <circle cx="7" cy={y} r="1.3" />
                          <circle cx="13" cy={y} r="1.3" />
                        </g>
                      ))}
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-body font-semibold text-fg-soft">{widget.name}</p>
                    {widget.summary && <p className="mt-1 text-caption text-muted">{widget.summary}</p>}
                  </div>
                  <Btn
                    ref={(node) => {
                      if (node) editButtons.current.set(item.id, node);
                      else editButtons.current.delete(item.id);
                    }}
                    className={`shrink-0 ${TOUCH_BUTTON}`}
                    aria-label={`Edit item ${widget.name}`}
                    aria-expanded={expanded}
                    aria-controls={expanded ? editorId : undefined}
                    onClick={() => (expanded ? closeItem() : setSelected(item.id))}
                  >
                    {expanded ? 'Close' : 'Edit'}
                  </Btn>
                </div>
              ) : (
                widget.content
              )}
              {expanded && (
                <div
                  id={editorId}
                  data-item-editor
                  role="region"
                  className="mt-3 space-y-3 border-t border-line-edge pt-3"
                  aria-label={`Edit item ${widget.name}`}
                >
                  {widget.editor ??
                    (widget.rename && (
                      <Field label="Item title">
                        <TextInput
                          maxLength={500}
                          value={widget.name}
                          onChange={(event) => widget.rename?.(event.target.value)}
                        />
                      </Field>
                    ))}
                  <div className="space-y-2 sm:flex sm:flex-wrap sm:gap-2 sm:space-y-0">
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <Btn
                        className={TOUCH_BUTTON}
                        disabled={index === 0}
                        aria-label={`Move ${widget.name} up`}
                        onClick={() => move(item.id, -1)}
                      >
                        Move up
                      </Btn>
                      <Btn
                        className={TOUCH_BUTTON}
                        disabled={index === displayed.length - 1}
                        aria-label={`Move ${widget.name} down`}
                        onClick={() => move(item.id, 1)}
                      >
                        Move down
                      </Btn>
                    </div>
                    <div className={`grid gap-2 sm:flex ${widget.remove ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      <Btn
                        className={TOUCH_BUTTON}
                        aria-label={`Hide ${widget.name}`}
                        onClick={() => {
                          patch(item.id, { hidden: true });
                          setSelected('');
                          requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
                        }}
                      >
                        Hide from card
                      </Btn>
                      {widget.remove && (
                        <Btn
                          kind="danger"
                          className={TOUCH_BUTTON}
                          aria-label={`Delete ${widget.name}`}
                          onClick={() => {
                            const undo = widget.remove!();
                            setDeleted({ name: widget.name, undo });
                            setSelected('');
                            requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
                          }}
                        >
                          Delete
                        </Btn>
                      )}
                      <Btn className={TOUCH_BUTTON} onClick={closeItem}>
                        Close item
                      </Btn>
                    </div>
                  </div>
                </div>
              )}
            </m.div>
          );
        })}
      </div>
      {!editing && displayed.length === 0 && (
        <p className="py-4 text-meta text-muted">No visible items. Use Edit to add them.</p>
      )}
      {editing &&
        drag &&
        createPortal(
          <div
            aria-hidden
            inert
            className="game-widget pointer-events-none fixed z-[90] rounded-ui-lg bg-panel p-3 shadow-float"
            style={{
              left: drag.left + drag.x - drag.startX,
              top: drag.top + drag.y - drag.startY,
              width: drag.width,
              transform: 'scale(1.025)',
            }}
          >
            <p className="mb-2 text-meta font-semibold">{widgets.get(drag.id)?.name}</p>
            {widgets.get(drag.id)?.content}
          </div>,
          document.body,
        )}
    </div>
  );
}
