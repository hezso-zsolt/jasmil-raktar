const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { stringify } = require('csv-stringify/sync');
const db = require('../db/database');
const inbox = require('../lib/invoiceInbox');
const { taxKey } = require('../lib/invoiceExtract');
const { normalizeAccount } = require('../lib/payment');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 50 } });

const STATUSES = ['ellenorizendo', 'fizetendo', 'fizetve'];
const today = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function withComputed(inv) {
  return {
    ...inv,
    overdue: inv.status === 'fizetendo' && !!inv.due_date && inv.due_date < today(),
    has_file: !!inv.file_name,
    extract_warnings: inv.extract_warnings ? inv.extract_warnings.split('\n') : [],
  };
}

// ---------- Beállítások, mappa beolvasása ----------

router.get('/settings', (req, res) => {
  res.json({ ...inbox.getSettings(), last_scan: inbox.getLastScan() });
});

router.put('/settings', (req, res) => {
  try {
    res.json(inbox.saveSettings(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/scan', async (req, res) => {
  res.json(await inbox.scanInbox());
});

router.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nincs kiválasztott fájl.' });
  const result = { imported: 0, duplicates: 0, errors: [], ids: [] };
  for (const f of files) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    if (!/\.pdf$/i.test(name) && f.mimetype !== 'application/pdf') {
      result.errors.push(`${name}: csak PDF fájl tölthető fel.`);
      continue;
    }
    try {
      const { invoice, duplicate } = await inbox.importPdf(f.buffer, name, 'feltoltes');
      if (duplicate) result.duplicates++;
      else result.imported++;
      result.ids.push(invoice.id);
    } catch (e) {
      result.errors.push(`${name}: ${e.message}`);
    }
  }
  res.json(result);
});

// ---------- Szállítók ----------

router.get('/suppliers', (req, res) => {
  res.json(db.prepare(
    `SELECT s.*, COUNT(i.id) AS invoice_count FROM suppliers s
     LEFT JOIN invoices i ON i.supplier_id = s.id
     GROUP BY s.id ORDER BY s.name COLLATE NOCASE`
  ).all());
});

