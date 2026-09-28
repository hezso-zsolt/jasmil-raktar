const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const db = require('../db/database');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis > commas ? ';' : ',';
}

// Termékadatok importja Excel/CSV-ből (27. pont)
// Elvárt oszlopok (kis-nagybetű független, a Shoprenter-export elnevezéseivel is kompatibilis):
// sku/cikkszam, ean/vonalkod, name/nev/megnevezes, category/kategoria, size/meret, color/szin, stock/keszlet,
// suly_g/gramm (vagy suly_kg/suly) - opcionális, a csomagsúly-számításhoz
router.post('/products/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nincs feltöltött fájl.' });

  let records;
  try {
    const text = req.file.buffer.toString('utf8');
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: detectDelimiter(text),
      bom: true,
    });
  } catch (e) {
    return res.status(400).json({ error: 'A fájl nem olvasható be CSV-ként: ' + e.message });
  }

  const pick = (row, keys) => {
    for (const k of Object.keys(row)) {
      if (keys.includes(k.trim().toLowerCase())) return row[k];
    }
    return undefined;
  };

  const result = { imported: 0, updated: 0, skipped: [], total: records.length };
  const seenSku = new Set();
  const seenEan = new Set();

  // A weight_g (tömeg grammban) opcionális: ha a CSV-ben nincs súly oszlop,
  // a meglévő értéket NEM írjuk felül nullra - így egy sima készlet-import
  // nem törli a korábban feltöltött súlyokat.
  const upsert = db.prepare(
    `INSERT INTO products (sku, ean, name, category, size, color, weight_g, theoretical_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sku) DO UPDATE SET
       ean = COALESCE(excluded.ean, products.ean), name = excluded.name, category = excluded.category,
       size = excluded.size, color = excluded.color,
       weight_g = COALESCE(excluded.weight_g, products.weight_g),
       theoretical_stock = excluded.theoretical_stock,
       updated_at = datetime('now')`
  );

  const tx = db.transaction(() => {
    records.forEach((row, idx) => {
      const sku = pick(row, ['sku', 'cikkszam', 'cikkszám']);
      const eanRaw = pick(row, ['ean', 'vonalkod', 'vonalkód', 'gtin', 'barcode']);
      // Az Excel a hosszú vonalkódokat tudományos jelölésre alakítja
      // ("8.60507E+12"), amiből az eredeti szám NEM állítható vissza. Az ilyen
      // értéket eldobjuk, hogy ne írjuk felül vele a helyes EAN-t - a sor
      // többi adata (pl. a súly) ettől még importálódik, és a figyelmeztetés
      // megjelenik az import eredményében.
      let ean = eanRaw ? String(eanRaw).trim() : '';
      let eanWarning = null;
      if (ean && !/^\d+$/.test(ean)) {
        eanWarning = ean;
        ean = '';
      }
      const name = pick(row, ['name', 'nev', 'név', 'megnevezes', 'megnevezés', 'termeknev', 'terméknév']);
      const category = pick(row, ['category', 'kategoria', 'kategória']);
      const size = pick(row, ['size', 'meret', 'méret']);
      const color = pick(row, ['color', 'szin', 'szín']);
      const stockRaw = pick(row, ['stock', 'keszlet', 'készlet', 'mennyiseg', 'mennyiség']);
      const stock = parseInt(stockRaw, 10);
      // Súly: grammban vagy kilogrammban is megadható, a fejléc nevétől függően.
      const weightGRaw = pick(row, ['weight_g', 'suly_g', 'súly_g', 'tomeg_g', 'tömeg_g', 'gramm']);
      const weightKgRaw = pick(row, ['weight_kg', 'suly_kg', 'súly_kg', 'tomeg_kg', 'tömeg_kg', 'suly', 'súly', 'tomeg', 'tömeg', 'weight']);
      let weightG = null;
      if (weightGRaw !== undefined && weightGRaw !== null && String(weightGRaw).trim() !== '') {
        const v = parseFloat(String(weightGRaw).replace(',', '.'));
        if (Number.isFinite(v) && v > 0) weightG = v;
      } else if (weightKgRaw !== undefined && weightKgRaw !== null && String(weightKgRaw).trim() !== '') {
        const v = parseFloat(String(weightKgRaw).replace(',', '.'));
        if (Number.isFinite(v) && v > 0) weightG = v * 1000;
      }

      const rowNum = idx + 2; // fejléc + 1-alapú index

      if (!sku) return result.skipped.push({ row: rowNum, reason: 'Hiányzó SKU.' });
      if (!name) return result.skipped.push({ row: rowNum, sku, reason: 'Hiányzó terméknév.' });
      if (seenSku.has(sku)) return result.skipped.push({ row: rowNum, sku, reason: 'Duplikált SKU a fájlon belül.' });
      if (ean && seenEan.has(ean)) return result.skipped.push({ row: rowNum, sku, reason: 'Duplikált EAN a fájlon belül.' });

      seenSku.add(sku);
      if (ean) seenEan.add(ean);

      if (eanWarning) {
        result.eanIgnored = (result.eanIgnored || 0) + 1;
        if (!result.eanIgnoredExample) result.eanIgnoredExample = { sku, value: eanWarning };
      }

      const existing = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku);
      upsert.run(sku, ean || null, name, category || null, size || null, color || null, weightG, Number.isFinite(stock) ? stock : 0);
      if (existing) result.updated++;
      else result.imported++;
    });
  });

  try {
    tx();
  } catch (e) {
    return res.status(409).json({ error: 'Import közben hiba történt (valószínűleg ütköző EAN): ' + e.message });
  }

  res.json(result);
});

