const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// A Node.js beépített SQLite modulját használjuk (node:sqlite), hogy ne legyen
// szükség semmilyen natív fordításra (node-gyp / Visual Studio Build Tools)
// telepítésekor Windows-on. Node.js 22.5+ verziótól elérhető.

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'jasmil.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

/**
 * Könnyű "migráció": ha egy már létező adatbázisban (pl. egy korábbi
 * verzióból) hiányzik egy oszlop, amit a schema.sql egy újabb verziója
 * bevezetett, itt pótoljuk - a "CREATE TABLE IF NOT EXISTS" ugyanis egy már
 * létező táblát NEM egészít ki új oszlopokkal, csak vadonatúj táblánál fut le.
 * Ez teszi lehetővé, hogy a leltár- és a Kvikk-adatok elvesztése nélkül
 * lehessen frissíteni egy már használt telepítést.
 */
function ensureColumn(table, column, definitionSql) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = existing.some((col) => col.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`);
    console.log(`[db migráció] Hozzáadva a hiányzó oszlop: ${table}.${column}`);
  }
}

ensureColumn('kvikk_shipments', 'package_value', 'REAL');
ensureColumn('kvikk_shipments', 'pickup_point_type', 'TEXT');
// Termék tömegek a pontos csomagsúly-számításhoz (grammban).
ensureColumn('products', 'weight_g', 'REAL');
// Rendeléshez könyvelt készletcsökkentés időpontja (NULL = még nincs könyvelve).
ensureColumn('shoprenter_orders', 'stock_deducted_at', 'TEXT');
// Címzett/szállítási adatok - a tömeges Kvikk-címkegeneráláshoz szükségesek,
// hogy ne kelljen minden rendeléshez egyenként megnyitni a Shoprenter oldalát.
ensureColumn('shoprenter_orders', 'recipient_phone', 'TEXT');
ensureColumn('shoprenter_orders', 'recipient_email', 'TEXT');
ensureColumn('shoprenter_orders', 'address_zip', 'TEXT');
ensureColumn('shoprenter_orders', 'address_city', 'TEXT');
ensureColumn('shoprenter_orders', 'address_street', 'TEXT');
ensureColumn('shoprenter_orders', 'address_country', 'TEXT');
ensureColumn('shoprenter_orders', 'cod_amount', 'REAL');

// Kis "polyfill", hogy a routes/ fájlokban használt better-sqlite3-stílusú
// db.transaction(fn) API tovább működjön, csak sima BEGIN/COMMIT/ROLLBACK-kal.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        /* ha a tranzakció már úgyis lezárult, nincs teendő */
      }
      throw e;
    }
  };
};

module.exports = db;
