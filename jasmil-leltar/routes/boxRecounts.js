const express = require('express');
const db = require('../db/database');
const { getActiveRecount } = require('../lib/boxLock');

const router = express.Router();

function itemWithProduct(item, { blind }) {
  const product = db.prepare(`SELECT sku, ean, name FROM products WHERE id = ?`).get(item.product_id);
  const base = {
    product_id: item.product_id,
    sku: product ? product.sku : null,
    ean: product ? product.ean : null,
    name: product ? product.name : '(törölt termék)',
    counted_qty: item.counted_qty,
    last_scanned_at: item.last_scanned_at,
  };
  if (blind) return base; // vak számolás közben a recorded_qty NEM megy ki a kliensnek
  return { ...base, recorded_qty: item.recorded_qty, diff: item.counted_qty - item.recorded_qty };
}

function recountWithItems(recount) {
  const blind = recount.status === 'szamolas';
  const items = db
    .prepare(`SELECT * FROM box_recount_items WHERE recount_id = ? ORDER BY id`)
    .all(recount.id)
    .map((it) => itemWithProduct(it, { blind }));
  return { recount, items };
}

/**
 * GET /api/boxes/:boxId/recount
 * Az adott doboz jelenlegi AKTÍV (szamolas vagy osszesitve állapotú)
 * újraszámolása, ha van. 404, ha a dobozon jelenleg nincs folyamatban lévő
 * számolás - ez nem hiba, egyszerűen azt jelenti, hogy a doboz szabadon
 * használható a normál elhelyezés/kivétel/áthelyezés műveletekhez.
 */
router.get('/boxes/:boxId/recount', (req, res) => {
  const recount = getActiveRecount(req.params.boxId);
  if (!recount) return res.status(404).json({ error: 'Ezen a dobozon jelenleg nincs folyamatban lévő újraszámolás.' });
  res.json(recountWithItems(recount));
});

/**
 * POST /api/boxes/:boxId/recount/start
 * Új újraszámolás indítása egy dobozon. A doboz jelenlegi (placements)
 * tartalmát azonnal "lefényképezzük" (recorded_qty), majd a dobozt
 * zárolttá tesszük a normál készletműveletek elől, amíg a számolás le nem
 * zárul (jóváhagyással vagy elvetéssel).
 *
 * Ha a dobozon már fut egy számolás, nem indítunk másikat, hanem simán
 * visszaadjuk a meglévőt - így ha valaki véletlenül duplán nyomja meg a
 * gombot (vagy egy másik eszközről folytatja), nem veszik el semmi adat.
 */
router.post('/boxes/:boxId/recount/start', (req, res) => {
  const box = db.prepare(`SELECT * FROM boxes WHERE id = ?`).get(req.params.boxId);
  if (!box) return res.status(404).json({ error: `A(z) "${req.params.boxId}" doboz nem található.` });

  const existing = getActiveRecount(box.id);
  if (existing) {
    return res.status(200).json({ already_active: true, ...recountWithItems(existing) });
  }

  const currentContents = db
    .prepare(`SELECT product_id, qty FROM placements WHERE box_id = ? AND qty > 0`)
    .all(box.id);

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO box_recounts (box_id) VALUES (?)`).run(box.id);
    const recountId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO box_recount_items (recount_id, product_id, recorded_qty, counted_qty) VALUES (?, ?, ?, 0)`
    );
    for (const row of currentContents) insertItem.run(recountId, row.product_id, row.qty);
    return recountId;
  });
  const recountId = tx();

  const recount = db.prepare(`SELECT * FROM box_recounts WHERE id = ?`).get(recountId);
  res.status(201).json({ already_active: false, ...recountWithItems(recount) });
});

function getOpenRecount(id) {
  return db.prepare(`SELECT * FROM box_recounts WHERE id = ? AND status = 'szamolas'`).get(id);
}

function getItem(recountId, productId) {
  return db.prepare(`SELECT * FROM box_recount_items WHERE recount_id = ? AND product_id = ?`).get(recountId, productId);
}

