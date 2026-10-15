// TEMPORARY development tool - on-device check of the OCR engines.
//
// When a test run has copied images into <app cache>/ocr_fixtures (adb, debug
// build only), each image is put through exactly what the app uses on a
// captured photo - readWeightFromPhoto: the seven-segment reader plus the
// four ML Kit passes. One JSON line per image goes to the log, prefixed
// [OCRFIX], with the RAW output of every engine. (PaddleOCR was removed from
// the app; the device-check script reports its column as not read.) Nothing is
// shown to the user, nothing is saved, and no weight ever leaves this file.
// With no such folder (every normal run) it does nothing at all.
import {NativeModules} from 'react-native';

async function run() {
  const LiveWeight = NativeModules.LiveWeight;
  if (!LiveWeight || !LiveWeight.fixtureFiles) return;
  const files = await LiveWeight.fixtureFiles();
  if (!files || !files.length) return;

  const {readWeightFromPhoto, readWeightAuto} = require('../services/weightOcr');
  console.log(`[OCRFIX] START ${files.length}`);
  // Live-reader timing mode (images named L_*): only the native seven-segment
  // reader, as the live scanner calls it, three times per image; `ms` is what
  // the phone itself measured inside the reader.
  if (files.every(f => f.split('/').pop().startsWith('L_'))) {
    for (const path of files) {
      const out = {file: path.split('/').pop(), runs: []};
      for (let i = 0; i < 3; i++) {
        try {
          const t0 = Date.now();
          const r = await LiveWeight.readImage(path);
          out.runs.push({ok: r.ok, text: r.text || null, reason: r.reason || null, detail: (r.detail || '').slice(0, 80), ms: r.ms, wall: Date.now() - t0});
        } catch (e) {
          out.runs.push({error: String((e && e.message) || e).slice(0, 200)});
        }
      }
      console.log(`[OCRFIX] ${JSON.stringify(out)}`);
    }
    console.log('[OCRFIX] DONE');
    return;
  }
  for (const path of files) {
    const name = path.split('/').pop();
    const out = {file: name};
    try {
      const t0 = Date.now();
      const r = await readWeightFromPhoto(`file://${path}`, null, null);
      out.final = r.ok ? String(r.kg) : `REJECT:${r.reason}`;
      out.engine = r.ok ? (r.engine || 'text') : null;
      out.unit = r.ok ? `${r.detectedUnit}${r.unitAssumed ? '(assumed)' : ''}` : null;
      out.others = r.otherReadings || [];
      out.passes = r.passSummary || [];
      out.ms = Date.now() - t0;
    } catch (e) {
      out.final = `ERROR:${e && e.message}`;
    }
    // The same image with the display found automatically (what a newly
    // captured photo goes through): where it was found, and what was read.
    try {
      const t2 = Date.now();
      const a = await readWeightAuto(`file://${path}`, null);
      const d = a.detection || {};
      out.auto = {
        mode: a.auto ? 'auto' : a.plan.mode,
        final: a.auto ? (a.ok ? String(a.kg) : `REJECT:${a.reason}`) : `REJECT:${a.plan.reason}`,
        found: !!d.found,
        box: d.box ? [d.box.x, d.box.y, d.box.w, d.box.h].map(v => Number(v.toFixed(3))) : null,
        cutOff: !!d.cutOff,
        tooSmall: !!d.tooSmall,
        tried: d.tried,
        ms: Date.now() - t2,
      };
    } catch (e) {
      out.auto = {error: String((e && e.message) || e).slice(0, 300)};
    }
    console.log(`[OCRFIX] ${JSON.stringify(out)}`);
  }
  console.log('[OCRFIX] DONE');
}

// Deferred so it never delays app start.
setTimeout(() => {
  run().catch(e => console.log(`[OCRFIX] FAILED ${e && e.message}`));
}, 4000);