router.get('/categories', (req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT category FROM invoices WHERE category IS NOT NULL AND category != '' ORDER BY category`
  ).all();
  const defaults = ['Áru', 'Csomagolóanyag', 'Szállítás / futár', 'Rezsi', 'Szolgáltatás', 'Egyéb'];
  res.json([...new Set([...defaults, ...rows.map((r) => r.category)])]);
});

/** Megkeresi vagy létrehozza a szállítót (először adószám, aztán név alapján) */
function upsertSupplier(name, taxNumber, category, bankAccount) {
  if (!name) return null;
  const all = db.prepare('SELECT * FROM suppliers').all();
  let s = taxNumber ? all.find((x) => x.tax_number && taxKey(x.tax_number) === taxKey(taxNumber)) : null;
  if (!s) s = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) {
    const info = db.prepare('INSERT INTO suppliers (name, tax_number, default_category, bank_account) VALUES (?, ?, ?, ?)')
      .run(name, taxNumber || null, category || null, bankAccount || null);
    return info.lastInsertRowid;
  }
  db.prepare(`UPDATE suppliers SET name = ?, tax_number = COALESCE(tax_number, ?),
              default_category = COALESCE(?, default_category),
              bank_account = COALESCE(?, bank_account) WHERE id = ?`)
    .run(name, taxNumber || null, category || null, bankAccount || null, s.id);
  return s.id;
}

// ---------- Lista, összesítő, export ----------

function buildFilter(q) {
  const where = [];
  const params = [];
  const status = q.status || 'all';
  if (status === 'lejart') {
    where.push(`status = 'fizetendo' AND due_date IS NOT NULL AND due_date < ?`);
    params.push(today());
  } else if (STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (q.supplier_id) { where.push('supplier_id = ?'); params.push(Number(q.supplier_id)); }
  if (q.from) { where.push('issue_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('issue_date <= ?'); params.push(q.to); }
  if (q.category) { where.push('category = ?'); params.push(q.category); }
  if (q.q) {
    where.push(`(supplier_name LIKE ? OR invoice_number LIKE ? OR note LIKE ? OR original_file_name LIKE ?)`);
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const ORDER_SQL = `ORDER BY CASE status WHEN 'ellenorizendo' THEN 0 WHEN 'fizetendo' THEN 1 ELSE 2 END,
  CASE WHEN status = 'fizetendo' THEN due_date END ASC,
  COALESCE(paid_at, issue_date, created_at) DESC, id DESC`;

function sumsByCurrency(rows) {
  const out = {};
  rows.forEach((r) => { out[r.currency || 'HUF'] = (out[r.currency || 'HUF'] || 0) + (r.gross_amount || 0); });
  return out;
}

function summary() {
  const t = today();
  const all = db.prepare('SELECT status, due_date, paid_at, gross_amount, currency FROM invoices').all();
  const toPay = all.filter((r) => r.status === 'fizetendo');
  const overdue = toPay.filter((r) => r.due_date && r.due_date < t);
  const weekAhead = today(7);
  const dueSoon = toPay.filter((r) => r.due_date && r.due_date >= t && r.due_date <= weekAhead);
  const monthStart = t.slice(0, 8) + '01';
  const paidThisMonth = all.filter((r) => r.status === 'fizetve' && r.paid_at && r.paid_at >= monthStart);
  return {
    to_review: all.filter((r) => r.status === 'ellenorizendo').length,
    to_pay: { count: toPay.length, sums: sumsByCurrency(toPay) },
    overdue: { count: overdue.length, sums: sumsByCurrency(overdue) },
    due_soon: { count: dueSoon.length, sums: sumsByCurrency(dueSoon) },
    paid_this_month: { count: paidThisMonth.length, sums: sumsByCurrency(paidThisMonth) },
  };
}

router.get('/', (req, res) => {
  const { sql, params } = buildFilter(req.query);
  const rows = db.prepare(`SELECT * FROM invoices ${sql} ${ORDER_SQL}`).all(...params);
  res.json({ invoices: rows.map(withComputed), totals: sumsByCurrency(rows), summary: summary() });
});

router.get('/summary', (req, res) => res.json(summary()));

const STATUS_LABEL = { ellenorizendo: 'Ellenőrizendő', fizetendo: 'Fizetendő', fizetve: 'Kifizetve' };
const huNumber = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

router.get('/export', (req, res) => {
  const { sql, params } = buildFilter(req.query);
  const rows = db.prepare(`SELECT * FROM invoices ${sql} ${ORDER_SQL}`).all(...params).map(withComputed);
  const csv = stringify(rows.map((r) => ({
    szallito: r.supplier_name || '',
    adoszam: r.supplier_tax_number || '',
    szamlaszam: r.invoice_number || '',
    kiallitas: r.issue_date || '',
    teljesites: r.fulfillment_date || '',
    hatarido: r.due_date || '',
    netto: huNumber(r.net_amount),
    afa: huNumber(r.vat_amount),
    brutto: huNumber(r.gross_amount),
    penznem: r.currency,
    fizetesi_mod: r.payment_method || '',
    kategoria: r.category || '',
    allapot: r.overdue ? 'Lejárt' : STATUS_LABEL[r.status] || r.status,
    kifizetve: r.paid_at || '',
    megjegyzes: r.note || '',
    fajl: r.original_file_name || '',
  })), { header: true, delimiter: ';' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="szamlak_${today()}.csv"`);
  res.send('﻿' + csv);
});

// ---------- Egy számla ----------

