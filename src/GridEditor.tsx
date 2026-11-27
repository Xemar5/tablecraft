import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Grid2X2, Hexagon, LocateFixed, Magnet, Plus, Trash2, X } from 'lucide-react';
import { uid } from './domain';
import { DEFAULT_POINT_RADIUS, type Grid } from './grids';
import { gridColor, opaqueColor } from './GridLayers';
import { TagFilterEditor } from './TagEditors';
import { Collapsible, ColorField, Field, IconChoice, NumberField, Toggle } from './ui';
import { ANY_TAGS } from './tags';
import './grids.css';

const SHAPES = [
  { value: 'square', label: 'Square grid', icon: <Grid2X2 size={15} /> },
  { value: 'hex', label: 'Hex grid', icon: <Hexagon size={15} /> },
  { value: 'points', label: 'Snap points', icon: <LocateFixed size={15} /> },
] as const;
export const GRID_SHAPES = SHAPES;
export const gridShapeIcon = (shape: Grid['shape'], size = 14) => shape === 'hex' ? <Hexagon size={size} /> : shape === 'points' ? <LocateFixed size={size} /> : <Grid2X2 size={size} />;

/** A new grid layer of a shape, named after it, numbered when the name is taken. */
export function newGrid(shape: Grid['shape'], grids: Grid[]): Grid {
  const base = shape === 'hex' ? 'Hex grid' : shape === 'points' ? 'Snap points' : 'Square grid';
  let name = base;
  for (let n = 2; grids.some(grid => grid.name === name); n++) name = `${base} ${n}`;
  return { id: uid('grid'), name, shape, visible: true, snap: true, size: shape === 'hex' ? 100 : 50, offsetX: 0, offsetY: 0, ...(shape === 'points' ? { points: [] } : {}) };
}

/** How a grid list is changed: the table's grids through shared table actions, a component's through design edits. */
export type GridActions<G extends Grid> = {
  save: (grid: G) => void; add: (grid: G) => Promise<boolean> | boolean; remove: (id: string) => void; reorder: (ids: string[]) => void;
  /** A new grid of a shape for this list (newGrid by default). */
  create?: (shape: Grid['shape'], grids: G[]) => G;
};

/**
 * A grid list and the selected grid's settings, its snap points included: the grid tool's panel for the table's grids
 * (the first one wins where several could take a piece), and the designer's for a component's grids, which add
 * `bounds` settings (from `boundsEditor`). Without `list` it's only the selected grid's settings, with its show, snap
 * and delete buttons in its title: the designer lists a component's grids in its Layers panel instead.
 */
