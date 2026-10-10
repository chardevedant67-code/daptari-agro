// Seed-management details of a batch — the optional fields the Create New
// Batch form collects beyond the QR-generation ones, grouped into the
// sections the form shows. `name` is the field name the backend stores
// (SeedBatch DETAIL_FIELDS); `label` is the matching Excel column header,
// spelled exactly as in Seed_Management.xlsx. Year, Warehouse, Rack and Shelf
// are not repeated here: the form's existing fields are those columns.
export const BATCH_DETAIL_SECTIONS = [
  {
    title: 'Crop & Year',
    fields: [
      { name: 'crop', label: 'Crop', placeholder: 'e.g. Soybean', helperText: 'If blank, Seed Name is shown as Crop in Excel' },
      { name: 'previousYear', label: 'Previous Year', type: 'number', placeholder: 'e.g. 2025' },
      { name: 'yearCode', label: 'Year_code' },
      { name: 'previousYearCode', label: 'PreviousYear_code' },
    ],
  },
  {
    title: 'Parentage & Variety',
    fields: [
      { name: 'femaleCode', label: 'Female_code' },
      { name: 'maleCode', label: 'Male_code' },
      { name: 'varietyName', label: 'Name Of Variety' },
      { name: 'varietyCode', label: 'Varity_Code' },
      { name: 'gene', label: 'Gene' },
    ],
  },
  {
    title: 'Location Codes',
    fields: [
      { name: 'farmLocationCode', label: 'FarmLocation_code' },
      { name: 'previousLocationCode', label: 'PreviousLocation_code' },
      { name: 'locationCode', label: 'Location code' },
    ],
  },
  {
    title: 'Scores & Yield',
    fields: [
      { name: 'sptScore', label: 'Spt Score' },
      { name: 'diseaseScore', label: 'Disease score' },
      { name: 'yield1', label: 'Yield 1', type: 'number' },
      { name: 'yield2', label: 'Yield 2', type: 'number' },
      { name: 'total', label: 'Total', type: 'number', helperText: 'Saved as entered — not calculated' },
    ],
  },
  {
    title: 'Remarks',
    fields: [
      { name: 'comments', label: 'Comments', multiline: true },
      { name: 'finalReport', label: 'Final report', multiline: true },
    ],
  },
];

export const BATCH_DETAIL_FIELDS = BATCH_DETAIL_SECTIONS.flatMap(s => s.fields);

// Same limit the backend enforces for every text detail.
export const BATCH_DETAIL_TEXT_MAX = 2000;

// Turns the form's raw strings into what POST /api/batches expects: trimmed
// text, and numbers as real numbers (null when left blank). Returns
// { details } or { error } — nothing is filled in on the user's behalf.
export function buildBatchDetails(form) {
  const details = {};
  for (const f of BATCH_DETAIL_FIELDS) {
    const raw = String(form[f.name] ?? '').trim();
    if (f.type === 'number') {
      if (raw === '') { details[f.name] = null; continue; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return { error: `${f.label} must be a number` };
      details[f.name] = parsed;
    } else {
      if (raw.length > BATCH_DETAIL_TEXT_MAX) {
        return { error: `${f.label} must be at most ${BATCH_DETAIL_TEXT_MAX} characters` };
      }
      details[f.name] = raw;
    }
  }
  return { details };
}
