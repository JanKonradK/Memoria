import { useState } from 'react';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { serverRegionLabel } from './NexusLayout';
import { useGameDraft } from './game-detail/useGameDraft';
import { GameEditor } from './settings/GameEditor';
import { Sheet } from './Sheet';
import { Btn, Field, SectionTitle, Segmented, TextInput } from './ui';

const ACCOUNT_DRAFT_FIELDS = ['accountLabel'] as const;

/**
 * The three regions this control offers, left to right — the HoYo/Kuro rows of
 * SERVER_TZ_OPTIONS, which is where these strings come from.
 *
 * Mind the sign: `Etc/GMT-1` is UTC**+**1. The POSIX zones invert, which is the
 * trap documented alongside SERVER_TZ_OPTIONS itself. game-detail-draft.test.tsx
 * derives the same three from their real UTC offsets and asserts they match, so
 * a typo here fails a test rather than silently sending a European account to
 * the wrong reset hour.
 */
const SERVER_OPTIONS = [
  { value: 'Etc/GMT-1', label: 'EU' },
  { value: 'Etc/GMT+5', label: 'NA' },
  { value: 'Etc/GMT-8', label: 'Asia' },
];

/**
 * Everything about one game, in one place, reached from the card's own Edit
 * button and from Settings.
 *
 * There used to be two editors. This sheet held the nickname, the server and
 * the delete button; the real one — resources, quick spends, the whole task
 * list — was an inline panel behind an "Expand" button on the Settings page,
 * sitting next to an "Edit" button that opened this sheet instead. So the card
 * offered no way at all to change a task, and Settings offered two buttons that
 * both said they edited the game and did different things. One surface now.
 */
export function GameDetailSheet({ gameId, open }: { gameId: string | null; open: boolean }) {
  const state = useApp((store) => store.state);
  const updateGame = useApp((store) => store.updateGame);
  const deleteGame = useApp((store) => store.deleteGame);
  const closeSheet = useUI((store) => store.closeSheet);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const game = state.games.find((candidate) => candidate.id === gameId && !candidate.deleted);
  const { changeDraft, commitDraft, draft } = useGameDraft(game, ACCOUNT_DRAFT_FIELDS, open);

  if (!game) {
    return (
      <Sheet open={false} onClose={closeSheet} title="">
        {null}
      </Sheet>
    );
  }

  const close = () => {
    commitDraft();
    setConfirmDelete(false);
    closeSheet();
  };
  const knownServer = SERVER_OPTIONS.some((option) => option.value === game.tz);
  const serverOptions = knownServer
    ? SERVER_OPTIONS
    : [
        ...SERVER_OPTIONS,
        {
          value: game.tz,
          label: serverRegionLabel(game.tz, Date.now()),
          disabled: true,
        },
      ];

  return (
    <Sheet
      open={open}
      onClose={close}
      wide
      title={game.accountLabel?.trim() ? `${game.name} · ${game.accountLabel.trim()}` : game.name}
    >
      <div className="space-y-6">
        <div>
          <Field label="Nickname">
            <TextInput
              value={draft.accountLabel}
              placeholder="e.g. Main EU"
              onChange={(event) => changeDraft('accountLabel', event.target.value)}
              onBlur={commitDraft}
            />
          </Field>
          <p className="mt-1 text-label text-muted">Only needed if you track more than one account of this game.</p>
        </div>

        {/* Deliberately not a <Field>. Field renders a <label>, and a label may
            only name ONE control — wrapping a radiogroup in one hands its first
            radio the label's text as that radio's accessible name, so the EU
            option announced itself as "Server". The group carries its own name
            through ariaLabel instead. */}
        <div>
          <span className="mb-1 block text-label font-semibold uppercase tracking-wider text-muted">Server</span>
          <Segmented
            options={serverOptions}
            value={game.tz}
            onChange={(tz) => updateGame(game.id, { tz })}
            ariaLabel="Server"
          />
        </div>

        <GameEditor game={game} />

        <div className="border-t border-line-hairline pt-5">
          <SectionTitle>Delete game</SectionTitle>
          {!confirmDelete ? (
            <Btn kind="danger" onClick={() => setConfirmDelete(true)}>
              Delete game…
            </Btn>
          ) : (
            <>
              <p className="mb-2 text-label text-danger-fg">
                This also deletes this game's resources, tasks, quick spends, and events.
              </p>
              <div className="flex gap-2">
                <Btn
                  kind="danger"
                  onClick={() => {
                    deleteGame(game.id);
                    close();
                  }}
                >
                  Really delete {game.short}
                </Btn>
                <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
