const express = require('express');
const db = require('../db/database');

const router = express.Router();

function getItem(sessionId, productId) {
  return db
    .prepare(`SELECT * FROM inventory_items WHERE session_id = ? AND product_id = ?`)
    .get(sessionId, productId);
}

function itemWithProduct(item) {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(item.product_id);
  return {
    ...item,
    sku: product.sku,
    ean: product.ean,
    name: product.name,
    difference: item.counted_qty - item.theoretical_qty,
  };
}

// Munkamenetek listája
router.get('/sessions', (req, res) => {
  res.json(db.prepare(`SELECT * FROM inventory_sessions ORDER BY created_at DESC`).all());
});

// Munkamenet törlése (a hozzá tartozó tételek és lépések is törlődnek)
router.delete('/sessions/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM inventory_sessions WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });
  res.status(204).end();
});

// Új leltár-munkamenet indítása: minden termék elméleti készlete "befagyasztva"
router.post('/sessions', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'A munkamenet neve kötelező.' });

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO inventory_sessions (name) VALUES (?)`).run(name);
    const sessionId = info.lastInsertRowid;
    const products = db.prepare(`SELECT id, theoretical_stock FROM products`).all();
    const insertItem = db.prepare(
      `INSERT INTO inventory_items (session_id, product_id, theoretical_qty, counted_qty) VALUES (?, ?, ?, 0)`
    );
    for (const p of products) insertItem.run(sessionId, p.id, p.theoretical_stock);
    return sessionId;
  });
  const sessionId = tx();
  res.status(201).json(db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(sessionId));
});

// Munkamenet tételei, szűréssel: all | eltero | hiany | tobblet | nemellenorzott
router.get('/sessions/:id/items', (req, res) => {
  const session = db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });

  let items = db
    .prepare(`SELECT * FROM inventory_items WHERE session_id = ?`)
    .all(req.params.id)
    .map(itemWithProduct);

  const { filter } = req.query;
  if (filter === 'eltero') items = items.filter((i) => i.difference !== 0);
  if (filter === 'hiany') items = items.filter((i) => i.difference < 0);
  if (filter === 'tobblet') items = items.filter((i) => i.difference > 0);
  if (filter === 'nemellenorzott') items = items.filter((i) => !i.checked);
  if (filter === 'ellenorzott') items = items.filter((i) => i.checked);

  res.json({ session, items });
});

// Vonalkód / SKU beolvasása a leltár-munkamenetben -> +delta (alapból +1, vagy amennyit a kliens küld)
router.post('/sessions/:id/scan', (req, res) => {
  const session = db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });
  if (session.status !== 'nyitott') {
    return res.status(409).json({ error: 'A munkamenet már le van zárva, nem lehet módosítani.' });
  }

  const { code, delta } = req.body;
  const step = Number.isInteger(delta) ? delta : 1;

  const product = db.prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`).get(code, code);
  if (!product) {
    return res.status(404).json({ error: `A beolvasott "${code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }

  let item = getItem(session.id, product.id);
  if (!item) {
    // ha a terméket a munkamenet indítása után vették fel, most csatlakoztatjuk
    db.prepare(
      `INSERT INTO inventory_items (session_id, product_id, theoretical_qty, counted_qty) VALUES (?, ?, ?, 0)`
    ).run(session.id, product.id, product.theoretical_stock);
    item = getItem(session.id, product.id);
  }

  const newCount = Math.max(0, item.counted_qty + step);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE inventory_items SET counted_qty = ?, checked = 1, last_scanned_at = datetime('now')
       WHERE id = ?`
    ).run(newCount, item.id);
    db.prepare(
      `INSERT INTO inventory_actions (session_id, product_id, delta) VALUES (?, ?, ?)`
    ).run(session.id, product.id, newCount - item.counted_qty);
  });
  tx();

  res.json(itemWithProduct(getItem(session.id, product.id)));
});

// Mennyiség közvetlen módosítása
router.post('/sessions/:id/set', (req, res) => {
  const session = db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });
  const { product_id, counted_qty } = req.body;
  if (!Number.isInteger(counted_qty) || counted_qty < 0) {
    return res.status(400).json({ error: 'A mennyiségnek nem-negatív egész számnak kell lennie.' });
  }
  const item = getItem(session.id, product_id);
  if (!item) return res.status(404).json({ error: 'A termék nem szerepel ebben a munkamenetben.' });

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO inventory_actions (session_id, product_id, delta) VALUES (?, ?, ?)`
    ).run(session.id, product_id, counted_qty - item.counted_qty);
    db.prepare(
      `UPDATE inventory_items SET counted_qty = ?, checked = 1, last_scanned_at = datetime('now') WHERE id = ?`
    ).run(counted_qty, item.id);
  });
  tx();

  res.json(itemWithProduct(getItem(session.id, product_id)));
});

// Utolsó művelet visszavonása
router.post('/sessions/:id/undo', (req, res) => {
  const session = db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Ismeretlen munkamenet.' });

  const lastAction = db
    .prepare(`SELECT * FROM inventory_actions WHERE session_id = ? ORDER BY id DESC LIMIT 1`)
    .get(session.id);
  if (!lastAction) return res.status(409).json({ error: 'Nincs visszavonható művelet.' });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE inventory_items SET counted_qty = MAX(0, counted_qty - ?) WHERE session_id = ? AND product_id = ?`
    ).run(lastAction.delta, session.id, lastAction.product_id);
    db.prepare(`DELETE FROM inventory_actions WHERE id = ?`).run(lastAction.id);
  });
  tx();

  res.json(itemWithProduct(getItem(session.id, lastAction.product_id)));
});

// Munkamenet lezárása
router.post('/sessions/:id/close', (req, res) => {
  const info = db
    .prepare(`UPDATE inventory_sessions SET status = 'lezart', closed_at = datetime('now') WHERE id = ? AND status = 'nyitott'`)
    .run(req.params.id);
  if (!info.changes) return res.status(409).json({ error: 'A munkamenet nem található vagy már le van zárva.' });
  res.json(db.prepare(`SELECT * FROM inventory_sessions WHERE id = ?`).get(req.params.id));
});

module.exports = router;
