const express = require('express');
const db = require('../db/database');

const router = express.Router();

/**
 * Shoprenter rendelések a komissiózáshoz.
 *
 * A rendeléseket a Kvikk Connect Chrome-bővítmény küldi be, amikor a
 * csomagoló megnyit egy rendelést a Shoprenter adminban. A leltár app
 * ezekhez társítja a saját termék- és elhelyezés-adatait, így megmutatja,
 * melyik terméket melyik dobozból kell kivenni.
 *
 * SKU-párosítás: a Shoprenter cikkszáma a terméknév végén, zárójelben
 * szerepel (pl. "... (J25K-43P103-3099-12)"). Ezt a bővítmény bontja ki.
 * Ha egy cikkszámhoz nincs párja a leltár termékei közt, a tételt akkor is
 * eltároljuk, és a felületen külön jelezzük - némán soha nem dobjuk el.
 */

function findProductIdBySku(sku) {
  if (!sku) return null;
  // Először pontos egyezés, majd kis/nagybetű-független - a Shoprenter és a
  // leltárba importált CSV között előfordulhat eltérő írásmód.
  let row = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku);
  if (!row) {
    row = db.prepare(`SELECT id FROM products WHERE UPPER(sku) = UPPER(?)`).get(sku);
  }
  return row ? row.id : null;
}

