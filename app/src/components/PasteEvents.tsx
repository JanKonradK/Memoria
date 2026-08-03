import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { EventType, Game } from '@void/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { Pill } from './primitives';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextArea } from './ui';

interface ParsedEvent {
  sourceKey: string;
  name: string;
  type: EventType;
  start: number;
  end: number;
  dailyTouch: boolean;
}

const TYPES = new Set<EventType>(['banner', 'event', 'cycle', 'maintenance', 'custom']);

function aiPrompt(game: Game): string {
  return `List every event, banner and maintenance window in ${game.name} that is currently running or already announced (current patch and next).
Reply with ONLY a JSON array — no prose, no markdown fences — in exactly this schema:
[{"name":"Event name","type":"banner|event|cycle|maintenance","start":"2026-07-09 04:00","end":"2026-07-30 03:59","dailyTouch":false}]
Use type "cycle" for recurring endgame windows (Spiral Abyss, Memory of Chaos, Shiyu Defense and the like).
All times in the game's SERVER time (${game.tz}). Set "dailyTouch": true only for events that require a daily login or claim.`;
}

function parseWhen(v: unknown, tz: string): number | null {
  const s = String(v ?? '').trim();
  for (const fmt of [
    'yyyy-LL-dd HH:mm:ss',
    'yyyy-LL-dd HH:mm',
    "yyyy-LL-dd'T'HH:mm:ss",
    "yyyy-LL-dd'T'HH:mm",
    'yyyy-LL-dd',
  ]) {
    const dt = DateTime.fromFormat(s, fmt, { zone: tz });
    if (dt.isValid) return dt.toMillis();
  }
  const iso = DateTime.fromISO(s, { zone: tz });
  return iso.isValid ? iso.toMillis() : null;
}

function parsePasted(text: string, game: Game): { events: ParsedEvent[]; error: string } {
  const cleaned = text
    .replace(/^```[a-z]*\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();
  if (!cleaned) return { events: [], error: '' };
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return { events: [], error: 'Not valid JSON — paste exactly what the AI returned (the JSON array).' };
  }
  if (!Array.isArray(raw)) return { events: [], error: 'Expected a JSON array of events.' };
  const events: ParsedEvent[] = [];
  const problems: string[] = [];
  raw.forEach((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = String(o['name'] ?? '').trim();
    const start = parseWhen(o['start'], game.tz);
    const end = parseWhen(o['end'], game.tz);
    if (!name || start == null || end == null || end <= start) {
      problems.push(`#${i + 1}${name ? ` (${name})` : ''}`);
      return;
    }
    const type = TYPES.has(o['type'] as EventType) ? (o['type'] as EventType) : 'event';
    events.push({
      sourceKey: `paste:${game.id}:${name}:${start}`,
      name,
      type,
      start,
      end,
      dailyTouch: Boolean(o['dailyTouch']),
    });
  });
  return {
    events,
    error: problems.length
      ? `Skipped ${problems.length} malformed item${problems.length > 1 ? 's' : ''}: ${problems.join(', ')}`
      : '',
  };
}

export function PasteEventsSheet({ open }: { open: boolean }) {
  const state = useApp((store) => store.state);
  const upsertEvents = useApp((store) => store.upsertEvents);
  const closeSheet = useUI((s) => s.closeSheet);
  const games = state.games.filter((g) => !g.deleted).sort((a, b) => a.sort - b.sort);

  const [gameId, setGameId] = useState('');
  const game = games.find((g) => g.id === gameId) ?? games[0];
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [importedMsg, setImportedMsg] = useState('');

  const existingKeys = useMemo(
    () => new Set(state.events.filter((e) => !e.deleted && e.sourceKey).map((e) => e.sourceKey!)),
    [state.events],
  );
  const parsed = useMemo(() => (game ? parsePasted(text, game) : { events: [], error: '' }), [text, game]);

  const copyPrompt = () => {
    if (!game) return;
    void navigator.clipboard
      .writeText(aiPrompt(game))
      .then(() => {
        setImportedMsg('');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((error: unknown) => {
        setImportedMsg(`Copy failed — ${error instanceof Error ? error.message : 'clipboard permission was denied'}.`);
      });
  };

  const doImport = () => {
    if (!game) return;
    const picked = parsed.events.filter((e) => !unchecked.has(e.sourceKey) && !existingKeys.has(e.sourceKey));
    upsertEvents(
      picked.map((e) => ({
        gameId: game.id,
        name: e.name,
        type: e.type,
        start: e.start,
        end: e.end,
        dailyTouch: e.dailyTouch,
        notify: e.type !== 'maintenance',
        sourceKey: e.sourceKey,
      })),
    );
    setImportedMsg(`Imported ${picked.length} event${picked.length === 1 ? '' : 's'} → Timeline.`);
    setText('');
    setUnchecked(new Set());
  };

  return (
    <Sheet open={open} onClose={closeSheet} wide title="Paste events (AI)">
      {!game ? (
        <p className="py-6 text-body text-muted">Add a game first.</p>
      ) : (
        <div className="space-y-3 pb-2">
          <Field label="Game">
            <Select value={game.id} onChange={(e) => setGameId(e.target.value)}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-center gap-2">
            <Btn onClick={copyPrompt}>{copied ? '✓ Copied' : 'Copy AI prompt'}</Btn>
            <span className="text-label text-dim">
              Paste it to any AI (Claude, etc.), then paste the JSON it returns below.
            </span>
          </div>

          <Field label="AI response (JSON)">
            <TextArea
              rows={5}
              className="font-mono"
              placeholder='[{"name":"…","type":"banner","start":"2026-07-09 04:00","end":"2026-07-30 03:59","dailyTouch":false}]'
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setImportedMsg('');
              }}
            />
          </Field>

          {parsed.error && <p className="text-meta text-warn-fg">{parsed.error}</p>}

          {parsed.events.length > 0 && (
            <>
              <div className="max-h-[36dvh] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                {parsed.events.map((e) => {
                  const dup = existingKeys.has(e.sourceKey);
                  return (
                    <label
                      key={e.sourceKey}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-ui-lg px-2 py-1.5 transition hover:bg-fill-2 ${dup ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-accent-2"
                        checked={!dup && !unchecked.has(e.sourceKey)}
                        disabled={dup}
                        onChange={() =>
                          setUnchecked((cur) => {
                            const next = new Set(cur);
                            if (next.has(e.sourceKey)) next.delete(e.sourceKey);
                            else next.add(e.sourceKey);
                            return next;
                          })
                        }
                      />
                      <Pill variant="muted">{e.type}</Pill>
                      <span className="min-w-0 flex-1 truncate text-body text-fg-soft">{e.name}</span>
                      <span className="shrink-0 text-label tabular-nums text-dim">
                        {DateTime.fromMillis(e.start).toFormat('dd LLL HH:mm')} →{' '}
                        {DateTime.fromMillis(e.end).toFormat('dd LLL HH:mm')}
                        {dup && ' · already imported'}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <Btn kind="primary" onClick={doImport}>
                  Import{' '}
                  {parsed.events.filter((e) => !unchecked.has(e.sourceKey) && !existingKeys.has(e.sourceKey)).length}{' '}
                  events
                </Btn>
                {importedMsg && <span className="text-meta text-ok-fg">{importedMsg}</span>}
              </div>
            </>
          )}
          {importedMsg && parsed.events.length === 0 && <p className="text-meta text-ok-fg">{importedMsg}</p>}
        </div>
      )}
    </Sheet>
  );
}
