const mongoose = require('mongoose');

// Desktop "Excel Data Manager" records — a new, additive collection. Nothing
// here reads from or writes to any existing schema; SeedBatch/SeedPacket stay
// the sole source of truth for batch/packet data and are never modified by
// anything that touches this model.
//
// DATA_FIELDS is the single definition of the 23 Excel columns (exact header
// text, exact order) — the schema below, the route validation
// (desktopRecordRoutes.js) and the desktop app's own column list all follow
// this order. `type` is 'text' or 'number'.
const DATA_FIELDS = [
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
  { header: 'Weight',                field: 'weight',               type: 'number' },
  { header: 'Comments',              field: 'comments',             type: 'text' },
  { header: 'Final report',          field: 'finalReport',          type: 'text' },
];

const TEXT_MAX_LENGTH = 2000;

// The only columns copied from an existing packet's batch when a record is
// created by POST /api/desktop-records/import-packets. They are fixed for
// packet-linked records (updates to them are ignored). Weight, Name Of
// Variety and Varity_Code are deliberately NOT here — their mapping is
// unconfirmed, so they are never pre-filled from packet/batch data.
const PACKET_DERIVED_FIELDS = ['crop', 'year', 'warehouse', 'rackShelf'];

const dataPaths = {};
for (const { field, type } of DATA_FIELDS) {
  dataPaths[field] = type === 'number'
    ? { type: Number, default: null }
    : { type: String, default: '', maxlength: TEXT_MAX_LENGTH };
}

const DesktopSeedRecordSchema = new mongoose.Schema({
  // Stable, client-generated id (a UUID for records added in the desktop
  // app, `PKT-<uniqueId>` for records imported from an existing packet).
  // Unique, so a retried create can never produce a second document.
  recordId:       { type: String, required: true, unique: true },

  // Set only for records imported from an existing SeedPacket. A plain
  // string reference, never an ObjectId link — the packet itself is never
  // touched.
  packetUniqueId: { type: String, default: null },

  // Optimistic-concurrency counter: starts at 1, incremented by every
  // successful update. PUT must present the version it last saw.
  version:        { type: Number, default: 1 },

  ...dataPaths,

  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
}, { timestamps: true });

// One desktop record per packet at most — this is what makes import-packets
// safe to repeat (and safe against two imports racing). Partial, so the
// many desktop-created records with packetUniqueId:null never collide.
DesktopSeedRecordSchema.index(
  { packetUniqueId: 1 },
  { unique: true, partialFilterExpression: { packetUniqueId: { $type: 'string' } } }
);

// Supports GET /api/desktop-records — keyset pagination ordered by
// (updatedAt, _id), which is also the "changed since last sync" query.
DesktopSeedRecordSchema.index({ updatedAt: 1, _id: 1 });

const DesktopSeedRecord = mongoose.model('DesktopSeedRecord', DesktopSeedRecordSchema);

DesktopSeedRecord.DATA_FIELDS = DATA_FIELDS;
DesktopSeedRecord.PACKET_DERIVED_FIELDS = PACKET_DERIVED_FIELDS;
DesktopSeedRecord.TEXT_MAX_LENGTH = TEXT_MAX_LENGTH;

module.exports = DesktopSeedRecord;
