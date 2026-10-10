import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emptyState, type GameImportBatch } from '@memoria/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame, makeResource, makeTask } from '../../shared/test/helpers';

const launcher = vi.hoisted(() => ({ fetch: vi.fn(), available: true }));
const account = vi.hoisted(() => ({ batch: undefined as GameImportBatch | undefined }));
vi.mock('../src/native', () => ({ isNativeApp: false }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => launcher.available, launcherFetch: launcher.fetch }));
vi.mock('../src/sync', () => ({ flushSync: vi.fn(async () => undefined) }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  m: {
    div: ({ children, role, className }: { children: ReactNode; role?: string; className?: string }) => (
      <div role={role} className={className}>
        {children}
      </div>
    ),
    p: ({ children, role }: { children: ReactNode; role?: string }) => <p role={role}>{children}</p>,
  },
}));
vi.mock('../src/components/GameConnections', () => ({
  GameConnections: ({ onReview }: { onReview(batch: GameImportBatch): void }) => (
    <button onClick={() => onReview(account.batch!)}>Account responds</button>
  ),
}));

import { ReadingIntake } from '../src/components/ReadingIntake';
import { ReadingsPanel } from '../src/components/GameReadings';
import { TooltipProvider } from '../src/components/ui';
import { closeReadings, openReadings, receiveScreenshotText, startTextReading, useReadings } from '../src/readings';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const png = (name = 'screenshot.png') => new File(['png fixture'], name, { type: 'image/png' });
const ocr = (text: string, capturedAt = Date.now() - 1000) => new Response(JSON.stringify({ text, capturedAt }));
const drop = (files: File[]) => fireEvent.drop(document, { dataTransfer: { files, types: ['Files'] } });
const paste = (files: File[], target: Element | Document = document) =>
  fireEvent.paste(target, {
    clipboardData: {
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  });
const latest = (resourceId = 'r1') =>
  useApp
    .getState()
    .state.snapshots.filter((snapshot) => snapshot.resourceId === resourceId)
    .at(-1);

/** The intake, plus the card panel for whichever game a reading landed on. */
function Harness() {
  const games = useApp((store) => store.state.games);
  return (
    <TooltipProvider>
      <ReadingIntake />
      {games.map((game) => (
        <ReadingsPanel key={game.id} game={game} />
      ))}
    </TooltipProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  launcher.available = true;
  launcher.fetch.mockReset().mockImplementation(async () => ocr('Original Resin 123/200'));
  const state = emptyState();
  state.games = [makeGame(), makeGame({ id: 'g2', name: 'Other game', sort: 1 })];
  state.resources = [
    makeResource({ name: 'Original Resin', reserveCap: 2400, reserveLabel: 'Stored reserve' }),
    makeResource({ id: 'r2', gameId: 'g2', name: 'Waveplates', cap: 240 }),
  ];
  state.tasks = [makeTask()];
  useApp.setState({ state, importHistory: [], loaded: true });
  useReadings.setState({ busy: false, draft: null, panel: null, unassigned: null, notice: null });
  useUI.setState({ tab: 'today', focusedGameId: null, todayGameId: null });
});

describe('a screenshot Memoria is sure about', () => {
  it.each([
    ['dropped', drop],
    ['pasted', paste],
  ] as const)('saves a %s screenshot without a form and can undo it', async (_, receive) => {
    const state = useApp.getState().state;
    useApp.setState({
      state: { ...state, snapshots: [{ id: 'earlier', resourceId: 'r1', value: 20, takenAt: Date.now() - 600_000 }] },
    });
    render(<Harness />);
    receive([png()]);
    // "Reading…" comes first and is replaced by the result.
    const notice = (await screen.findByText('Saved 1 reading to Testland.')).closest<HTMLElement>('[role="status"]')!;
    expect(launcher.fetch).toHaveBeenCalledOnce();
    expect(latest()).toMatchObject({ value: 123, provenance: { kind: 'screenshot' } });
    expect(useReadings.getState().draft).toBeNull();
    expect(screen.queryByRole('region', { name: /Check this reading/ })).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
    // Undo returns to the earlier reading, projected to now, as a manual value.
    expect(latest()!.value).toBeLessThan(30);
    expect(latest()!.provenance?.kind).not.toBe('screenshot');
    expect(screen.getByRole('status')).toHaveTextContent('Restored 1 reading.');
  });

  it('finds the game from the resource it names, whatever is on screen', async () => {
    launcher.fetch.mockImplementation(async () => ocr('Waveplates 88/240'));
    useUI.setState({ tab: 'today', todayGameId: 'g1' });
    render(<Harness />);
    drop([png()]);
    await waitFor(() => expect(latest('r2')).toMatchObject({ value: 88 }));
    expect(latest('r1')).toBeUndefined();
  });

  it('reads an image pasted into a field once, even when the clipboard also holds text', async () => {
    render(
      <>
        <Harness />
        <input aria-label="Somewhere else" />
      </>,
    );
    paste([png()], screen.getByRole('textbox', { name: 'Somewhere else' }));
    await waitFor(() => expect(latest()).toMatchObject({ value: 123 }));
    expect(launcher.fetch).toHaveBeenCalledOnce();
  });

  it('leaves text and non-image pastes alone', () => {
    render(<Harness />);
    fireEvent.paste(document, { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain' }] } });
    paste([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(launcher.fetch).not.toHaveBeenCalled();
    expect(useReadings.getState().notice).toBeNull();
  });

  it('does not save an older screenshot over a newer reading', async () => {
    useApp.getState().setEnergy('r1', 50);
    launcher.fetch.mockImplementation(async () => ocr('Original Resin 123/200', Date.now() - 3_600_000));
    render(<Harness />);
    drop([png()]);
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer reading or resource edit is already saved.');
    expect(latest()).toMatchObject({ value: 50 });
  });
});

describe('a screenshot Memoria is not sure about', () => {
  it('asks in the game card when a value does not state its cap', async () => {
    launcher.fetch.mockImplementation(async () => ocr('Original Resin 123'));
    render(<Harness />);
    drop([png()]);
    const review = await screen.findByRole('region', { name: 'Check this reading for Testland' });
    expect(latest()).toBeUndefined();
    expect(useUI.getState().todayGameId).toBe('g1');
    expect(within(review).getByRole('spinbutton', { name: 'Original Resin / 200' })).toHaveValue(123);
    fireEvent.change(within(review).getByRole('spinbutton', { name: 'Original Resin / 200' }), {
      target: { value: '120' },
    });
    fireEvent.click(within(review).getByRole('button', { name: 'Save 1 reading' }));
    expect(latest()).toMatchObject({ value: 120, provenance: { kind: 'screenshot' } });
    expect(screen.queryByRole('region', { name: /Check this reading/ })).not.toBeInTheDocument();
  });

  it('asks which game owns a screenshot two accounts could both claim', async () => {
    const state = useApp.getState().state;
    useApp.setState({
      state: {
        ...state,
        games: [...state.games, makeGame({ id: 'g3', name: 'Testland', accountLabel: 'Alt', sort: 2 })],
        resources: [...state.resources, makeResource({ id: 'r3', gameId: 'g3', name: 'Original Resin' })],
      },
    });
    render(<Harness />);
    drop([png()]);
    const chooser = await screen.findByRole('dialog', { name: 'Which game is this?' });
    expect(within(chooser).queryByText('Other game')).not.toBeInTheDocument();
    expect(latest()).toBeUndefined();
    fireEvent.click(within(chooser).getByRole('button', { name: /Alt/ }));
    expect(latest('r3')).toMatchObject({ value: 123 });
    expect(latest('r1')).toBeUndefined();
  });

  it('lets an unlabelled meter be assigned, and only to a resource with that maximum', async () => {
    launcher.fetch.mockImplementation(async () => ocr('118 / 200\n3/5'));
    useUI.setState({ tab: 'today', todayGameId: 'g1' });
    render(<Harness />);
    drop([png()]);
    const review = await screen.findByRole('region', { name: 'Check this reading for Testland' });
    expect(within(review).getByText('These meters have no label. Choose what each one is.')).toBeInTheDocument();
    // 3/5 matches no tracked maximum, so it is not offered at all.
    expect(within(review).queryByText('3 / 5')).not.toBeInTheDocument();
    expect(within(review).getByRole('button', { name: /^Save/ })).toBeDisabled();
    fireEvent.click(within(review).getByRole('combobox', { name: '118 / 200' }));
    fireEvent.click(screen.getByRole('option', { name: 'Original Resin' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Save 1 reading' }));
    expect(latest()).toMatchObject({ value: 118 });
  });

  it('keeps the reading being checked when a replacement is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harness />);
    act(() => startTextReading('g1'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Screenshot text' }), {
      target: { value: 'Original Resin 77' },
    });
    drop([png()]);
    expect(launcher.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Screenshot text' })).toHaveValue('Original Resin 77');
    act(() => {
      expect(receiveScreenshotText({ text: 'Original Resin 5/200' })).toBe(false);
    });
    expect(latest()).toBeUndefined();
  });

  it('rejects a capture time in the future and saves with Just now', () => {
    render(<Harness />);
    act(() => startTextReading('g1'));
    const review = screen.getByRole('region', { name: 'Check this reading for Testland' });
    fireEvent.change(within(review).getByRole('textbox', { name: 'Screenshot text' }), {
      target: { value: 'Original Resin 60' },
    });
    fireEvent.change(within(review).getByLabelText('Taken'), { target: { value: '2999-01-01T00:00' } });
    expect(within(review).getByRole('button', { name: /^Save/ })).toBeDisabled();
    fireEvent.click(within(review).getByRole('button', { name: 'Just now' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Save 1 reading' }));
    expect(latest()).toMatchObject({ value: 60 });
  });
});

describe('guards around reading an image', () => {
  it.each([
    ['two images', () => [png('a.png'), png('b.png')], 'Read one screenshot at a time'],
    ['a non-image file', () => [new File(['x'], 'a.gif', { type: 'image/gif' })], 'Choose one PNG or JPEG image'],
    ['an empty image', () => [new File([], 'a.png', { type: 'image/png' })], 'Choose one PNG or JPEG image'],
  ] as const)('refuses %s before reading anything', async (_, files, text) => {
    render(<Harness />);
    drop(files());
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(launcher.fetch).not.toHaveBeenCalled();
  });

  it('explains the browser version instead of failing silently', async () => {
    launcher.available = false;
    render(<Harness />);
    drop([png()]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Open the Windows app to read this image');
    expect(launcher.fetch).not.toHaveBeenCalled();
  });

  it('refuses a second image while one is being read, and drops a result that was cancelled', async () => {
    let respond!: (value: Response) => void;
    launcher.fetch.mockImplementation(() => new Promise<Response>((done) => (respond = done)));
    render(<Harness />);
    drop([png()]);
    await waitFor(() => expect(launcher.fetch).toHaveBeenCalledOnce());
    drop([png()]);
    expect(launcher.fetch).toHaveBeenCalledOnce();
    expect(useReadings.getState().notice?.text).toMatch(/Wait for the current screenshot/);
    act(() => closeReadings());
    await act(async () => respond(ocr('Original Resin 123/200')));
    expect(latest()).toBeUndefined();
    expect(useReadings.getState().busy).toBe(false);
  });

  it('shows the whole window as a drop target only for files', () => {
    render(<Harness />);
    fireEvent.dragOver(document, { dataTransfer: { types: ['text/plain'] } });
    expect(screen.queryByText('Drop the screenshot to read it')).not.toBeInTheDocument();
    fireEvent.dragOver(document, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop the screenshot to read it')).toBeInTheDocument();
    fireEvent.dragLeave(document, { relatedTarget: null });
    expect(screen.queryByText('Drop the screenshot to read it')).not.toBeInTheDocument();
  });
});

describe('accounts, Play mode and history', () => {
  beforeEach(() => {
    account.batch = {
      id: 'account-batch',
      gameId: 'g1',
      observedAt: Date.now() - 1000,
      source: { kind: 'account', provider: 'hoyolab' },
      resources: [{ resourceId: 'r1', value: 140, reserve: 456 }],
      tasks: [{ taskId: 't1', done: true }],
    };
  });

  it('saves an account reading directly, reserve and task included', () => {
    render(<Harness />);
    act(() => openReadings('g1', 'account'));
    fireEvent.click(screen.getByRole('button', { name: 'Account responds' }));
    expect(latest()).toMatchObject({ value: 140, reserve: 456, provenance: { kind: 'account' } });
    expect(screen.getByRole('status')).toHaveTextContent('Saved 2 readings to Testland.');
    expect(screen.queryByRole('region', { name: /Check this reading/ })).not.toBeInTheDocument();
  });

  it('releases a Play mode capture only after its readings are saved', async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal('memoriaDesktop', { version: 1, play: { remove } });
    render(<Harness />);
    const event = new CustomEvent('memoria:review-capture', {
      cancelable: true,
      detail: {
        id: 'capture-1',
        gameId: 'g1',
        name: 'Window',
        text: 'Original Resin 99/200',
        capturedAt: Date.now() - 500,
        detectedAt: Date.now(),
      },
    });
    act(() => {
      expect(document.dispatchEvent(event)).toBe(true);
    });
    expect(latest()).toMatchObject({ value: 99 });
    await waitFor(() => expect(remove).toHaveBeenCalledWith('capture-1'));
    vi.unstubAllGlobals();
  });

  it('keeps a capture in the inbox while its reading still needs checking', () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal('memoriaDesktop', { version: 1, play: { remove } });
    render(<Harness />);
    act(() => {
      document.dispatchEvent(
        new CustomEvent('memoria:review-capture', {
          cancelable: true,
          detail: {
            id: 'capture-2',
            gameId: 'g1',
            name: 'Window',
            text: 'Original Resin 99',
            capturedAt: Date.now() - 500,
            detectedAt: Date.now(),
          },
        }),
      );
    });
    expect(screen.getByRole('region', { name: 'Check this reading for Testland' })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    expect(latest()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('refuses a malformed capture and leaves its panel open', () => {
    render(<Harness />);
    const event = new CustomEvent('memoria:review-capture', { cancelable: true, detail: { id: 7, text: 'x' } });
    act(() => {
      expect(document.dispatchEvent(event)).toBe(false);
    });
    expect(useReadings.getState().draft).toBeNull();
  });

  it('lists recent imports in the card and reports an undo that fails', () => {
    render(<Harness />);
    act(() => openReadings('g1', 'account'));
    fireEvent.click(screen.getByRole('button', { name: 'Account responds' }));
    act(() => openReadings('g1', 'history'));
    const history = screen.getByRole('region', { name: 'Recent imports for Testland' });
    expect(within(history).getByText(/Account · 2 saved/)).toBeInTheDocument();
    vi.spyOn(useApp.getState(), 'undoGameImport').mockImplementation(() => {
      throw new Error('The correction could not be saved.');
    });
    fireEvent.click(within(history).getByRole('button', { name: /^Undo import/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('The correction could not be saved.');
    expect(within(history).getByRole('button', { name: /^Undo import/ })).toBeEnabled();
  });
});
