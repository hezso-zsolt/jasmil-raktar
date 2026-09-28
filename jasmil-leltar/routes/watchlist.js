const express = require('express');
const db = require('../db/database');

const router = express.Router();

function withProduct(row) {
  return {
    id: row.id,
    product_id: row.product_id,
    sku: row.sku,
    ean: row.ean,
    name: row.name,
    requested_qty: row.requested_qty,
    fulfilled_qty: row.fulfilled_qty,
    note: row.note,
    status: row.status,
    created_at: row.created_at,
  };
}

// Teljes lista (aktív és kész tételek is)
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT w.*, p.sku, p.ean, p.name FROM watchlist w
       JOIN products p ON p.id = w.product_id
       ORDER BY w.status ASC, w.created_at DESC`
    )
    .all();
  res.json(rows.map(withProduct));
});

// Új figyelt tétel felvétele
router.post('/', (req, res) => {
  const { product_code, requested_qty, note } = req.body;
  if (!product_code) return res.status(400).json({ error: 'A "product_code" (EAN/SKU) mező kötelező.' });
  const qty = parseInt(requested_qty, 10);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'A kért mennyiségnek pozitív egész számnak kell lennie.' });
  }
  const product = db.prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`).get(product_code, product_code);
  if (!product) {
    return res.status(404).json({ error: `A(z) "${product_code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }
  const info = db
    .prepare(`INSERT INTO watchlist (product_id, requested_qty, note) VALUES (?, ?, ?)`)
    .run(product.id, qty, note || null);
  const row = db
    .prepare(
      `SELECT w.*, p.sku, p.ean, p.name FROM watchlist w JOIN products p ON p.id = w.product_id WHERE w.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(withProduct(row));
});

// Egy beolvasott EAN/SKU-hoz tartozó AKTÍV figyelt tételek lekérdezése —
// ezt hívja a felület minden beolvasás után, hogy eldöntse, kell-e
// figyelmeztető ablakot mutatnia. Ismeretlen kódnál egyszerűen üres
// listát ad vissza (nem hibát), hogy ne zavarja be a fő műveletet.
router.get('/check', (req, res) => {
  const { code } = req.query;
  if (!code) return res.json([]);
  const product = db.prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`).get(code, code);
  if (!product) return res.json([]);
  const rows = db
    .prepare(
      `SELECT w.*, p.sku, p.ean, p.name FROM watchlist w JOIN products p ON p.id = w.product_id
       WHERE w.product_id = ? AND w.status = 'aktiv' ORDER BY w.created_at ASC`
    )
    .all(product.id);
  res.json(rows.map(withProduct));
});

// "Félretéve" — a fizikailag félretett mennyiséget eggyel növeli, és ha
// ezzel eléri a kért mennyiséget, a tételt "kész" állapotba állítja.
// Ez tisztán nyilvántartási művelet, semmilyen raktári adatot nem mozgat.
router.post('/:id/fulfill', (req, res) => {
  const item = db.prepare(`SELECT * FROM watchlist WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Ismeretlen figyelt tétel.' });
  if (item.status === 'kesz') {
    return res.status(409).json({ error: 'Ez a tétel már teljesítve van.' });
  }
  const newFulfilled = item.fulfilled_qty + 1;
  const newStatus = newFulfilled >= item.requested_qty ? 'kesz' : 'aktiv';
  db.prepare(`UPDATE watchlist SET fulfilled_qty = ?, status = ? WHERE id = ?`).run(newFulfilled, newStatus, item.id);
  const row = db
    .prepare(
      `SELECT w.*, p.sku, p.ean, p.name FROM watchlist w JOIN products p ON p.id = w.product_id WHERE w.id = ?`
    )
    .get(item.id);
  res.json(withProduct(row));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM watchlist WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Ismeretlen figyelt tétel.' });
  res.status(204).end();
});

module.exports = router;
