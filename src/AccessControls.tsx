import type { ReactNode } from 'react';
import { EyeOff, ListOrdered, LockKeyhole } from 'lucide-react';
import { appliesTo, toggleSeat, type AccessKind, type Scope } from './access';
import type { Player } from './domain';
import { InfoTip } from './ui';

const KINDS: Record<AccessKind, { title: string; icon: ReactNode; on: string; off: string; hint: string }> = {
  hide: {
    title: 'Hidden from', icon: <EyeOff size={12} />, on: 'Show to', off: 'Hide from',
    hint: 'Seats it’s hidden from don’t see it on the table (stacks are hidden whole). Everyone hides it from every seat, seats that join later included, except the seats you leave out. Like hidden hands this is visual privacy: every player’s browser still receives the whole table. Show hidden pieces from Actions → Visibility.',
  },
  lock: {
    title: 'Locked for', icon: <LockKeyhole size={12} />, on: 'Unlock for', off: 'Lock for',
    hint: 'Seats it’s locked for can’t move, turn, flip or draw it. Everyone locks it for every seat, seats that join later and scripts included, except the seats you leave out.',
  },
  orderLock: {
    title: 'Order locked for', icon: <ListOrdered size={12} />, on: 'Unlock order for', off: 'Lock order for',
    hint: 'Seats its order is locked for can’t bring it forward, send it back, raise it by picking it up, or move it in the Pieces panel or into or out of a group; it can still move on the table. Everyone covers every seat, seats that join later and scripts included, except the seats you leave out.',
  },
};

const names = (players: Player[], ids: string[]) => ids.map(id => players.find(player => player.id === id)?.name ?? 'a removed seat').join(', ');
/** What a setting covers, in words. */
export function scopeSummary(scope: Scope, players: Player[]) {
  if (scope.all) return scope.players.length ? `Everyone but ${names(players, scope.players)}, and seats that join later` : 'Everyone, and seats that join later';
  return scope.players.length ? `Only ${names(players, scope.players)}` : 'No one';
}

/**
 * Hiding, locks and order locks for pieces or groups, all alike: an Everyone switch, and a chip for each seat that shows
 * whether the setting covers it now. With Everyone off, the chips pick the seats it covers; with it on, it covers every
 * seat (seats that join later too) but those whose chips are turned off. Turning Everyone on or off starts afresh.
 */
export function AccessControls({ kinds, scopes, players, seat, disabled, onChange }: {
  kinds: AccessKind[]; scopes: Record<AccessKind, Scope>; players: Player[]; seat?: string;
  /** Why the controls can't be used (viewers). */
  disabled?: string | false;
  onChange: (kind: AccessKind, scope: Scope) => void;
}) {
  return <div className="access-controls">{kinds.map(kind => {
    const { title, icon, on, off, hint } = KINDS[kind], scope = scopes[kind];
    return <div key={kind} className={`field access-row access-${kind}`} role="group" aria-label={title}>
      <span>{title}<InfoTip text={hint} /></span>
      <div className="access-seats">
        <button type="button" role="switch" aria-checked={scope.all} className={`access-everyone${scope.all ? ' on' : ''}`} aria-disabled={!!disabled || undefined}
          title={disabled || (scope.all ? `Covers every seat, seats that join later too, but those left out. Turn off to cover no one.` : 'Cover every seat, seats that join later too')}
          onClick={() => { if (!disabled) onChange(kind, { all: !scope.all, players: [] }); }}>{icon}Everyone</button>
        {players.map(player => {
          const covered = appliesTo(scope, player.id);
          return <button key={player.id} type="button" className={`hidden-seat access-seat${covered ? ' hidden' : ''}`} aria-pressed={covered} aria-disabled={!!disabled || undefined}
            aria-label={`${covered ? on : off} ${player.name}`} title={disabled || `${covered ? on : off} ${player.name}`}
            onClick={() => { if (!disabled) onChange(kind, toggleSeat(scope, player.id)); }}>
            <span className="mini-avatar" style={{ background: player.color }}>{player.name[0]}</span>{player.name}{player.id === seat && ' (you)'}{covered && icon}
          </button>;
        })}
      </div>
      <small className="access-summary">{scopeSummary(scope, players)}</small>
    </div>;
  })}</div>;
}
