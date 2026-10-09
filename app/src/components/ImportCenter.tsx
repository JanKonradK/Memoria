import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  extractScreenshotRatios,
  parseScreenshotReadings,
  planGameImport,
  type GameImportBatch,
} from '@memoria/shared';
import { flushPersist, useApp } from '../store';
import { flushSync } from '../sync';
import type { CapturedReading } from '../desktop-play';
import { launcherFetch, servedByLauncher } from '../launcher';
import { isNativeApp } from '../native';
import {
  chooseScreenshot,
  getPendingScreenshot,
  onScreenshotReceived,
  type ScreenshotText,
} from '../screenshot-native';
import { Sheet } from './Sheet';
import { Btn, Field, NumInput, Select, TextInput } from './ui';
import { GameConnections } from './GameConnections';

function localDateTime(at: number): string {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
const message = (error: unknown) => (error instanceof Error ? error.message : 'The import could not be completed.');

export function ImportCenter() {
  const state = useApp((store) => store.state);
  const history = useApp((store) => store.importHistory);
  const games = state.games.filter((game) => !game.deleted);
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState('');
  const [tab, setTab] = useState<'screenshot' | 'accounts' | 'history'>('screenshot');
  const [text, setText] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<GameImportBatch>();
  const [incoming, setIncoming] = useState<ScreenshotText | null>(null);
  const [captureId, setCaptureId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const recognitionBusy = useRef(false);
  const requestEpoch = useRef(0);
  const selectedGame = games.some((game) => game.id === gameId) ? gameId : captureId ? '' : (games[0]?.id ?? '');
  const dirty = !!batch || !!text.trim() || !!incoming || !!captureId;
  const currentDraft = useRef({ selectedGame, dirty, open });
  useLayoutEffect(() => {
    currentDraft.current = { selectedGame, dirty, open };
  }, [selectedGame, dirty, open]);
  const ratios = extractScreenshotRatios(text);
  const resources = state.resources.filter((resource) => resource.gameId === selectedGame && !resource.deleted);

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ gameId?: string; tab?: 'accounts' }>).detail;
      const id = detail?.gameId;
      if (id && id !== selectedGame) {
        if (dirty && !window.confirm('Clear the current import draft and change game?')) {
          event.preventDefault();
          return;
        }
        requestEpoch.current += 1;
        recognitionBusy.current = false;
        setBusy(false);
        setGameId(id);
        setBatch(undefined);
        setText('');
        setCaptureId(undefined);
        setAssignments({});
      }
      if (detail?.tab === 'accounts') setTab('accounts');
      setOpen(true);
    };
    document.addEventListener('memoria:open-import', show);
    return () => document.removeEventListener('memoria:open-import', show);
  }, [dirty, selectedGame]);
  useEffect(() => {
    const show = (event: Event) => {
      const capture = (event as CustomEvent<CapturedReading>).detail;
      if (
        !capture ||
        typeof capture.id !== 'string' ||
        typeof capture.text !== 'string' ||
        !Number.isFinite(capture.capturedAt) ||
        capture.capturedAt < 0 ||
        capture.capturedAt > 8.64e15
      ) {
        event.preventDefault();
        return;
      }
      if (dirty && !window.confirm('Replace the current import draft with this capture?')) {
        event.preventDefault();
        return;
      }
      requestEpoch.current += 1;
      recognitionBusy.current = false;
      setBusy(false);
      // Deleted or unassigned game accounts need a fresh, explicit selection.
      setGameId(capture.gameId || '');
      setText(capture.text);
      setCapturedAt(localDateTime(capture.capturedAt));
      setCaptureId(capture.id);
      setBatch(undefined);
      setAssignments({});
      setIncoming(null);
      setTab('screenshot');
      setError('');
      setNotice(
        'Check the game account and detected values. The capture stays in your inbox until these readings are saved.',
      );
      setOpen(true);
    };
    document.addEventListener('memoria:review-capture', show);
    return () => document.removeEventListener('memoria:review-capture', show);
  }, [dirty]);
  useEffect(() => {
    if (!isNativeApp) return;
    let active = true;
    const receive = () =>
      void getPendingScreenshot()
        .then((result) => {
          if (active && result) {
            setIncoming(result);
            setOpen(true);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(message(cause));
            setOpen(true);
          }
        });
    const listener = onScreenshotReceived(receive);
    void listener.then(receive).catch((cause: unknown) => {
      if (active) setError(message(cause));
    });
    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, []);

  const acceptText = useCallback((result: ScreenshotText) => {
    setCaptureId(undefined);
    setIncoming(null);
    setText(result.text);
    setCapturedAt(result.capturedAt ? localDateTime(result.capturedAt) : '');
    setBatch(undefined);
    setAssignments({});
    setTab('screenshot');
    setError('');
    setNotice(
      result.text.trim()
        ? 'Choose the game and confirm when this screenshot was taken.'
        : 'No text was found. Try a clearer screenshot or paste its text.',
    );
  }, []);
  const recognize = useCallback(
    async (file?: File) => {
      if (recognitionBusy.current) {
        setError('Wait for the current screenshot to finish reading, then try again.');
        return;
      }
      if (file && (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) {
        setError('Choose one PNG or JPEG image, up to 8 MB. The image must not be empty.');
        if (fileInput.current) fileInput.current.value = '';
        return;
      }
      if (file && !servedByLauncher()) {
        setError('Open the Windows app to read this image, or paste its text below.');
        return;
      }
      if (dirty && !window.confirm('Replace the current import draft?')) {
        if (fileInput.current) fileInput.current.value = '';
        return;
      }
      const epoch = ++requestEpoch.current;
      recognitionBusy.current = true;
      const requestedGame = selectedGame;
      const stillCurrent = () =>
        requestEpoch.current === epoch &&
        currentDraft.current.open &&
        currentDraft.current.selectedGame === requestedGame;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        if (isNativeApp) {
          const result = await chooseScreenshot();
          if (stillCurrent()) acceptText(result);
        } else if (file && servedByLauncher()) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('The image could not be read.'));
            reader.readAsDataURL(file);
          });
          if (!stillCurrent()) return;
          const response = await launcherFetch('/api/ocr', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ base64, mimeType: file.type }),
          });
          const result = (await response.json()) as ScreenshotText & { error?: string };
          if (!response.ok) throw new Error(result.error || 'Text recognition failed.');
          if (stillCurrent()) acceptText(result);
        }
      } catch (cause) {
        if (stillCurrent()) setError(message(cause));
      } finally {
        if (requestEpoch.current === epoch) {
          recognitionBusy.current = false;
          setBusy(false);
          if (fileInput.current) fileInput.current.value = '';
        }
      }
    },
    [acceptText, dirty, selectedGame],
  );
  const receiveFiles = useCallback(
    (files: File[]) => {
      dragDepth.current = 0;
      setDragging(false);
      setOpen(true);
      setTab('screenshot');
      if (recognitionBusy.current) {
        setError('Wait for the current screenshot to finish reading, then try again.');
        return;
      }
      if (files.length !== 1) {
        setError('Drop one screenshot at a time. Choose one PNG or JPEG image, up to 8 MB.');
        return;
      }
      void recognize(files[0]);
    },
    [recognize],
  );
  useEffect(() => {
    if (isNativeApp) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = recognitionBusy.current ? 'none' : 'copy';
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      receiveFiles(Array.from(event.dataTransfer.files));
    };
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    document.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('drop', drop);
      document.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, [receiveFiles]);
  const review = () => {
    setError('');
    setNotice('');
    if (!selectedGame || !useApp.getState().state.games.some((game) => game.id === selectedGame && !game.deleted)) {
      setError('Choose a game account for this capture before reviewing its readings.');
      return;
    }
    const time = new Date(capturedAt).getTime();
    if (!Number.isFinite(time) || time > Date.now()) {
      setError('Enter the screenshot capture time. It cannot be in the future.');
      return;
    }
    const parsed = parseScreenshotReadings(state, selectedGame, text, time);
    const assignedIds = new Set<string>();
    for (const ratio of ratios) {
      const resourceId = assignments[`${ratio.value}/${ratio.cap}`];
      if (!resourceId) continue;
      const resource = resources.find((item) => item.id === resourceId);
      if (!resource || resource.cap !== ratio.cap || assignedIds.has(resourceId)) {
        setError('Assign each resource once, with a matching maximum value.');
        return;
      }
      assignedIds.add(resourceId);
      parsed.resources = [
        ...(parsed.resources || []).filter((item) => item.resourceId !== resourceId),
        { resourceId, value: ratio.value, confidence: 0.85 },
      ];
    }
    if (assignedIds.size) parsed.id = crypto.randomUUID();
    if (!parsed.resources?.length && !parsed.tasks?.length) {
      setError(
        'No readings were found. Include a resource name and value, or assign a detected ratio to a resource below.',
      );
      return;
    }
    setBatch(parsed);
  };
  const apply = () => {
    if (!batch) return;
    if (
      batch.gameId !== selectedGame ||
      !useApp.getState().state.games.some((game) => game.id === batch.gameId && !game.deleted)
    ) {
      setError('This game account is no longer available. Choose an account and review the readings again.');
      setBatch(undefined);
      return;
    }
    const confirmed = {
      ...batch,
      resources: batch.resources?.map((item) => ({ ...item, confirmed: true })),
      tasks: batch.tasks?.map((item) => ({ ...item, confirmed: true })),
    };
    try {
      const result = useApp.getState().applyGameImport(confirmed);
      setNotice(
        `${result.applied} readings saved. ${result.skipped} skipped.${result.issues.length ? ` ${result.issues.map((item) => item.message).join(' ')}` : ''}`,
      );
      if (result.applied > 0) {
        setBatch(undefined);
        setText('');
        setTab('history');
        if (captureId && window.memoriaDesktop?.play) {
          const id = captureId;
          setCaptureId(undefined);
          // Keep the inbox entry if either data store fails to save the review.
          void flushPersist()
            .then(flushSync)
            .then(() => window.memoriaDesktop?.play?.remove(id))
            .catch(() => {
              setNotice('Readings were applied. The capture remains in the inbox until saving is confirmed.');
            });
        }
      }
    } catch (cause) {
      setError(message(cause));
    }
  };
  const planned = batch
    ? planGameImport(
        state,
        {
          ...batch,
          resources: batch.resources?.map((item) => ({ ...item, confirmed: true })),
          tasks: batch.tasks?.map((item) => ({ ...item, confirmed: true })),
        },
        Date.now(),
      )
    : undefined;
  return (
    <AnimatePresence>
      {open && (
        <Sheet
          key="import-center"
          open
          title="Import game readings"
          dirty={dirty}
          onClose={() => {
            requestEpoch.current += 1;
            recognitionBusy.current = false;
            dragDepth.current = 0;
            setDragging(false);
            setBusy(false);
            setOpen(false);
            setBatch(undefined);
            setText('');
            setCaptureId(undefined);
            setAssignments({});
            setError('');
            setNotice('');
          }}
          footer={
            batch && tab !== 'history' ? (
              <Btn
                kind="primary"
                disabled={busy || !planned || planned.resources.length + planned.tasks.length === 0}
                onClick={apply}
              >
                Apply reviewed readings
              </Btn>
            ) : undefined
          }
        >
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <p className="text-body text-muted">
              Check the account, capture time, and values before saving. Missing fields stay unchanged.
            </p>
            {incoming && (
              <div className="space-y-2 rounded-ui-lg bg-fill-2 p-3">
                <p className="text-body">A shared screenshot is ready.</p>
                <Btn
                  onClick={() => {
                    if (dirty && !window.confirm('Replace the current import draft?')) return;
                    acceptText(incoming);
                    setIncoming(null);
                  }}
                >
                  Review shared screenshot
                </Btn>
              </div>
            )}
            {games.length === 0 ? (
              <p className="text-body">Add a game before importing readings.</p>
            ) : (
              <>
                <Field label="Game account">
                  <Select
                    value={selectedGame}
                    onChange={(event) => {
                      if (captureId) {
                        if (!window.confirm('Use this capture for the selected game account?')) return;
                      } else if (dirty && !window.confirm('Clear the current import draft and change game?')) return;
                      setGameId(event.target.value);
                      setBatch(undefined);
                      if (!captureId) setText('');
                      setAssignments({});
                      setNotice('');
                      setError('');
                    }}
                  >
                    {!selectedGame && <option value="">Choose a game account</option>}
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                        {game.accountLabel ? ` · ${game.accountLabel}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2" aria-label="Import method">
                  {(['screenshot', 'accounts', 'history'] as const).map((item) => (
                    <Btn key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>
                      {item === 'screenshot' ? 'Screenshot' : item === 'accounts' ? 'Accounts' : 'History'}
                    </Btn>
                  ))}
                </div>
                {tab === 'screenshot' && (
                  <div className="space-y-4">
                    <input
                      hidden
                      ref={fileInput}
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        if (files.length) receiveFiles(files);
                      }}
                    />
                    {servedByLauncher() && !isNativeApp ? (
                      <div
                        role="group"
                        aria-label="Screenshot upload"
                        aria-busy={busy}
                        className={`space-y-3 rounded-ui-lg border border-dashed p-4 ${dragging ? 'border-accent bg-accent/10' : 'border-line-edge bg-fill-1'}`}
                        onDragEnter={(event) => {
                          if (!event.dataTransfer.types.includes('Files')) return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (recognitionBusy.current) return;
                          dragDepth.current += 1;
                          setDragging(true);
                        }}
                        onDragOver={(event) => {
                          if (!event.dataTransfer.types.includes('Files')) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
                        }}
                        onDragLeave={(event) => {
                          if (!event.dataTransfer.types.includes('Files')) return;
                          event.preventDefault();
                          event.stopPropagation();
                          dragDepth.current = Math.max(0, dragDepth.current - 1);
                          if (!dragDepth.current) setDragging(false);
                        }}
                        onDrop={(event) => {
                          if (!event.dataTransfer.types.includes('Files')) return;
                          event.preventDefault();
                          event.stopPropagation();
                          receiveFiles(Array.from(event.dataTransfer.files));
                        }}
                      >
                        <div>
                          <p className="text-body font-medium">
                            {busy
                              ? 'Reading image…'
                              : dragging
                                ? 'Release screenshot to read it'
                                : 'Drop screenshot here'}
                          </p>
                          <p className="text-meta text-muted">
                            One PNG or JPEG, up to 8 MB. You can also drop it anywhere in Memoria.
                          </p>
                        </div>
                        <Btn disabled={busy} onClick={() => fileInput.current?.click()}>
                          Choose screenshot
                        </Btn>
                      </div>
                    ) : (
                      isNativeApp && (
                        <Btn disabled={busy} onClick={() => void recognize()}>
                          {busy ? 'Reading image…' : 'Choose screenshot'}
                        </Btn>
                      )
                    )}
                    <p className="text-meta text-muted">
                      Images are read on this device. Review the detected text below.{' '}
                      {isNativeApp
                        ? 'You can also share an image to Memoria from your gallery.'
                        : !servedByLauncher()
                          ? 'Use the Windows or Android app to read images, or paste text here.'
                          : ''}
                    </p>
                    <Field label="Text from the screenshot">
                      <textarea
                        className="min-h-32 w-full rounded-ui-lg bg-fill-2 p-3 text-body text-fg ring-1 ring-line-edge"
                        maxLength={30000}
                        value={text}
                        onChange={(event) => {
                          setText(event.target.value);
                          setBatch(undefined);
                          setAssignments({});
                        }}
                        placeholder="Original Resin 120 / 200"
                      />
                    </Field>
                    {ratios.length > 0 && (
                      <details className="space-y-3 text-body">
                        <summary className="min-h-11 cursor-pointer py-2">Assign values without a label</summary>
                        <p className="text-meta text-muted">
                          For icon-only meters, choose what each ratio represents. Leave unrelated values unassigned.
                        </p>
                        {ratios.map((ratio) => {
                          const key = `${ratio.value}/${ratio.cap}`;
                          return (
                            <Field key={key} label={`${ratio.value} / ${ratio.cap}`}>
                              <Select
                                value={assignments[key] || ''}
                                onChange={(event) => {
                                  setAssignments({ ...assignments, [key]: event.target.value });
                                  setBatch(undefined);
                                }}
                              >
                                <option value="">Leave unassigned</option>
                                {resources
                                  .filter((resource) => resource.cap === ratio.cap)
                                  .map((resource) => (
                                    <option key={resource.id} value={resource.id}>
                                      {resource.name}
                                    </option>
                                  ))}
                              </Select>
                            </Field>
                          );
                        })}
                      </details>
                    )}
                    <Field label="Screenshot capture time (this device’s local time)">
                      <TextInput
                        type="datetime-local"
                        step="0.001"
                        required
                        value={capturedAt}
                        onChange={(event) => {
                          setCapturedAt(event.target.value);
                          setBatch(undefined);
                        }}
                      />
                    </Field>
                    <Btn
                      onClick={() => {
                        setCapturedAt(localDateTime(Date.now()));
                        setBatch(undefined);
                      }}
                    >
                      Taken just now
                    </Btn>
                    <Btn
                      disabled={busy || !selectedGame || !text.trim() || !capturedAt}
                      kind="primary"
                      onClick={review}
                    >
                      Review readings
                    </Btn>
                  </div>
                )}
                {tab === 'accounts' && (
                  <GameConnections
                    key={selectedGame}
                    gameId={selectedGame}
                    onReview={(value) => {
                      const draft = currentDraft.current;
                      if (!draft.open || value.gameId !== draft.selectedGame) return;
                      if (
                        draft.dirty &&
                        !window.confirm('Replace the current import draft with these account readings?')
                      )
                        return;
                      setBatch(value);
                      setCaptureId(undefined);
                      setError('');
                      setNotice(
                        value.resources?.length || value.tasks?.length
                          ? 'Check these readings before applying them.'
                          : 'This response contained no supported readings for the selected game.',
                      );
                    }}
                  />
                )}
                {batch && tab !== 'history' && (
                  <section className="space-y-3 border-t border-line-hairline pt-4" aria-label="Review imported values">
                    <h2 className="text-heading font-semibold">Review values</h2>
                    <p className="text-meta text-muted">
                      {batch.source.kind === 'account' ? 'HoYoLAB account' : 'Screenshot'} ·{' '}
                      {new Date(batch.observedAt).toLocaleString()}
                    </p>
                    {batch.resources?.map((item, index) => (
                      <div key={item.resourceId} className="flex items-end gap-3">
                        <Field
                          className="min-w-0 flex-1"
                          label={
                            state.resources.find((resource) => resource.id === item.resourceId)?.name || 'Resource'
                          }
                        >
                          <NumInput
                            min={0}
                            value={item.value ?? ''}
                            onChange={(event) =>
                              setBatch({
                                ...batch,
                                resources: batch.resources?.map((reading, i) =>
                                  i === index
                                    ? {
                                        ...reading,
                                        value: event.target.value === '' ? null : Number(event.target.value),
                                      }
                                    : reading,
                                ),
                              })
                            }
                          />
                        </Field>
                        {item.reserve != null && (
                          <Field
                            className="min-w-0 flex-1"
                            label={
                              state.resources.find((resource) => resource.id === item.resourceId)?.reserveLabel ||
                              'Reserve'
                            }
                          >
                            <NumInput
                              min={0}
                              max={state.resources.find((resource) => resource.id === item.resourceId)?.reserveCap}
                              value={item.reserve}
                              onChange={(event) =>
                                setBatch({
                                  ...batch,
                                  resources: batch.resources?.map((reading, i) =>
                                    i === index
                                      ? {
                                          ...reading,
                                          reserve: event.target.value === '' ? null : Number(event.target.value),
                                        }
                                      : reading,
                                  ),
                                })
                              }
                            />
                          </Field>
                        )}
                        <Btn
                          onClick={() =>
                            setBatch({ ...batch, resources: batch.resources?.filter((_, i) => i !== index) })
                          }
                        >
                          Skip
                        </Btn>
                      </div>
                    ))}
                    {batch.tasks?.map((item, index) => (
                      <div key={item.taskId} className="flex items-center gap-3">
                        <label className="flex min-h-11 flex-1 items-center gap-3 text-body">
                          <input
                            type="checkbox"
                            checked={item.done === true}
                            onChange={(event) =>
                              setBatch({
                                ...batch,
                                tasks: batch.tasks?.map((reading, i) =>
                                  i === index ? { ...reading, done: event.target.checked } : reading,
                                ),
                              })
                            }
                          />
                          {state.tasks.find((task) => task.id === item.taskId)?.name || 'Task'}
                        </label>
                        <Btn onClick={() => setBatch({ ...batch, tasks: batch.tasks?.filter((_, i) => i !== index) })}>
                          Skip
                        </Btn>
                      </div>
                    ))}
                    {!!planned?.issues.length && (
                      <ul className="space-y-1 text-meta text-warn-fg">
                        {planned.issues.map((issue, index) => (
                          <li key={index}>{issue.message}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
                {tab === 'history' && (
                  <section className="space-y-3" aria-label="Import history">
                    <p className="text-meta text-muted">Recent imports on this device. Undo keeps any later edits.</p>
                    {history.filter((entry) => entry.gameId === selectedGame).length === 0 && (
                      <p className="text-body text-muted">No imports yet for this game.</p>
                    )}
                    {history
                      .filter((entry) => entry.gameId === selectedGame)
                      .map((entry) => (
                        <div
                          key={entry.batchId}
                          className="flex flex-wrap items-center justify-between gap-3 border-b border-line-hairline py-3"
                        >
                          <div>
                            <p className="text-body font-medium">
                              {entry.source.kind === 'account' ? 'Account' : 'Screenshot'} · {entry.applied} saved
                            </p>
                            <p className="text-meta text-muted">
                              {new Date(entry.importedAt).toLocaleString()} · {entry.status}
                            </p>
                          </div>
                          <Btn
                            disabled={entry.undoneAt != null}
                            onClick={() => {
                              try {
                                const result = useApp.getState().undoGameImport(entry.batchId);
                                setError('');
                                setNotice(
                                  `${result.applied} readings restored. ${result.skipped} kept unchanged. ${result.issues.map((issue) => issue.message).join(' ')}`,
                                );
                              } catch (cause) {
                                setError(message(cause));
                              }
                            }}
                          >
                            Undo import
                          </Btn>
                        </div>
                      ))}
                  </section>
                )}
              </>
            )}
            {notice && (
              <p role="status" className="text-body text-muted">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="text-body text-danger-fg">
                {error}
              </p>
            )}
          </fieldset>
        </Sheet>
      )}
    </AnimatePresence>
  );
}
