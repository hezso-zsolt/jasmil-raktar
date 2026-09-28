const express = require('express');
const db = require('../db/database');
const kvikk = require('../lib/kvikkClient');
const { loadConfig } = require('../lib/kvikkConfig');
const { looksLikePickupPointOrder } = require('../lib/pickupPointDetection');

const router = express.Router();

function validatePayload(body) {
  const errors = [];
  if (!body.shoprenter_order_id) errors.push('Hiányzik a rendelés azonosítója (shoprenter_order_id).');
  if (!body.courier) errors.push('Nincs kiválasztva Kvikk futár.');
  if (!body.recipient_phone) errors.push('Hiányzó telefonszám: a rendeléshez nem található telefonszám.');
  if (body.weight_kg === undefined || body.weight_kg === null || Number(body.weight_kg) <= 0) {
    errors.push('Hiányzó súly: a csomag súlya nincs megadva.');
  }
  if (body.package_value === undefined || body.package_value === null || Number(body.package_value) < 0) {
    errors.push('Hiányzik a csomag értéke (a Kvikk ezt kötelezően kéri).');
  }
  if (body.pickup_point_id) {
    if (!body.pickup_point_type) errors.push('Csomagpontos küldeménynél hiányzik a pont típusa (belső hiba, jelezd a fejlesztőnek).');
  } else {
    const address = body.address || {};
    if (!address.zip || !address.city || !address.street) errors.push('Hiányos szállítási cím.');
  }
  return errors;
}

