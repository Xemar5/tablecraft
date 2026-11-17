import { useEffect, useRef, useState } from 'react';
import { ComponentThumbnail } from './ComponentView';
import { assetFontFamily, assetUrl, isAsset, type Component } from './domain';
import { componentZip, downloadZip } from './portable';
import { Modal } from './ui';

export function AssetFonts({ components, notify }: { components: Component[]; notify: (message: string, error?: boolean) => void }) {
  const registered = useRef(new Map<string, { data: string; mime: string; font: FontFace }>());
  useEffect(() => {
    const fonts = components.filter(component => component.kind === 'font' && component.asset);
    for (const [id, entry] of registered.current) if (!fonts.some(component => component.id === id)) {
      document.fonts.delete(entry.font); registered.current.delete(id);
    }
    for (const component of fonts) {
      const previous = registered.current.get(component.id), asset = component.asset!;
      if (previous?.data === asset.data && previous.mime === asset.mime) continue;
      if (previous) document.fonts.delete(previous.font);
      const font = new FontFace(assetFontFamily(component), `url("${assetUrl(component)}")`);
      document.fonts.add(font);
      registered.current.set(component.id, { data: asset.data, mime: asset.mime, font });
      void font.load().catch(() => {
        if (registered.current.get(component.id)?.font === font) notify(`Unable to load imported font "${component.name}". The font file may be invalid.`, true);
      });
    }
  }, [components, notify]);
  useEffect(() => {
    const fonts = registered.current;
    return () => { fonts.forEach(entry => document.fonts.delete(entry.font)); fonts.clear(); };
  }, []);
  return null;
}

export function AssetInspector({ component, components, onChange, onDelete, notify }: {
  component: Component; components: Component[]; onChange: (component: Component) => Promise<boolean>;
  onDelete: () => Promise<void>; notify: (message: string, error?: boolean) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(component.name);
  useEffect(() => setName(component.name), [component.name]);
  // Names select assets in {{bindings}}, so every texture and font needs its own.
  const clash = components.find(other => other.id !== component.id && isAsset(other) && other.name.trim().toLowerCase() === name.trim().toLowerCase());
  const commitName = () => {
    const next = name.trim();
    if (!next || clash) { setName(component.name); return; }
    if (next !== component.name) void onChange({ ...component, name: next });
  };
  return <section className="linked-component-view">
    <h1>{component.kind === 'font' ? 'Imported font' : 'Imported texture'}</h1>
    <label className={`field asset-name-field${clash ? ' invalid' : ''}`}><span>Asset name</span>
      <input maxLength={100} value={name} aria-invalid={!!clash} aria-describedby="asset-name-hint" onChange={event => setName(event.target.value)} onBlur={commitName}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { setName(component.name); } }} />
      <small id="asset-name-hint" role={clash ? 'alert' : undefined}>{clash ? `“${clash.name}” already uses this name. Asset names must be unique.` : 'Unique across textures and fonts.'}</small>
    </label>
    <p>{component.asset?.name} · {component.asset?.mime}</p>
    <p>{component.kind === 'font'
      ? <>Select this font on a text layer in the designer, or type its name (or bind a column whose value is its name, as in <code>{'{{font}}'}</code>) in the Google font field.</>
      : <>Select this texture on an image layer in the designer, or use its name as the image source, directly or through a binding such as <code>{'{{art}}'}</code>.</>} This asset is embedded in ZIP saves and cannot be spawned as a piece.</p>
    <ComponentThumbnail component={component} components={components} width={280} />
    <div className="button-row">
      <button className="button" onClick={() => {
        try { downloadZip(`${component.name}.component.zip`, componentZip(component, components)); }
        catch (error) { notify(`Export failed: ${String(error)}`, true); }
      }}>Export asset</button>
      <button className="button danger" onClick={() => setDeleting(true)}>Delete asset</button>
    </div>
    {deleting && <Modal title={`Delete ${component.name}?`} subtitle="This deletes the embedded file. Image layers using it become empty; text layers revert to DM Sans." onClose={() => setDeleting(false)}>
      <div className="modal-actions"><button className="button" onClick={() => setDeleting(false)}>Cancel</button><button className="button danger" onClick={() => void onDelete()}>Delete asset</button></div>
    </Modal>}
  </section>;
}
