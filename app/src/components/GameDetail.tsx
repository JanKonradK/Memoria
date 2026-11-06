import { useState } from 'react';
import { useApp } from '../store';
import { useUI, type GameEditorSection } from '../ui-store';
import { ServerSelect } from './ServerSelect';
import { useGameDraft } from './game-detail/useGameDraft';
import { GameEditor } from './settings/GameEditor';
import { Sheet } from './Sheet';
import { Btn, COMPACT_INPUT, Field, TextInput } from './ui';

const ACCOUNT_DRAFT_FIELDS = ['accountLabel'] as const;

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
export function GameDetailSheet({
  gameId,
  open,
  initialSection,
}: {
  gameId: string | null;
  open: boolean;
  initialSection?: GameEditorSection;
}) {
  const state = useApp((store) => store.state);
  const updateGame = useApp((store) => store.updateGame);
  const deleteGame = useApp((store) => store.deleteGame);
  const closeSheet = useUI((store) => store.closeSheet);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Keep a soft-deleted game visible until its sheet finishes exiting.
  const game = state.games.find((candidate) => candidate.id === gameId);
  const { changeDraft, commitDraft, draft } = useGameDraft(game, ACCOUNT_DRAFT_FIELDS, open);

  if (!game) return null;

  // The title reads the DRAFT, not the store. The nickname deliberately keeps
  // its debounce — nothing outside this sheet renders it while it is being
  // typed — but the sheet's own heading is inside the sheet, and a heading that
  // lags a third of a second behind the field under it looks broken.
  const nickname = draft.accountLabel.trim();
  const close = () => {
    commitDraft();
    closeSheet();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      dirty={dirty}
      wide
      title={nickname ? `${game.name} · ${nickname}` : game.name}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 text-meta text-muted">
            {dirty ? 'Add or save your draft before closing' : 'Game settings save automatically'}
          </span>
          <Btn
            kind="primary"
            onClick={() => {
              if (!dirty || window.confirm('Discard your unsaved changes?')) close();
            }}
          >
            Done
          </Btn>
        </div>
      }
    >
      <GameEditor
        key={`${game.id}:${initialSection ?? ''}`}
        game={game}
        initialSection={initialSection}
        onDraftChange={setDirty}
        accountControls={
          <div>
            <Field label="Nickname">
              <TextInput
                className={COMPACT_INPUT}
                value={draft.accountLabel}
                placeholder="e.g. Main EU"
                onChange={(event) => changeDraft('accountLabel', event.target.value)}
                onBlur={commitDraft}
              />
            </Field>
          </div>
        }
        serverControl={
          <Field label="Server">
            <ServerSelect
              className={COMPACT_INPUT}
              game={game}
              value={{ server: game.server, tz: game.tz }}
              onChange={(pick) => updateGame(game.id, pick)}
            />
          </Field>
        }
        dangerControls={
          <div>
            {!confirmDelete ? (
              <Btn kind="danger" onClick={() => setConfirmDelete(true)}>
                Delete game…
              </Btn>
            ) : (
              <>
                <p className="mb-2 text-label text-danger-fg">
                  Also deletes its resources, tasks, events and reminders.
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
        }
      />
    </Sheet>
  );
}
