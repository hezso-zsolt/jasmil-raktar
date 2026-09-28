const express = require('express');
const QRCode = require('qrcode');
const db = require('../db/database');

const router = express.Router();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nyomtatható tartalom-összesítő ("csomagolási lista") egy dobozhoz: a
// doboz QR-kódja + a benne ténylegesen lévő termékek teljes, aktuális
// listája. Ez a "Doboz lezárása" munkafolyamat végén nyílik meg, hogy a
// dobozra rá lehessen ragasztani, mi (mennyi) van benne.
async function buildManifestHtml(box, contents) {
  const svg = await QRCode.toString(box.id, { type: 'svg', margin: 1, width: 160 });
  const totalUnits = contents.reduce((sum, c) => sum + c.qty, 0);

  const rows = contents.length
    ? contents
        .map(
          (c) => `
        <tr>
          <td class="mono">${escapeHtml(c.sku)}</td>
          <td class="mono">${escapeHtml(c.ean || '—')}</td>
          <td>${escapeHtml(c.name)}</td>
          <td class="mono num">${c.qty}</td>
        </tr>`
        )
        .join('\n')
    : `<tr><td colspan="4" class="empty">Ez a doboz jelenleg üres.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8" />
<title>Doboz tartalma — ${escapeHtml(box.id)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 24px; background: #fff; color: #191c19; }
  .toolbar { margin-bottom: 18px; }
  .toolbar button {
    font-family: inherit; font-size: 14px; font-weight: 600; padding: 10px 18px;
    background: #E85D0C; color: white; border: none; border-radius: 3px; cursor: pointer;
  }
  .head { display: flex; align-items: center; gap: 20px; border-bottom: 2px solid #191c19; padding-bottom: 16px; margin-bottom: 16px; }
  .head .qr svg { width: 100px; height: 100px; }
  .head .info .code { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 26px; font-weight: 700; }
  .head .info .name { font-size: 14px; color: #555; margin-top: 2px; }
  .head .info .total { font-size: 13px; color: #555; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #EEF0EA; border-bottom: 1px solid #ccc; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e2e2; }
  td.num { text-align: right; font-weight: 600; }
  td.empty { text-align: center; color: #888; padding: 24px; }
  @media print {
    .toolbar { display: none; }
    body { margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Nyomtatás</button></div>
  <div class="head">
    <div class="qr">${svg}</div>
    <div class="info">
      <div class="code">${escapeHtml(box.id)}</div>
      ${box.label ? `<div class="name">${escapeHtml(box.label)}</div>` : ''}
      <div class="total">${contents.length} termékfajta, összesen ${totalUnits} db</div>
    </div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>EAN</th><th>Termék</th><th style="text-align:right">Mennyiség</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function buildLabelHtml(boxes) {
  const cards = await Promise.all(
    boxes.map(async (b) => {
      const svg = await QRCode.toString(b.id, { type: 'svg', margin: 1, width: 220 });
      return `
        <div class="label">
          <div class="qr">${svg}</div>
          <div class="code">${escapeHtml(b.id)}</div>
          ${b.label ? `<div class="name">${escapeHtml(b.label)}</div>` : ''}
        </div>`;
    })
  );

  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8" />
<title>Doboz címkék</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 24px; background: #fff; color: #191c19; }
  .toolbar { margin-bottom: 18px; }
  .toolbar button {
    font-family: inherit; font-size: 14px; font-weight: 600; padding: 10px 18px;
    background: #E85D0C; color: white; border: none; border-radius: 3px; cursor: pointer;
  }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .label {
    border: 1px dashed #999; border-radius: 4px; padding: 16px;
    text-align: center; page-break-inside: avoid;
  }
  .qr svg { width: 150px; height: 150px; }
  .code { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 19px; font-weight: 700; margin-top: 8px; }
  .name { font-size: 12px; color: #555; margin-top: 3px; }
  @media print {
    .toolbar { display: none; }
    body { margin: 8mm; }
    .label { border: 1px solid #999; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Nyomtatás</button></div>
  <div class="grid">
    ${cards.join('\n')}
  </div>
</body>
</html>`;
}

function withContents(box) {
  const contents = db
    .prepare(
      `SELECT pl.product_id, pl.qty, p.sku, p.ean, p.name, p.size
       FROM placements pl JOIN products p ON p.id = pl.product_id
       WHERE pl.box_id = ? AND pl.qty > 0
       ORDER BY p.name`
    )
    .all(box.id);
  const used = contents.reduce((sum, c) => sum + c.qty, 0);
  const activeRecount = db
    .prepare(`SELECT id, status FROM box_recounts WHERE box_id = ? AND status IN ('szamolas', 'osszesitve')`)
    .get(box.id);
  return { ...box, contents, used_units: used, active_recount: activeRecount || null };
}

router.get('/', (req, res) => {
  const boxes = db.prepare(`SELECT * FROM boxes ORDER BY id`).all().map(withContents);
  res.json(boxes);
});

