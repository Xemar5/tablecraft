import type { ReactNode } from 'react';

/** Wraps a zoom percentage button; hovering or focusing it reveals preset zoom levels above. */
export function ZoomPresets({ levels, zoom, onSelect, children }: { levels: number[]; zoom: number; onSelect: (level: number) => void; children: ReactNode }) {
  return <div className="zoom-presets">
    {children}
    <div className="zoom-preset-menu" role="group" aria-label="Zoom presets">
      {levels.map(level => <button key={level} type="button" aria-label={`Zoom to ${Math.round(level * 100)}%`}
        aria-pressed={Math.round(zoom * 100) === Math.round(level * 100)}
        onClick={e => { onSelect(level); e.currentTarget.blur(); }}>{Math.round(level * 100)}%</button>)}
    </div>
  </div>;
}
