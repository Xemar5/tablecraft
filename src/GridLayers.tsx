import { memo } from 'react';
import { DEFAULT_POINT_RADIUS, hexCorners, type ComponentGrid, type Grid } from './grids';
import './grids.css';

export const GRID_COLORS = ['#7d9b60', '#b08c4f', '#5f8fae', '#a2679a', '#c07457'];
/** The alpha of a square or hex grid's default colour: 10%, so a lattice stays in the background. */
export const DEFAULT_GRID_ALPHA = '1a';
/**
 * A grid's colour: its own, or one of GRID_COLORS by its place in the list, at 10% alpha for square and hex grids
 * (points grids' markers are opaque).
 */
export const gridColor = (grid: Pick<Grid, 'color' | 'shape'>, index: number) =>
  grid.color || `${GRID_COLORS[index % GRID_COLORS.length]}${grid.shape === 'points' ? '' : DEFAULT_GRID_ALPHA}`;
/** A colour without its alpha (for #rgba and #rrggbbaa; other formats are kept), for swatches and edit handles. */
export const opaqueColor = (color: string) => /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : /^#[0-9a-f]{4}$/i.test(color) ? color.slice(0, 4) : color;

export type GridArea = { x: number; y: number; width: number; height: number };

/**
 * The part of the endless table that grids are drawn across: what the view shows (in table coordinates, with the
 * camera's pan, zoom and rotation) plus half a view on every side, widened to whole steps of a power of two at least
 * half the view's size. So it changes only once the camera has panned or zoomed about half a view away, and panning
 * or zooming within it redraws nothing.
 */
export function gridArea(view: { width: number; height: number }, pan: { x: number; y: number }, zoom: number, camera: number): GridArea {
  const angle = -camera * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]]) {
    const dx = x - pan.x, dy = y - pan.y;
    xs.push((dx * cos - dy * sin) / zoom); ys.push((dx * sin + dy * cos) / zoom);
  }
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const step = 2 ** Math.ceil(Math.log2(Math.max(256, span / 2))), margin = span / 2;
  const x = Math.floor((Math.min(...xs) - margin) / step) * step, y = Math.floor((Math.min(...ys) - margin) / step) * step;
  return { x, y, width: Math.ceil((Math.max(...xs) + margin) / step) * step - x, height: Math.ceil((Math.max(...ys) + margin) / step) * step - y };
}

/**
 * How strongly a square or hex grid shows at a zoom: fully once its cells are 14 screen pixels or more apart, fading
 * out below that and gone under 5, where the lattice would only be a dense texture. Kept to tenths so zooming
 * doesn't redraw the grids at every step.
 */
export function gridFade(grid: Pick<Grid, 'shape' | 'size' | 'sizeY'>, zoom: number) {
  if (grid.shape === 'points') return 1;
  const cell = Math.min(grid.size, grid.sizeY ?? grid.size) * zoom;
  return Math.round(Math.max(0, Math.min(1, (cell - 5) / 9)) * 10) / 10;
}

const polygon = (corners: { x: number; y: number }[]) => `M${corners.map(at => `${at.x},${at.y}`).join('L')}Z`;

/**
 * The table's grids, drawn under the pieces in table coordinates: square grids as dots at their points, hex grids as
 * cell outlines, points grids as markers (with a tick for a forced rotation, and their labels). Line widths and
 * markers keep their screen size through `--table-zoom`. While the grid tool is on, hidden grids are drawn faintly
 * and the edited grid stands out.
 *
 * The table has no edge: square and hex grids fill `area` (see gridArea), which follows the camera. The SVG itself
 * is a point at the table's origin that shows everything around it, so a new area only changes the fills' attributes.
 * Grids whose cells are too small on screen at this zoom fade out (see gridFade); zooming redraws them only when a
 * grid's fade changes.
 */
export const GridLayers = memo(function GridLayers({ grids, area, zoom, editing, selected }: {
  grids: Grid[]; area: GridArea; zoom: number; editing?: boolean; selected?: string;
}) {
  return <svg className={`grid-layers${editing ? ' editing' : ''}`} width={1} height={1} aria-hidden="true">
    <defs>{grids.map((grid, index) => grid.shape !== 'points' && <GridPattern key={grid.id} grid={grid} id={`grid-pattern-${index}`} color={gridColor(grid, index)} />)}</defs>
    {grids.map((grid, index) => {
      if (!grid.visible && !(editing && grid.id === selected)) return null;
      const color = gridColor(grid, index), state = `${grid.visible ? '' : ' hidden-grid'}${editing && grid.id === selected ? ' selected-grid' : ''}`;
      if (grid.shape === 'points') return <g key={grid.id} className={`grid-points${state}`} style={{ color }}>
        {(grid.points ?? []).map(point => <PointMarker key={point.id} x={point.x} y={point.y} rotation={point.rotation ?? grid.rotation} label={point.label} />)}
      </g>;
      // The grid being edited stays visible however small its cells are.
      const fade = editing && grid.id === selected ? Math.max(.4, gridFade(grid, zoom)) : gridFade(grid, zoom);
      if (!fade) return null;
      return <g key={grid.id} opacity={fade}>
        <rect className={`grid-fill grid-fill-${grid.shape}${state}`} style={{ color }} x={area.x} y={area.y} width={area.width} height={area.height} fill={`url(#grid-pattern-${index})`} />
      </g>;
    })}
  </svg>;
}, (before, after) => before.grids === after.grids && before.area === after.area && before.editing === after.editing && before.selected === after.selected
  && after.grids.every(grid => gridFade(grid, before.zoom) === gridFade(grid, after.zoom)));

