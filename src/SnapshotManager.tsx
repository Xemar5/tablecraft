import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Download, FlagTriangleRight, History as HistoryIcon, PencilLine, Play, Plus, Save, Star, Trash2, X } from 'lucide-react';
import type { Project } from './domain';
import { baseSnapshot, deleteBlocker, isOutdated, latestSnapshot, type History, type OpenProject, type Session, type Snapshot } from './projectHistory';
import { Field, Modal } from './ui';
import './snapshotManager.css';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const pieces = (snapshot: Snapshot) => `${snapshot.project.instances?.length ?? 0} pieces · ${snapshot.project.players?.length ?? 0} players`;
export const snapshotName = (project: Pick<Project, 'name'>) => `${project.name} - ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

/** A name that turns into a text field to rename it (Enter or leaving the field saves, Escape cancels). */
function Renamable({ name, label, onRename, children }: { name: string; label: string; onRename: (name: string) => void; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  if (editing) return <input ref={input} className="history-rename" aria-label={`New name for ${label}`} defaultValue={name} maxLength={100} autoFocus
    onBlur={event => { const value = event.target.value.trim(); if (value && value !== name) onRename(value); setEditing(false); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.currentTarget.value = name; event.currentTarget.blur(); } }} />;
  return <span className="history-name"><strong>{name}</strong>{children}
    <button type="button" className="icon-button history-rename-button" aria-label={`Rename ${label}`} title="Rename" onClick={() => setEditing(true)}><PencilLine size={13} /></button></span>;
}

/** A delete button that asks once more before deleting, or says why it can't. */
function DeleteButton({ label, blocker, onDelete }: { label: string; blocker?: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (asking) return <span className="history-confirm" role="group" aria-label={`Delete ${label}?`}>
    <button type="button" className="button danger" onClick={() => { setAsking(false); onDelete(); }}>Delete</button>
    <button type="button" className="icon-button" aria-label="Keep it" title="Keep it" onClick={() => setAsking(false)}><X size={14} /></button></span>;
  return <button type="button" className="icon-button" aria-label={`Delete ${label}`} aria-disabled={!!blocker || undefined} title={blocker ?? 'Delete (this cannot be undone)'}
    onClick={() => { if (!blocker) setAsking(true); }}><Trash2 size={14} /></button>;
}

function SnapshotRow({ snapshot, history, open, session, latest, onLoad, onRename, onDelete, onBase, readOnly }: {
  snapshot: Snapshot; history: History; open?: OpenProject; session?: Session; latest: boolean; readOnly?: string;
  onLoad: () => void; onRename: (name: string) => void; onDelete: () => void; onBase?: () => void;
}) {
  const base = history.status === 'finished' && history.baseId === snapshot.id;
  const loaded = open?.from === snapshot.id;
  return <li className={`history-snapshot${loaded ? ' loaded' : ''}`}>
    <div className="history-snapshot-text">
      <Renamable name={snapshot.name} label={`snapshot ${snapshot.name}`} onRename={onRename}>
        {base && <span className="history-badge base"><Star size={10} /> Base</span>}
        {latest && !session && history.status === 'draft' && <span className="history-badge">Latest</span>}
        {loaded && <span className="history-badge loaded">Loaded</span>}
      </Renamable>
      <small>{when(snapshot.createdAt)} · {pieces(snapshot)}</small>
    </div>
    <div className="history-row-actions">
      {onBase && !base && <button type="button" className="button" title="Make this the base that new games start from" onClick={onBase}><Star size={13} /> Make base</button>}
      <button type="button" className="button" disabled={!!readOnly} title={readOnly} aria-label={`Load snapshot ${snapshot.name}`} onClick={onLoad}>Load</button>
      <DeleteButton label={`snapshot ${snapshot.name}`} blocker={deleteBlocker(history, snapshot.id, open)} onDelete={onDelete} />
    </div>
  </li>;
}

/** Asks what to call a new game (session): a name is required. */
function GameNameForm({ onStart, onCancel, disabled, title }: { onStart: (name: string) => void; onCancel?: () => void; disabled?: boolean; title?: string }) {
  const [name, setName] = useState('');
  return <form className="history-new-game-form" onSubmit={event => { event.preventDefault(); if (name.trim()) onStart(name.trim()); }}>
    <Field label="Session name"><input autoFocus value={name} maxLength={100} required placeholder="What shall we call this game?" onChange={event => setName(event.target.value)} /></Field>
    <div className="modal-actions">
      {onCancel && <button type="button" className="button" onClick={onCancel}>Cancel</button>}
      <button className="button primary" type="submit" disabled={disabled || !name.trim()} title={name.trim() ? title : 'Name the game first'}><Play size={15} /> Start a new game</button>
    </div>
  </form>;
}

/**
 * A project's draft snapshots and sessions: its status (draft or finished, with its base), renaming, deleting and
 * loading them, and starting a new game (which asks what to call it). Saving a snapshot is SaveDialog's.
 */
export function HistoryManager({ project: _project, history, open, readOnly, onLoad, onContinue, onStartGame, onRename, onDeleteSnapshot, onDeleteSession, onStatus, onExport }: {
  project: Project; history: History; open?: OpenProject; readOnly?: string;
  onLoad: (snapshotId: string) => void; onContinue: (sessionId: string) => void; onStartGame: (name: string) => void;
  onRename: (id: string, name: string) => void; onDeleteSnapshot: (id: string) => void; onDeleteSession: (id: string) => void;
  onStatus: (status: History['status'], baseId?: string) => void; onExport: () => void;
}) {
  const session = open?.session ? history.sessions.find(item => item.id === open.session) : undefined;
  const [naming, setNaming] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() => session ? [session.id] : []);
  const base = baseSnapshot(history);
  const finished = history.status === 'finished';
  const drafts = [...history.snapshots].reverse();
  const sessions = [...history.sessions].reverse();
  return <div className="history-manager">
    <div className="history-status" role="group" aria-label="Project status">
      <div className="history-status-switch">
        <button type="button" className={finished ? '' : 'active'} aria-pressed={!finished} onClick={() => onStatus('draft')}><PencilLine size={14} /> Draft</button>
        <button type="button" className={finished ? 'active' : ''} aria-pressed={finished} disabled={!history.snapshots.length} title={history.snapshots.length ? undefined : 'Save a draft snapshot first'}
          onClick={() => onStatus('finished', history.snapshots.some(item => item.id === history.baseId) ? history.baseId : history.snapshots.at(-1)?.id)}><FlagTriangleRight size={14} /> Finished</button>
      </div>
      <p>{finished
        ? <>New games start from the base <strong>{base?.name}</strong>. Loading the project asks whether to start a new game or continue a session.</>
        : <>Each new draft snapshot is the latest version, and loading the project loads it. Mark the project finished to play sessions from a base snapshot.</>}</p>
    </div>
    <section className="history-section" aria-label="Draft snapshots">
      <h3><HistoryIcon size={15} /> Draft snapshots <span className="history-count">{history.snapshots.length}</span></h3>
      {!drafts.length && <p className="help-text">No draft snapshots yet.</p>}
      <ul className="history-list">{drafts.map((snapshot, index) => <SnapshotRow key={snapshot.id} snapshot={snapshot} history={history} open={open} latest={index === 0} readOnly={readOnly}
        onLoad={() => onLoad(snapshot.id)} onRename={value => onRename(snapshot.id, value)} onDelete={() => onDeleteSnapshot(snapshot.id)}
        onBase={finished ? () => onStatus('finished', snapshot.id) : undefined} />)}</ul>
    </section>
    {(finished || sessions.length > 0) && <section className="history-section" aria-label="Sessions">
      <h3><Play size={15} /> Sessions <span className="history-count">{history.sessions.length}</span></h3>
      {finished && (naming ? <GameNameForm disabled={!!readOnly} title={readOnly} onCancel={() => setNaming(false)} onStart={name => { setNaming(false); onStartGame(name); }} />
        : <button type="button" className="button history-new-game" disabled={!!readOnly} title={readOnly} onClick={() => setNaming(true)}><Plus size={14} /> Start a new game</button>)}
      {!sessions.length && <p className="help-text">No sessions yet.</p>}
      <ul className="history-list">{sessions.map(item => {
        const outdated = isOutdated(history, item), shown = expanded.includes(item.id), playing = open?.session === item.id;
        const startedFrom = history.snapshots.find(snapshot => snapshot.id === item.baseId);
        return <li key={item.id} className={`history-session${playing ? ' loaded' : ''}`}>
          <div className="history-session-heading">
            <button type="button" className="icon-button" aria-expanded={shown} aria-label={`${shown ? 'Hide' : 'Show'} snapshots of ${item.name}`}
              onClick={() => setExpanded(current => shown ? current.filter(other => other !== item.id) : [...current, item.id])}>{shown ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
            <div className="history-snapshot-text">
              <Renamable name={item.name} label={`session ${item.name}`} onRename={value => onRename(item.id, value)}>
                {outdated && <span className="history-badge outdated" title="It started from a snapshot that is no longer the base">Outdated</span>}
                {playing && <span className="history-badge loaded">Playing</span>}
              </Renamable>
              <small>{item.snapshots.length} snapshot{item.snapshots.length === 1 ? '' : 's'} · started {when(item.createdAt)} from {startedFrom ? `“${startedFrom.name}”` : `“${item.baseName}” (deleted)`}</small>
            </div>
            <div className="history-row-actions">
              <button type="button" className="button" disabled={!!readOnly} title={readOnly ?? `Load its latest snapshot, “${latestSnapshot(history, item.id)?.name}”`} aria-label={`Continue session ${item.name}`} onClick={() => onContinue(item.id)}>Continue</button>
              <DeleteButton label={`session ${item.name}`} blocker={playing ? 'Close the project before deleting the session you are playing.' : undefined} onDelete={() => onDeleteSession(item.id)} />
            </div>
          </div>
          {shown && <ul className="history-list history-session-snapshots">{[...item.snapshots].reverse().map((snapshot, index) => <SnapshotRow key={snapshot.id} snapshot={snapshot} history={history} open={open} session={item}
            latest={index === 0} readOnly={readOnly} onLoad={() => onLoad(snapshot.id)} onRename={value => onRename(snapshot.id, value)} onDelete={() => onDeleteSnapshot(snapshot.id)} />)}</ul>}
        </li>;
      })}</ul>
    </section>}
    <div className="modal-actions history-footer"><button type="button" className="button" onClick={onExport}><Download size={15} /> Export…</button></div>
  </div>;
}

/** Loading a finished project: start a new game from its base, or continue one of its sessions. */
export function GameChooser({ project, history, onStart, onContinue, onClose }: {
  project: Project; history: History; onStart: (name: string) => void; onContinue: (sessionId: string) => void; onClose: () => void;
}) {
  const base = baseSnapshot(history);
  const sessions = [...history.sessions].sort((a, b) => (b.snapshots.at(-1)?.createdAt ?? b.createdAt) - (a.snapshots.at(-1)?.createdAt ?? a.createdAt));
  return <Modal title={`Play ${project.name}`} subtitle="Start a new game from the base snapshot, or pick up a session where it was saved." onClose={onClose}>
    <div className="game-chooser">
      <div className="game-chooser-new">
        <h3><Plus size={16} /> New game</h3>
        <p className="help-text">Starts a session from a copy of the base, <strong>{base?.name}</strong>. Snapshots you save while playing go to the session.</p>
        <GameNameForm onStart={onStart} />
      </div>
      <section className="game-chooser-sessions" aria-label="Existing sessions">
        <h3><HistoryIcon size={16} /> Continue a session</h3>
        {!sessions.length && <p className="help-text">No sessions yet.</p>}
        <ul className="history-list">{sessions.map(session => {
          const latest = session.snapshots.at(-1)!;
          return <li key={session.id} className="history-snapshot"><div className="history-snapshot-text">
            <span className="history-name"><strong>{session.name}</strong>{isOutdated(history, session) && <span className="history-badge outdated" title={`Started from “${session.baseName}”, which is no longer the base`}>Outdated</span>}</span>
            <small>Latest: {latest.name} · {when(latest.createdAt)}{isOutdated(history, session) ? ` · from “${session.baseName}”` : ''}</small></div>
            <div className="history-row-actions"><button type="button" className="button" aria-label={`Continue session ${session.name}`} onClick={() => onContinue(session.id)}>Continue</button></div></li>;
        })}</ul>
      </section>
    </div>
  </Modal>;
}

/** Saves a snapshot of the loaded project: to its drafts, or to the session being played. */
export function SaveDialog({ project, history, open, onSave, onClose }: {
  project: Project; history: History; open?: OpenProject; onSave: (name: string) => void; onClose: () => void;
}) {
  const session = open?.session ? history.sessions.find(item => item.id === open.session) : undefined;
  const [name, setName] = useState(() => snapshotName(project));
  return <Modal title="Save" subtitle="A snapshot keeps the whole playground: designs, table, hands, seats, scripts and memory." onClose={onClose}>
    <form className="unsaved-dialog" onSubmit={event => { event.preventDefault(); onSave(name); }}>
      <Field label="Snapshot name"><input autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} /></Field>
      <p className="help-text history-save-target">{session ? <>Saves to the session <strong>{session.name}</strong>.</> : 'Saves a draft snapshot, the latest version of the project. Load lists the snapshots.'}</p>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary"><Save size={15} /> Save snapshot</button>
      </div>
    </form>
  </Modal>;
}

/** Asks before leaving a loaded project whose table differs from its last snapshot. */
export function UnsavedDialog({ project, target, onSave, onDiscard, onCancel }: {
  project: Project; target: string; onSave: (name: string) => void; onDiscard: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(() => snapshotName(project));
  return <Modal title="Unsaved changes" subtitle={`${project.name} has changes since its last snapshot. Save them before you ${target}?`} onClose={onCancel}>
    <form className="unsaved-dialog" onSubmit={event => { event.preventDefault(); onSave(name); }}>
      <Field label="Snapshot name"><input autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} /></Field>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="button danger" onClick={onDiscard}>Discard changes</button>
        <button type="submit" className="button primary"><Save size={15} /> Save snapshot</button>
      </div>
    </form>
  </Modal>;
}

type Choice = { id: string; label: string; snapshots: string[] };
/**
 * Chooses what a project export holds besides the project itself: its base, its draft history, sessions (with or
 * without the drafts), single snapshots or everything. Presets fill in the checkboxes, which can then be adjusted.
 */
export function ExportDialog({ project, history, open, onExport, onClose }: {
  project: Project; history: History; open?: OpenProject; onExport: (snapshotIds: Set<string>) => void; onClose: () => void;
}) {
  const drafts = history.snapshots.map(snapshot => snapshot.id);
  const all = [...drafts, ...history.sessions.flatMap(session => session.snapshots.map(snapshot => snapshot.id))];
  const base = baseSnapshot(history);
  const session = open?.session ? history.sessions.find(item => item.id === open.session) : undefined;
  const presets: Choice[] = [
    ...base ? [{ id: 'base', label: 'Base snapshot', snapshots: [base.id] }] : [],
    ...!base && drafts.length ? [{ id: 'latest', label: 'Latest draft', snapshots: [drafts.at(-1)!] }] : [],
    { id: 'drafts', label: 'Draft history', snapshots: drafts },
    // A session with the draft it started from, so it can be played on from the same start after importing.
    ...session ? [{ id: 'session', label: 'This session', snapshots: [...drafts.includes(session.baseId) ? [session.baseId] : [], ...session.snapshots.map(snapshot => snapshot.id)] }] : [],
    ...history.sessions.length ? [{ id: 'everything', label: 'Everything', snapshots: all }] : [],
    { id: 'none', label: 'Project only', snapshots: [] },
  ];
  const [chosen, setChosen] = useState(() => new Set(presets[0].snapshots));
  const toggle = (ids: string[], on: boolean) => setChosen(current => { const next = new Set(current); for (const id of ids) if (on) next.add(id); else next.delete(id); return next; });
  const group = (label: string, ids: string[], children: ReactNode, extra?: ReactNode) => {
    const count = ids.filter(id => chosen.has(id)).length;
    return <li className="export-group"><label className="export-check"><input type="checkbox" checked={!!ids.length && count === ids.length} disabled={!ids.length}
      ref={element => { if (element) element.indeterminate = count > 0 && count < ids.length; }} onChange={event => toggle(ids, event.target.checked)} />
      <strong>{label}</strong>{extra}<small>{count}/{ids.length}</small></label><ul>{children}</ul></li>;
  };
  const item = (snapshot: Snapshot, badge?: ReactNode) => <li key={snapshot.id}><label className="export-check"><input type="checkbox" checked={chosen.has(snapshot.id)} onChange={event => toggle([snapshot.id], event.target.checked)} />
    <span>{snapshot.name}</span>{badge}<small>{when(snapshot.createdAt)}</small></label></li>;
  const same = (ids: string[]) => ids.length === chosen.size && ids.every(id => chosen.has(id));
  return <Modal title={`Export ${project.name}`} subtitle="The project's current table is always included. Choose which snapshots and sessions travel with it." wide onClose={onClose}>
    <div className="export-dialog">
      <div className="export-presets" role="group" aria-label="Export presets">{presets.map(preset => <button key={preset.id} type="button" className={`button${same(preset.snapshots) ? ' active' : ''}`} aria-pressed={same(preset.snapshots)}
        onClick={() => setChosen(new Set(preset.snapshots))}>{same(preset.snapshots) && <Check size={13} />}{preset.label}</button>)}</div>
      <ul className="export-tree">
        {group('Draft snapshots', drafts, history.snapshots.map(snapshot => item(snapshot, base?.id === snapshot.id && <span className="history-badge base"><Star size={10} /> Base</span>)))}
        {history.sessions.map(entry => group(entry.name, entry.snapshots.map(snapshot => snapshot.id), entry.snapshots.map(snapshot => item(snapshot)),
          isOutdated(history, entry) ? <span className="history-badge outdated">Outdated</span> : <span className="history-badge">Session</span>))}
      </ul>
      <p className="help-text">{chosen.size ? `${chosen.size} snapshot${chosen.size === 1 ? '' : 's'} selected.` : 'No snapshots: only the project and its current table.'}
        {history.status === 'finished' && base && !chosen.has(base.id) ? ' Without its base, the project is imported as a draft.' : ''}</p>
      <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" onClick={() => onExport(chosen)}><Download size={15} /> Export ZIP</button></div>
    </div>
  </Modal>;
}
