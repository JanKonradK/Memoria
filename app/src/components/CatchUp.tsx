import { useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { presetForGame, redemptionCodeStatus, type AppState, type Game } from '@memoria/shared';
import {
  CATCH_UP_LABELS,
  digestKey,
  digestsForGame,
  unreadDigests,
  type CatchUpCharacter,
  type CatchUpItem,
  type Section,
  type VersionDigest,
} from '../data/catch-up';
import { useNow } from '../hooks';
import { lastAiredStream, nextBroadcast } from '../catch-up-status';
import { useApp } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { fmtDur } from '../util';
import { LivestreamCodes } from './LivestreamCodes';
import { Btn, Segmented } from './ui';
import '../catch-up.css';

function day(iso: string, format = 'd LLL'): string {
  return DateTime.fromISO(iso).toFormat(format);
}

function SectionBlock<T>({
  title,
  section,
  children,
}: {
  title: string;
  section: Section<T>;
  children: (items: T[]) => ReactNode;
}) {
  return (
    <section className="catch-up-section" aria-label={title}>
      <h4 className="catch-up-label">{title}</h4>
      {section.items.length > 0 ? (
        children(section.items)
      ) : (
        <p className="aside text-meta text-muted">
          {section.state === 'complete'
            ? 'None this version.'
            : section.state === 'partial'
              ? 'None confirmed yet.'
              : 'No summary yet for this version.'}
        </p>
      )}
    </section>
  );
}

function Characters({ items }: { items: CatchUpCharacter[] }) {
  const ordered = [...items].sort((a, b) => Number(a.rerun ?? false) - Number(b.rerun ?? false));
  return (
    <ul className="catch-up-characters">
      {ordered.map((character) => (
        <li key={character.name} className="catch-up-character" data-rerun={character.rerun || undefined}>
          <span className="catch-up-rank numeral" aria-label={`Rank ${character.rank}`}>
            {character.rank}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold text-fg">{character.name}</span>
            <span className="aside block text-caption text-muted">
              {[character.rerun ? 'Rerun' : 'New', ...character.traits, character.note].filter(Boolean).join(' · ')}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Items({ items }: { items: CatchUpItem[] }) {
  return (
    <ul className="catch-up-items">
      {items.map((item) => (
        <li key={item.name}>
          <span className="text-body text-fg">
            {item.rank && <span className="numeral mr-1.5 text-caption font-semibold text-muted">{item.rank}</span>}
            {item.name}
          </span>
          {item.detail && <span className="aside block text-caption text-muted">{item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

const QOL_PREVIEW = 3;

function Changes({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, QOL_PREVIEW);
  return (
    <>
      <ul className="catch-up-list">
        {shown.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {items.length > QOL_PREVIEW && (
        <button type="button" className="catch-up-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show ${items.length - QOL_PREVIEW} more`}
        </button>
      )}
    </>
  );
}

function VersionBody({ digest, summary = true }: { digest: VersionDigest; summary?: boolean }) {
  const labels = CATCH_UP_LABELS[digest.game] ?? { weapons: 'Weapons', gear: 'Gear sets' };
  const now = useNow(60_000);
  // Usable codes stand beside the notes; expired or undated ones wait at the end, folded.
  const codesLive = redemptionCodeStatus(digest.codes?.expiresAt, now) === 'available';
  const codes = digest.codes && <LivestreamCodes redemption={digest.codes} gameName={`Version ${digest.version}`} />;
  return (
    <div className="catch-up-body">
      {summary && <p className="text-body leading-relaxed text-fg-soft">{digest.summary}</p>}
      <SectionBlock title="Characters" section={digest.characters}>
        {(items) => <Characters items={items} />}
      </SectionBlock>
      <div className="catch-up-columns">
        <SectionBlock title={labels.weapons} section={digest.weapons}>
          {(items) => <Items items={items} />}
        </SectionBlock>
        {labels.gear && (
          <SectionBlock title={labels.gear} section={digest.gear}>
            {(items) => <Items items={items} />}
          </SectionBlock>
        )}
        <SectionBlock title="Outfits" section={digest.outfits}>
          {(items) => <Items items={items} />}
        </SectionBlock>
      </div>
      <SectionBlock title="Events" section={digest.events}>
        {(items) => <Changes items={items} />}
      </SectionBlock>
      <SectionBlock title="Quality of life" section={digest.qol}>
        {(items) => <Changes items={items} />}
      </SectionBlock>
      {digest.story.items.length > 0 && (
        <details className="catch-up-spoiler">
          <summary>Story and new areas · may spoil</summary>
          <ul className="catch-up-list">
            {digest.story.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {!codesLive && codes}
      <p className="catch-up-sources say aside text-caption text-muted">
        Checked {day(digest.reviewed)} from{' '}
        {digest.sources.map((source, index) => (
          <span key={source.url}>
            {index > 0 && ', '}
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          </span>
        ))}
        .
      </p>
    </div>
  );
}

function VersionHeading({ digest, unread }: { digest: VersionDigest; unread: boolean }) {
  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="numeral text-heading font-semibold text-fg">Version {digest.version}</span>
        {digest.title && <span className="text-body text-fg-soft">{digest.title}</span>}
        {unread && <span className="catch-up-new">New to you</span>}
      </span>
      <span className="mt-1 block text-meta text-muted">
        {digest.status === 'announced'
          ? `Arrives ${day(digest.release, 'd LLL yyyy')}`
          : `${day(digest.release, 'd LLL')}${digest.ends ? ` – ${day(digest.ends, 'd LLL yyyy')}` : ' onward'}`}
      </span>
    </>
  );
}

/**
 * The newest version leads with its number set large in the game's colour, a
 * plate drawn from type alone: no publisher artwork ships with Memoria.
 * Earlier versions fold away under quieter headings.
 */
function Version({ digest, unread, lead }: { digest: VersionDigest; unread: boolean; lead: boolean }) {
  if (lead) {
    return (
      <article className="catch-up-version catch-up-lead" aria-labelledby={`${digest.id}-heading`}>
        {/* The plate sits beside the heading where there is room, so the content starts in the first view. */}
        <div className="catch-up-lead-head" data-art="">
          <div className="catch-up-plate" aria-hidden>
            <span className="catch-up-plate-version numeral">{digest.version}</span>
            {digest.title && <span className="catch-up-plate-title">{digest.title}</span>}
          </div>
          <div className="min-w-0">
            <h3 id={`${digest.id}-heading`}>
              <VersionHeading digest={digest} unread={unread} />
            </h3>
            <p className="mt-3 text-body leading-relaxed text-fg-soft">{digest.summary}</p>
            {digest.stream && (
              <a className="catch-up-replay" href={digest.stream.replay} target="_blank" rel="noreferrer">
                Watch the {digest.version} livestream ↗
              </a>
            )}
          </div>
        </div>
        <VersionBody digest={digest} summary={false} />
      </article>
    );
  }
  return (
    <details className="catch-up-version catch-up-fold">
      <summary>
        <span className="min-w-0 flex-1">
          <VersionHeading digest={digest} unread={unread} />
        </span>
        <span aria-hidden className="catch-up-chevron">
          ›
        </span>
      </summary>
      {digest.stream && (
        <a className="catch-up-replay" href={digest.stream.replay} target="_blank" rel="noreferrer">
          Watch the {digest.version} livestream ↗
        </a>
      )}
      <VersionBody digest={digest} />
    </details>
  );
}

function NextStream({ state, game, now }: { state: Pick<AppState, 'events' | 'settings'>; game: Game; now: number }) {
  const next = nextBroadcast(state, game.id, now);
  if (!next) return null;
  const zone = state.settings.localTz;
  const at = (ms: number, format: string) => DateTime.fromMillis(ms, { zone }).toFormat(format);
  const live = !next.estimated && next.event.start <= now;
  return (
    <section className="game-news-stream" aria-label="Next livestream">
      <h3 className="tab-label">Next livestream</h3>
      <span className="text-body text-fg">{next.event.name.replace(/\s*—\s*predicted window/i, '')}</span>
      <span className="numeral text-meta text-fg-soft">
        {next.estimated
          ? `Estimated ${at(next.event.start, 'd LLL')}–${at(next.event.end, 'd LLL')}`
          : live
            ? 'Live now'
            : `${at(next.event.start, 'ccc d LLL · HH:mm')} · in ${fmtDur(next.event.start - now)}`}
      </span>
    </section>
  );
}

/** The newest livestream that has aired, with its replay. */
function LastStream({ presetKey, now }: { presetKey: string | undefined; now: number }) {
  const last = lastAiredStream(presetKey, now);
  if (!last?.stream) return null;
  return (
    <section className="game-news-stream" aria-label="Last livestream">
      <h3 className="tab-label">Last livestream</h3>
      <span className="text-body text-fg">Version {last.version}</span>
      <span className="numeral text-meta text-muted">Aired {day(last.stream.aired, 'd LLL yyyy')}</span>
      <a className="catch-up-replay" href={last.stream.replay} target="_blank" rel="noreferrer">
        Watch the replay ↗
      </a>
    </section>
  );
}

/**
 * A game's News tab: what its recent versions added, new to you or all of them,
 * beside its livestreams and the codes that still work.
 */
export function CatchUpView({ game, now }: { game: Game; now: number }) {
  const state = useApp(useShallow((s) => ({ events: s.state.events, settings: s.state.settings })));
  const markRead = useApp((store) => store.markCatchUpRead);
  const preset = presetForGame(game)?.key;
  const digests = useMemo(() => digestsForGame(preset), [preset]);
  const seen = preset ? state.settings.catchUpSeen?.[preset] : undefined;
  const unread = useMemo(() => unreadDigests(digests, seen), [digests, seen]);
  // The scope is fixed when the tab opens, so marking read does not empty the view under you.
  const [scope, setScope] = useState<'new' | 'all'>(() => (unread.length > 0 ? 'new' : 'all'));
  const [openedUnread] = useState(() => new Set(unread.map(digestKey)));
  const shown = scope === 'new' ? digests.filter((digest) => openedUnread.has(digestKey(digest))) : digests;
  const stillUnread = shown.filter((digest) => unread.includes(digest));
  const liveCodes = digests.filter(
    (digest) => digest.codes && redemptionCodeStatus(digest.codes.expiresAt, now) === 'available',
  );
  const versions = digests.map((digest) => digest.version);
  const coverage =
    versions.length > 0 ? `Covers Version ${versions.at(-1)}${versions.length > 1 ? ` to ${versions[0]}` : ''}` : '';
  const stream = nextBroadcast(state, game.id, now);
  const replay = lastAiredStream(preset, now);
  const side = Boolean(stream || replay?.stream || liveCodes.length);

  return (
    <div className="game-news" data-side={side || undefined}>
      {side && (
        <aside className="game-news-side" aria-label={`${game.name} livestreams and codes`}>
          <NextStream state={state} game={game} now={now} />
          <LastStream presetKey={preset} now={now} />
          {liveCodes.map((digest) => (
            <LivestreamCodes key={digest.id} redemption={digest.codes!} gameName={`Version ${digest.version}`} />
          ))}
        </aside>
      )}
      <div className="catch-up game-news-main">
        {digests.length > 0 && (
          <div className="catch-up-toolbar">
            <Segmented
              ariaLabel="Versions to show"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'new', label: `New to you${openedUnread.size ? ` (${openedUnread.size})` : ''}` },
                { value: 'all', label: 'All versions' },
              ]}
            />
            {coverage && <p className="aside text-meta text-muted">{coverage}</p>}
            {stillUnread.length > 0 && (
              <Btn
                kind="primary"
                className="catch-up-mark"
                onClick={() =>
                  preset &&
                  markRead(
                    preset,
                    stillUnread.map((digest) => digestKey(digest)),
                  )
                }
              >
                Mark {stillUnread.length === 1 ? 'as' : `all ${stillUnread.length}`} read
              </Btn>
            )}
          </div>
        )}

        {digests.length === 0 ? (
          <p className="catch-up-empty text-body text-muted">No version notes for this game yet.</p>
        ) : shown.length === 0 ? (
          <div className="catch-up-empty">
            <p className="text-body text-fg-soft">You’re caught up.</p>
            <Btn className="mt-3" onClick={() => setScope('all')}>
              Show all versions
            </Btn>
          </div>
        ) : (
          shown.map((digest, index) => (
            <Version key={digest.id} digest={digest} unread={unread.includes(digest)} lead={index === 0} />
          ))
        )}
      </div>
    </div>
  );
}
