const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { COLUMNS, HIDDEN_COLUMNS } = require('../shared/columns');

const WORKBOOK_NAME = 'Seed_Management.xlsx';
const BACKUP_NAME = 'Seed_Management.backup.xlsx';
const SHEET_NAME = 'Seed_Management';

// Windows reports a file held open by Excel with one of these.
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

// Seed_Management.xlsx is OUTPUT ONLY. This module only ever writes the
// workbook — it never opens it to read cell values, so nothing typed into
// the file in Excel can travel back into the app or to the backend. Each
// write regenerates the whole sheet from the records passed in (records the
// backend returned), which is also why a manual edit in Excel simply
// disappears at the next write.
function createWorkbookWriter({ dir }) {
  const filePath = path.join(dir, WORKBOOK_NAME);
  const backupPath = path.join(dir, BACKUP_NAME);

  // Stable row order: oldest record first, recordId as the tie-breaker.
  function ordered(records) {
    return [...records].sort((a, b) => {
      const byCreated = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      return byCreated !== 0 ? byCreated : String(a.recordId).localeCompare(String(b.recordId));
    });
  }

  function rowValues(record) {
    const values = COLUMNS.map(({ field, type }) => {
      const value = record[field];
      if (type === 'number') return typeof value === 'number' ? value : null;
      return typeof value === 'string' && value !== '' ? value : null;
    });
    return [...values, record.recordId, record.version];
  }

  function signatureOf(rows) {
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  function fileMatches(meta) {
    try {
      const stat = fs.statSync(filePath);
      return stat.size === meta.size && stat.mtimeMs === meta.mtimeMs;
    } catch (_) {
      return false;
    }
  }

  async function build(rows) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Seed Management Desktop';
    const sheet = book.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });

    sheet.columns = [
      ...COLUMNS.map(({ header, field, type }) => ({ header, key: field, width: Math.max(header.length + 4, type === 'number' ? 12 : 18) })),
      ...HIDDEN_COLUMNS.map(({ header, field }) => ({ header, key: field, width: 40, hidden: true })),
    ];
    sheet.getRow(1).font = { bold: true };

    for (const values of rows) sheet.addRow(values);

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

    // Marks the sheet read-only in Excel. No password: this is a "do not
    // edit here" signal, not a secret — the data's real home is MongoDB.
    await sheet.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatColumns: true,
      formatRows: true,
      sort: true,
      autoFilter: true,
    });

    return book;
  }

  // Writes the workbook if its content would differ from what is already on
  // disk (new/changed records, or the file was changed/removed outside the
  // app). `lastMeta` is what the previous successful write returned.
  async function write(records, lastMeta) {
    const rows = ordered(records).map(rowValues);
    const signature = signatureOf(rows);
    if (lastMeta && lastMeta.signature === signature && fileMatches(lastMeta)) {
      return { written: false, meta: lastMeta };
    }

    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    const book = await build(rows);
    await book.xlsx.writeFile(tmpPath);

    try {
      if (fs.existsSync(filePath)) {
        try { fs.copyFileSync(filePath, backupPath); } catch (_) { /* a backup is best-effort */ }
      }
      // The swap itself: the complete new file replaces the old one in a
      // single rename, so a reader never sees a half-written workbook.
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try { fs.rmSync(tmpPath, { force: true }); } catch (_) {}
      if (BUSY_CODES.has(err.code)) {
        const busy = new Error(`${WORKBOOK_NAME} is open in another program.`);
        busy.busy = true;
        throw busy;
      }
      throw err;
    }

    const stat = fs.statSync(filePath);
    return { written: true, meta: { signature, size: stat.size, mtimeMs: stat.mtimeMs, rows: rows.length } };
  }

  return { filePath, backupPath, write };
}

module.exports = { createWorkbookWriter, WORKBOOK_NAME, SHEET_NAME };
