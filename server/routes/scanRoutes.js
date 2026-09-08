const express    = require('express');
const router     = express.Router();
const SeedPacket = require('../models/SeedPacket');

// GET /scan/:uniqueId  — public HTML page shown when QR is scanned
router.get('/:uniqueId', async (req, res) => {
  try {
    const packet = await SeedPacket.findOne({ uniqueId: req.params.uniqueId })
      .populate('batchId');

    if (!packet) return res.status(404).send(page404(req.params.uniqueId));
    res.send(pageHTML(packet));
  } catch (err) {
    res.status(500).send(`<h2>Server error: ${err.message}</h2>`);
  }
});

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function page404(id) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Not Found</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .c{background:#fff;border-radius:20px;padding:40px 28px;text-align:center;max-width:340px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  .e{font-size:52px;margin-bottom:16px}.t{font-size:18px;font-weight:800;color:#0f172a;margin-bottom:8px}
  .s{font-size:13px;color:#64748b}.id{font-family:monospace;font-size:13px;background:#f8fafc;border-radius:8px;padding:8px 12px;margin-top:16px;color:#475569}</style>
  </head><body><div class="c"><div class="e">❓</div>
  <div class="t">QR Not Found</div><div class="s">This packet ID doesn't exist.</div>
  <div class="id">${id}</div></div></body></html>`;
}

function pageHTML(packet) {
  const batch  = packet.batchId;
  const filled = packet.status === 'filled';
  const before = packet.beforeWeight;
  const after  = packet.afterWeight;
  const loss   = (before != null && after != null)
    ? (parseFloat(before) - parseFloat(after)).toFixed(3)
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>${packet.uniqueId} — WeighingQR</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;min-height:100vh;padding-bottom:40px}

    .hdr{background:linear-gradient(135deg,#1a227f,#3d47a3);padding:32px 24px 52px;text-align:center;position:relative;overflow:hidden}
    .hdr::before{content:'';position:absolute;top:-40px;right:-40px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.08)}
    .hdr::after{content:'';position:absolute;bottom:-50px;left:-20px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.05)}
    .brand{font-size:10px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:.14em;margin-bottom:10px;position:relative;z-index:1}
    .uid{font-family:'Courier New',monospace;font-size:20px;font-weight:800;color:#fff;letter-spacing:1px;position:relative;z-index:1}

    .card{background:#fff;border-radius:20px;margin:-28px 14px 0;padding:22px;box-shadow:0 4px 28px rgba(0,0,0,.11);position:relative;z-index:2}

    .badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;border-radius:100px;padding:7px 16px;margin-bottom:20px;border:1.5px solid}
    .badge-filled{background:#f0fdf4;border-color:#bbf7d0;color:#16a34a}
    .badge-empty{background:#f8fafc;border-color:#e2e8f0;color:#94a3b8}

    .sec{font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}
    .row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9}
    .row:last-child{border-bottom:none}
    .lbl{font-size:13px;color:#64748b;font-weight:500}
    .val{font-size:13px;color:#0f172a;font-weight:700;text-align:right;max-width:58%}
    .mono{font-family:'Courier New',monospace;font-size:12px}

    .divider{height:1px;background:#f1f5f9;margin:18px 0}

    .wgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
    .wbox{background:#f8fafc;border-radius:12px;padding:14px;text-align:center;border:1px solid #e2e8f0}
    .wval{font-size:24px;font-weight:800;color:#1a227f;line-height:1;margin-bottom:2px}
    .wunit{font-size:11px;color:#94a3b8;font-weight:600}
    .wlbl{font-size:11px;color:#64748b;margin-top:6px;font-weight:600}

    .loss{border-radius:12px;padding:14px;text-align:center;margin-bottom:12px}
    .loss-val{font-size:22px;font-weight:800;line-height:1}
    .loss-lbl{font-size:11px;color:#64748b;margin-top:4px;font-weight:600}

    .empty-state{text-align:center;padding:24px 0;color:#94a3b8}
    .empty-state .ic{font-size:40px;margin-bottom:10px}
    .empty-state .et{font-size:14px;font-weight:600;color:#64748b}
    .empty-state .es{font-size:12px;margin-top:4px}

    .footer{text-align:center;margin-top:22px;font-size:12px;color:#94a3b8}
    .footer b{color:#1a227f}
  </style>
</head>
<body>
  <div class="hdr">
    <div class="brand">WEIGHINGQR · SEED TRACKING</div>
    <div class="uid">${packet.uniqueId}</div>
  </div>

  <div class="card">
    <span class="badge ${filled ? 'badge-filled' : 'badge-empty'}">${filled ? '✓ Filled &amp; Weighed' : '○ Not Yet Filled'}</span>

    <div class="sec">Batch Information</div>
    <div class="row"><span class="lbl">Batch Name</span><span class="val">${batch?.batchName || '—'}</span></div>
    <div class="row"><span class="lbl">Seed Type</span><span class="val">${batch?.seedType || '—'}</span></div>
    <div class="row"><span class="lbl">Batch No.</span><span class="val mono">${batch?.batchNumber || '—'}</span></div>
    <div class="row"><span class="lbl">Packet ID</span><span class="val mono">${packet.uniqueId}</span></div>

    <div class="divider"></div>

    ${filled ? `
    <div class="sec">Weight Data</div>
    <div class="wgrid">
      <div class="wbox">
        <div class="wval">${before ?? '—'}</div>
        <div class="wunit">kg</div>
        <div class="wlbl">Before Fill</div>
      </div>
      <div class="wbox">
        <div class="wval">${after ?? '—'}</div>
        <div class="wunit">kg</div>
        <div class="wlbl">After Fill</div>
      </div>
    </div>
    ${loss !== null ? `
    <div class="loss" style="background:${parseFloat(loss)>0?'#fff7ed':'#f0fdf4'};border:1.5px solid ${parseFloat(loss)>0?'#fed7aa':'#bbf7d0'}">
      <div class="loss-val" style="color:${parseFloat(loss)>0?'#c2410c':'#16a34a'}">${loss} kg</div>
      <div class="loss-lbl">Seed Weight (After − Before)</div>
    </div>` : ''}
    <div class="row"><span class="lbl">Weighed At</span><span class="val">${fmt(packet.afterTime || packet.linkedAt)}</span></div>
    ` : `
    <div class="empty-state">
      <div class="ic">⚖️</div>
      <div class="et">Not yet weighed</div>
      <div class="es">This packet hasn't been filled and weighed yet.</div>
    </div>
    `}
  </div>

  <div class="footer">Powered by <b>WeighingQR</b> · Seed Tracking System</div>
</body>
</html>`;
}

module.exports = router;
