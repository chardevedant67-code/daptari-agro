const mongoose = require('mongoose');

// Seed-management details entered on the Create New Batch form. All optional,
// so batches created before these existed stay valid and simply read back
// blank. `label` is the Excel column the value belongs to (exact header
// text); `type` is 'text' or 'number'. Field names and types match the same
// columns in DesktopSeedRecord.js, which is where the desktop app and
// Seed_Management.xlsx get them from. Year, Wearhouse and Rack_shelf are not
// repeated here — they are the year / warehouse / rack / shelf paths below.
const DETAIL_FIELDS = [
  { field: 'crop',                 label: 'Crop',                  type: 'text' },
  { field: 'previousYear',         label: 'Previous Year',         type: 'number' },
  { field: 'yearCode',             label: 'Year_code',             type: 'text' },
  { field: 'previousYearCode',     label: 'PreviousYear_code',     type: 'text' },
  { field: 'farmLocationCode',     label: 'FarmLocation_code',     type: 'text' },
  { field: 'femaleCode',           label: 'Female_code',           type: 'text' },
  { field: 'maleCode',             label: 'Male_code',             type: 'text' },
  { field: 'sptScore',             label: 'Spt Score',             type: 'text' },
  { field: 'diseaseScore',         label: 'Disease score',         type: 'text' },
  { field: 'yield1',               label: 'Yield 1',               type: 'number' },
  { field: 'yield2',               label: 'Yield 2',               type: 'number' },
  // Stored exactly as entered — never calculated from Yield 1 / Yield 2.
  { field: 'total',                label: 'Total',                 type: 'number' },
  { field: 'varietyName',          label: 'Name Of Variety',       type: 'text' },
  { field: 'varietyCode',          label: 'Varity_Code',           type: 'text' },
  { field: 'previousLocationCode', label: 'PreviousLocation_code', type: 'text' },
  { field: 'locationCode',         label: 'Location code',         type: 'text' },
  { field: 'gene',                 label: 'Gene',                  type: 'text' },
  { field: 'comments',             label: 'Comments',              type: 'text' },
  { field: 'finalReport',          label: 'Final report',          type: 'text' },
];

const DETAIL_TEXT_MAX_LENGTH = 2000;

const detailPaths = {};
for (const { field, type } of DETAIL_FIELDS) {
  detailPaths[field] = type === 'number'
    ? { type: Number, default: null }
    : { type: String, default: '', maxlength: DETAIL_TEXT_MAX_LENGTH };
}

const SeedBatchSchema = new mongoose.Schema({
  batchName:   { type: String, required: true },
  seedType:    { type: String, required: true },
  // Seed classification (Organic/Hybrid/Open Pollinated/Heirloom/Conventional) —
  // optional and separate from seedType (which holds the seed name, e.g. "Soybean").
  seedCategory: { type: String, default: '' },
  seedCode:    { type: String, required: true, uppercase: true, maxlength: 4 },
  batchNumber: { type: String, required: true },
  batchCode:   { type: String, required: true, uppercase: true },
  count:       { type: Number, required: true, min: 1 },

  // Storage location (optional — not required so existing batches remain valid)
  month:       { type: Number, min: 1, max: 12, default: null },
  year:        { type: Number, default: null },
  warehouse:   { type: String, default: '' },
  rack:        { type: String, default: '' },
  shelf:       { type: String, default: '' },

  ...detailPaths,

  packets:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'SeedPacket' }],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

const SeedBatch = mongoose.model('SeedBatch', SeedBatchSchema);

SeedBatch.DETAIL_FIELDS = DETAIL_FIELDS;
SeedBatch.DETAIL_TEXT_MAX_LENGTH = DETAIL_TEXT_MAX_LENGTH;

module.exports = SeedBatch;
