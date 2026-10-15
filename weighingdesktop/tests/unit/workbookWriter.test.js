const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createWorkbookWriter, WORKBOOK_NAME } = require('../../electron/workbookWriter');
const { COLUMNS, blankFields } = require('../../shared/columns');

const HEADERS = COLUMNS.map((c) => c.header);
const dirs = [];
let dir;
let writer;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-workbook-'));
  dirs.push(dir);
  writer = createWorkbookWriter({ dir });
});

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function record(recordId, version, fields = {}, createdAt = '2026-01-01T00:00:00.000Z') {
  return { ...blankFields(), recordId, packetUniqueId: null, version, createdAt, updatedAt: createdAt, ...fields };
}

// Test-only reader, to inspect what the writer produced.
async function read(filePath = writer.filePath) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(filePath);
  const sheet = book.worksheets[0];
  const rows = [];
  sheet.eachRow((row) => rows.push(Array.from({ length: 26 }, (_, i) => row.getCell(i + 1).value)));
  return { book, sheet, header: rows[0], data: rows.slice(1) };
}

describe('workbook writer — layout', () => {
  it('writes Seed_Management.xlsx with the 24 headers in order, then Record_ID and Version', async () => {
    await writer.write([record('r1', 1, { crop: 'Maize' })]);
    assert.equal(path.basename(writer.filePath), WORKBOOK_NAME);
    assert.equal(WORKBOOK_NAME, 'Seed_Management.xlsx');
    const { header, sheet, book } = await read();
    assert.deepEqual(header.slice(0, 24), HEADERS);
    assert.deepEqual(header.slice(24), ['Record_ID', 'Version']);
    assert.equal(sheet.columnCount, 26);
    assert.equal(book.worksheets.length, 1);
  });

  it('hides only Record_ID and Version', async () => {
    await writer.write([record('r1', 1, { crop: 'Maize' })]);
    const { sheet } = await read();
    for (let i = 1; i <= 24; i += 1) assert.notEqual(sheet.getColumn(i).hidden, true);
    assert.equal(sheet.getColumn(25).hidden, true);
    assert.equal(sheet.getColumn(26).hidden, true);
  });

  it('protects the sheet and freezes the header row', async () => {
    await writer.write([record('r1', 1, { crop: 'Maize' })]);
    const { sheet } = await read();
    assert.equal(sheet.sheetProtection.sheet, true);
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
  });

  it('with no records it is a header-only sheet — no placeholder rows', async () => {
    await writer.write([]);
    const { header, data } = await read();
    assert.deepEqual(header.slice(0, 24), HEADERS);
    assert.equal(data.length, 0);
  });
});

describe('workbook writer — content', () => {
  it('writes each value in its own column, numbers as numbers, blanks as empty cells', async () => {
    const full = {};
    COLUMNS.forEach(({ field, type }, i) => { full[field] = type === 'number' ? i + 0.5 : `text-${i}`; });
    await writer.write([record('r-full', 7, full), record('r-blank', 1, { crop: 'Only crop' })]);
    const { data } = await read();
    const fullRow = data.find((r) => r[24] === 'r-full');
    COLUMNS.forEach(({ type }, i) => {
      assert.equal(fullRow[i], type === 'number' ? i + 0.5 : `text-${i}`);
      assert.equal(typeof fullRow[i], type === 'number' ? 'number' : 'string');
    });
    assert.equal(fullRow[25], 7);

    const blankRow = data.find((r) => r[24] === 'r-blank');
    assert.equal(blankRow[0], 'Only crop');
    for (let i = 1; i < 24; i += 1) assert.equal(blankRow[i], null);
  });

  it('keeps zero as 0, not as an empty cell', async () => {
    await writer.write([record('r1', 1, { total: 0, weight: 0, afterWeight: 0 })]);
    const { data } = await read();
    assert.equal(data[0][12], 0);
    assert.equal(data[0][20], 0);
    assert.equal(data[0][21], 0);
  });

  it('text that looks like a formula is stored as text, never as a formula', async () => {
    await writer.write([record('r1', 1, { comments: '=1+1', crop: '+SUM(A1)' })]);
    const { data } = await read();
    assert.equal(data[0][22], '=1+1');
    assert.equal(typeof data[0][22], 'string');
    assert.equal(data[0][0], '+SUM(A1)');
  });

  it('one row per record, oldest first, independent of the order given', async () => {
    const a = record('a', 1, { crop: 'A' }, '2026-01-01T00:00:00.000Z');
    const b = record('b', 1, { crop: 'B' }, '2026-01-02T00:00:00.000Z');
    const c = record('c', 1, { crop: 'C' }, '2026-01-03T00:00:00.000Z');
    await writer.write([c, a, b]);
    const { data } = await read();
    assert.deepEqual(data.map((r) => r[24]), ['a', 'b', 'c']);
  });

  it('writes only the records it is given — nothing invented, nothing carried over', async () => {
    await writer.write([record('r1', 1, { crop: 'One' }), record('r2', 1, { crop: 'Two' })]);
    await writer.write([record('r2', 2, { crop: 'Two v2' })]);
    const { data } = await read();
    assert.equal(data.length, 1);
    assert.equal(data[0][0], 'Two v2');
    assert.equal(data[0][25], 2);
  });
});