function toApiShape(row) {
  return {
    id: row.id,
    shoprenter_order_id: row.shoprenter_order_id,
    recipient_name: row.recipient_name,
    recipient_phone: row.recipient_phone,
    recipient_email: row.recipient_email,
    address: { zip: row.address_zip, city: row.address_city, street: row.address_street, country: row.address_country },
    cod_amount: row.cod_amount,
    cod_currency: row.cod_currency,
    package_value: row.package_value,
    weight_kg: row.weight_kg,
    courier: row.courier,
    pickup_point_id: row.pickup_point_id,
    pickup_point_type: row.pickup_point_type,
    shipping_method_text: row.shipping_method_text,
    status: row.status,
    kvikk_tracking_number: row.kvikk_tracking_number,
    courier_tracking_number: row.courier_tracking_number,
    label_base64: row.label_base64,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/labels-zip', async (req, res) => {
  const idsParam = req.query.order_ids;
  const orderIds = (idsParam ? String(idsParam).split(',') : []).map((s) => s.trim()).filter(Boolean);
  if (!orderIds.length) {
    return res.status(400).json({ error: 'Hiányzik az "order_ids" paraméter (vesszővel elválasztott lista).' });
  }

  const placeholders = orderIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT shoprenter_order_id, label_base64 FROM kvikk_shipments
       WHERE shoprenter_order_id IN (${placeholders}) AND label_base64 IS NOT NULL`
    )
    .all(...orderIds);

  if (!rows.length) {
    return res.status(404).json({ error: 'Egyik kiválasztott rendeléshez sincs letölthető címke.' });
  }

  const archiver = require('archiver');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="kvikk-cimkek.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    // Ha már elkezdtük streamelni a választ, a fejlécet nem lehet módosítani -
    // ilyenkor csak megszakítjuk a kapcsolatot.
    if (!res.headersSent) res.status(500);
    res.end();
    console.error('[kvikk labels-zip] hiba:', err.message);
  });
  archive.pipe(res);

  for (const row of rows) {
    archive.append(Buffer.from(row.label_base64, 'base64'), { name: `${row.shoprenter_order_id}.pdf` });
  }

  await archive.finalize();
});

// FONTOS: ennek a "/:orderId" útvonalnak a regisztrációja UTÁN kell jönnie
// minden konkrét (nem-paraméteres) GET végpontnak (pl. "/labels-zip"), mert
// az Express a route-okat regisztrálási sorrendben próbálja illeszteni - egy
// korábban regisztrált "/:orderId" elnyelne egy később jövő "/labels-zip"
// hívást is (orderId = "labels-zip" néven).
router.get('/:orderId', (req, res) => {
  const row = db.prepare(`SELECT * FROM kvikk_shipments WHERE shoprenter_order_id = ?`).get(req.params.orderId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ shipment: toApiShape(row) });
});

/**
 * A tényleges Kvikk-csomag létrehozás - kiemelve, hogy az egyenkénti (POST /)
 * és a tömeges (POST /bulk) végpont is ugyanazt a logikát használja.
 * Nem ír a res-be, hanem { httpStatus, json } alakban adja vissza az
 * eredményt, amit a hívó a saját válaszába illeszthet.
 */
async function performCreate(body) {
  const validationErrors = validatePayload(body);
  if (validationErrors.length > 0) {
    return { httpStatus: 400, json: { error: 'validation_error', messages: validationErrors } };
  }

  const existing = db
    .prepare(`SELECT * FROM kvikk_shipments WHERE shoprenter_order_id = ?`)
    .get(body.shoprenter_order_id);
  if (existing) {
    return {
      httpStatus: 200,
      json: {
        already_exists: true,
        message: 'Ehhez a rendeléshez már készült Kvikk csomag.',
        shipment: toApiShape(existing),
      },
    };
  }

  const kvikkConfig = loadConfig();
  if (!kvikkConfig.mockMode && kvikkConfig.kvikkApiKey && !kvikkConfig.senderId) {
    return {
      httpStatus: 500,
      json: {
        error: 'server_misconfigured',
        message: 'Nincs beállítva Kvikk feladó (senderId) a data/kvikk-config.json fájlban. Lásd a README "Kvikk Connect" szakaszát.',
      },
    };
  }

  let insertedId;
  try {
    const info = db
      .prepare(
        `INSERT INTO kvikk_shipments
          (shoprenter_order_id, recipient_name, recipient_phone, recipient_email,
           address_zip, address_city, address_street, address_country,
           cod_amount, cod_currency, package_value, weight_kg, courier,
           pickup_point_id, pickup_point_type, shipping_method_text, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        body.shoprenter_order_id,
        body.recipient_name || null,
        body.recipient_phone || null,
        body.recipient_email || null,
        (body.address && body.address.zip) || null,
        (body.address && body.address.city) || null,
        (body.address && body.address.street) || null,
        (body.address && body.address.country) || 'HU',
        body.cod_amount ?? 0,
        body.cod_currency || 'HUF',
        Number(body.package_value),
        Number(body.weight_kg),
        body.courier,
        body.pickup_point_id || null,
        body.pickup_point_type || null,
        body.shipping_method_text || null
      );
    insertedId = info.lastInsertRowid;
  } catch (e) {
    const row = db.prepare(`SELECT * FROM kvikk_shipments WHERE shoprenter_order_id = ?`).get(body.shoprenter_order_id);
    return {
      httpStatus: 200,
      json: {
        already_exists: true,
        message: 'Ehhez a rendeléshez már készült Kvikk csomag.',
        shipment: toApiShape(row),
      },
    };
  }

  try {
    // Kvikk API mezőnevek pontosan (lásd lib/kvikkClient.js fejléc-kommentje):
    // weight GRAMMBAN kell, cod és value Ft-ban, senderID a fiókból.
    const kvikkPayload = {
      name: body.recipient_name || '',
      phone: body.recipient_phone,
      email: body.recipient_email || '',
      courier: body.courier,
      note: body.note || '',
      orderID: body.shoprenter_order_id,
      weight: Math.round(Number(body.weight_kg) * 1000),
      cod: Number(body.cod_amount) || 0,
      value: Number(body.package_value),
      senderID: kvikkConfig.senderId,
    };

    if (body.pickup_point_id) {
      kvikkPayload.deliveryPointType = body.pickup_point_type;
      kvikkPayload.deliveryPointID = body.pickup_point_id;
    } else {
      kvikkPayload.address = body.address.street;
      kvikkPayload.city = body.address.city;
      kvikkPayload.postcode = Number(body.address.zip);
      kvikkPayload.country = body.address.country || 'HU';
    }

    const result = await kvikk.createShipment(kvikkPayload);

    db.prepare(
      `UPDATE kvikk_shipments SET
        status = 'label_created', kvikk_tracking_number = ?, courier_tracking_number = ?,
        label_base64 = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(result.trackingNumber || null, result.courierTrackingNumber || null, result.labelBase64 || null, insertedId);

    if (body.shipping_method_text) {
      db.prepare(
        `INSERT INTO kvikk_courier_preferences (shipping_method_text, courier, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(shipping_method_text) DO UPDATE SET courier = excluded.courier, updated_at = excluded.updated_at`
      ).run(body.shipping_method_text, body.courier);
    }

    const row = db.prepare(`SELECT * FROM kvikk_shipments WHERE id = ?`).get(insertedId);
    return { httpStatus: 201, json: { already_exists: false, shipment: toApiShape(row), mock_mode: kvikk.isMockMode() } };
  } catch (err) {
    db.prepare(
      `UPDATE kvikk_shipments SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err.message, insertedId);
    const row = db.prepare(`SELECT * FROM kvikk_shipments WHERE id = ?`).get(insertedId);
    return {
      httpStatus: 502,
      json: {
        error: 'kvikk_api_error',
        message: 'A Kvikk nem tudta létrehozni a csomagot.',
        detail: err.message,
        kvikk_code: err.code,
        shipment: toApiShape(row),
      },
    };
  }
}

router.post('/', async (req, res) => {
  const result = await performCreate(req.body || {});
  res.status(result.httpStatus).json(result.json);
});

// A csomagpont/automata/"postán maradó" felismerés közös helyen (lib/pickupPointDetection.js).

/**
 * A rendelés tételeinek összsúlya a leltár termékadatokból - ugyanaz a
 * logika, mint a POST /api/orders/calculate-weight, csak itt egy már
 * importált (order_id szerinti) rendelésre nézve.
 */
function calculateOrderWeightG(orderRowId) {
  const items = db
    .prepare(
      `SELECT i.qty, p.weight_g, i.sku, i.name
       FROM shoprenter_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ?`
    )
    .all(orderRowId);
  let totalG = 0;
  const missing = [];
  for (const item of items) {
    if (item.weight_g === null || item.weight_g === undefined) {
      missing.push(item.sku || item.name || '(ismeretlen tétel)');
      continue;
    }
    totalG += Number(item.weight_g) * (Number(item.qty) || 1);
  }
  return { totalG, missing };
}

/**
 * POST /api/kvikk/shipments/bulk
 * Tömeges Kvikk-címkegenerálás több, már importált (a Rendelések listáján
 * szereplő) rendeléshez egyszerre - anélkül, hogy egyenként meg kellene
 * nyitni mindegyiket a Shoprenter adminban.
 *
 * Csak azokhoz a rendelésekhez tud automatikusan címkét generálni, amikhez:
 *  - van rögzített telefonszám és teljes cím (ezt a bővítmény az adott
 *    rendelés MEGNYITÁSAKOR küldi be - ha egy rendelést még sosem nyitottak
 *    meg a Shoprenterben, ez hiányzik),
 *  - a szállítási mód szövege alapján NEM csomagpontos/automatás rendelés,
 *  - a szállítási mód szövegéhez már van korábban használt (megjegyzett)
 *    Kvikk futár - ha még sosem készült ilyen szállítási módú címke
 *    egyenként, nincs mit alapértelmezettként ajánlani,
 *  - minden tételének ismert a súlya a leltárban.
 *
 * Minden más esetben az adott rendelést kihagyja, és a válaszban pontosan
 * megindokolja miért - ezeket egyenként, a Shoprenter oldaláról kell intézni.
 */
router.post('/bulk', async (req, res) => {
  const orderIds = Array.isArray(req.body && req.body.shoprenter_order_ids) ? req.body.shoprenter_order_ids : [];
  if (!orderIds.length) {
    return res.status(400).json({ error: 'Nincs kiválasztva egyetlen rendelés sem.' });
  }

  const results = [];

  for (const shoprenterOrderId of orderIds) {
    const order = db.prepare(`SELECT * FROM shoprenter_orders WHERE shoprenter_order_id = ?`).get(shoprenterOrderId);
    if (!order) {
      results.push({ shoprenter_order_id: shoprenterOrderId, ok: false, reason: 'A rendelés nincs importálva a leltár appba.' });
      continue;
    }

    const existingShipment = db
      .prepare(`SELECT * FROM kvikk_shipments WHERE shoprenter_order_id = ?`)
      .get(shoprenterOrderId);
    if (existingShipment) {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: true,
        already_existed: true,
        shipment: toApiShape(existingShipment),
      });
      continue;
    }

    if (looksLikePickupPointOrder(order.shipping_method_text)) {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: false,
        reason: 'Csomagpontos/automatás rendelésnek tűnik - a pontot kézzel kell kiválasztani, nyisd meg egyenként.',
      });
      continue;
    }

    if (!order.recipient_phone || !order.address_zip || !order.address_city || !order.address_street) {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: false,
        reason: 'Hiányzik a telefonszám vagy a cím - nyisd meg legalább egyszer a rendelést a Shoprenterben, hogy a bővítmény beküldje ezt az adatot.',
      });
      continue;
    }

    const preference = db
      .prepare(`SELECT courier FROM kvikk_courier_preferences WHERE shipping_method_text = ?`)
      .get(order.shipping_method_text || '');
    if (!preference) {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: false,
        reason: `Nincs alapértelmezett futár a(z) "${order.shipping_method_text || 'ismeretlen'}" szállítási módhoz - készíts hozzá egyenként legalább egy címkét, utána a rendszer megjegyzi.`,
      });
      continue;
    }

    const { totalG, missing } = calculateOrderWeightG(order.id);
    if (missing.length > 0 || totalG <= 0) {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: false,
        reason: `Hiányzik a súly a leltárban ehhez: ${missing.join(', ') || 'valamelyik tételhez'}.`,
      });
      continue;
    }

    const body = {
      shoprenter_order_id: order.shoprenter_order_id,
      recipient_name: order.customer_name,
      recipient_phone: order.recipient_phone,
      recipient_email: order.recipient_email,
      address: {
        zip: order.address_zip,
        city: order.address_city,
        street: order.address_street,
        country: order.address_country || 'HU',
      },
      cod_amount: order.cod_amount || 0,
      package_value: order.gross_total || 0,
      weight_kg: totalG / 1000,
      courier: preference.courier,
      shipping_method_text: order.shipping_method_text,
    };

    const result = await performCreate(body);
    if (result.httpStatus === 201 || (result.httpStatus === 200 && result.json.already_exists)) {
      results.push({ shoprenter_order_id: shoprenterOrderId, ok: true, shipment: result.json.shipment });
    } else {
      results.push({
        shoprenter_order_id: shoprenterOrderId,
        ok: false,
        reason: result.json.message || result.json.error || 'Ismeretlen hiba a Kvikk címke létrehozásakor.',
      });
    }
  }

  res.json({
    total: results.length,
    created: results.filter((r) => r.ok && !r.already_existed).length,
    already_existed: results.filter((r) => r.ok && r.already_existed).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

module.exports = router;
