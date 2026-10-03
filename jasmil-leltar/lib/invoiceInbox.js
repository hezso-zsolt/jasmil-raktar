const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/database');
const { extractInvoice, taxKey } = require('./invoiceExtract');

/**
 * Bejövő számlák beolvasása.
 *
 * - Egy beállítható mappát (alapból data/szamlak-bejovo) percenként
 *   átnézünk; minden új PDF-ből kiolvassuk az adatokat, és "ellenőrizendő"
 *   állapotú számlaként felvesszük.
 * - A PDF egy másolata a data/szamlak/<év>/ mappába kerül (ezt a napi mentés
 *   is átviszi), az eredeti fájlt pedig a figyelt mappán belüli
 *   "feldolgozott" almappába tesszük át, hogy látszódjon, mi van már kész.
 * - Ugyanazt a fájlt (tartalom szerint) kétszer nem veszünk fel.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_DIR = path.join(DATA_DIR, 'szamlak');
const DEFAULT_INBOX_DIR = path.join(DATA_DIR, 'szamlak-bejovo');
const PROCESSED_SUBDIR = 'feldolgozott';
const SCAN_INTERVAL_MS = 60 * 1000;
// Az épp letöltés alatt álló fájlt még nem bántjuk
const MIN_FILE_AGE_MS = 5 * 1000;

// ---------- Beállítások ----------

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row && row.value !== null ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

const splitList = (s) => (s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function getSettings() {
  return {
    inbox_dir: getSetting('invoice_inbox_dir', DEFAULT_INBOX_DIR),
    own_tax_numbers: splitList(getSetting('invoice_own_tax_numbers', '')),
    own_names: splitList(getSetting('invoice_own_names', 'Jasmil')),
  };
}

function saveSettings({ inbox_dir, own_tax_numbers, own_names }) {
  if (inbox_dir !== undefined) {
    const dir = String(inbox_dir || '').trim();
    if (!dir) throw new Error('Add meg a figyelt mappa útvonalát.');
    if (!path.isAbsolute(dir)) throw new Error('A mappa útvonalát teljes formában add meg (pl. C:\\Szamlak).');
    setSetting('invoice_inbox_dir', dir);
  }
  if (own_tax_numbers !== undefined) {
    setSetting('invoice_own_tax_numbers', [].concat(own_tax_numbers).join(', '));
  }
  if (own_names !== undefined) setSetting('invoice_own_names', [].concat(own_names).join(', '));
  return getSettings();
}

// ---------- Egy PDF felvétele ----------

const pad2 = (n) => String(n).padStart(2, '0');

function safeFileName(name) {
  const base = path.basename(name || 'szamla.pdf').replace(/[^\p{L}\p{N}._\- ]/gu, '_').slice(-120);
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function knownSuppliers() {
  return db.prepare('SELECT id, name, tax_number, default_category FROM suppliers').all();
}

function findDuplicate(inv, excludeId = 0) {
  if (!inv.invoice_number) return null;
  const rows = db.prepare(
    `SELECT id, supplier_name, supplier_tax_number FROM invoices
     WHERE invoice_number = ? AND id != ?`
  ).all(inv.invoice_number, excludeId);
  return rows.find((r) =>
    (inv.supplier_tax_number && r.supplier_tax_number && taxKey(r.supplier_tax_number) === taxKey(inv.supplier_tax_number))
    || (inv.supplier_name && r.supplier_name && r.supplier_name.toLowerCase() === inv.supplier_name.toLowerCase())
  ) || null;
}

/**
 * Egy PDF felvétele "ellenőrizendő" számlaként.
 * @returns {{ invoice: object|null, duplicate: boolean }}
 */
