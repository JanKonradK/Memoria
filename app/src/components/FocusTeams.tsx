import { useState } from 'react';
import { useApp } from '../store';
import { Btn, TextInput, Toggle } from './ui';

/** Per-game "what to build next" list. Top undone goal is pinned on the card. */
export function FocusEditor({ gameId }: { gameId: string }) {
  const app = useApp();
  const [newFocus, setNewFocus] = useState('');
  const focusItems = app.state.focus.filter((f) => f.gameId === gameId && !f.deleted).sort((a, b) => a.sort - b.sort);

  const add = () => {
    if (!newFocus.trim()) return;
    app.addFocus(gameId, newFocus.trim());
    setNewFocus('');
  };

  return (
    <div className="space-y-2">
      {focusItems.map((f, i) => (
        <div key={f.id} className={`flex items-center gap-2 ${f.done ? 'opacity-50' : ''}`}>
          <span className="w-5 shrink-0 text-center text-[11px] font-bold tabular-nums text-slate-500">
            {f.done ? '✓' : i + 1}
          </span>
          <TextInput
            value={f.name}
            onChange={(e) => app.updateFocus(f.id, { name: e.target.value })}
            className={f.done ? 'line-through' : ''}
          />
          <TextInput
            placeholder="note (talents 9/9/9, mats…)"
            value={f.note}
            onChange={(e) => app.updateFocus(f.id, { note: e.target.value })}
          />
          <div className="flex shrink-0 gap-0.5">
            <button
              type="button"
              onClick={() => app.moveFocus(f.id, -1)}
              disabled={i === 0}
              className="rounded px-1 text-slate-500 transition hover:text-slate-200 disabled:opacity-30"
              aria-label={`Move ${f.name} up`}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => app.moveFocus(f.id, 1)}
              disabled={i === focusItems.length - 1}
              className="rounded px-1 text-slate-500 transition hover:text-slate-200 disabled:opacity-30"
              aria-label={`Move ${f.name} down`}
            >
              ↓
            </button>
          </div>
          <Toggle checked={f.done} onChange={(v) => app.updateFocus(f.id, { done: v })} />
          <button
            type="button"
            onClick={() => app.deleteFocus(f.id)}
            className="text-slate-500 transition hover:text-rose-400"
            aria-label={`Delete focus ${f.name}`}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <TextInput
          placeholder="Next character / weapon / goal…"
          value={newFocus}
          onChange={(e) => setNewFocus(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Btn className="shrink-0" onClick={add}>
          + Goal
        </Btn>
      </div>
    </div>
  );
}

function TeamMemberInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    setDraft('');
  };
  return (
    <input
      value={draft}
      placeholder="+ member"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      onBlur={commit}
      className="h-7 w-24 rounded-lg bg-white/[0.07] px-2 text-xs text-slate-200 ring-1 ring-white/15 outline-none placeholder:text-slate-500 focus:ring-2"
      aria-label="Add team member"
    />
  );
}

/** Saved comps; click a member to flag as needs-building (shows on the card). */
export function TeamsEditor({ gameId }: { gameId: string }) {
  const app = useApp();
  const teams = app.state.teams.filter((t) => t.gameId === gameId && !t.deleted).sort((a, b) => a.sort - b.sort);

  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <div key={team.id} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/5">
          <div className="flex items-center gap-2">
            <TextInput
              value={team.name}
              onChange={(e) => app.updateTeam(team.id, { name: e.target.value })}
              className="max-w-56 font-semibold"
              aria-label="Team name"
            />
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => app.deleteTeam(team.id)}
              className="text-slate-500 transition hover:text-rose-400"
              aria-label={`Delete team ${team.name}`}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {team.members.map((m, mi) => (
              <span
                key={`${m.name}-${mi}`}
                className={`inline-flex items-center gap-1 rounded-lg py-1 pl-2.5 pr-1.5 text-xs font-semibold ring-1 transition ${
                  m.needsWork
                    ? 'bg-amber-400/15 text-amber-200 ring-amber-300/30'
                    : 'bg-white/[0.07] text-slate-200 ring-white/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    app.updateTeam(team.id, {
                      members: team.members.map((x, xi) => (xi === mi ? { ...x, needsWork: !x.needsWork } : x)),
                    })
                  }
                  title={m.needsWork ? 'Marked: needs building — click to clear' : 'Click to mark as needs building'}
                >
                  {m.name}
                </button>
                <button
                  type="button"
                  onClick={() => app.updateTeam(team.id, { members: team.members.filter((_, xi) => xi !== mi) })}
                  className="rounded px-0.5 text-slate-500 transition hover:text-rose-400"
                  aria-label={`Remove ${m.name} from ${team.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <TeamMemberInput
              onAdd={(name) => app.updateTeam(team.id, { members: [...team.members, { name, needsWork: false }] })}
            />
          </div>
        </div>
      ))}
      <Btn onClick={() => app.addTeam(gameId, `Team ${teams.length + 1}`)}>+ Team</Btn>
    </div>
  );
}