// Leltár export: SKU, EAN, termék, elméleti, fizikai, eltérés
router.get('/inventory/:sessionId/export', (req, res) => {
  const session = db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });

  let items = db
    .prepare(
      `SELECT p.sku, p.ean, p.name, i.theoretical_qty, i.counted_qty, i.checked
       FROM inventory_items i JOIN products p ON p.id = i.product_id
       WHERE i.session_id = ? ORDER BY p.name`
    )
    .all(session.id)
    .map((i) => ({ ...i, difference: i.counted_qty - i.theoretical_qty }));

  const { filter } = req.query;
  if (filter === 'nemellenorzott') items = items.filter((i) => !i.checked);
  if (filter === 'ellenorzott') items = items.filter((i) => i.checked);
  if (filter === 'eltero') items = items.filter((i) => i.difference !== 0);
  if (filter === 'hiany') items = items.filter((i) => i.difference < 0);
  if (filter === 'tobblet') items = items.filter((i) => i.difference > 0);

  const rows = items.map((i) => ({
    sku: i.sku,
    ean: i.ean || '',
    termek: i.name,
    elmeleti_keszlet: i.theoretical_qty,
    fizikai_keszlet: i.counted_qty,
    elteres: i.difference,
    ellenorizve: i.checked ? 'igen' : 'nem',
  }));

  const csv = stringify(rows, { header: true, delimiter: ';' });
  const suffix = filter && filter !== 'all' ? `_${filter}` : '';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leltar_${session.id}${suffix}.csv"`);
  res.send('\uFEFF' + csv);
});

// Raktári export: SKU, EAN, termék, készlet, raktári hely, helyenkénti mennyiség
/**
 * Termék export - kifejezetten a súlyadatok feltöltéséhez.
 *
 * A fájl oszlopnevei pontosan megegyeznek azzal, amit a termék import elfogad
 * (cikkszam, nev, ..., suly_g), így a kiexportált fájlt a súly oszlop
 * kitöltése után változtatás nélkül vissza lehet tölteni.
 *
 * A "suly_g" oszlop üresen marad azoknál a termékeknél, ahol még nincs
 * megadva súly - ezeket kell kitölteni. Ahol már van, ott az érték
 * megjelenik, így látszik, mi van már kész.
 *
 * FONTOS: a visszatöltésnél az üresen hagyott súly NEM törli a korábbi
 * értéket (lásd a products/import COALESCE logikáját), tehát részletekben,
 * több körben is fel lehet tölteni a súlyokat.
 */
router.get('/products/export', (req, res) => {
  // FONTOS: az EAN szándékosan NINCS benne ebben az exportban. Az Excel a
  // 13 jegyű vonalkódokat megnyitáskor tudományos jelölésre alakítja
  // ("8.60507E+12"), amiből az eredeti érték nem állítható vissza - egy ilyen
  // fájl visszatöltése tönkretenné a vonalkódokat. Mivel a súlyok kitöltéséhez
  // az EAN-ra nincs szükség, ki sem küldjük. (A termékeket a cikkszám
  // azonosítja, a visszatöltés az alapján párosít.)
  const rows = db
    .prepare(`SELECT sku, name, category, size, color, weight_g, theoretical_stock FROM products ORDER BY name`)
    .all()
    .map((p) => ({
      cikkszam: p.sku,
      nev: p.name,
      kategoria: p.category || '',
      meret: p.size || '',
      szin: p.color || '',
      suly_g: p.weight_g === null || p.weight_g === undefined ? '' : p.weight_g,
      keszlet: p.theoretical_stock,
    }));

  const csv = stringify(rows, { header: true, delimiter: ';' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="termekek_sulyokhoz.csv"');
  res.send('\uFEFF' + csv);
});

router.get('/warehouse/export', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.sku, p.ean, p.name, pl.box_id, pl.qty
       FROM placements pl JOIN products p ON p.id = pl.product_id
       WHERE pl.qty > 0 ORDER BY p.name, pl.box_id`
    )
    .all()
    .map((r) => ({
      sku: r.sku,
      ean: r.ean || '',
      termek: r.name,
      raktari_hely: r.box_id,
      mennyiseg: r.qty,
    }));

  const csv = stringify(rows, { header: true, delimiter: ';' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="raktari_elhelyezes.csv"');
  res.send('\uFEFF' + csv);
});

// Doboz export: azonosító, méret, kapacitás, tartalom, kihasználtság
router.get('/boxes/export', (req, res) => {
  const boxes = db.prepare(`SELECT * FROM boxes ORDER BY id`).all();
  const rows = boxes.map((b) => {
    const used = db
      .prepare(`SELECT COALESCE(SUM(qty),0) AS total FROM placements WHERE box_id = ?`)
      .get(b.id).total;
    return {
      doboz_id: b.id,
      megnevezes: b.label || '',
      meret_mm: [b.width_mm, b.height_mm, b.depth_mm].filter(Boolean).join('x'),
      terfogat_l: b.volume_l || '',
      foglalt_darab: used,
    };
  });
  const csv = stringify(rows, { header: true, delimiter: ';' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dobozok.csv"');
  res.send('\uFEFF' + csv);
});

module.exports = router;