// POST /api/orders/import - rendelés beszippantása a bővítményből
router.post('/import', (req, res) => {
  const body = req.body || {};
  const orderId = body.shoprenter_order_id;
  const items = Array.isArray(body.items) ? body.items : [];

  if (!orderId) {
    return res.status(400).json({ error: 'Hiányzik a rendelés azonosítója.' });
  }

  const existing = db.prepare(`SELECT id FROM shoprenter_orders WHERE shoprenter_order_id = ?`).get(orderId);
  const address = body.address || {};

  let orderRowId;
  if (existing) {
    orderRowId = existing.id;
    db.prepare(
      `UPDATE shoprenter_orders SET customer_name = ?, shipping_method_text = ?,
        payment_method_text = ?, gross_total = ?, recipient_phone = ?, recipient_email = ?,
        address_zip = ?, address_city = ?, address_street = ?, address_country = ?,
        cod_amount = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.customer_name || null,
      body.shipping_method_text || null,
      body.payment_method_text || null,
      body.gross_total ?? null,
      body.recipient_phone || null,
      body.recipient_email || null,
      address.zip || null,
      address.city || null,
      address.street || null,
      address.country || null,
      body.cod_amount ?? null,
      orderRowId
    );
    // A tételeket újraírjuk, mert a rendelés közben módosulhatott a Shoprenterben.
    db.prepare(`DELETE FROM shoprenter_order_items WHERE order_id = ?`).run(orderRowId);
  } else {
    const info = db
      .prepare(
        `INSERT INTO shoprenter_orders
           (shoprenter_order_id, customer_name, shipping_method_text, payment_method_text, gross_total,
            recipient_phone, recipient_email, address_zip, address_city, address_street, address_country, cod_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderId,
        body.customer_name || null,
        body.shipping_method_text || null,
        body.payment_method_text || null,
        body.gross_total ?? null,
        body.recipient_phone || null,
        body.recipient_email || null,
        address.zip || null,
        address.city || null,
        address.street || null,
        address.country || null,
        body.cod_amount ?? null
      );
    orderRowId = info.lastInsertRowid;
  }

  const insertItem = db.prepare(
    `INSERT INTO shoprenter_order_items (order_id, sku, name, qty, shoprenter_product_id, product_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let matched = 0;
  for (const item of items) {
    const productId = findProductIdBySku(item.sku);
    if (productId) matched++;
    insertItem.run(
      orderRowId,
      item.sku || null,
      item.name || null,
      Number(item.qty) || 1,
      item.shoprenter_product_id || null,
      productId
    );
  }

  res.json({
    ok: true,
    order_id: orderRowId,
    items_total: items.length,
    items_matched: matched,
    items_unmatched: items.length - matched,
  });
});

// GET /api/orders - rendeléslista (alapból a még össze nem készítettek elöl)
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*,
         (SELECT COUNT(*) FROM shoprenter_order_items i WHERE i.order_id = o.id) AS item_count,
         (SELECT COALESCE(SUM(i.qty), 0) FROM shoprenter_order_items i WHERE i.order_id = o.id) AS unit_count,
         (SELECT COUNT(*) FROM shoprenter_order_items i WHERE i.order_id = o.id AND i.product_id IS NULL) AS unmatched_count,
         (SELECT kvikk_tracking_number FROM kvikk_shipments s WHERE s.shoprenter_order_id = o.shoprenter_order_id) AS kvikk_tracking_number
       FROM shoprenter_orders o
       ORDER BY (o.picked_at IS NOT NULL), o.imported_at DESC`
    )
    .all();
  res.json(rows);
});

/**
 * GET /api/orders/:id/picking
 * Komissiózó lista: tételenként megmutatja, melyik dobozban van a termék.
 * A "boxes" tömb doboz szerint rendezve jön, hogy egy körrel be lehessen járni
 * a raktárat.
 */
router.get('/:id/picking', (req, res) => {
  const order = db.prepare(`SELECT * FROM shoprenter_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Nincs ilyen rendelés.' });

  const items = db
    .prepare(`SELECT * FROM shoprenter_order_items WHERE order_id = ? ORDER BY id`)
    .all(order.id);

  const placementStmt = db.prepare(
    `SELECT pl.box_id, pl.qty, b.label
       FROM placements pl
       LEFT JOIN boxes b ON b.id = pl.box_id
      WHERE pl.product_id = ? AND pl.qty > 0
      ORDER BY pl.qty DESC, pl.box_id`
  );
  const productStmt = db.prepare(`SELECT sku, ean, name, theoretical_stock, weight_g FROM products WHERE id = ?`);

  const detailed = items.map((item) => {
    if (!item.product_id) {
      return {
        ...item,
        matched: false,
        placements: [],
        available_qty: 0,
        problem: 'Ez a cikkszám nem szerepel a leltár termékei között.',
      };
    }
    const product = productStmt.get(item.product_id);
    const placements = placementStmt.all(item.product_id);
    const availableQty = placements.reduce((sum, p) => sum + p.qty, 0);

    let problem = null;
    if (placements.length === 0) problem = 'Nincs elhelyezve egyetlen dobozban sem.';
    else if (availableQty < item.qty) problem = `Kevesebb van elhelyezve (${availableQty} db), mint amennyi kell (${item.qty} db).`;

    return {
      ...item,
      matched: true,
      product_name: product ? product.name : item.name,
      product_ean: product ? product.ean : null,
      theoretical_stock: product ? product.theoretical_stock : null,
      weight_g: product ? product.weight_g : null,
      placements,
      available_qty: availableQty,
      problem,
    };
  });

  // Doboz szerinti csoportosítás - így nem kell oda-vissza járkálni a raktárban.
  const byBox = new Map();
  for (const item of detailed) {
    for (const pl of item.placements) {
      if (!byBox.has(pl.box_id)) byBox.set(pl.box_id, { box_id: pl.box_id, label: pl.label, items: [] });
      byBox.get(pl.box_id).items.push({
        sku: item.sku,
        ean: item.product_ean,
        name: item.product_name || item.name,
        needed_qty: item.qty,
        in_box_qty: pl.qty,
      });
    }
  }

  res.json({
    order,
    items: detailed,
    by_box: Array.from(byBox.values()).sort((a, b) => String(a.box_id).localeCompare(String(b.box_id))),
    problems: detailed.filter((i) => i.problem).length,
  });
});

// POST /api/orders/:id/picked - összekészítettnek jelölés (visszakapcsolható)
router.post('/:id/picked', (req, res) => {
  const order = db.prepare(`SELECT * FROM shoprenter_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Nincs ilyen rendelés.' });
  const newValue = order.picked_at ? null : new Date().toISOString();
  db.prepare(`UPDATE shoprenter_orders SET picked_at = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newValue,
    order.id
  );
  res.json({ ok: true, picked_at: newValue });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM shoprenter_orders WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

/**
 * POST /api/orders/:id/deduct-stock
 * Készletcsökkentés könyvelése egy rendeléshez, jellemzően az összekészítést
 * követően.
 *
 * Idempotens/visszavonható: ha a rendeléshez már történt könyvelés
 * (stock_deducted_at ki van töltve), ez a hívás NEM könyvel újra, hanem
 * pontosan visszaállítja a korábban levont mennyiségeket (a
 * order_stock_deductions tábla tételes bontása alapján) - így egy tévesen
 * megnyomott gomb nem okoz végleges készletproblémát.
 *
 * Az első könyveléskor tételenként, dobozonként (a legtöbbet tartalmazó
 * dobozból kezdve) vonjuk le a mennyiséget - ha egy tételhez nincs elég
 * elhelyezett készlet ÖSSZESEN az összes dobozban, a teljes könyvelés
 * elmarad (semmi nem kerül levonásra), és a hiányzó tételeket visszaadjuk,
 * hogy a csomagoló tudja, mit kell előbb rendezni.
 */
router.post('/:id/deduct-stock', (req, res) => {
  const order = db.prepare(`SELECT * FROM shoprenter_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Nincs ilyen rendelés.' });

  // ---- Visszavonás, ha már könyvelve volt ----
  if (order.stock_deducted_at) {
    const deductions = db
      .prepare(`SELECT * FROM order_stock_deductions WHERE order_id = ?`)
      .all(order.id);

    const tx = db.transaction(() => {
      for (const d of deductions) {
        if (d.box_id) {
          db.prepare(
            `INSERT INTO placements (product_id, box_id, qty) VALUES (?, ?, ?)
             ON CONFLICT(product_id, box_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`
          ).run(d.product_id, d.box_id, d.qty);
        }
        db.prepare(
          `INSERT INTO stock_movements (product_id, source_box_id, dest_box_id, qty, operation)
           VALUES (?, NULL, ?, ?, 'bevetelezes')`
        ).run(d.product_id, d.box_id, d.qty);
      }
      db.prepare(`DELETE FROM order_stock_deductions WHERE order_id = ?`).run(order.id);
      db.prepare(`UPDATE shoprenter_orders SET stock_deducted_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(order.id);
    });
    tx();

    return res.json({ ok: true, stock_deducted_at: null, reversed_items: deductions.length });
  }

  // ---- Első könyvelés ----
  if (!order.picked_at) {
    return res.status(409).json({ error: 'A rendelést előbb összekészítettnek kell jelölni.' });
  }

  const items = db
    .prepare(`SELECT * FROM shoprenter_order_items WHERE order_id = ? ORDER BY id`)
    .all(order.id);

  const placementStmt = db.prepare(
    `SELECT box_id, qty FROM placements WHERE product_id = ? AND qty > 0 ORDER BY qty DESC, box_id`
  );

  const plan = [];       // { product_id, box_id, qty } - amit ténylegesen le fogunk vonni
  const shortfalls = []; // tételek, amikhez nincs elég összesített készlet
  const skippedUnmatched = [];

  for (const item of items) {
    if (!item.product_id) {
      skippedUnmatched.push({ sku: item.sku, name: item.name });
      continue;
    }
    let remaining = item.qty;
    const placements = placementStmt.all(item.product_id);
    for (const p of placements) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, p.qty);
      if (take > 0) {
        plan.push({ product_id: item.product_id, box_id: p.box_id, qty: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      shortfalls.push({
        sku: item.sku,
        name: item.name,
        needed_qty: item.qty,
        missing_qty: remaining,
      });
    }
  }

  if (shortfalls.length > 0) {
    return res.status(409).json({
      error: 'Nincs elég elhelyezett készlet minden tételhez, a könyvelés nem történt meg.',
      shortfalls,
    });
  }

  const deductedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const p of plan) {
      db.prepare(`UPDATE placements SET qty = qty - ?, updated_at = datetime('now') WHERE product_id = ? AND box_id = ?`).run(
        p.qty,
        p.product_id,
        p.box_id
      );
      db.prepare(
        `INSERT INTO order_stock_deductions (order_id, product_id, box_id, qty) VALUES (?, ?, ?, ?)`
      ).run(order.id, p.product_id, p.box_id, p.qty);
      db.prepare(
        `INSERT INTO stock_movements (product_id, source_box_id, dest_box_id, qty, operation)
         VALUES (?, ?, NULL, ?, 'kivetel')`
      ).run(p.product_id, p.box_id, p.qty);
    }
    db.prepare(`UPDATE shoprenter_orders SET stock_deducted_at = ?, updated_at = datetime('now') WHERE id = ?`).run(
      deductedAt,
      order.id
    );
  });
  tx();

  res.json({
    ok: true,
    stock_deducted_at: deductedAt,
    deducted_lines: plan.length,
    skipped_unmatched: skippedUnmatched,
  });
});

/**
 * POST /api/orders/calculate-weight
 * Csomagsúly számítása a tételekből. A bővítmény hívja, hogy a súly mezőt
 * automatikusan kitöltse.
 *
 * Ha bármelyik termék súlya hiányzik a leltárban, azt megmondjuk - ilyenkor
 * a számított súly hiányos, és a felület jelzi, hogy kézzel ellenőrizni kell.
 * A csomagolóanyag (doboz, boríték) súlyát a packaging_g paraméterrel lehet
 * hozzáadni; alapértelmezés 0.
 */
router.post('/calculate-weight', (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  const packagingG = Number(req.body && req.body.packaging_g) || 0;

  let totalG = packagingG;
  const missing = [];

  for (const item of items) {
    const productId = findProductIdBySku(item.sku);
    const product = productId
      ? db.prepare(`SELECT sku, name, weight_g FROM products WHERE id = ?`).get(productId)
      : null;

    if (!product || product.weight_g === null || product.weight_g === undefined) {
      missing.push({ sku: item.sku, name: item.name, reason: product ? 'nincs súly megadva' : 'ismeretlen cikkszám' });
      continue;
    }
    totalG += Number(product.weight_g) * (Number(item.qty) || 1);
  }

  res.json({
    total_g: Math.round(totalG),
    total_kg: Math.round(totalG) / 1000,
    complete: missing.length === 0,
    missing,
  });
});

module.exports = router;
