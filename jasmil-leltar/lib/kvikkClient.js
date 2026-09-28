const { loadConfig } = require('./kvikkConfig');

/**
 * Kvikk API kliens, a hivatalos dokumentáció alapján (https://api.kvikk.hu/docs,
 * https://support.kvikk.hu/docs/api/api-documentation - v1.1, 2026-09).
 *
 * Fontos, könnyen elrontható részletek, amikre külön figyeltünk:
 * - A súlyt GRAMMBAN kéri az API (weight), nem kg-ban - ezért a hívó oldalon
 *   (routes/kvikkShipments.js) a felhasználó által kg-ban megadott értéket
 *   *1000-rel szorozzuk, mielőtt idekerül.
 * - Kötelező mező a "value" (csomag értéke Ft-ban) és a "senderID" (a Kvikk
 *   fiókodban regisztrált feladó azonosítója) - ez utóbbit a data/kvikk-
 *   config.json senderId mezőjében kell beállítani (lásd README).
 * - A válaszban a Kvikk saját tracking száma data.trackingNumber, a futáré
 *   pedig data.accounting.courierTrackingNumber alatt van.
 * - Csomagpontos küldeménynél a deliveryPointType-ot a /delivery-points
 *   végpont válaszából kapott "type" mezőből vesszük át változtatás nélkül -
 *   nem kell kitalálnunk/felsorolnunk az egyes futárok pont-típus kódjait.
 */

const MOCK_LABEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function isMockMode() {
  const config = loadConfig();
  return config.mockMode || !config.kvikkApiKey;
}

function randomTrackingNumber() {
  const digits = Math.floor(100000000000 + Math.random() * 899999999999);
  return `M${digits}`;
}

async function kvikkFetch(path, options = {}) {
  const config = loadConfig();
  if (!config.kvikkApiBaseUrl) {
    throw new Error('A Kvikk API URL nincs beállítva (data/kvikk-config.json → kvikkApiBaseUrl).');
  }
  const response = await fetch(`${config.kvikkApiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.kvikkApiKey,
      ...(options.headers || {}),
    },
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (raw && raw.message) || `Kvikk API hiba (HTTP ${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.code = raw && raw.code;
    err.raw = raw;
    throw err;
  }
  return raw;
}

// ---------- Fiókadatok (feladók, aktív futárok) - rövid ideig gyorsítótárazva ----------

let accountDetailsCache = null;
let accountDetailsCacheAt = 0;
const ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

async function getAccountDetails({ forceRefresh = false } = {}) {
  if (isMockMode()) {
    return {
      couriers: [
        { slug: 'mpl', name: 'MPL', status: 'active' },
        { slug: 'foxpost', name: 'Foxpost', status: 'active' },
        { slug: 'packeta', name: 'Packeta', status: 'active' },
        { slug: 'gls', name: 'GLS', status: 'active' },
        { slug: 'dpd', name: 'DPD', status: 'active' },
        { slug: 'famafutar', name: 'FámaFutár', status: 'active' },
      ],
      senders: [{ name: 'Teszt feladó (MOCK)', _id: 'MOCK-SENDER-ID' }],
    };
  }

  const now = Date.now();
  if (!forceRefresh && accountDetailsCache && now - accountDetailsCacheAt < ACCOUNT_CACHE_TTL_MS) {
    return accountDetailsCache;
  }

  const raw = await kvikkFetch('/account-details');
  accountDetailsCache = raw.data;
  accountDetailsCacheAt = now;
  return accountDetailsCache;
}

// ---------- Csomag/futárcímke létrehozása ----------

/**
 * shipmentPayload mezői pontosan a Kvikk API mezőnevei szerint (lásd a fenti
 * megjegyzést): name, phone, email, courier, address/city/postcode/country
 * VAGY deliveryPointType/deliveryPointID, note, orderID, weight (gramm),
 * cod, value, senderID.
 */
async function createShipment(shipmentPayload) {
  if (isMockMode()) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      ok: true,
      trackingNumber: randomTrackingNumber(),
      courierTrackingNumber: String(Math.floor(100000000000 + Math.random() * 899999999999)),
      labelBase64: MOCK_LABEL_BASE64,
      labelDownloadLink: null,
      raw: { mock: true },
    };
  }

  const raw = await kvikkFetch('/shipment', {
    method: 'POST',
    body: JSON.stringify(shipmentPayload),
  });

  const data = raw.data || {};
  return {
    ok: true,
    trackingNumber: data.trackingNumber,
    courierTrackingNumber: data.accounting && data.accounting.courierTrackingNumber,
    labelBase64: data.label,
    labelDownloadLink: data.labelDownloadLink,
    raw,
  };
}

// ---------- Csomagpontok ----------

