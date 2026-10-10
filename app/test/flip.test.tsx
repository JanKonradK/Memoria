import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { useFlip } from '../src/flip';

const ROW = 40;
const OPTIONS = { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

interface Glide {
  key: string;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: Mock;
}

let glides: Glide[];
// Offsets a running glide is drawn at, which jsdom cannot compute on its own.
let drawn: Map<HTMLElement, number>;

function List({ order }: { order: string[] }) {
  const listRef = useFlip<HTMLUListElement>('[data-key]', (node) => node.dataset.key ?? null);
  return (
    <ul ref={listRef}>
      {order.map((key) => (
        <li key={key} data-key={key}>
          {key}
        </li>
      ))}
    </ul>
  );
}

// Rows sit ROW px apart in render order. A scrolled page moves them up the viewport.
function rowRect(this: HTMLElement): DOMRect {
  const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
  const top = index * ROW - window.scrollY + (drawn.get(this) ?? 0);
  return { x: 0, y: top, top, left: 0, right: 0, bottom: top + ROW, width: 0, height: ROW, toJSON: () => ({}) };
}

function stubAnimate(): void {
  glides = [];
  const animate = vi.fn(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const cancel = vi.fn(() => drawn.delete(this));
    glides.push({ key: this.dataset.key ?? '', frames, options, cancel });
    return { cancel };
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
}

function glideFor(key: string): Glide {
  const found = glides.find((glide) => glide.key === key);
  if (!found) throw new Error(`no glide for ${key}`);
  return found;
}

beforeEach(() => {
  drawn = new Map();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(rowRect);
  // The shared setup reports reduced motion for any unrecognised query; these tests want motion allowed.
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false }) as MediaQueryList);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  window.scrollY = 0;
});

it('animates nothing on first render', () => {
  stubAnimate();
  render(<List order={['a', 'b', 'c']} />);
  expect(glides).toEqual([]);
});

it('glides each moved row from its old place and leaves the unmoved rows alone', () => {
  stubAnimate();
  const view = render(<List order={['a', 'b', 'c']} />);
  view.rerender(<List order={['b', 'a', 'c']} />);
  expect(glides.map((glide) => glide.key).sort()).toEqual(['a', 'b']);
  expect(glideFor('a').frames).toEqual([{ transform: 'translate(0px, -40px)' }, { transform: 'none' }]);
  expect(glideFor('b').frames).toEqual([{ transform: 'translate(0px, 40px)' }, { transform: 'none' }]);
  expect(glideFor('a').options).toEqual(OPTIONS);
});

it('cancels a glide that is still running when the rows move again', () => {
  stubAnimate();
  const view = render(<List order={['a', 'b', 'c']} />);
  view.rerender(<List order={['b', 'a', 'c']} />);
  const first = glideFor('a');
  view.rerender(<List order={['c', 'b', 'a']} />);
  expect(first.cancel).toHaveBeenCalledTimes(1);
});

it('glides from where a running glide is drawn when a commit lands mid-glide', () => {
  stubAnimate();
  const view = render(<List order={['a', 'b', 'c']} />);
  view.rerender(<List order={['b', 'a', 'c']} />);
  // Halfway through the glide, row a is drawn 20px above its new rest.
  drawn.set(screen.getByText('a'), -20);
  view.rerender(<List order={['b', 'a', 'c']} />);
  expect(glideFor('a').cancel).toHaveBeenCalledTimes(1);
  expect(glides.filter((glide) => glide.key === 'a')[1]!.frames).toEqual([
    { transform: 'translate(0px, -20px)' },
    { transform: 'none' },
  ]);
});

it('animates nothing when the reader prefers reduced motion', () => {
  stubAnimate();
  vi.mocked(window.matchMedia).mockImplementation(() => ({ matches: true }) as MediaQueryList);
  const view = render(<List order={['a', 'b', 'c']} />);
  view.rerender(<List order={['b', 'a', 'c']} />);
  expect(glides).toEqual([]);
});

it('does nothing and throws nothing when the Web Animations API is missing', () => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  const view = render(<List order={['a', 'b', 'c']} />);
  expect(() => view.rerender(<List order={['b', 'a', 'c']} />)).not.toThrow();
  expect(screen.getByText('b')).toBeInTheDocument();
});

it('animates nothing when the page scrolls between commits', () => {
  stubAnimate();
  const view = render(<List order={['a', 'b', 'c']} />);
  // Scrolling 100px moves every row 100px up the viewport, but no row moved in the document.
  window.scrollY = 100;
  view.rerender(<List order={['a', 'b', 'c']} />);
  expect(glides).toEqual([]);
});
