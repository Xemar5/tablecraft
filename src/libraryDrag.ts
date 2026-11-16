export const LIBRARY_DRAG_TYPE = 'application/x-tablecraft-library';

export type LibraryDrag = { projectId: string; componentId: string; rows: number[]; stacked: boolean };

export function startLibraryDrag(transfer: DataTransfer, projectId: string, componentId: string, rows: number[], stacked = false) {
  transfer.effectAllowed = 'copy';
  transfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify({ projectId, componentId, rows, stacked }));
}

export function readLibraryDrag(transfer: DataTransfer): LibraryDrag | undefined {
  try {
    const value: unknown = JSON.parse(transfer.getData(LIBRARY_DRAG_TYPE));
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (typeof data.projectId !== 'string' || typeof data.componentId !== 'string' ||
      !Array.isArray(data.rows) || !data.rows.length || data.rows.length > 10000 ||
      !data.rows.every(row => Number.isSafeInteger(row) && row >= 0) || new Set(data.rows).size !== data.rows.length) return;
    return { projectId: data.projectId, componentId: data.componentId, rows: data.rows, stacked: data.stacked === true };
  } catch { return; }
}
