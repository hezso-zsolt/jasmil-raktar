const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * A Kvikk integráció beállításait egy egyszerű JSON fájlban tároljuk
 * (data/kvikk-config.json), ugyanabban a szellemben, ahogy a leltár app is
 * a data/ mappában tartja az SQLite fájlt - nincs szükség .env-hez dotenv
 * csomagra, sem semmilyen extra npm függőségre.
 *
 * Első induláskor, ha a fájl még nem létezik, a rendszer automatikusan
 * generál egy véletlenszerű extensionToken-t, és kiírja a terminálra -
 * ezt kell majd bemásolni a Chrome-bővítmény beállításaiba.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'kvikk-config.json');

const DEFAULTS = {
  extensionToken: null, // első indításkor generálódik
  mockMode: true,
  kvikkApiBaseUrl: 'https://api.kvikk.hu/v1',
  kvikkApiKey: '',
  senderId: '', // a Kvikk /account-details válaszában lévő senders[]._id értéke
  webhookSecret: '',
};

function loadConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    const initial = { ...DEFAULTS, extensionToken: crypto.randomBytes(24).toString('hex') };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const merged = { ...DEFAULTS, ...stored };

  // Ha valamiért törölték a tokent a fájlból, generálunk egy újat és visszaírjuk.
  if (!merged.extensionToken) {
    merged.extensionToken = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  }

  return merged;
}

function saveConfig(partial) {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
