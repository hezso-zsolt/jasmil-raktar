const express = require('express');
const db = require('../db/database');
const { looksLikePickupPointOrder } = require('../lib/pickupPointDetection');

const router = express.Router();

router.get('/overview', (req, res) => {
  const totalBoxes = db.prepare(`SELECT COUNT(*) AS c FROM boxes`).get().c;
  const occupiedBoxes = db
    .prepare(
      `SELECT COUNT(DISTINCT box_id) AS c FROM placements WHERE qty > 0`
    )
    .get().c;
  const totalProducts = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
  const unplacedProducts = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products p
       WHERE NOT EXISTS (SELECT 1 FROM placements pl WHERE pl.product_id = p.id AND pl.qty > 0)`
    )
    .get().c;
  const totalUnitsPlaced = db.prepare(`SELECT COALESCE(SUM(qty),0) AS c FROM placements`).get().c;

  res.json({
    totalBoxes,
    occupiedBoxes,
    emptyBoxes: totalBoxes - occupiedBoxes,
    totalProducts,
    unplacedProducts,
    totalUnitsPlaced,
  });
});

router.get('/unplaced', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.* FROM products p
       WHERE NOT EXISTS (SELECT 1 FROM placements pl WHERE pl.product_id = p.id AND pl.qty > 0)
       ORDER BY p.name`
    )
    .all();
  res.json(rows);
});

/**
 * Elhelyezettségi kimutatás.
 *
 * Három csoportba sorolja a termékeket:
 *  - "placed":    a teljes készlet el van helyezve dobozokban
 *  - "partial":   van elhelyezve belőle, de kevesebb, mint a készlet
 *  - "unplaced":  egyetlen dobozban sincs elhelyezve
 *
 * A "partial" csoport a gyakorlatban a leghasznosabb: ezek azok a termékek,
 * amikből maradt még kint/bedobozolatlan mennyiség, pedig részben már el
 * lettek pakolva - ez egy sima "van-e elhelyezés" szűrővel láthatatlan marad.
 *
 * ?status=placed|partial|unplaced szűkíti a listát,
 * ?format=csv letölthető CSV-t ad vissza a táblázat helyett.
 */
function buildPlacementStatusRows() {
  return db
    .prepare(
      `SELECT
         p.id, p.sku, p.ean, p.name, p.category, p.size, p.color,
         p.theoretical_stock,
         COALESCE((SELECT SUM(pl.qty) FROM placements pl WHERE pl.product_id = p.id AND pl.qty > 0), 0) AS placed_qty,
         (SELECT GROUP_CONCAT(pl.box_id || ' (' || pl.qty || ' db)', ', ')
            FROM placements pl WHERE pl.product_id = p.id AND pl.qty > 0) AS boxes
       FROM products p
       ORDER BY p.name`
    )
    .all()
    .map((r) => {
      const placed = r.placed_qty || 0;
      const stock = r.theoretical_stock || 0;
      let status;
      if (placed === 0) status = 'unplaced';
      else if (placed < stock) status = 'partial';
      else status = 'placed';
      return { ...r, placed_qty: placed, missing_qty: Math.max(stock - placed, 0), status, boxes: r.boxes || '' };
    });
}

