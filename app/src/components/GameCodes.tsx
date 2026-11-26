import { useId, useState, type FormEvent } from 'react';
import {
  defaultRedeemUrl,
  parseCodeList,
  presetForGame,
  redeemInstructionsFor,
  redeemPortalUrl,
  type Game,
} from '@memoria/shared';
import { useCopyCode, useGameCodes, useRedeemed, withUndo, type GameCodeItem } from '../codes';
import { useApp } from '../store';
import { fmtDur } from '../util';
import { CodeClaim } from './CodeClaim';
import { Btn, Field, TextArea, TextInput } from './ui';

const LINK_CLASS =
  'inline-flex min-h-11 shrink-0 items-center px-1 text-meta font-semibold text-accent-fg underline underline-offset-4 fine:min-h-8';

/** A code row: no fill at rest, the quiet fill under a pointer, bleeding into the gutter so the text stays aligned. */
const ROW_CLASS = '-mx-1.5 flex flex-wrap items-center gap-x-2 rounded-ui-md px-1.5 py-1 transition hover:bg-fill-1';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A `yyyy-mm-dd` date as the last second of that day here; undefined when blank or unreadable. */
function endOfDay(value: string): number | undefined {
  if (!value) return undefined;
  const at = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(at) ? at : undefined;
}

