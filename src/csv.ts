import Papa from 'papaparse';

export function variantLabels(csv: string, rows: Record<string, string>[]): string[] {
  const firstColumn = Papa.parse<string[]>(csv, { skipEmptyLines: 'greedy' }).data[0]?.[0] ?? Object.keys(rows[0] ?? {})[0];
  return rows.map((row, index) => `${index + 1}. ${row[firstColumn] ?? ''}`);
}

export function parseCsvData(csv: string): Record<string, string>[] {
  if (!csv.trim()) return [];
  const result = Papa.parse<string[]>(csv, { skipEmptyLines: 'greedy' });
  const error = result.errors.find(item => item.code !== 'UndetectableDelimiter');
  if (error) throw new Error(`CSV: ${error.message}${error.row === undefined ? '' : ` (row ${error.row + 1})`}`);
  const [headers, ...rows] = result.data;
  if (!headers?.length || headers.some(header => !header.trim())) throw new Error('CSV needs a non-empty name for every header column.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV header names must be unique.');
  return rows.map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${row.length} cells; expected ${headers.length}. Quote cells containing delimiters or newlines.`);
    return Object.fromEntries(headers.map((header, column) => [header, row[column]]));
  });
}
