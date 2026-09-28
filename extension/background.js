/**
 * Jasmil – Kvikk Connect – background service worker
 *
 * Ez a réteg felel a backend hívásokért. Azért itt (és nem közvetlenül a
 * content scriptben) történik a fetch, mert:
 *  - a beállítások (backend URL, token) itt egy helyen kezelhetők,
 *  - a content script így nem tartalmaz semmilyen titkot vagy kapcsolati adatot.
 *
 * A tényleges Kvikk API-kulcs SOSEM kerül ide vagy a Chrome storage-ba -
 * az kizárólag a szerveren (a Jasmil leltár app data/kvikk-config.json
 * fájljában) tárolódik.
 */

const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:3000",
  extensionToken: "",
  defaultWeightKg: 1.0,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function apiFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.backendUrl) {
    throw new Error("Nincs beállítva backend URL. Nyisd meg az extension beállításait.");
  }
  if (!settings.extensionToken) {
    throw new Error("Nincs beállítva extension token. Nyisd meg az extension beállításait.");
  }

  const response = await fetch(`${settings.backendUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.extensionToken}`,
      ...(options.headers || {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    /* üres válasz törzs, pl. 404-nél is előfordulhat */
  }

  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

const handlers = {
  async CHECK_EXISTING_SHIPMENT({ orderId }) {
    try {
      const res = await apiFetch(`/api/kvikk/shipments/${encodeURIComponent(orderId)}`);
      return res;
    } catch (err) {
      if (err.status === 404) return { shipment: null };
      throw err;
    }
  },

  async GET_COURIERS() {
    return apiFetch("/api/kvikk/couriers");
  },

  async GET_COURIER_PREFERENCE({ shippingMethodText }) {
    return apiFetch(`/api/kvikk/couriers/preference?shipping_method_text=${encodeURIComponent(shippingMethodText || "")}`);
  },

  async SEARCH_PICKUP_POINTS({ q, courier }) {
    return apiFetch(
      `/api/kvikk/couriers/delivery-points?courier=${encodeURIComponent(courier || "")}&q=${encodeURIComponent(q || "")}`
    );
  },

  async CREATE_SHIPMENT(payload) {
    return apiFetch("/api/kvikk/shipments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // A leltár app rendelés-/komissiózás végpontjai. Ezek a leltár alkalmazás
  // saját (LAN-on belül nyitott) végpontjai, nem a Kvikk-költséggel járó
  // műveletek - de a token küldése nem zavar, így egységes marad a hívás.
  async IMPORT_ORDER(payload) {
    return apiFetch("/api/orders/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async CALCULATE_WEIGHT(payload) {
    return apiFetch("/api/orders/calculate-weight", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Ismeretlen üzenettípus: ${message.type}` });
    return false;
  }

  handler(message.payload || {})
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true; // aszinkron válasz jelzése
});