describe('workbook writer — replacing the file', () => {
  it('skips the write when nothing changed and the file is untouched', async () => {
    const records = [record('r1', 1, { crop: 'Maize' })];
    const first = await writer.write(records);
    assert.equal(first.written, true);
    const second = await writer.write(records, first.meta);
    assert.equal(second.written, false);
  });

  it('rewrites when a record changed', async () => {
    const first = await writer.write([record('r1', 1, { crop: 'Maize' })]);
    const second = await writer.write([record('r1', 2, { crop: 'Maize', gene: 'Rf1' })], first.meta);
    assert.equal(second.written, true);
    assert.equal((await read()).data[0][19], 'Rf1');
  });

  it('rewrites when the file was changed or deleted outside the app', async () => {
    const records = [record('r1', 1, { crop: 'Maize' })];
    const first = await writer.write(records);

    fs.appendFileSync(writer.filePath, 'x'); // tampered
    const healed = await writer.write(records, first.meta);
    assert.equal(healed.written, true);
    assert.equal((await read()).data[0][0], 'Maize');

    fs.rmSync(writer.filePath);
    const recreated = await writer.write(records, healed.meta);
    assert.equal(recreated.written, true);
    assert.equal(fs.existsSync(writer.filePath), true);
  });

  it('keeps the previous workbook as a backup and leaves no temp file', async () => {
    await writer.write([record('r1', 1, { crop: 'Old' })]);
    await writer.write([record('r1', 2, { crop: 'New' })]);
    assert.equal((await read(writer.backupPath)).data[0][0], 'Old');
    assert.equal((await read()).data[0][0], 'New');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['Seed_Management.backup.xlsx', 'Seed_Management.xlsx']);
  });

  it('when the workbook is locked by another program: reports busy, keeps the old file, leaves no temp file', async (t) => {
    if (process.platform !== 'win32') return t.skip('file locking semantics are Windows-specific');
    await writer.write([record('r1', 1, { crop: 'Old' })]);

    // Hold the file open without delete-sharing, as Excel does.
    const { spawn } = require('child_process');
    const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
      `$f=[System.IO.File]::Open('${writer.filePath.replace(/'/g, "''")}','Open','ReadWrite','None'); Write-Output locked; Start-Sleep -Seconds 60`]);
    try {
      await new Promise((resolve, reject) => {
        holder.stdout.on('data', (d) => { if (String(d).includes('locked')) resolve(); });
        holder.on('exit', () => reject(new Error('lock helper exited early')));
        setTimeout(() => reject(new Error('lock helper timed out')), 20000);
      });

      await assert.rejects(writer.write([record('r1', 2, { crop: 'New' })]), (err) => err.busy === true);
      assert.equal(fs.existsSync(`${writer.filePath}.tmp`), false);
    } finally {
      holder.removeAllListeners('exit');
      holder.kill();
      await new Promise((resolve) => holder.once('exit', resolve));
    }

    assert.equal((await read()).data[0][0], 'Old', 'the open workbook was not damaged');
    const after = await writer.write([record('r1', 2, { crop: 'New' })]);
    assert.equal(after.written, true);
    assert.equal((await read()).data[0][0], 'New');
  });
});
