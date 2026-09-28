const express = require('express');
const db = require('../db/database');
const { getActiveRecount } = require('../lib/boxLock');

const router = express.Router();

function resolveProduct(code) {
  return db.prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`).get(code, code);
}

function capacityFor(boxId, productId) {
  const row = db
    .prepare(`SELECT max_qty FROM box_capacities WHERE box_id = ? AND product_id = ?`)
    .get(boxId, productId);
  return row ? row.max_qty : null; // null = nincs korlátozva
}

function currentQty(boxId, productId) {
  const row = db
    .prepare(`SELECT qty FROM placements WHERE box_id = ? AND product_id = ?`)
    .get(boxId, productId);
  return row ? row.qty : 0;
}

// Ha a doboz újraszámolás alatt áll, a hívó egy 409-es hibaüzenetet kap - ezt
// minden olyan végpont elején hívjuk, ami egy adott dobozon módosítaná a
// placements mennyiséget (place/pick/transfer).
function assertBoxNotLocked(res, boxId) {
  const recount = getActiveRecount(boxId);
  if (recount) {
    res.status(409).json({
      error: `A(z) "${boxId}" doboz jelenleg újraszámolás alatt áll - előbb zárd le (jóváhagyással vagy elvetéssel) a "Dobozok" nézetben, utána módosítható újra.`,
    });
    return true;
  }
  return false;
}

const logMovement = db.prepare(
  `INSERT INTO stock_movements (product_id, source_box_id, dest_box_id, qty, operation)
   VALUES (?, ?, ?, ?, ?)`
);

// Termék elhelyezése / mennyiség hozzáadása egy dobozhoz (14. pont)
router.post('/place', (req, res) => {
  const { product_code, box_id, qty } = req.body;
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'A mennyiségnek pozitív egész számnak kell lennie.' });
  }

  const product = resolveProduct(product_code);
  if (!product) {
    return res.status(404).json({ error: `A beolvasott "${product_code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(box_id);
  if (!box) {
    return res.status(404).json({ error: `A(z) "${box_id}" raktári hely nem található.` });
  }
  if (assertBoxNotLocked(res, box.id)) return;

  const existingQty = currentQty(box.id, product.id);
  const cap = capacityFor(box.id, product.id);
  if (cap !== null && existingQty + qty > cap) {
    return res.status(409).json({
      error: `A(z) "${box.id}" doboz kapacitása nem elegendő ehhez a termékhez. Max: ${cap} db, jelenleg: ${existingQty} db.`,
    });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO placements (product_id, box_id, qty) VALUES (?, ?, ?)
       ON CONFLICT(product_id, box_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`
    ).run(product.id, box.id, qty);
    logMovement.run(product.id, null, box.id, qty, 'bevetelezes');
  });
  tx();

  res.json({
    ok: true,
    product,
    box_id: box.id,
    new_qty: currentQty(box.id, product.id),
  });
});

// Készlet kivétele egy dobozból (18. pont, pl. rendeléshez)
router.post('/pick', (req, res) => {
  const { product_code, box_id, qty } = req.body;
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'A mennyiségnek pozitív egész számnak kell lennie.' });
  }
  const product = resolveProduct(product_code);
  if (!product) {
    return res.status(404).json({ error: `A beolvasott "${product_code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }

  let targetBoxId = box_id;
  if (!targetBoxId) {
    // Ha nincs megadva doboz, az első olyan (jelenleg NEM újraszámolás alatt
    // álló) helyet választjuk, ahol elég van belőle - egy zárolt dobozból
    // úgysem lehetne kivenni, így ki sem ajánljuk automatikusan.
    const row = db
      .prepare(
        `SELECT pl.box_id FROM placements pl
         WHERE pl.product_id = ? AND pl.qty >= ?
           AND pl.box_id NOT IN (SELECT box_id FROM box_recounts WHERE status IN ('szamolas', 'osszesitve'))
         ORDER BY pl.qty DESC LIMIT 1`
      )
      .get(product.id, qty);
    if (!row) return res.status(409).json({ error: 'Egyik (jelenleg nem újraszámolás alatt álló) raktári helyen sincs elég készlet ehhez a kivételhez.' });
    targetBoxId = row.box_id;
  } else if (assertBoxNotLocked(res, targetBoxId)) {
    return;
  }

  const existingQty = currentQty(targetBoxId, product.id);
  if (existingQty < qty) {
    return res.status(409).json({ error: `A(z) "${targetBoxId}" helyen csak ${existingQty} db van, ${qty} db nem vehető ki.` });
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE placements SET qty = qty - ?, updated_at = datetime('now') WHERE product_id = ? AND box_id = ?`).run(
      qty,
      product.id,
      targetBoxId
    );
    logMovement.run(product.id, targetBoxId, null, qty, 'kivetel');
  });
  tx();

  res.json({ ok: true, product, box_id: targetBoxId, new_qty: currentQty(targetBoxId, product.id) });
});

// Áthelyezés két doboz között (19. pont)
router.post('/transfer', (req, res) => {
  const { product_code, from_box_id, to_box_id, qty } = req.body;
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'A mennyiségnek pozitív egész számnak kell lennie.' });
  }
  if (from_box_id === to_box_id) {
    return res.status(400).json({ error: 'A forrás- és a cél-doboz nem lehet ugyanaz.' });
  }
  const product = resolveProduct(product_code);
  if (!product) {
    return res.status(404).json({ error: `A beolvasott "${product_code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }
  const toBox = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(to_box_id);
  if (!toBox) return res.status(404).json({ error: `A(z) "${to_box_id}" cél raktári hely nem található.` });
  if (assertBoxNotLocked(res, from_box_id)) return;
  if (assertBoxNotLocked(res, to_box_id)) return;

  const sourceQty = currentQty(from_box_id, product.id);
  if (sourceQty < qty) {
    return res.status(409).json({ error: `A(z) "${from_box_id}" helyen csak ${sourceQty} db van.` });
  }
  const destQty = currentQty(to_box_id, product.id);
  const cap = capacityFor(to_box_id, product.id);
  if (cap !== null && destQty + qty > cap) {
    return res.status(409).json({ error: `A(z) "${to_box_id}" doboz kapacitása nem elegendő. Max: ${cap} db.` });
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE placements SET qty = qty - ?, updated_at = datetime('now') WHERE product_id = ? AND box_id = ?`).run(
      qty,
      product.id,
      from_box_id
    );
    db.prepare(
      `INSERT INTO placements (product_id, box_id, qty) VALUES (?, ?, ?)
       ON CONFLICT(product_id, box_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`
    ).run(product.id, to_box_id, qty);
    logMovement.run(product.id, from_box_id, to_box_id, qty, 'athelyezes');
  });
  tx();

  res.json({
    ok: true,
    product,
    from_box_id,
    to_box_id,
    from_qty: currentQty(from_box_id, product.id),
    to_qty: currentQty(to_box_id, product.id),
  });
});

module.exports = router;
