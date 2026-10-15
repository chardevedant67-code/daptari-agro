const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { COLUMNS, HIDDEN_COLUMNS, PACKET_DERIVED_FIELDS, blankFields, normalizeFields, isEmptyRecord } = require('../../shared/columns');

const APPROVED_HEADERS = [
  'Crop', 'Previous Year', 'Year', 'Year_code', 'PreviousYear_code', 'FarmLocation_code',
  'Female_code', 'Male_code', 'Spt Score', 'Disease score', 'Yield 1', 'Yield 2', 'Total',
  'Name Of Variety', 'Varity_Code', 'PreviousLocation_code', 'Wearhouse', 'Rack_shelf',
  'Location code', 'Gene', 'Before Weight', 'After Weight', 'Comments', 'Final report',
];

describe('columns — the 24 approved Excel columns', () => {
  it('exactly the approved headers in the approved order', () => {
    assert.deepEqual(COLUMNS.map((c) => c.header), APPROVED_HEADERS);
    assert.equal(COLUMNS.length, 24);
  });

  it('field names are unique and every type is text or number', () => {
    const fields = COLUMNS.map((c) => c.field);
    assert.deepEqual(fields, [...new Set(fields)]);
    for (const { type } of COLUMNS) assert.ok(type === 'text' || type === 'number');
  });

  it('Record_ID and Version are the only extra columns, kept separate from the 24', () => {
    assert.deepEqual(HIDDEN_COLUMNS.map((c) => c.header), ['Record_ID', 'Version']);
    for (const { field } of HIDDEN_COLUMNS) assert.equal(COLUMNS.some((c) => c.field === field), false);
  });

  it('Weight, Name Of Variety and Varity_Code are not packet-derived', () => {
    assert.deepEqual(PACKET_DERIVED_FIELDS, ['crop', 'year', 'warehouse', 'rackShelf']);
  });

  it('Before Weight keeps the stored field name; After Weight is a number column directly after it, and stays editable', () => {
    const at = COLUMNS.findIndex((c) => c.header === 'Before Weight');
    assert.deepEqual(COLUMNS[at], { header: 'Before Weight', field: 'weight', type: 'number' });
    assert.deepEqual(COLUMNS[at + 1], { header: 'After Weight', field: 'afterWeight', type: 'number' });
    assert.equal(PACKET_DERIVED_FIELDS.includes('afterWeight'), false);
  });

  it('a blank record has an empty value for all 24 columns', () => {
    const blank = blankFields();
    assert.equal(Object.keys(blank).length, 24);
    assert.equal(isEmptyRecord(blank), true);
  });
});

describe('columns — normalizeFields', () => {
  it('trims text and converts numeric input', () => {
    const { fields, error } = normalizeFields({ crop: '  Maize ', yield1: ' 12.5 ', year: 2026, gene: null, weight: '' });
    assert.equal(error, undefined);
    assert.deepEqual(fields, { crop: 'Maize', yield1: 12.5, year: 2026, gene: '', weight: null });
  });

  it('rejects text in a number column, naming the Excel header', () => {
    assert.equal(normalizeFields({ yield1: 'lots' }).error, 'Yield 1 must be a number.');
    assert.equal(normalizeFields({ weight: Infinity }).error, 'Before Weight must be a number.');
  });

  it('rejects over-long text', () => {
    assert.match(normalizeFields({ comments: 'x'.repeat(2001) }).error, /Comments must be at most 2000/);
    assert.equal(normalizeFields({ comments: 'x'.repeat(2000) }).error, undefined);
  });

  it('rejects anything that is not one of the 24 columns', () => {
    assert.equal(normalizeFields({ recordId: 'x' }).error, 'Unknown column: recordId');
    assert.equal(normalizeFields({ version: 5 }).error, 'Unknown column: version');
  });

  it('rejects non-object input', () => {
    assert.ok(normalizeFields(null).error);
    assert.ok(normalizeFields(['crop']).error);
  });

  it('isEmptyRecord is false as soon as one column has a value', () => {
    assert.equal(isEmptyRecord({ ...blankFields(), total: 0 }), false);
    assert.equal(isEmptyRecord({ ...blankFields(), comments: 'ok' }), false);
  });
});