router.get('/:id', (req, res) => {
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id);
  if (!box) {
    return res.status(404).json({ error: `A(z) "${req.params.id}" azonosítójú doboz nem található.` });
  }
  const capacities = db
    .prepare(
      `SELECT bc.product_id, bc.max_qty, p.sku, p.name FROM box_capacities bc
       JOIN products p ON p.id = bc.product_id WHERE bc.box_id = ?`
    )
    .all(box.id);
  res.json({ ...withContents(box), capacities });
});

router.post('/', (req, res) => {
  const { id, label, type, width_mm, height_mm, depth_mm, note } = req.body;
  if (!id) return res.status(400).json({ error: 'Az "id" (doboz-azonosító) kötelező.' });

  const volume_l =
    width_mm && height_mm && depth_mm
      ? Math.round((width_mm * height_mm * depth_mm) / 1000) / 1000
      : null;

  try {
    db.prepare(
      `INSERT INTO boxes (id, label, type, width_mm, height_mm, depth_mm, volume_l, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, label || null, type || null, width_mm || null, height_mm || null, depth_mm || null, volume_l, note || null);
    res.status(201).json(db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(id));
  } catch (e) {
    res.status(409).json({ error: `A(z) "${id}" doboz-azonosító már létezik.` });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ismeretlen doboz.' });

  const { label, type, width_mm, height_mm, depth_mm, note } = req.body;
  const w = width_mm ?? existing.width_mm;
  const h = height_mm ?? existing.height_mm;
  const d = depth_mm ?? existing.depth_mm;
  const volume_l = w && h && d ? Math.round((w * h * d) / 1000) / 1000 : existing.volume_l;

  db.prepare(
    `UPDATE boxes SET label=?, type=?, width_mm=?, height_mm=?, depth_mm=?, volume_l=?, note=? WHERE id=?`
  ).run(label ?? existing.label, type ?? existing.type, w, h, d, volume_l, note ?? existing.note, req.params.id);

  res.json(db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM boxes WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Ismeretlen doboz.' });
  res.status(204).end();
});

// Kapacitás beállítása egy adott termékre az adott dobozban
router.post('/:id/capacity', (req, res) => {
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id);
  if (!box) return res.status(404).json({ error: 'Ismeretlen doboz.' });

  const { product_id, max_qty } = req.body;
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(product_id);
  if (!product) return res.status(404).json({ error: 'Ismeretlen termék.' });
  if (!Number.isInteger(max_qty) || max_qty < 0) {
    return res.status(400).json({ error: 'A "max_qty" nem-negatív egész szám kell legyen.' });
  }

  db.prepare(
    `INSERT INTO box_capacities (box_id, product_id, max_qty) VALUES (?, ?, ?)
     ON CONFLICT(box_id, product_id) DO UPDATE SET max_qty = excluded.max_qty`
  ).run(box.id, product_id, max_qty);

  res.json({ ok: true });
});

// Nyomtatható tartalom-összesítő ("csomagolási lista") — a doboz jelenlegi
// teljes tartalmával, nem csak egy adott munkamenet közben hozzáadott
// tételekkel.
router.get('/:id/manifest', async (req, res) => {
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id);
  if (!box) return res.status(404).send('Ismeretlen doboz.');
  const contents = db
    .prepare(
      `SELECT p.sku, p.ean, p.name, pl.qty FROM placements pl
       JOIN products p ON p.id = pl.product_id
       WHERE pl.box_id = ? AND pl.qty > 0 ORDER BY p.name`
    )
    .all(box.id);
  const html = await buildManifestHtml(box, contents);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Egyetlen doboz nyomtatható QR-címkéje
router.get('/:id/label', async (req, res) => {
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.id);
  if (!box) return res.status(404).send('Ismeretlen doboz.');
  const html = await buildLabelHtml([box]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Minden doboz QR-címkéje egy nyomtatható oldalon (A4-re rendezve)
router.get('/labels/all', async (req, res) => {
  const boxes = db.prepare(`SELECT * FROM boxes ORDER BY id`).all();
  if (!boxes.length) return res.status(404).send('Még nincs felvéve doboz.');
  const html = await buildLabelHtml(boxes);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * Kijelölt dobozok címkéi egy nyomtatható oldalon.
 * Az azonosítókat vesszővel elválasztva várja: /labels/selected?ids=D-001,D-002
 *
 * A dobozazonosító tartalmazhat olyan karaktert, ami vesszővel ütközne, ezért
 * a hívó oldalon minden azonosítót külön encodeURIComponent-tel kódolunk, és
 * itt dekódoljuk. A sorrendet a kijelölés helyett azonosító szerint rendezzük,
 * hogy a nyomtatott ív áttekinthető legyen.
 */
router.get('/labels/selected', async (req, res) => {
  const raw = (req.query.ids || '').trim();
  if (!raw) return res.status(400).send('Nincs kijelölve doboz.');

  const ids = raw
    .split(',')
    .map((s) => decodeURIComponent(s.trim()))
    .filter(Boolean);

  if (!ids.length) return res.status(400).send('Nincs kijelölve doboz.');

  const placeholders = ids.map(() => '?').join(',');
  const boxes = db.prepare(`SELECT * FROM boxes WHERE id IN (${placeholders}) ORDER BY id`).all(...ids);

  if (!boxes.length) return res.status(404).send('A kijelölt dobozok egyike sem található.');

  const html = await buildLabelHtml(boxes);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