/**
 * POST /api/box-recounts/:id/scan
 * Vonalkód/cikkszám beolvasása a folyamatban lévő számoláshoz -> +delta
 * (alapból +1, vagy amennyit a kliens küld, lehet negatív is a gyors "-1"
 * gombhoz). Ha a termék korábban nem volt ebben a dobozban nyilvántartva
 * (recorded_qty=0), most is felvesszük 0 nyilvántartott mennyiséggel - ez
 * a "többlet, amiről nem tudtunk" esetet kezeli.
 */
router.post('/box-recounts/:id/scan', (req, res) => {
  const recount = getOpenRecount(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs (már nincs) folyamatban.' });

  const { code, delta } = req.body;
  const step = Number.isInteger(delta) ? delta : 1;

  const product = db.prepare(`SELECT * FROM products WHERE ean = ? OR sku = ?`).get(code, code);
  if (!product) {
    return res.status(404).json({ error: `A beolvasott "${code}" EAN-kódhoz/cikkszámhoz nem található termék.` });
  }

  let item = getItem(recount.id, product.id);
  if (!item) {
    db.prepare(
      `INSERT INTO box_recount_items (recount_id, product_id, recorded_qty, counted_qty) VALUES (?, ?, 0, 0)`
    ).run(recount.id, product.id);
    item = getItem(recount.id, product.id);
  }

  const newCount = Math.max(0, item.counted_qty + step);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE box_recount_items SET counted_qty = ?, last_scanned_at = datetime('now') WHERE id = ?`
    ).run(newCount, item.id);
    db.prepare(
      `INSERT INTO box_recount_actions (recount_id, product_id, delta) VALUES (?, ?, ?)`
    ).run(recount.id, product.id, newCount - item.counted_qty);
  });
  tx();

  res.json(itemWithProduct(getItem(recount.id, product.id), { blind: true }));
});

// Mennyiség közvetlen beírása (pl. ha a csomagoló inkább beír egy számot beolvasás helyett)
router.post('/box-recounts/:id/set', (req, res) => {
  const recount = getOpenRecount(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs (már nincs) folyamatban.' });

  const { product_id, counted_qty } = req.body;
  if (!Number.isInteger(counted_qty) || counted_qty < 0) {
    return res.status(400).json({ error: 'A mennyiségnek nem-negatív egész számnak kell lennie.' });
  }
  let item = getItem(recount.id, product_id);
  if (!item) {
    db.prepare(
      `INSERT INTO box_recount_items (recount_id, product_id, recorded_qty, counted_qty) VALUES (?, ?, 0, 0)`
    ).run(recount.id, product_id);
    item = getItem(recount.id, product_id);
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO box_recount_actions (recount_id, product_id, delta) VALUES (?, ?, ?)`
    ).run(recount.id, product_id, counted_qty - item.counted_qty);
    db.prepare(
      `UPDATE box_recount_items SET counted_qty = ?, last_scanned_at = datetime('now') WHERE id = ?`
    ).run(counted_qty, item.id);
  });
  tx();

  res.json(itemWithProduct(getItem(recount.id, product_id), { blind: true }));
});

