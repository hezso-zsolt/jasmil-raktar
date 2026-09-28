const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Egy termékhez a teljes (elhelyezésekből számolt) fizikai készlet
function withPhysicalStock(product) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(qty), 0) AS total FROM placements WHERE product_id = ?`
  ).get(product.id);
  return { ...product, physical_stock: row.total };
}

// Lista + keresés/szűrés
router.get('/', (req, res) => {
  const { q, category, unplaced } = req.query;
  let sql = `SELECT * FROM products`;
  const clauses = [];
  const params = [];

  if (q) {
    clauses.push(`(sku LIKE ? OR ean LIKE ? OR name LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    clauses.push(`category = ?`);
    params.push(category);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY name ASC';

  let products = db.prepare(sql).all(...params).map(withPhysicalStock);

  if (unplaced === '1') {
    products = products.filter((p) => p.physical_stock === 0);
  }

  res.json(products);
});

// Egy termék lekérése azonosító / EAN / SKU alapján
router.get('/lookup', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Hiányzó "code" paraméter.' });

  const product = db
    .prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`)
    .get(code, code);

  if (!product) {
    return res.status(404).json({
      error: `A(z) "${code}" EAN-kódhoz vagy cikkszámhoz nem található termék.`,
    });
  }

  const placements = db
    .prepare(
      `SELECT p.box_id, p.qty, b.label FROM placements p
       JOIN boxes b ON b.id = p.box_id
       WHERE p.product_id = ? AND p.qty > 0
       ORDER BY p.box_id`
    )
    .all(product.id);

  res.json({ ...withPhysicalStock(product), placements });
});

router.get('/:id', (req, res) => {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Ismeretlen SKU / termék.' });
  res.json(withPhysicalStock(product));
});

router.post('/', (req, res) => {
  const { sku, ean, name, category, size, color, theoretical_stock } = req.body;
  if (!sku || !name) {
    return res.status(400).json({ error: 'A "sku" és a "name" mező kötelező.' });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO products (sku, ean, name, category, size, color, theoretical_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(sku, ean || null, name, category || null, size || null, color || null, theoretical_stock || 0);
    res.status(201).json(db.prepare(`SELECT * FROM products WHERE id = ?`).get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: 'Duplikált SKU vagy EAN.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ismeretlen termék.' });

  const { sku, ean, name, category, size, color, theoretical_stock } = req.body;
  try {
    db.prepare(
      `UPDATE products SET sku=?, ean=?, name=?, category=?, size=?, color=?, theoretical_stock=?, updated_at=datetime('now')
       WHERE id = ?`
    ).run(
      sku ?? existing.sku,
      ean ?? existing.ean,
      name ?? existing.name,
      category ?? existing.category,
      size ?? existing.size,
      color ?? existing.color,
      theoretical_stock ?? existing.theoretical_stock,
      req.params.id
    );
    res.json(db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id));
  } catch (e) {
    res.status(409).json({ error: 'Duplikált SKU vagy EAN.' });
  }
});

// Tömeges törlés (kijelölt vagy az összes szűrt termék egyszerre)
router.delete('/', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'Az "ids" mezőben legalább egy termékazonosítót meg kell adni.' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    const info = db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...ids);
    return info.changes;
  });
  const deleted = tx();
  res.json({ deleted });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Ismeretlen termék.' });
  res.status(204).end();
});

module.exports = router;
