// The 24 Excel columns — exact header text, exact order. This list drives
// the grid, the add-record form, field validation and the workbook writer,
// and mirrors DATA_FIELDS in server/models/DesktopSeedRecord.js (the e2e
// suite asserts the two stay identical).
const COLUMNS = [
  { header: 'Crop',                  field: 'crop',                 type: 'text' },
  { header: 'Previous Year',         field: 'previousYear',         type: 'number' },
  { header: 'Year',                  field: 'year',                 type: 'number' },
  { header: 'Year_code',             field: 'yearCode',             type: 'text' },
  { header: 'PreviousYear_code',     field: 'previousYearCode',     type: 'text' },
  { header: 'FarmLocation_code',     field: 'farmLocationCode',     type: 'text' },
  { header: 'Female_code',           field: 'femaleCode',           type: 'text' },
  { header: 'Male_code',             field: 'maleCode',             type: 'text' },
  { header: 'Spt Score',             field: 'sptScore',             type: 'text' },
  { header: 'Disease score',         field: 'diseaseScore',         type: 'text' },
  { header: 'Yield 1',               field: 'yield1',               type: 'number' },
  { header: 'Yield 2',               field: 'yield2',               type: 'number' },
  { header: 'Total',                 field: 'total',                type: 'number' },
  { header: 'Name Of Variety',       field: 'varietyName',          type: 'text' },
  { header: 'Varity_Code',           field: 'varietyCode',          type: 'text' },
  { header: 'PreviousLocation_code', field: 'previousLocationCode', type: 'text' },
  { header: 'Wearhouse',             field: 'warehouse',            type: 'text' },
  { header: 'Rack_shelf',            field: 'rackShelf',            type: 'text' },
  { header: 'Location code',         field: 'locationCode',         type: 'text' },
  { header: 'Gene',                  field: 'gene',                 type: 'text' },
  { header: 'Before Weight',         field: 'weight',               type: 'number' },
  { header: 'After Weight',          field: 'afterWeight',          type: 'number' },
  { header: 'Comments',              field: 'comments',             type: 'text' },
  { header: 'Final report',          field: 'finalReport',          type: 'text' },
];

// Written after column 24 in the workbook and hidden there.
const HIDDEN_COLUMNS = [
  { header: 'Record_ID', field: 'recordId' },
  { header: 'Version',   field: 'version' },
];

// Fixed on records that came from an existing packet (the backend ignores
// changes to them as well).
const PACKET_DERIVED_FIELDS = ['crop', 'year', 'warehouse', 'rackShelf'];

const TEXT_MAX_LENGTH = 2000;

const FIELD_TYPES = new Map(COLUMNS.map(({ field, type }) => [field, type]));

function blankFields() {
  const out = {};
  for (const { field, type } of COLUMNS) out[field] = type === 'number' ? null : '';
  return out;
}

// Normalizes user input for the known columns into what the backend accepts
// (trimmed text, finite numbers or null). Returns { fields } or { error }.
// Keys that are not one of the 24 columns are an error, never passed along.
function normalizeFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Nothing to save.' };
  }
  const fields = {};
  for (const key of Object.keys(input)) {
    const type = FIELD_TYPES.get(key);
    if (!type) return { error: `Unknown column: ${key}` };
    const header = COLUMNS.find((c) => c.field === key).header;
    const value = input[key];
    if (type === 'number') {
      if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        fields[key] = null;
        continue;
      }
      const parsed = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed)) return { error: `${header} must be a number.` };
      fields[key] = parsed;
    } else {
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text.length > TEXT_MAX_LENGTH) {
        return { error: `${header} must be at most ${TEXT_MAX_LENGTH} characters.` };
      }
      fields[key] = text;
    }
  }
  return { fields };
}

function isEmptyRecord(fields) {
  return COLUMNS.every(({ field }) => fields[field] === null || fields[field] === '' || fields[field] === undefined);
}

module.exports = {
  COLUMNS,
  HIDDEN_COLUMNS,
  PACKET_DERIVED_FIELDS,
  TEXT_MAX_LENGTH,
  blankFields,
  normalizeFields,
  isEmptyRecord,
};