// Utolsó beolvasási lépés visszavonása
router.post('/box-recounts/:id/undo', (req, res) => {
  const recount = getOpenRecount(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs (már nincs) folyamatban.' });

  const lastAction = db
    .prepare(`SELECT * FROM box_recount_actions WHERE recount_id = ? ORDER BY id DESC LIMIT 1`)
    .get(recount.id);
  if (!lastAction) return res.status(409).json({ error: 'Nincs visszavonható lépés.' });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE box_recount_items SET counted_qty = MAX(0, counted_qty - ?) WHERE recount_id = ? AND product_id = ?`
    ).run(lastAction.delta, recount.id, lastAction.product_id);
    db.prepare(`DELETE FROM box_recount_actions WHERE id = ?`).run(lastAction.id);
  });
  tx();

  res.json(itemWithProduct(getItem(recount.id, lastAction.product_id), { blind: true }));
});

/**
 * POST /api/box-recounts/:id/close
 * Lezárja a (vak) számolást, és megmutatja a teljes eltérés-összevetést
 * (innentől nem vak). A doboz eddig is zárolva volt, és marad is zárolva,
 * amíg jóváhagyás (apply) vagy elvetés (cancel) nem történik - így a
 * csomagoló nyugodtan átgondolhatja az eredményt, mielőtt bármi
 * ténylegesen megváltozna a nyilvántartásban.
 */
router.post('/box-recounts/:id/close', (req, res) => {
  const recount = getOpenRecount(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs (már nincs) folyamatban.' });

  db.prepare(`UPDATE box_recounts SET status = 'osszesitve', closed_at = datetime('now') WHERE id = ?`).run(recount.id);
  const updated = db.prepare(`SELECT * FROM box_recounts WHERE id = ?`).get(recount.id);
  res.json(recountWithItems(updated));
});

/**
 * POST /api/box-recounts/:id/apply
 * Jóváhagyás: az összesítés (close) után mutatott eltéréseket ténylegesen
 * beírja a placements táblába (recount → counted_qty lesz az új placements
 * qty, 0 esetén törlődik a sor), és minden nem-nulla eltérést naplóz a
 * stock_movements táblába 'leltar_korrekcio' művelettel. Ezután a doboz
 * feloldódik.
 */
router.post('/box-recounts/:id/apply', (req, res) => {
  const recount = db.prepare(`SELECT * FROM box_recounts WHERE id = ? AND status = 'osszesitve'`).get(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs összesítve (előbb zárd le a "close" lépéssel).' });

  const items = db.prepare(`SELECT * FROM box_recount_items WHERE recount_id = ?`).all(recount.id);
  const logMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, source_box_id, dest_box_id, qty, operation) VALUES (?, ?, ?, ?, 'leltar_korrekcio')`
  );

  const tx = db.transaction(() => {
    for (const item of items) {
      const diff = item.counted_qty - item.recorded_qty;
      if (diff === 0) continue;
      if (item.counted_qty > 0) {
        db.prepare(
          `INSERT INTO placements (product_id, box_id, qty) VALUES (?, ?, ?)
           ON CONFLICT(product_id, box_id) DO UPDATE SET qty = excluded.qty, updated_at = datetime('now')`
        ).run(item.product_id, recount.box_id, item.counted_qty);
      } else {
        db.prepare(`DELETE FROM placements WHERE product_id = ? AND box_id = ?`).run(item.product_id, recount.box_id);
      }
      // diff > 0: több lett elő, mint a nyilvántartás szerint kellett volna (dest = ez a doboz)
      // diff < 0: kevesebb lett elő, mint kellett volna (source = ez a doboz)
      if (diff > 0) logMovement.run(item.product_id, null, recount.box_id, diff);
      else logMovement.run(item.product_id, recount.box_id, null, -diff);
    }
    db.prepare(`UPDATE box_recounts SET status = 'lezart', finished_at = datetime('now') WHERE id = ?`).run(recount.id);
  });
  tx();

  const updated = db.prepare(`SELECT * FROM box_recounts WHERE id = ?`).get(recount.id);
  res.json(recountWithItems(updated));
});

/**
 * POST /api/box-recounts/:id/cancel
 * Elvetés: 'szamolas' vagy 'osszesitve' állapotból egyaránt hívható, semmit
 * nem ír a placements táblába, a doboz feloldódik. Arra való, ha valaki
 * tévedésből indította a számolást, vagy az eredményt megbízhatatlannak
 * ítéli (pl. közben mégis nyúltak a dobozhoz) és inkább újrakezdené.
 */
router.post('/box-recounts/:id/cancel', (req, res) => {
  const recount = db
    .prepare(`SELECT * FROM box_recounts WHERE id = ? AND status IN ('szamolas', 'osszesitve')`)
    .get(req.params.id);
  if (!recount) return res.status(409).json({ error: 'Ez az újraszámolás nincs (már nincs) folyamatban.' });

  db.prepare(`UPDATE box_recounts SET status = 'megszakitva', finished_at = datetime('now') WHERE id = ?`).run(recount.id);
  res.json({ ok: true });
});

/**
 * GET /api/box-recounts/history
 * Korábbi (lezárt vagy elvetett) újraszámolások listája, audit-célra.
 */
router.get('/box-recounts/history', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, box_id, status, started_at, closed_at, finished_at,
              (SELECT COUNT(*) FROM box_recount_items i WHERE i.recount_id = box_recounts.id AND i.counted_qty != i.recorded_qty) AS diff_count
       FROM box_recounts WHERE status IN ('lezart', 'megszakitva') ORDER BY finished_at DESC LIMIT 100`
    )
    .all();
  res.json(rows);
});

module.exports = router;
