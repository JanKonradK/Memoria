/* global window, document */
// The snip window: the frozen screen, and up to eight numbered rectangles the
// player drags on it. Enter (or the Read button) reads every rectangle in
// order, or the whole screen when there are none. It may call only
// screenshot_snip_data, _commit and _cancel (capabilities/snip.json).
(() => {
  const invoke = (command, args) => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals) return Promise.reject(new Error('Memoria is still starting.'));
    return internals.invoke(command, args ?? {});
  };
  const body = document.body;
  const dim = document.getElementById('dim');
  const layer = document.getElementById('boxes');
  const draft = document.getElementById('draft');
  const bar = document.getElementById('bar');
  const hint = document.getElementById('hint');
  const readButton = document.getElementById('read');
  const wholeButton = document.getElementById('whole');
  const undoButton = document.getElementById('undo');
  const clearButton = document.getElementById('clear');
  const cancelButton = document.getElementById('cancel');
  const MIN = 8;
  const MAX_REGIONS = 8;
  const HINT = 'Drag around each number to read · up to 8 regions';

  /** Committed rectangles in CSS pixels, in the order drawn. */
  const boxes = [];
  let start = null;
  let dragging = null;
  let busy = false;
  let message = '';

  const say = (text) => {
    message = text;
    render();
  };

  // The dim layer: the frozen screen darkened everywhere but inside the rectangles.
  const paint = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (dim.width !== pixelWidth || dim.height !== pixelHeight) {
      dim.width = pixelWidth;
      dim.height = pixelHeight;
    }
    const context = dim.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, width, height);
    for (const box of dragging ? [...boxes, dragging] : boxes) {
      context.clearRect(box.x, box.y, box.width, box.height);
    }
  };

  const place = (element, box) => {
    Object.assign(element.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  };

  const removeAt = (index) => {
    if (busy || index < 0 || index >= boxes.length) return;
    boxes.splice(index, 1);
    say('');
  };

  const renderBoxes = () => {
    layer.replaceChildren(
      ...boxes.map((box, index) => {
        const number = index + 1;
        const element = document.createElement('div');
        element.className = box.y < 30 ? 'box low' : 'box';
        place(element, box);
        const label = document.createElement('div');
        label.className = 'tag left';
        const badge = document.createElement('span');
        badge.className = 'num';
        badge.textContent = String(number);
        label.append(badge);
        const actions = document.createElement('div');
        actions.className = 'tag right';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '×';
        remove.title = `Remove region ${number}`;
        remove.setAttribute('aria-label', `Remove region ${number}`);
        remove.addEventListener('mousedown', (event) => event.preventDefault());
        remove.addEventListener('click', () => removeAt(index));
        actions.append(remove);
        element.append(label, actions);
        return element;
      }),
    );
  };

  const render = () => {
    const count = boxes.length;
    renderBoxes();
    paint();
    readButton.textContent =
      count === 0 ? 'Read whole screen (Enter)' : `Read ${count} ${count === 1 ? 'region' : 'regions'} (Enter)`;
    wholeButton.hidden = count === 0;
    undoButton.hidden = count === 0;
    clearButton.hidden = count === 0;
    for (const button of [readButton, wholeButton, undoButton, clearButton, cancelButton]) button.disabled = busy;
    if (busy) {
      hint.textContent = 'Reading…';
    } else if (message) {
      hint.textContent = message;
    } else if (count >= MAX_REGIONS) {
      hint.textContent = `${MAX_REGIONS} regions: read them, or remove one to draw another`;
    } else if (count > 0) {
      hint.textContent = 'Drag another region, or read these';
    } else {
      hint.textContent = HINT;
    }
  };

  const cancel = () => {
    if (busy) return;
    busy = true;
    render();
    void invoke('screenshot_snip_cancel').catch(() => window.close());
  };

  const wholeScreen = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });

  const commit = (regions) => {
    if (busy) return;
    busy = true;
    start = null;
    dragging = null;
    body.classList.remove('dragging');
    render();
    void invoke('screenshot_snip_commit', {
      regions,
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
    }).catch((error) => {
      // A region Rust turned down leaves the screen and every rectangle up for another try.
      busy = false;
      say(typeof error === 'string' ? error : 'Drag around a larger area.');
    });
  };

  const readAll = () => commit(boxes.length > 0 ? boxes.map((box) => ({ ...box })) : [wholeScreen()]);
  const undo = () => removeAt(boxes.length - 1);
  const clear = () => {
    if (busy || boxes.length === 0) return;
    boxes.length = 0;
    say('');
  };

  const area = (event) => {
    const x = Math.max(0, Math.min(start.x, event.clientX));
    const y = Math.max(0, Math.min(start.y, event.clientY));
    const right = Math.min(window.innerWidth, Math.max(start.x, event.clientX));
    const bottom = Math.min(window.innerHeight, Math.max(start.y, event.clientY));
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  };

  /** The topmost rectangle under a point, or -1. */
  const boxAt = (x, y) => {
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index];
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return index;
    }
    return -1;
  };

  /** The toolbar and the remove buttons take their own clicks; everywhere else draws. */
  const onControl = (event) => Boolean(event.target?.closest?.('#bar, .remove'));

  // A mouse click on a toolbar button must not keep focus there, or Enter would press it again.
  bar.addEventListener('mousedown', (event) => {
    if (event.target?.closest?.('button')) event.preventDefault();
  });
  readButton.addEventListener('click', readAll);
  wholeButton.addEventListener('click', () => commit([wholeScreen()]));
  undoButton.addEventListener('click', undo);
  clearButton.addEventListener('click', clear);
  cancelButton.addEventListener('click', cancel);

  window.addEventListener('pointerdown', (event) => {
    if (busy || onControl(event)) return;
    if (event.button === 2) {
      event.preventDefault();
      // Right-click removes the region under the pointer, or cancels on empty screen.
      const index = boxAt(event.clientX, event.clientY);
      if (index >= 0) removeAt(index);
      else cancel();
      return;
    }
    if (event.button !== 0) return;
    if (boxes.length >= MAX_REGIONS) {
      say(`Up to ${MAX_REGIONS} regions. Remove one to draw another.`);
      return;
    }
    start = { x: event.clientX, y: event.clientY };
    dragging = null;
    document.documentElement.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', (event) => {
    if (!start || busy) return;
    dragging = area(event);
    body.classList.add('dragging');
    place(draft, dragging);
    paint();
  });

  const endDrag = (event) => {
    if (!start || busy) return;
    const picked = area(event);
    start = null;
    dragging = null;
    body.classList.remove('dragging');
    if (picked.width >= MIN && picked.height >= MIN) {
      boxes.push(picked);
      message = '';
    }
    render();
  };

  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) endDrag(event);
  });

  window.addEventListener('pointercancel', () => {
    start = null;
    dragging = null;
    body.classList.remove('dragging');
    paint();
  });

  window.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    // A focused button handles its own Enter and Space.
    const onButton = Boolean(event.target?.closest?.('button'));
    if (event.key === 'Escape') {
      event.preventDefault();
      if (start) {
        // Escape mid-drag drops only that drag.
        start = null;
        dragging = null;
        body.classList.remove('dragging');
        paint();
      } else {
        cancel();
      }
    } else if (event.key === 'Enter' && !onButton) {
      event.preventDefault();
      readAll();
    } else if (event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) {
      event.preventDefault();
      undo();
    }
  });

  window.addEventListener('resize', () => render());

  render();

  invoke('screenshot_snip_data')
    .then((data) => {
      if (typeof data?.dataUrl !== 'string' || !data.dataUrl.startsWith('data:image/')) throw new Error('No capture');
      const shot = document.createElement('img');
      shot.id = 'shot';
      shot.alt = '';
      shot.draggable = false;
      shot.src = data.dataUrl;
      body.prepend(shot);
      window.focus();
    })
    .catch(cancel);
})();