async function importPdf(buffer, originalName, source) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = db.prepare('SELECT * FROM invoices WHERE file_hash = ?').get(hash);
  if (existing) return { invoice: existing, duplicate: true };

  const settings = getSettings();
  const suppliers = knownSuppliers();
  const data = await extractInvoice(buffer, {
    ownTaxNumbers: settings.own_tax_numbers,
    ownNames: settings.own_names,
    knownSuppliers: suppliers,
  });

  const now = new Date();
  const relName = path.join(String(now.getFullYear()), `${hash.slice(0, 10)}_${safeFileName(originalName)}`);
  fs.mkdirSync(path.join(STORE_DIR, String(now.getFullYear())), { recursive: true });
  fs.writeFileSync(path.join(STORE_DIR, relName), buffer);

  const warnings = [...data.warnings];
  const dup = findDuplicate(data);
  if (dup) warnings.push(`Ugyanilyen számlaszámú számla ettől a szállítótól már szerepel a nyilvántartásban (#${dup.id}).`);

  const supplier = data.supplier_id ? suppliers.find((s) => s.id === data.supplier_id) : null;
  const info = db.prepare(
    `INSERT INTO invoices (supplier_id, supplier_name, supplier_tax_number, invoice_number, issue_date,
       fulfillment_date, due_date, net_amount, vat_amount, gross_amount, currency, payment_method,
       category, status, source, file_name, original_file_name, file_hash, extract_warnings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ellenorizendo', ?, ?, ?, ?, ?)`
  ).run(
    data.supplier_id, data.supplier_name, data.supplier_tax_number, data.invoice_number, data.issue_date,
    data.fulfillment_date, data.due_date, data.net_amount, data.vat_amount, data.gross_amount, data.currency,
    data.payment_method, supplier ? supplier.default_category : null, source,
    relName.split(path.sep).join('/'), path.basename(originalName || ''), hash,
    warnings.length ? warnings.join('\n') : null
  );
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid);
  return { invoice, duplicate: false };
}

function storedFilePath(invoice) {
  if (!invoice.file_name) return null;
  const full = path.resolve(STORE_DIR, invoice.file_name);
  // Biztonsági ellenőrzés: csak a számla-tárolón belüli fájlt adjuk ki
  if (!full.startsWith(path.resolve(STORE_DIR) + path.sep)) return null;
  return full;
}

// ---------- Mappa figyelése ----------

let scanning = null;
let lastScan = null;

function moveToProcessed(inboxDir, fileName) {
  const targetDir = path.join(inboxDir, PROCESSED_SUBDIR);
  fs.mkdirSync(targetDir, { recursive: true });
  let target = path.join(targetDir, fileName);
  if (fs.existsSync(target)) {
    const ext = path.extname(fileName);
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    target = path.join(targetDir, `${path.basename(fileName, ext)}_${stamp}${ext}`);
  }
  fs.renameSync(path.join(inboxDir, fileName), target);
}

async function doScan() {
  const { inbox_dir: inboxDir } = getSettings();
  const result = { imported: 0, duplicates: 0, errors: [], inbox_dir: inboxDir, at: new Date().toISOString() };
  try {
    fs.mkdirSync(inboxDir, { recursive: true });
  } catch (e) {
    result.errors.push(`A figyelt mappa nem érhető el (${inboxDir}): ${e.message}`);
    return result;
  }

  let entries;
  try {
    entries = fs.readdirSync(inboxDir, { withFileTypes: true });
  } catch (e) {
    result.errors.push(`A figyelt mappa nem olvasható (${inboxDir}): ${e.message}`);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
    const full = path.join(inboxDir, entry.name);
    try {
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs < MIN_FILE_AGE_MS) continue;
      const buffer = fs.readFileSync(full);
      const { duplicate } = await importPdf(buffer, entry.name, 'mappa');
      if (duplicate) result.duplicates++;
      else result.imported++;
      try {
        moveToProcessed(inboxDir, entry.name);
      } catch (e) {
        // Pl. ha a fájl épp meg van nyitva - a következő körben a lenyomat
        // alapján felismerjük, hogy már fel van véve, és akkor helyezzük át.
      }
    } catch (e) {
      result.errors.push(`${entry.name}: ${e.message}`);
    }
  }
  if (result.imported) console.log(`[számlák] ${result.imported} új számla beolvasva a(z) ${inboxDir} mappából.`);
  return result;
}

/** Egyszerre csak egy beolvasás fut; a párhuzamos kérés megvárja azt. */
function scanInbox() {
  if (!scanning) {
    scanning = doScan()
      .then((r) => { lastScan = r; return r; })
      .finally(() => { scanning = null; });
  }
  return scanning;
}

function getLastScan() {
  return lastScan;
}

function startInboxWatcher() {
  scanInbox().catch((e) => console.error('[számlák] Beolvasási hiba:', e.message));
  setInterval(() => {
    scanInbox().catch((e) => console.error('[számlák] Beolvasási hiba:', e.message));
  }, SCAN_INTERVAL_MS).unref();
}

module.exports = {
  STORE_DIR,
  DEFAULT_INBOX_DIR,
  getSettings,
  saveSettings,
  importPdf,
  findDuplicate,
  storedFilePath,
  scanInbox,
  getLastScan,
  startInboxWatcher,
};
