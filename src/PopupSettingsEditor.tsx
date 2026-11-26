import { LayoutTemplate, Pin } from 'lucide-react';
import type { Component } from './domain';
import { POPUP_ANCHORS, popupSettings, type PopupAnchor, type PopupSettings } from './popups';
import { Field, IconChoice, NumberField, SectionTitle, Toggle } from './ui';

const ANCHOR_NAMES: Record<PopupAnchor, string> = {
  'top-left': 'Top left', top: 'Top', 'top-right': 'Top right', left: 'Left', center: 'Centre', right: 'Right',
  'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right',
};

/**
 * A popup component's on-screen settings (its Behavior tab): where it shows over the table and how players use it.
 * Each game.popup call may override them.
 */
export function PopupSettingsEditor({ component, onChange }: { component: Component; onChange: (popup: PopupSettings) => void }) {
  const settings = popupSettings(component);
  const set = (patch: Partial<PopupSettings>) => onChange({ ...component.popup, ...patch });
  return <div className="inspector-section popup-settings">
    <SectionTitle title="On screen" hint="Scripts show popups on players’ screens over the table (game.popup), never on the table itself. Each game.popup call can change these settings." />
    <IconChoice label="Placement" value={settings.layout} onChange={layout => set({ layout })} options={[
      { value: 'layout', label: 'Layout: anchored in the table area, fitting it as it changes size', icon: <LayoutTemplate size={15} /> },
      { value: 'fixed', label: 'Fixed: at an exact position, at its own size', icon: <Pin size={15} /> },
    ]} />
    {settings.layout === 'layout' ? <>
      <div className="field"><span>Anchor</span>
        <div className="pivot-picker popup-anchor" role="radiogroup" aria-label="Anchor">
          {POPUP_ANCHORS.map(anchor => <button key={anchor} type="button" role="radio" aria-checked={settings.anchor === anchor} aria-label={`Anchor ${ANCHOR_NAMES[anchor].toLowerCase()}`}
            title={ANCHOR_NAMES[anchor]} className={settings.anchor === anchor ? 'active' : ''} onClick={() => set({ anchor })}><span /></button>)}
        </div></div>
      <Field label="Size"><select aria-label="Size" value={settings.fit} onChange={event => set({ fit: event.target.value as PopupSettings['fit'] })}>
        <option value="shrink">Shrink to fit the table area</option><option value="fill">Fill the table area</option><option value="none">Keep its size</option>
      </select></Field>
      <div className="field-grid">
        <NumberField deferred label="Margin (px)" hint="Space kept between it and the table area’s edges." value={settings.margin} min={0} max={2000} onChange={margin => set({ margin })} />
        <NumberField deferred label="Scale" value={settings.scale} min={0.1} max={10} step={0.1} onChange={scale => set({ scale })} />
      </div>
      <div className="field-grid">
        <NumberField deferred label="Offset X (px)" value={settings.x} min={-10000} max={10000} onChange={x => set({ x })} />
        <NumberField deferred label="Offset Y (px)" value={settings.y} min={-10000} max={10000} onChange={y => set({ y })} />
      </div>
    </> : <>
      <div className="field-grid">
        <NumberField deferred label="X (px)" hint="Its top-left corner, from the table area’s top-left corner." value={settings.x} min={-10000} max={10000} onChange={x => set({ x })} />
        <NumberField deferred label="Y (px)" value={settings.y} min={-10000} max={10000} onChange={y => set({ y })} />
      </div>
      <NumberField deferred label="Scale" value={settings.scale} min={0.1} max={10} step={0.1} onChange={scale => set({ scale })} />
    </>}
    <Toggle label="Blur the table behind it" description="Dims and blurs the table, which can’t be used until it’s closed" checked={settings.blur} onChange={blur => set({ blur })} />
    <Toggle label="Players can drag it" description="Each player moves it on their own screen" checked={settings.draggable} onChange={draggable => set({ draggable })} />
    <Toggle label="Players can close it" description="With its × button or Escape" checked={settings.closable} onChange={closable => set({ closable })} />
    <Field label="Closing"><select aria-label="Closing" value={settings.dismiss} onChange={event => set({ dismiss: event.target.value as PopupSettings['dismiss'] })}>
      <option value="each">Each player closes their own</option><option value="all">Closing it closes it for everyone</option>
    </select></Field>
    <NumberField deferred label="Close after (s)" hint="Closes by itself this many seconds after it shows; 0 keeps it open until it’s closed." value={settings.duration} min={0} max={3600}
      onChange={duration => set({ duration })} />
    {!!component.action && <Toggle label="Close after a click runs the action" description="Clicking a layer runs the script action, then closes it for that player"
      checked={settings.closeOnAction} onChange={closeOnAction => set({ closeOnAction })} />}
    <p className="help-text">Show it from a script with <code>game.popup("{component.name}", {'{'} players = …, data = {'{'} … {'}'} {'}'})</code>. While playing, click it in the library to preview it on your screen.</p>
  </div>;
}
