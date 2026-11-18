import { useMemo, useState } from 'react';
import { ComponentThumbnail } from './ComponentView';
import type { Component } from './domain';
import { componentZip, downloadZip } from './portable';
import { variantLabels } from './csv';
import { SearchSelect } from './SearchSelect';

export function LinkedComponent({ component, components, available, onCopy, onRemove, notify }: {
  component: Component; components: Component[]; available: boolean; onCopy: () => void; onRemove: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [row, setRow] = useState(0);
  const labels = useMemo(() => variantLabels(component.csv, component.rows), [component.csv, component.rows]);
  return <section className="linked-component-view">
    <h1>{component.name}</h1>
    <p role="status">Read-only link from <strong>{component.source?.projectName}</strong>.</p>
    <p>{available ? 'Edit the original in its source project to update this component.' : 'Source unavailable locally. Showing the last saved snapshot.'}</p>
    <div className="button-row"><button className="button primary" onClick={onCopy}>Make local copy</button>
      <button className="button" onClick={() => {
        try { downloadZip(`${component.name}.component.zip`, componentZip(component, components)); }
        catch (error) { notify(`Export failed: ${String(error)}`, true); }
      }}>Export component</button>
      <button className="button" onClick={onRemove}>Remove link</button></div>
    {!!component.rows.length && <SearchSelect label="Preview row" value={String(Math.min(row, component.rows.length - 1))}
      options={labels.map((label, index) => ({ value: String(index), label }))} onChange={value => setRow(Number(value))} />}
    <div className="linked-component-art"><ComponentThumbnail component={component} components={components} row={Math.min(row, Math.max(0, component.rows.length - 1))} width={Math.min(360, component.width)} /></div>
  </section>;
}
