import { useMemo, useState } from 'react';
import { ComponentThumbnail } from './ComponentView';
import type { Component } from './domain';
import { exportComponentBundle, download } from './storage';
import { variantLabels } from './csv';

export function LinkedComponent({ component, components, available, onCopy, onRemove }: {
  component: Component; components: Component[]; available: boolean; onCopy: () => void; onRemove: () => void;
}) {
  const [row, setRow] = useState(0);
  const labels = useMemo(() => variantLabels(component.csv, component.rows), [component.csv, component.rows]);
  return <section className="linked-component-view">
    <h1>{component.name}</h1>
    <p role="status">Read-only link from <strong>{component.source?.projectName}</strong>.</p>
    <p>{available ? 'Edit the original in its source project to update this component.' : 'Source unavailable locally. Showing the last saved snapshot.'}</p>
    <div className="button-row"><button className="button primary" onClick={onCopy}>Make local copy</button>
      <button className="button" onClick={() => download(`${component.name}.component.json`, JSON.stringify(exportComponentBundle(component, components), null, 2))}>Export component</button>
      <button className="button" onClick={onRemove}>Remove link</button></div>
    {!!component.rows.length && <label className="field"><span>Preview row</span><select aria-label="Preview row" value={Math.min(row, component.rows.length - 1)} onChange={event => setRow(Number(event.target.value))}>
      {labels.map((label, index) => <option key={index} value={index}>{label}</option>)}
    </select></label>}
    <div className="linked-component-art"><ComponentThumbnail component={component} components={components} row={Math.min(row, Math.max(0, component.rows.length - 1))} width={Math.min(360, component.width)} /></div>
  </section>;
}