/** Paste codes, say what they pay and when they run out. */
function AddCodesForm({
  game,
  autoLink,
  onDone,
  onCancel,
}: {
  game: Game;
  autoLink: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [rewards, setRewards] = useState('');
  const [expires, setExpires] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const count = parseCodeList(text).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const codes = parseCodeList(text);
    if (codes.length === 0) return setError('Paste at least one code.');
    const redeemUrl = link.trim();
    if (redeemUrl && !redeemUrl.startsWith('https://')) return setError('Redeem links must start with https://.');
    const expiresAt = endOfDay(expires);
    const added = withUndo(
      (n: number) => `Added ${plural(n, 'code')} to ${game.name}`,
      () =>
        useApp.getState().addGameCodes(
          game.id,
          codes.map((code) => ({
            code,
            ...(rewards.trim() ? { rewards: rewards.trim() } : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
            ...(redeemUrl ? { redeemUrl } : {}),
          })),
        ),
    );
    if (added === 0) return setError('Already added.');
    onDone(`Added ${plural(added, 'code')}`);
  };

  return (
    <form className="row-arrive mt-3 grid gap-3" onSubmit={submit} aria-label={`Add codes for ${game.name}`}>
      <TextArea
        aria-label="Reward codes"
        className="numeral"
        placeholder="Paste one or more codes (one per line or comma-separated)"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        autoFocus
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rewards">
          <TextInput
            value={rewards}
            maxLength={200}
            placeholder="100 Primogems"
            onChange={(event) => setRewards(event.target.value)}
          />
        </Field>
        <Field label="Expires">
          <TextInput type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
        </Field>
      </div>
      {autoLink ? (
        <p className="aside text-caption text-muted">Redeem links fill in automatically for Genshin, HSR and ZZZ.</p>
      ) : (
        <Field label="Redeem link">
          <TextInput
            type="url"
            inputMode="url"
            value={link}
            maxLength={500}
            placeholder="https://…"
            onChange={(event) => {
              setLink(event.target.value);
              setError('');
            }}
          />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger-fg">
          {error}
        </p>
      )}
      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" kind="primary">
          {count > 1 ? 'Add codes' : 'Add code'}
        </Btn>
      </div>
    </form>
  );
}

/** One game's reward codes, its own tab: what still works, then what was redeemed or ran out. */
export function GameCodes({ game, now }: { game: Game; now: number }) {
  const { active, redeemed, expired } = useGameCodes(game, now);
  const mark = useRedeemed((s) => s.mark);
  const { copied, message, copy } = useCopyCode();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const headingId = useId();
  const presetKey = game.presetKey ?? presetForGame(game)?.key;
  const autoLink = Boolean(defaultRedeemUrl(presetKey, 'CODE'));
  const portal = redeemPortalUrl(presetKey);
  const finished = [
    ...redeemed.map((item) => ({ item, tag: 'Redeemed' as const })),
    ...expired.map((item) => ({ item, tag: 'Expired' as const })),
  ];

  const toggle = (item: GameCodeItem) => {
    const id = item.customId;
    if (!id) return;
    const was = redeemed.includes(item);
    withUndo(was ? `Unmarked ${item.code}` : `Marked ${item.code} redeemed`, () =>
      useApp.getState().toggleGameCodeRedeemed(game.id, id),
    );
  };
  const remove = (item: GameCodeItem) => {
    const id = item.customId;
    if (id) withUndo(`Removed ${item.code}`, () => useApp.getState().removeGameCode(game.id, id));
  };

  return (
    <section className="game-codes game-codes-page" aria-labelledby={headingId}>
      <div className="look-rule flex items-center gap-2">
        <h3 id={headingId} className="look-rule-label shrink-0 text-meta font-semibold text-muted">
          Codes
        </h3>
        {active.length > 0 && <span className="numeral text-caption text-muted">{active.length}</span>}
        <span aria-hidden className="look-rule-line h-px min-w-4 flex-1 bg-line-hairline" />
        {portal && (
          <a href={portal} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Official redeem page ↗
          </a>
        )}
        <Btn
          className="shrink-0"
          aria-expanded={adding}
          aria-label={`Add codes for ${game.name}`}
          onClick={() => {
            setAdding((open) => !open);
            setNote('');
          }}
        >
          <span aria-hidden>+ </span>Add
        </Btn>
      </div>

      {adding && (
        <AddCodesForm
          game={game}
          autoLink={autoLink}
          onCancel={() => setAdding(false)}
          onDone={(text) => {
            setNote(text);
            setAdding(false);
          }}
        />
      )}

      {active.length > 0 && (
        <ul className="mt-2 grid gap-0.5" aria-label={`${game.name} active codes`}>
          {active.map((item) => {
            const meta = [item.rewards, item.expiresAt ? `${fmtDur(item.expiresAt - now)} left` : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={item.customId ?? `feed:${item.code}`} className={ROW_CLASS}>
                <div className="min-w-0 flex-1 basis-32">
                  <code className="numeral select-all break-all text-meta font-semibold text-fg">{item.code}</code>
                  {meta && <p className="aside text-caption text-muted">{meta}</p>}
                </div>
                <Btn
                  className="min-w-16 shrink-0"
                  aria-label={`Copy ${item.code}`}
                  onClick={() => void copy(item.code)}
                >
                  {copied === item.code ? 'Copied' : 'Copy'}
                </Btn>
                <CodeClaim game={game} item={item} linkClassName={LINK_CLASS} onDone={setNote} />
                <Btn
                  className="shrink-0"
                  aria-label={`Mark ${item.code} redeemed`}
                  onClick={() => (item.customId ? toggle(item) : mark(item.key, item.code))}
                >
                  ✓
                </Btn>
                {item.customId && (
                  <Btn className="shrink-0" aria-label={`Remove ${item.code}`} onClick={() => remove(item)}>
                    ×
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {finished.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer content-center text-meta text-muted fine:min-h-8">
            Redeemed &amp; expired ({finished.length})
          </summary>
          <ul className="mt-1 grid gap-0.5">
            {finished.map(({ item, tag }) => (
              <li key={item.customId ?? `feed:${item.code}`} className={ROW_CLASS}>
                <div className="min-w-0 flex-1 basis-32">
                  <s className="numeral break-all text-meta text-muted">{item.code}</s>
                  <span className="ml-2 text-caption text-muted">{tag}</span>
                </div>
                {item.customId && tag === 'Redeemed' && (
                  <Btn className="shrink-0" aria-label={`Unmark ${item.code}`} onClick={() => toggle(item)}>
                    Unmark
                  </Btn>
                )}
                {item.customId && (
                  <Btn className="shrink-0" aria-label={`Remove ${item.code}`} onClick={() => remove(item)}>
                    ×
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!adding && active.length === 0 && finished.length === 0 && (
        <p className="mt-3 text-meta text-muted">
          No active codes right now. Paste a livestream or promo code with + Add to copy, open, or claim it here.
        </p>
      )}
      <p className="aside mt-3 text-caption text-muted">{redeemInstructionsFor(presetKey)}</p>
      <p role="status" className="text-caption text-muted empty:hidden">
        {note || message}
      </p>
    </section>
  );
}
