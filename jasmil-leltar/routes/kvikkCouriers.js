const express = require('express');
const kvikk = require('../lib/kvikkClient');
const db = require('../db/database');

const router = express.Router();

// GET /api/kvikk/couriers - a Kvikk fiókban ténylegesen aktív futárok listája
// (nem statikus, hanem élőben a Kvikk /account-details válaszából).
router.get('/', async (req, res) => {
  try {
    const account = await kvikk.getAccountDetails();
    const couriers = (account.couriers || [])
      .filter((c) => c.status === 'active')
      .map((c) => ({ code: c.slug, label: c.name }));
    res.json({ couriers });
  } catch (err) {
    res.status(502).json({ error: 'kvikk_api_error', message: err.message });
  }
});

router.get('/preference', (req, res) => {
  const text = req.query.shipping_method_text;
  if (!text) return res.json({ courier: null });
  const row = db.prepare(`SELECT courier FROM kvikk_courier_preferences WHERE shipping_method_text = ?`).get(text);
  res.json({ courier: row ? row.courier : null });
});

// GET /api/kvikk/couriers/delivery-points?courier=foxpost&q=kiskunhalas
// A Kvikk API nem tud szövegesen keresni, ezért futáronként letöltjük és
// gyorsítótárazzuk a teljes pontlistát (lásd lib/kvikkClient.js), és a
// keresést mi végezzük a letöltött adaton.
router.get('/delivery-points', async (req, res) => {
  const { courier, q } = req.query;
  if (!courier) {
    return res.status(400).json({ error: 'validation_error', message: 'A "courier" paraméter kötelező.' });
  }
  try {
    const points = await kvikk.searchDeliveryPoints(courier, q || '');
    res.json({ points });
  } catch (err) {
    res.status(502).json({ error: 'kvikk_api_error', message: err.message });
  }
});

module.exports = router;