/**
 * A component's grids, over its face in its own coordinates, each only inside its bounds: on its table pieces (which
 * move, turn and scale them) and in the designer. `idPrefix` keeps the fill patterns of many pieces apart. While its
 * grids are edited, hidden ones show faintly and the edited one stands out.
 */
export const ComponentGrids = memo(function ComponentGrids({ grids, width, height, idPrefix, editing, selected, style }: {
  grids: ComponentGrid[]; width: number; height: number; idPrefix: string; editing?: boolean; selected?: string; style?: React.CSSProperties;
}) {
  return <svg className={`component-grids${editing ? ' editing' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style} aria-hidden="true">
    <defs>{grids.map((grid, index) => grid.shape !== 'points' && <GridPattern key={grid.id} grid={grid} id={`${idPrefix}-${index}`} color={gridColor(grid, index)} />)}</defs>
    {grids.map((grid, index) => {
      if (!grid.visible && !editing) return null;
      const { bounds } = grid, color = gridColor(grid, index);
      const state = `${grid.visible ? '' : ' hidden-grid'}${editing && grid.id === selected ? ' selected-grid' : ''}`;
      if (grid.shape === 'points') return <g key={grid.id} className={`grid-points${state}`} style={{ color }}>
        {(grid.points ?? []).filter(point => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height)
          .map(point => <PointMarker key={point.id} x={point.x} y={point.y} rotation={point.rotation ?? grid.rotation} label={point.label} />)}
      </g>;
      return <rect key={grid.id} className={`grid-fill grid-fill-${grid.shape}${state}`} style={{ color }} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}
        fill={`url(#${idPrefix}-${index})`} />;
    })}
  </svg>;
});

// A pattern's content takes its colour (currentColor) from the pattern, not from the shape it fills.
function GridPattern({ grid, id, color }: { grid: Grid; id: string; color: string }) {
  if (grid.shape === 'square') {
    const w = grid.size, h = grid.sizeY ?? grid.size;
    return <pattern id={id} patternUnits="userSpaceOnUse" x={grid.offsetX} y={grid.offsetY} width={w} height={h} style={{ color }}>
      {[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => <circle key={`${x},${y}`} className="grid-dot" cx={x} cy={y} />)}
    </pattern>;
  }
  // Hex tiles: two rows (pointy) or two columns (flat) of cells, drawn whole across the tile's edges.
  const s = grid.size, row = s * Math.sqrt(3) / 2, flat = grid.orientation === 'flat';
  const w = flat ? 2 * row : s, h = flat ? s : 2 * row;
  const centres = flat ? [[0, 0], [0, s], [row, s / 2], [2 * row, 0], [2 * row, s], [row, -s / 2], [row, 1.5 * s]]
    : [[0, 0], [s, 0], [s / 2, row], [0, 2 * row], [s, 2 * row], [-s / 2, row], [1.5 * s, row]];
  return <pattern id={id} patternUnits="userSpaceOnUse" x={grid.offsetX} y={grid.offsetY} width={w} height={h} style={{ color }}>
    {centres.map(([x, y]) => <path key={`${x},${y}`} className="grid-hex" d={polygon(hexCorners(grid, x, y))} />)}
    {centres.map(([x, y]) => <circle key={`dot ${x},${y}`} className="grid-dot" cx={x} cy={y} />)}
  </pattern>;
}

function PointMarker({ x, y, rotation, label }: { x: number; y: number; rotation?: number; label?: string }) {
  return <g className="grid-point" transform={`translate(${x} ${y})`}>
    <circle className="grid-point-ring" />
    {rotation !== undefined && <rect className="grid-point-tick" transform={`rotate(${rotation})`} />}
    {label && <text className="grid-point-label">{label}</text>}
  </g>;
}

/**
 * The edited points grid's points as handles above the pieces, to select and drag them with the grid tool, each in a
 * dashed circle showing its snap distance (how close a piece's centre must come to snap to it).
 */
export function GridPointHandles({ grid, color, selected, highlighted, width, height }: {
  grid: Grid; color: string; selected?: string; width: number; height: number;
  /** Points of the Points panel's selected group. */
  highlighted?: string[];
}) {
  const reach = grid.radius ?? DEFAULT_POINT_RADIUS;
  return <svg className="grid-handles" width={width} height={height} style={{ color }}>
    <g aria-hidden="true">{(grid.points ?? []).map(point => <circle key={point.id} className="grid-snap-reach" cx={point.x} cy={point.y} r={reach} />)}</g>
    {(grid.points ?? []).map(point => <g key={point.id} data-grid-point={point.id} className={`grid-handle${point.id === selected ? ' selected' : ''}${highlighted?.includes(point.id) ? ' highlighted' : ''}`} transform={`translate(${point.x} ${point.y})`}
      role="button" aria-label={`Point ${point.label || point.id}`}>
      <circle className="grid-handle-hit" />
      <circle className="grid-handle-dot" />
      {(point.rotation ?? grid.rotation) !== undefined && <rect className="grid-point-tick" transform={`rotate(${point.rotation ?? grid.rotation})`} />}
    </g>)}
  </svg>;
}