// A /delivery-points végpont NEM szövegesen kereshető, és KÖTELEZŐ neki a
// "type" paraméter is (a courier önmagában nem elég - üres listát ad vissza).
// Ráadásul a courier és a type nem azonos: a Packeta Z-Pontoknál például
// type=zpont, de a pont "courier" mezője "packeta". A 2026. januári
// Foxpost-Packeta összeolvadás miatt ugyanahhoz a futárválasztáshoz több
// ponttípus is tartozhat, ezért futáronként az alábbi típusokat kérdezzük le
// és fésüljük össze.
//
// Az itt szereplő típusokat valós API-válaszokkal ellenőriztük (2026-09):
// type=foxpost → 3663 db Foxpost A-BOX automata, type=zpont → 1372 db
// Packeta Z-Pont. Ha a Kvikk később új ponttípust vezet be, ezt a táblázatot
// kell bővíteni.
//
// FONTOS (2026-09-23-i javítás): az "mpl" sor korábban HIBÁS type-kódokat
// tartalmazott ("postapont", "csomagautomata", "mpl") - ezek nem léteznek a
// valós Kvikk API-ban, ezért éles (nem MOCK) üzemmódban az MPL
// csomagpont/automata keresés valószínűleg mindig üres listát adott vissza
// (a /delivery-points végpont a "type" paramétert szigorúan illeszti, nem
// enged el hibás értéket csendben). A helyes kódokat a Kvikk hivatalos
// dokumentációja (support.kvikk.hu/docs/api, 2026-09-i állapot) alapján
// pótoltuk - ELLENŐRIZD ÉLES BEÁLLÍTÁS ELŐTT a saját Kvikk fiókodban/API
// válaszban, mert ez egy korábbi (gyorsítótárazott) dokumentum-állapotból
// származik, nem élő API-hívásból lett leellenőrizve:
//   - mpl_postapont  = MPL Postapont (Coop/MOL átvevőhely)
//   - mpl_automata   = MPL Csomagautomata
//   - mpl_posta      = MPL "Postán maradó" (a csomagot egy megjelölt postán
//                       tárolják 5 napig, ott veszi át a címzett - lásd
//                       support.kvikk.hu/docs/shipments/couriers/mpl-information)
const DELIVERY_POINT_TYPES_BY_COURIER = {
  foxpost: ['foxpost', 'zpont', 'zbox'],
  packeta: ['zpont', 'zbox', 'foxpost'],
  mpl: ['mpl_postapont', 'mpl_automata', 'mpl_posta'],
  gls: ['csomagpont', 'gls'],
  dpd: ['csomagpont', 'dpd'],
};

const deliveryPointsCache = new Map(); // "courier:type" -> { points, cachedAt }
const DELIVERY_POINTS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 perc

async function getDeliveryPointsForCourierType(courier, type) {
  if (isMockMode()) {
    return [
      { id: 'MOCK-001', name: `${courier.toUpperCase()} teszt automata - Budapest`, city: 'Budapest', addr: 'Teszt utca 1.', zip: '1000', type, courier },
      { id: 'MOCK-002', name: `${courier.toUpperCase()} teszt pont - Debrecen`, city: 'Debrecen', addr: 'Minta utca 2.', zip: '4000', type, courier },
    ];
  }

  const cacheKey = `${courier}:${type}`;
  const cached = deliveryPointsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < DELIVERY_POINTS_CACHE_TTL_MS) {
    return cached.points;
  }

  const raw = await kvikkFetch(
    `/delivery-points?courier=${encodeURIComponent(courier)}&type=${encodeURIComponent(type)}`
  );
  const points = raw.data || [];
  deliveryPointsCache.set(cacheKey, { points, cachedAt: now });
  return points;
}

async function searchDeliveryPoints(courier, query) {
  if (!courier) return [];
  const types = DELIVERY_POINT_TYPES_BY_COURIER[courier] || [courier];

  // Több típus párhuzamos lekérdezése; ha egy típus hibázik vagy üres,
  // az nem akadályozza a többit.
  const results = await Promise.all(
    types.map((type) => getDeliveryPointsForCourierType(courier, type).catch(() => []))
  );
  const allPoints = results.flat();

  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();

  return allPoints
    .filter((p) => {
      const haystack = `${p.name || ''} ${p.addr || ''} ${p.city || ''} ${p.zip || ''}`.toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 25)
    .map((p) => ({
      id: p.id,
      // A csomagoló számára jól olvasható, egyértelmű megnevezés, hogy a
      // hasonló nevű pontok között is biztosan a helyeset válassza ki.
      name: `${p.name} — ${p.zip} ${p.city}, ${p.addr}`,
      type: p.type,
      courier: p.courier,
    }));
}

module.exports = {
  isMockMode,
  getAccountDetails,
  createShipment,
  searchDeliveryPoints,
};