router.get('/placement-status', (req, res) => {
  const all = buildPlacementStatusRows();
  const statusFilter = req.query.status;
  const rows = statusFilter ? all.filter((r) => r.status === statusFilter) : all;

  if (req.query.format === 'csv') {
    const { stringify } = require('csv-stringify/sync');
    const statusLabel = { placed: 'elhelyezve', partial: 'részben elhelyezve', unplaced: 'nincs elhelyezve' };
    const csv = stringify(
      rows.map((r) => ({
        cikkszam: r.sku,
        ean: r.ean || '',
        nev: r.name,
        kategoria: r.category || '',
        meret: r.size || '',
        allapot: statusLabel[r.status],
        keszlet: r.theoretical_stock,
        elhelyezve: r.placed_qty,
        hianyzik: r.missing_qty,
        dobozok: r.boxes,
      })),
      { header: true, delimiter: ';' }
    );
    const namePart = statusFilter ? `_${statusFilter}` : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="elhelyezettseg${namePart}.csv"`);
    return res.send('\uFEFF' + csv);
  }

  const summary = {
    total: all.length,
    placed: all.filter((r) => r.status === 'placed').length,
    partial: all.filter((r) => r.status === 'partial').length,
    unplaced: all.filter((r) => r.status === 'unplaced').length,
    units_stock: all.reduce((s, r) => s + (r.theoretical_stock || 0), 0),
    units_placed: all.reduce((s, r) => s + r.placed_qty, 0),
  };
  summary.units_missing = Math.max(summary.units_stock - summary.units_placed, 0);

  res.json({ summary, rows });
});

router.get('/movements', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = db
    .prepare(
      `SELECT m.*, p.sku, p.name FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(limit);
  res.json(rows);
});

// Teljes mozgásnapló ürítése (pl. teszteléskor felvitt adatok eltüntetésére).
// Csak magát a naplót törli — a termékeket, dobozokat és a tényleges
// raktári elhelyezéseket nem érinti.
router.delete('/movements', (req, res) => {
  const info = db.prepare(`DELETE FROM stock_movements`).run();
  res.json({ deleted: info.changes });
});

/**
 * GET /api/reports/kvikk
 * Kvikk Connect statisztika/riport: hány csomag készült, milyen állapotban,
 * futáronként, mennyi az utánvét-forgalom, napi bontás, a legutóbbi
 * sikertelen próbálkozások, és melyik importált rendeléshez nincs még Kvikk
 * címke (ez utóbbi a tömeges címkegenerálás kiindulópontja a felületen).
 *
 * Query paraméterek (opcionális): ?from=ÉÉÉÉ-HH-NN&to=ÉÉÉÉ-HH-NN - ha
 * bármelyik meg van adva, az összesítők (total/status_counts/by_courier/cod/
 * recent_failed) csak erre az időszakra vonatkoznak. A pending_orders lista
 * NEM szűrt (mindig a jelenleg címke nélküli rendeléseket mutatja).
 */
router.get('/kvikk', (req, res) => {
  // Opcionális időszak-szűrés: ?from=2026-09-01&to=2026-09-23 (mindkettő
  // "ÉÉÉÉ-HH-NN" formátumban, mindkét határ zárt/inkluzív). Ha egyik sincs
  // megadva, a teljes eddigi adatra összesít (ez marad az alapértelmezett,
  // visszafelé kompatibilis viselkedés). A pending_orders (Kvikk címke
  // nélküli rendelések) listáját szándékosan NEM szűri az időszak - az egy
  // "mi a teendő most" lista, nem a múltbeli forgalom kimutatása.
  const { from, to } = req.query;
  const dateConditions = [];
  const dateParams = [];
  if (from) {
    dateConditions.push('created_at >= ?');
    dateParams.push(`${from} 00:00:00`);
  }
  if (to) {
    dateConditions.push('created_at <= ?');
    dateParams.push(`${to} 23:59:59`);
  }
  const dateWhere = dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : '';

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS c FROM kvikk_shipments WHERE 1=1 ${dateWhere} GROUP BY status`)
    .all(...dateParams);
  const statusCounts = { pending: 0, label_created: 0, failed: 0 };
  for (const row of byStatus) statusCounts[row.status] = row.c;
  const total = statusCounts.pending + statusCounts.label_created + statusCounts.failed;

  // A legkorábbi csomag időpontja MINDIG a teljes (szűretlen) adatra
  // vonatkozik - ez a dátumválasztók alsó határa, és arra szolgál, hogy
  // "Mind" választásnál is lássa a felhasználó, mióta gyűlik az adat.
  const earliestRow = db.prepare(`SELECT MIN(created_at) AS d FROM kvikk_shipments`).get();

  const byCourier = db
    .prepare(
      `SELECT courier, COUNT(*) AS c FROM kvikk_shipments
       WHERE status = 'label_created' ${dateWhere} GROUP BY courier ORDER BY c DESC`
    )
    .all(...dateParams);

  const codRow = db
    .prepare(
      `SELECT COALESCE(SUM(cod_amount), 0) AS s, COUNT(*) AS c FROM kvikk_shipments
       WHERE status = 'label_created' AND cod_amount > 0 ${dateWhere}`
    )
    .get(...dateParams);

  // Napi bontás: szűretlen nézetben az utolsó 14 nap (mint eddig). Ha van
  // időszak-szűrés, a kijelölt tartományt bontjuk napokra - de max. 62 napig
  // (kb. 2 hónap), hogy az oszlopdiagram olvasható maradjon; ennél hosszabb
  // tartománynál a legutóbbi 62 napot mutatjuk, és jelezzük a truncated
  // mezőben, hogy a diagram nem fedi le a teljes szűrt időszakot (a
  // fenti összesítők - total, status_counts, by_courier, cod - viszont
  // MINDIG a teljes szűrt tartományra vonatkoznak, nem csak erre a 62 napra).
  const MAX_CHART_DAYS = 62;
  let chartWhere = dateWhere;
  let chartParams = dateParams;
  let dailyTruncated = false;
  if (!from && !to) {
    chartWhere = `AND created_at >= datetime('now', '-14 days')`;
    chartParams = [];
  } else if (from && to) {
    const spanDays = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (spanDays > MAX_CHART_DAYS) {
      dailyTruncated = true;
      chartWhere = `AND created_at >= date('${to}', '-${MAX_CHART_DAYS - 1} days') AND created_at <= ?`;
      chartParams = [`${to} 23:59:59`];
    }
  }
  const dailyBreakdown = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS c
       FROM kvikk_shipments
       WHERE 1=1 ${chartWhere}
       GROUP BY day ORDER BY day`
    )
    .all(...chartParams);

  const recentFailed = db
    .prepare(
      `SELECT shoprenter_order_id, recipient_name, courier, error_message, updated_at
       FROM kvikk_shipments WHERE status = 'failed' ${dateWhere} ORDER BY updated_at DESC LIMIT 20`
    )
    .all(...dateParams);

  // Importált rendelések, amikhez még nincs Kvikk csomag - ez a tömeges
  // címkegenerálás felülete alapja. Jelöljük, hogy az adatok alapján
  // valószínűsíthetően automatizálható-e (van cím+telefon+súly+alapértelmezett
  // futár), hogy a felület előre megmutathassa, mit érdemes kijelölni.
  const pendingOrders = db
    .prepare(
      `SELECT o.id, o.shoprenter_order_id, o.customer_name, o.shipping_method_text,
              o.recipient_phone, o.address_zip, o.address_city, o.address_street,
              o.gross_total, o.picked_at, o.imported_at,
              (SELECT COUNT(*) FROM shoprenter_order_items i WHERE i.order_id = o.id) AS item_count
       FROM shoprenter_orders o
       WHERE NOT EXISTS (SELECT 1 FROM kvikk_shipments s WHERE s.shoprenter_order_id = o.shoprenter_order_id)
       ORDER BY o.imported_at DESC`
    )
    .all();

  const preferenceRows = db.prepare(`SELECT shipping_method_text FROM kvikk_courier_preferences`).all();
  const knownShippingMethods = new Set(preferenceRows.map((r) => r.shipping_method_text));

  const pendingWithReadiness = pendingOrders.map((o) => {
    const hasAddress = !!(o.recipient_phone && o.address_zip && o.address_city && o.address_street);
    const isPickupPoint = looksLikePickupPointOrder(o.shipping_method_text);
    const hasCourierPreference = knownShippingMethods.has(o.shipping_method_text || '');
    return {
      ...o,
      bulk_ready: hasAddress && !isPickupPoint && hasCourierPreference,
      bulk_blocked_reason: isPickupPoint
        ? 'csomagpontos/automatás'
        : !hasAddress
        ? 'nincs cím/telefon (nyisd meg egyszer a Shoprenterben)'
        : !hasCourierPreference
        ? 'nincs alapértelmezett futár ehhez a szállítási módhoz'
        : null,
    };
  });

  res.json({
    total,
    data_since: earliestRow.d, // legkorábbi csomag időpontja - mindig a TELJES adatból, a dátumválasztók alsó határának
    period: { from: from || null, to: to || null }, // a ténylegesen alkalmazott szűrés visszaigazolása
    status_counts: statusCounts,
    by_courier: byCourier,
    cod: { total_amount: codRow.s, shipment_count: codRow.c },
    daily_breakdown: dailyBreakdown,
    daily_breakdown_truncated: dailyTruncated, // true, ha a szűrt időszak hosszabb, mint amit a diagram mutat
    recent_failed: recentFailed,
    pending_orders: pendingWithReadiness,
  });
});

module.exports = router;
