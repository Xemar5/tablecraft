import { describe, expect, it } from 'vitest';
import { parseCsvData } from '../src/csv';

describe('CSV data editing', () => {
  it('accepts single-column data without delimiter detection errors', () => {
    expect(parseCsvData('value\n1\n2\n"Text, with a comma"')).toEqual([{ value: '1' }, { value: '2' }, { value: 'Text, with a comma' }]);
    expect(parseCsvData('value')).toEqual([]);
    expect(parseCsvData(' \n')).toEqual([]);
  });
  it('handles normal delimiters, quoted multiline cells, BOM and blank lines', () => {
    expect(parseCsvData('\ufeffname,text\r\nA,"Line 1\nLine 2"\r\n\r\n')).toEqual([{ name: 'A', text: 'Line 1\nLine 2' }]);
    expect(parseCsvData('name;value\nA;1\nB;2')).toEqual([{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
    expect(parseCsvData('name\tvalue\nA\t1')).toEqual([{ name: 'A', value: '1' }]);
  });
  it('rejects malformed quotes, missing/duplicate headers and uneven rows explicitly', () => {
    expect(() => parseCsvData('name,\nA,1')).toThrow('header');
    expect(() => parseCsvData('name,name\nA,1')).toThrow('unique');
    expect(() => parseCsvData('name,value\nA')).toThrow('row 2');
    expect(() => parseCsvData('name,value\nA,1,2')).toThrow('row 2');
    expect(() => parseCsvData('name\n"unclosed')).toThrow(/quoted/i);
  });
});