function getInvoice(id) {
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

router.get('/:id', (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Ismeretlen számla.' });
  res.json(withComputed(inv));
});

router.get('/:id/pdf', (req, res) => {
  const inv = getInvoice(req.params.id);
  const file = inv && inbox.storedFilePath(inv);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Ehhez a számlához nincs PDF.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(inv.original_file_name || 'szamla.pdf')}`);
  res.sendFile(file);
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanBody(body) {
  const b = body || {};
  const str = (v) => (v === undefined ? undefined : (String(v ?? '').trim() || null));
  const num = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error('Az összegeknél csak számot adj meg.');
    return n;
  };
  const date = (v, label) => {
    const s = str(v);
    if (s && !DATE_RE.test(s)) throw new Error(`Hibás dátum: ${label}.`);
    return s;
  };
  const account = (v) => {
    const s = str(v);
    if (!s) return s;
    const acc = normalizeAccount(s, { strict: true });
    if (!acc) throw new Error('A bankszámlaszám hibás (ellenőrizd a számjegyeket).');
    return acc;
  };
  return {
    supplier_name: str(b.supplier_name),
    supplier_tax_number: str(b.supplier_tax_number),
    invoice_number: str(b.invoice_number),
    issue_date: date(b.issue_date, 'kiállítás'),
    fulfillment_date: date(b.fulfillment_date, 'teljesítés'),
    due_date: date(b.due_date, 'fizetési határidő'),
    net_amount: num(b.net_amount),
    vat_amount: num(b.vat_amount),
    gross_amount: num(b.gross_amount),
    currency: str(b.currency),
    payment_method: str(b.payment_method),
    bank_account: account(b.bank_account),
    category: str(b.category),
    note: str(b.note),
    status: b.status,
    paid_at: date(b.paid_at, 'fizetés napja'),
  };
}

function saveInvoice(id, body) {
  const current = id ? getInvoice(id) : null;
  const v = cleanBody(body);
  const merged = { ...(current || {}) };
  Object.entries(v).forEach(([k, val]) => { if (val !== undefined) merged[k] = val; });
  if (!merged.currency) merged.currency = 'HUF';
  if (!merged.status || merged.status === 'ellenorizendo') merged.status = current && current.status !== 'ellenorizendo' ? current.status : 'fizetendo';
  if (!STATUSES.includes(merged.status)) throw new Error('Ismeretlen állapot.');
  if (merged.status === 'fizetve' && !merged.paid_at) merged.paid_at = today();
  if (merged.status !== 'fizetve') merged.paid_at = null;
  if (!merged.supplier_name) throw new Error('Add meg a szállító nevét.');
  if (merged.gross_amount === null || merged.gross_amount === undefined) throw new Error('Add meg a bruttó összeget.');

  merged.supplier_id = upsertSupplier(merged.supplier_name, merged.supplier_tax_number, merged.category, merged.bank_account);

  const cols = ['supplier_id', 'supplier_name', 'supplier_tax_number', 'invoice_number', 'issue_date',
    'fulfillment_date', 'due_date', 'net_amount', 'vat_amount', 'gross_amount', 'currency', 'payment_method',
    'category', 'bank_account', 'note', 'status', 'paid_at'];
  const values = cols.map((c) => merged[c] ?? null);
  if (current) {
    db.prepare(`UPDATE invoices SET ${cols.map((c) => `${c} = ?`).join(', ')}, extract_warnings = NULL,
                updated_at = datetime('now') WHERE id = ?`).run(...values, current.id);
    return current.id;
  }
  const info = db.prepare(`INSERT INTO invoices (${cols.join(', ')}, source) VALUES (${cols.map(() => '?').join(', ')}, 'kezi')`)
    .run(...values);
  return info.lastInsertRowid;
}

router.post('/', (req, res) => {
  try {
    const id = db.transaction(() => saveInvoice(null, req.body))();
    res.status(201).json(withComputed(getInvoice(id)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Mentés / jóváhagyás (az "ellenőrizendő" számla ezzel lesz fizetendő vagy kifizetett)
router.put('/:id', (req, res) => {
  if (!getInvoice(req.params.id)) return res.status(404).json({ error: 'Ismeretlen számla.' });
  try {
    db.transaction(() => saveInvoice(Number(req.params.id), req.body))();
    const inv = getInvoice(req.params.id);
    const dup = inbox.findDuplicate(inv, inv.id);
    res.json({ ...withComputed(inv), duplicate_of: dup ? dup.id : null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Gyors gomb a listában: kifizetve / vissza fizetendőre
router.post('/:id/pay', (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Ismeretlen számla.' });
  if (inv.status === 'ellenorizendo') return res.status(409).json({ error: 'Előbb nézd át és mentsd el a számla adatait.' });
  const paid = req.body && req.body.paid === false ? false : true;
  const paidAt = paid ? (req.body && DATE_RE.test(req.body.paid_at || '') ? req.body.paid_at : today()) : null;
  db.prepare(`UPDATE invoices SET status = ?, paid_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(paid ? 'fizetve' : 'fizetendo', paidAt, inv.id);
  res.json(withComputed(getInvoice(inv.id)));
});

router.delete('/:id', (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Ismeretlen számla.' });
  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  const file = inbox.storedFilePath(inv);
  if (file) fs.rmSync(file, { force: true });
  res.status(204).end();
});

module.exports = router;
