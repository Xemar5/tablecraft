import { useEffect, useRef, useState } from 'react';
import { ComponentThumbnail } from './ComponentView';
import { assetFontFamily, assetUrl, type Component } from './domain';
import { componentZip, downloadZip } from './portable';
import { Field, Modal } from './ui';

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
  return <section className="linked-component-view">
    <h1>{component.kind === 'font' ? 'Imported font' : 'Imported texture'}</h1>
    <Field label="Asset name"><input maxLength={100} value={component.name} onChange={event => {
      void onChange({ ...component, name: event.target.value });
    }} /></Field>
    <p>{component.asset?.name} · {component.asset?.mime}</p>
    <p>{component.kind === 'font' ? 'Select this font on a text layer in the designer.' : 'Select this texture on an image layer in the designer.'} This asset is embedded in ZIP saves and cannot be spawned as a piece.</p>
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
