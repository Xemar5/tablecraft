import { memo } from 'react';
import { hexCorners, type Grid } from './grids';
import './grids.css';

export const GRID_COLORS = ['#7d9b60', '#b08c4f', '#5f8fae', '#a2679a', '#c07457'];
export const gridColor = (grid: Grid, index: number) => grid.color || GRID_COLORS[index % GRID_COLORS.length];

const polygon = (corners: { x: number; y: number }[]) => `M${corners.map(at => `${at.x},${at.y}`).join('L')}Z`;

/**
 * The table's grids, drawn under the pieces in table coordinates: square grids as dots at their points, hex grids as
 * cell outlines, points grids as markers (with a tick for a forced rotation, and their labels). Line widths and
 * markers keep their screen size through `--table-zoom`. While the grid tool is on, hidden grids are drawn faintly
 * and the edited grid stands out.
 */
export const GridLayers = memo(function GridLayers({ grids, width, height, editing, selected }: {
  grids: Grid[]; width: number; height: number; editing?: boolean; selected?: string;
}) {
  return <svg className={`grid-layers${editing ? ' editing' : ''}`} width={width} height={height} aria-hidden="true">
    <defs>{grids.map((grid, index) => grid.shape !== 'points' && <GridPattern key={grid.id} grid={grid} id={`grid-pattern-${index}`} color={gridColor(grid, index)} />)}</defs>
    {grids.map((grid, index) => {
      if (!grid.visible && !(editing && grid.id === selected)) return null;
      const color = gridColor(grid, index), state = `${grid.visible ? '' : ' hidden-grid'}${editing && grid.id === selected ? ' selected-grid' : ''}`;
      if (grid.shape === 'points') return <g key={grid.id} className={`grid-points${state}`} style={{ color }}>
        {(grid.points ?? []).map(point => <PointMarker key={point.id} x={point.x} y={point.y} rotation={point.rotation ?? grid.rotation} label={point.label} />)}
      </g>;
      return <rect key={grid.id} className={`grid-fill grid-fill-${grid.shape}${state}`} style={{ color }} x={0} y={0} width={width} height={height} fill={`url(#grid-pattern-${index})`} />;
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

/** The edited points grid's points as handles above the pieces, to select and drag them with the grid tool. */
export function GridPointHandles({ grid, color, selected, highlighted, width, height }: {
  grid: Grid; color: string; selected?: string; width: number; height: number;
  /** Points of the Points panel's selected group. */
  highlighted?: string[];
}) {
  return <svg className="grid-handles" width={width} height={height} style={{ color }}>
    {(grid.points ?? []).map(point => <g key={point.id} data-grid-point={point.id} className={`grid-handle${point.id === selected ? ' selected' : ''}${highlighted?.includes(point.id) ? ' highlighted' : ''}`} transform={`translate(${point.x} ${point.y})`}
      role="button" aria-label={`Point ${point.label || point.id}`}>
      <circle className="grid-handle-hit" />
      <circle className="grid-handle-dot" />
      {(point.rotation ?? grid.rotation) !== undefined && <rect className="grid-point-tick" transform={`rotate(${point.rotation ?? grid.rotation})`} />}
    </g>)}
  </svg>;
}
