import { describe, expect, it } from 'vitest';
import { LIBRARY_DRAG_TYPE, readLibraryDrag, startLibraryDrag } from '../src/libraryDrag';

function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer;
}

describe('library drag payload', () => {
  it('round-trips the component and selected rows as a copy', () => {
    const data = transfer();
    startLibraryDrag(data, 'project', 'component', [1, 3]);
    expect(data.effectAllowed).toBe('copy');
    expect(readLibraryDrag(data)).toEqual({ projectId: 'project', componentId: 'component', rows: [1, 3] });
  });

  it('rejects malformed, duplicate, and oversized payloads', () => {
    const data = transfer();
    for (const payload of ['not json', '{}', JSON.stringify({ projectId: 'p', componentId: 'c', rows: [0, 0] }),
      JSON.stringify({ projectId: 'p', componentId: 'c', rows: [-1] }),
      JSON.stringify({ projectId: 'p', componentId: 'c', rows: [0.5] }),
      JSON.stringify({ projectId: 'p', componentId: 'c', rows: Array.from({ length: 10001 }, (_, i) => i) })]) {
      data.setData(LIBRARY_DRAG_TYPE, payload);
      expect(readLibraryDrag(data)).toBeUndefined();
    }
  });
});
