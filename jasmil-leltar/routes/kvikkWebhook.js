const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { loadConfig } = require('../lib/kvikkConfig');

const router = express.Router();

/**
 * Kvikk webhook fogadó, a hivatalos dokumentáció alapján
 * (https://support.kvikk.hu/docs/webhooks/):
 *
 * - Fejlécek: "kvikk-webhook-event" (esemény típusa: dispatched | shipped |
 *   delivered | returned) és "kvikk-webhook-signature" (HMAC-SHA256 hex).
 * - Az aláírást a Kvikk a JSON.stringify(req.body) eredményén számolja -
 *   ezért itt is a feldolgozott (parse-olt, majd újra JSON.stringify-olt)
 *   body-t hash-eljük, pontosan ahogy a Kvikk saját Node.js példakódja is
 *   teszi, NEM a nyers byte-okat.
 * - A payload gyökerében van a "trackingNumber" (a Kvikk saját tracking
 *   száma - ugyanaz, amit a /shipment válaszból elmentettünk).
 *
 * A webhookot magában a Kvikk App-ban (app.kvikk.hu → Beállítások) kell
 * regisztrálni erre az URL-re: <backend URL>/api/kvikk/webhook
 * A regisztráláskor kapott titkos kulcsot a data/kvikk-config.json
 * webhookSecret mezőjébe kell bemásolni.
 */
router.post('/', (req, res) => {
  const config = loadConfig();
  if (!config.webhookSecret) {
    console.warn('Kvikk webhookSecret nincs beállítva (data/kvikk-config.json) - webhook elutasítva.');
    return res.status(500).send('webhook not configured');
  }

  const receivedSignature = req.headers['kvikk-webhook-signature'];
  const eventType = req.headers['kvikk-webhook-event'];

  const payloadString = JSON.stringify(req.body);
  const expectedSignature = crypto.createHmac('sha256', config.webhookSecret).update(payloadString).digest('hex');

  if (!receivedSignature || receivedSignature !== expectedSignature) {
    return res.status(401).send('invalid signature');
  }

  const trackingNumber = req.body && req.body.trackingNumber;
  if (trackingNumber && eventType) {
    const info = db
      .prepare(`UPDATE kvikk_shipments SET status = ?, updated_at = datetime('now') WHERE kvikk_tracking_number = ?`)
      .run(eventType, trackingNumber);
    if (info.changes === 0) {
      console.warn(`Kvikk webhook: ismeretlen tracking szám (${trackingNumber}), nincs ilyen csomag nálunk.`);
    } else {
      console.log(`Kvikk webhook: ${trackingNumber} → ${eventType}`);
    }
  }

  res.status(200).send('ok');
});

module.exports = router;