export function GridEditor<G extends Grid>({ grids, selected, onSelect, point, onSelectPoint, actions, disabled, tags, onDone, intro, boundsEditor, pointsList, list = true, surface = 'the table' }: {
  grids: G[]; selected?: G; onSelect: (id: string) => void; point?: string; onSelectPoint: (id: string | undefined) => void;
  actions: GridActions<G>; disabled: boolean; tags: string[]; onDone: () => void;
  /** The panel's explanation under its title (the table grid tool's by default). */
  intro?: ReactNode;
  boundsEditor?: (grid: G) => ReactNode;
  /** The selected points grid's points, listed under its snap distance. */
  pointsList?: ReactNode;
  /** Whether to show the grid list (with the add buttons) above the settings. */
  list?: boolean;
  /** Where the grid is dragged and points are added: the table (with the grid tool), or the designer's canvas. */
  surface?: string;
}) {
  const save = actions.save;
  const update = (patch: Partial<Grid>) => { if (selected) save({ ...selected, ...patch }); };
  const add = async (shape: Grid['shape']) => {
    const grid = actions.create ? actions.create(shape, grids) : newGrid(shape, grids) as G;
    if (await actions.add(grid)) { onSelect(grid.id); onSelectPoint(undefined); }
  };
  const move = (index: number, offset: number) => {
    const ids = grids.map(grid => grid.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    actions.reorder(ids);
  };
  const selectedPoint = selected?.points?.find(item => item.id === point);
  const updatePoint = (patch: Partial<NonNullable<Grid['points']>[number]>) => {
    if (selected && selectedPoint) update({ points: selected.points!.map(item => item.id === selectedPoint.id ? { ...item, ...patch } : item) });
  };
  const rowActions = (grid: G) => <>
    <button className="icon-button" aria-label={`${grid.visible ? 'Hide' : 'Show'} ${grid.name}`} title={grid.visible ? 'Shown on the table' : 'Hidden'} aria-pressed={grid.visible} disabled={disabled}
      onClick={() => save({ ...grid, visible: !grid.visible })}>{grid.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
    <button className="icon-button" aria-label={`${grid.snap ? 'Stop snapping to' : 'Snap to'} ${grid.name}`} title={grid.snap ? 'Pieces snap to it' : 'Pieces don’t snap to it'} aria-pressed={grid.snap} disabled={disabled}
      onClick={() => save({ ...grid, snap: !grid.snap })}><Magnet size={14} /></button>
  </>;
  return <div className="grid-editor">
    {list && <div className="inspector-section">
      <div className="section-title"><h3>Grids</h3><button className="button grid-done" onClick={onDone}><X size={13} /> Done</button></div>
      <p className="help-text grid-intro">{intro ?? <>Pieces snap to the first grid in this list that takes them. With the grid tool on, drag the table to move the selected grid{selected?.shape === 'points' ? ', or click it to add a snap point' : ''}.</>}</p>
      <ol className="grid-list" aria-label="Grid layers">{grids.map((grid, index) => <li key={grid.id} className={grid.id === selected?.id ? 'active' : ''}>
        <button className="grid-row" aria-pressed={grid.id === selected?.id} onClick={() => { onSelect(grid.id); onSelectPoint(undefined); }}>
          <span className="grid-swatch" style={{ color: opaqueColor(gridColor(grid, index)) }}>{gridShapeIcon(grid.shape)}</span><span className="grid-name">{grid.name}</span>
        </button>
        <span className="grid-row-actions">
          {rowActions(grid)}
          <button className="icon-button" aria-label={`Move ${grid.name} up`} disabled={disabled || !index} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
          <button className="icon-button" aria-label={`Move ${grid.name} down`} disabled={disabled || index === grids.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
          <button className="icon-button danger" aria-label={`Delete ${grid.name}`} disabled={disabled} onClick={() => actions.remove(grid.id)}><Trash2 size={13} /></button>
        </span>
      </li>)}</ol>
      {!grids.length && <p className="help-text">No grids: pieces move freely.</p>}
      {!disabled && <div className="grid-add" role="group" aria-label="Add a grid">{SHAPES.map(shape =>
        <button key={shape.value} className="button" onClick={() => void add(shape.value)}><Plus size={12} />{shape.icon}{shape.value === 'square' ? 'Square' : shape.value === 'hex' ? 'Hex' : 'Points'}</button>)}</div>}
    </div>}
    {selected && <fieldset className="inspector-section grid-settings" disabled={disabled}>
      {list ? <div className="section-title"><h3>{selected.name}</h3>{gridShapeIcon(selected.shape, 15)}</div>
        : <div className="section-title"><h3>{selected.name}</h3><span className="grid-row-actions">{rowActions(selected)}
          <button className="icon-button danger" aria-label={`Delete ${selected.name}`} title="Delete this grid (Delete)" disabled={disabled} onClick={() => actions.remove(selected.id)}><Trash2 size={13} /></button></span></div>}
      {!list && intro && <p className="help-text grid-intro">{intro}</p>}
      <Field label="Name"><input key={`name-${selected.id}`} defaultValue={selected.name} maxLength={60}
        onBlur={event => { const name = event.target.value.trim(); if (name && name !== selected.name) update({ name }); else event.target.value = selected.name; }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></Field>
      <IconChoice label="Shape" value={selected.shape} options={SHAPES} disabled={disabled}
        onChange={shape => update({ shape, ...(shape === 'points' ? { points: selected.points ?? [] } : {}), ...(shape === 'hex' && !selected.orientation ? { orientation: 'pointy' as const } : {}) })} />
      {boundsEditor?.(selected)}
      {/* Linked square cells have no height of their own (sizeY), so the height follows the width either way it's edited. */}
      {selected.shape === 'square' && <>
        <div className="field-grid">
          <NumberField deferred label="Cell width (px)" value={selected.size} min={5} max={2000} onChange={size => update({ size })} />
          <NumberField deferred label="Cell height (px)" value={selected.sizeY ?? selected.size} min={5} max={2000}
            onChange={sizeY => update(selected.sizeY === undefined ? { size: sizeY } : { sizeY })} />
        </div>
        <Toggle label="Link width and height" description="Square cells: changing one changes the other" checked={selected.sizeY === undefined} disabled={disabled}
          onChange={linked => { const { sizeY: _height, ...rest } = selected; save((linked ? rest : { ...rest, sizeY: selected.size }) as G); }} />
      </>}
      {selected.shape === 'hex' && <>
        <NumberField deferred label="Cell size (px)" hint="The distance between the centres of neighbouring cells (a cell's width across its flat sides)." value={selected.size} min={5} max={2000} onChange={size => update({ size })} />
        <Field label="Cells"><select value={selected.orientation ?? 'pointy'} onChange={event => update({ orientation: event.target.value as 'pointy' | 'flat' })}>
          <option value="pointy">Pointy tops (in rows)</option><option value="flat">Flat tops (in columns)</option></select></Field>
      </>}
      {selected.shape !== 'points' && <div className="field-grid">
        <NumberField deferred label="Offset X (px)" hint={`Where the grid's points sit; drag ${surface === 'the table' ? 'the table with the grid tool' : surface} to move it.`} value={selected.offsetX} min={-100000} max={100000} onChange={offsetX => update({ offsetX })} />
        <NumberField deferred label="Offset Y (px)" value={selected.offsetY} min={-100000} max={100000} onChange={offsetY => update({ offsetY })} />
      </div>}
      {selected.shape === 'points' && <>
        <NumberField deferred label="Snap distance (px)" hint="How close a piece's centre must come to a point to snap to it." value={selected.radius ?? DEFAULT_POINT_RADIUS} min={1} max={2000} onChange={radius => update({ radius })} />
        <p className="help-text">{(selected.points ?? []).length} points. Click {surface} to add one, drag points to move them, and select one to edit it (Delete removes it).</p>
        {pointsList && <Collapsible name="grid-points" title="Points" summary={`${(selected.points ?? []).length} point${(selected.points ?? []).length === 1 ? '' : 's'}`}>{pointsList}</Collapsible>}
        {selectedPoint && <div className="grid-point-editor" role="group" aria-label="Selected point">
          <div className="section-title"><h3>Point {selectedPoint.label || ''}</h3><button className="icon-button" aria-label="Deselect point" onClick={() => onSelectPoint(undefined)}><X size={13} /></button></div>
          <div className="field-grid">
            <NumberField deferred label="X (px)" value={selectedPoint.x} min={-100000} max={100000} onChange={x => updatePoint({ x })} />
            <NumberField deferred label="Y (px)" value={selectedPoint.y} min={-100000} max={100000} onChange={y => updatePoint({ y })} />
          </div>
          <Field label="Label"><input key={`label-${selectedPoint.id}`} defaultValue={selectedPoint.label ?? ''} maxLength={60} placeholder="None"
            onBlur={event => { const label = event.target.value.trim(); if (label !== (selectedPoint.label ?? '')) updatePoint({ label: label || undefined }); }}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></Field>
          <Toggle label="Turn pieces here" description="Pieces snapped to this point take its rotation" checked={selectedPoint.rotation !== undefined}
            onChange={on => updatePoint({ rotation: on ? selected.rotation ?? 0 : undefined })} />
          {selectedPoint.rotation !== undefined && <NumberField deferred label="Point rotation (°)" value={selectedPoint.rotation} min={-360} max={360} onChange={rotation => updatePoint({ rotation })} />}
          <button className="button danger full" onClick={() => { update({ points: selected.points!.filter(item => item.id !== selectedPoint.id) }); onSelectPoint(undefined); }}><Trash2 size={13} /> Delete point</button>
        </div>}
      </>}
      <Toggle label="Turn snapped pieces" description="Pieces that snap to this grid take a fixed rotation" checked={selected.rotation !== undefined}
        onChange={on => update({ rotation: on ? 0 : undefined })} />
      {selected.rotation !== undefined && <NumberField deferred label="Rotation (°)" value={selected.rotation} min={-360} max={360} onChange={rotation => update({ rotation })} />}
      <ColorField deferred label="Colour" value={selected.color || gridColor(selected, grids.indexOf(selected))} onChange={color => update({ color })} />
      <TagFilterEditor collapsible="grid-filter" label="Snaps pieces" filter={selected.filter ?? ANY_TAGS} suggestions={tags} disabled={disabled}
        hint="Which pieces snap to this grid, by their components' grid tags (Behavior tab). Components can also turn snapping off."
        anything="Every piece snaps here." untagged="Pieces without grid tags snap to every grid."
        onChange={filter => update({ filter: filter.anyOf.length ? filter : undefined })} />
    </fieldset>}
  </div>;
}
