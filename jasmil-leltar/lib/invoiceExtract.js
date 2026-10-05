/**
 * Bejövő számla-PDF-ek adatainak kinyerése, teljesen helyben (internet és
 * külső szolgáltatás nélkül).
 *
 * A PDF-ből a pdf.js könyvtárral kiolvassuk a szövegdarabokat a pozíciójukkal
 * együtt, ezekből sorokat és "cellákat" (egymáshoz közeli szövegdarabokat)
 * építünk, majd jellemző magyar (és angol) címkék alapján keressük meg az
 * értékeket: "Számlaszám:", "Fizetési határidő", "Fizetendő" stb. Az érték
 * lehet a címke után ugyanabban a cellában, tőle jobbra ugyanabban a sorban,
 * vagy alatta ugyanabban az oszlopban (táblázatos fejléc).
 *
 * Ez szabályalapú felismerés: a szokásos számlázóprogramok (Számlázz.hu,
 * Billingo, közüzemi számlák) PDF-jein jól működik, de a kinyert adatokat
 * a felületen mindig át kell nézni. A beszkennelt (csak képet tartalmazó)
 * PDF-ekből nem tud szöveget olvasni - ezt a "warnings" listában jelzi.
 */

let pdfjsPromise = null;
function loadPdfjs() {
  // A pdf.js csak ES modulként érhető el, ezért dinamikusan töltjük be.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

const MAX_PAGES = 5;

// ---------- PDF → sorok és cellák ----------

async function readCells(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const lines = [];
  try {
    const pageCount = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
          h: Math.abs(it.transform[3]) || 10,
        }));
      lines.push(...groupIntoLines(items, p));
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

function groupIntoLines(items, page) {
  // Fentről lefelé, azon belül balról jobbra rendezve
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.4));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    // Az egymáshoz közeli darabokat egy cellába vonjuk össze; a nagyobb
    // vízszintes hézag új cellát (oszlopot) jelent.
    const cells = [];
    for (const it of row.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x2 : Infinity;
      if (last && gap < it.h * 1.2) {
        last.text += (gap > it.h * 0.15 && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        last.x2 = Math.max(last.x2, it.x + it.w);
      } else {
        cells.push({ text: it.str, x: it.x, x2: it.x + it.w });
      }
    }
    cells.forEach((c) => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
    return { page, y: row.y, cells, text: cells.map((c) => c.text).join('   ') };
  });
}

// ---------- Értékfelismerők ----------

const HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július',
  'augusztus', 'szeptember', 'október', 'november', 'december'];

const pad2 = (n) => String(n).padStart(2, '0');
function validDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseDate(text) {
  if (!text) return null;
  let m = text.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) return validDate(m[1], m[2], m[3]);
  m = text.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(20\d{2})/);
  if (m) return validDate(m[3], m[2], m[1]);
  m = text.toLowerCase().match(/(20\d{2})\.?\s*([a-záéíóöőúüű]+)\.?\s*(\d{1,2})/);
  if (m) {
    const month = HU_MONTHS.findIndex((name) => name.startsWith(m[2].slice(0, 3)));
    if (month >= 0) return validDate(m[1], month + 1, m[3]);
  }
  return null;
}

/** "12 700,50" / "12.700" / "1,200.00" / "9990" → szám */
function normalizeNumber(raw) {
  let s = raw.replace(/[\s\u00a0]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Amelyik később jön, az a tizedesjel
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    // "9.990" vagy "1.234.567" → ezres elválasztó; "12.5" → tizedes
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_RE = /(?<![\d.,\-/])-?\d{1,3}(?:[ \u00a0.]\d{3})+(?:,\d{1,2})?(?![\d%])|(?<![\d.,\-/])-?\d+(?:[.,]\d{1,2})?(?![\d%.,\-/])/g;

/** Egy szövegben található összegek (dátumokat, százalékokat kihagyva) */
function findAmounts(text) {
  if (!text) return [];
  // A dátumokat és adószámokat előbb kitakarjuk, hogy ne olvassuk őket összegnek
  const masked = text
    .replace(/20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\.?/g, ' ')
    .replace(/\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*20\d{2}/g, ' ')
    .replace(/\d{8}-\d-\d{2}/g, ' ')
    .replace(/\d+\s*%/g, ' ');
  const out = [];
  for (const m of masked.matchAll(AMOUNT_RE)) {
    const n = normalizeNumber(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

function parseLastAmount(text) {
  const all = findAmounts(text);
  return all.length ? all[all.length - 1] : null;
}

const LABEL_WORDS = /^(eladó|vevő|szállító|kibocsátó|seller|buyer|supplier|számlaszám|sorszám|invoice)(?![a-záéíóöőúüű])/i;

function parseInvoiceNumber(text) {
  if (!text) return null;
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(/^[:#.\s]+|[,;:.]+$/g, '');
    if (tok.length < 3 || tok.length > 40) continue;
    if (!/\d/.test(tok) || LABEL_WORDS.test(tok)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-/._]*$/.test(tok)) continue;
    if (parseDate(tok) && /^\d/.test(tok)) continue; // egy dátum nem számlaszám
    return tok;
  }
  return null;
}

const COMPANY_SUFFIX = /(?<![a-záéíóöőúüű])(kft|bt|zrt|nyrt|kkt|e\.?\s?v\.|egyéni vállalkozó|ltd|gmbh|s\.r\.o|sp\.? z o\.?o|srl|inc|llc)(?![a-záéíóöőúüű])\.?/i;

function parseName(text) {
  if (!text) return null;
  let s = text.replace(/^[\s:/\-–]+/, '');
  // "Seller / Eladó: Valami Kft." → a második címkeszót is levesszük
  while (LABEL_WORDS.test(s)) s = s.replace(LABEL_WORDS, '').replace(/^[\s:/\-–]+/, '');
  s = s.trim();
  if (s.length < 2 || !/[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{2}/.test(s)) return null;
  if (/^(adószám|adoszam|cím|tel|e-?mail|bank|vat|tax|irsz)/i.test(s)) return null;
  if (/^\d{4}\s/.test(s)) return null; // irányítószámmal kezdődő cím
  return s.length > 120 ? s.slice(0, 120) : s;
}

// ---------- Címke alapú keresés ----------

const BEFORE = '(?<![a-záéíóöőúüű])';

function labelRe(body) {
  return new RegExp(BEFORE + '(?:' + body + ')', 'i');
}

const LABELS = {
  invoiceNumber: labelRe('számla\\s*(?:sorszáma|száma|szám)|sorszám|bizonylatszám|invoice\\s*(?:no\\.?|number|#)'),
  issueDate: labelRe('számla\\s*kelte|kiállítás\\s*(?:dátuma|kelte|napja)?|kiállítva|kelte|kelt|számla\\s*dátuma|issue\\s*date|invoice\\s*date|date\\s*of\\s*issue'),
  fulfillmentDate: labelRe('teljesítés(?:i)?\\s*(?:dátuma|időpontja|időpont|napja|ideje)?|delivery\\s*date|date\\s*of\\s*supply'),
  dueDate: labelRe('fizetési\\s*határid[őo]|esedékesség(?:\\s*dátuma|\\s*napja)?|határid[őo]|due\\s*date|payment\\s*due'),
  gross: labelRe('fizetendő(?:\\s*összeg)?|bruttó\\s*végösszeg|végösszeg|bruttó\\s*összesen|összesen\\s*bruttó|bruttó\\s*összeg|számla\\s*összege|total\\s*(?:amount|due|payable)?(?!\\s*net)|amount\\s*due|grand\\s*total'),
  net: labelRe('nettó\\s*(?:összesen|érték\\s*összesen|végösszeg|összeg)|összesen\\s*nettó|total\\s*net|net\\s*total|net\\s*amount'),
  vat: labelRe('áfa\\s*(?:összesen|összeg|érték(?:\\s*összesen)?|tartalom)|összes\\s*áfa|vat\\s*(?:total|amount)|vat\\s*\\d+\\s*%|total\\s*vat'),
  paymentMethod: labelRe('fizetési\\s*mód|fizetés\\s*módja|payment(?:\\s*method)?'),
  supplier: labelRe('eladó|szállító(?![a-záéíóöőúüű])|kibocsátó|számlakibocsátó|szolgáltató(?![a-záéíóöőúüű])|seller|supplier|vendor'),
  buyer: labelRe('vevő|megrendelő|előfizető|buyer|customer|bill\\s*to'),
};

/**
 * Megkeresi a címkét, és visszaadja a hozzá tartozó, a parse() által
 * elfogadott első értéket: a címke után ugyanabban a cellában, a sorban
 * jobbra, végül a következő pár sorban a címke oszlopában.
 */
function findByLabel(lines, label, parse, { below = 3, lastOnLine = false } = {}) {
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.cells.length; ci++) {
      const cell = line.cells[ci];
      const m = cell.text.match(label);
      if (!m) continue;
      const rest = cell.text.slice(m.index + m[0].length);
      const sameLine = [rest, ...line.cells.slice(ci + 1).map((c) => c.text)];
      if (lastOnLine) {
        const v = parse(sameLine.join('   '));
        if (v !== null && v !== undefined) return v;
      } else {
        for (const t of sameLine) {
          const v = parse(t);
          if (v !== null && v !== undefined) return v;
        }
      }
      // Alatta, ugyanabban az oszlopban
      for (let k = 1; k <= below && li + k < lines.length; k++) {
        const next = lines[li + k];
        if (next.page !== line.page) break;
        const under = next.cells.find((c) => c.x < cell.x2 + 8 && c.x2 > cell.x - 8);
        if (!under) continue;
        const v = parse(under.text);
        if (v !== null && v !== undefined) return v;
        break; // az első alatta lévő cella nem értelmezhető → nem keresünk tovább
      }
    }
  }
  return null;
}

// ---------- Adószámok, felek ----------

const HU_TAX_RE = /\b(\d{8})-(\d)-(\d{2})\b/g;
const EU_VAT_RE = /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)\s?([0-9A-Z]{8,12})\b/g;

/** Összehasonlításhoz: magyar adószámnál a törzsszám (első 8 számjegy) számít */
function taxKey(tax) {
  if (!tax) return '';
  const s = String(tax).toUpperCase().replace(/\s/g, '');
  let m = s.match(/^(\d{8})-\d-\d{2}$/);
  if (m) return m[1];
  m = s.match(/^HU(\d{8})$/);
  if (m) return m[1];
  return s;
}

function findTaxNumbers(lines, buyerZones) {
  const found = [];
  lines.forEach((line, li) => {
    line.cells.forEach((cell) => {
      const isBuyerCell = /vevő|buyer|customer|előfizető|megrendelő/i.test(cell.text)
        || buyerZones.some((z) => li > z.line && li <= z.line + 8 && line.page === z.page && cell.x < z.x2 && cell.x2 > z.x);
      for (const m of cell.text.matchAll(HU_TAX_RE)) found.push({ tax: m[0], buyer: isBuyerCell, line: li, cell });
      for (const m of cell.text.matchAll(EU_VAT_RE)) found.push({ tax: m[1] + m[2], buyer: isBuyerCell, line: li, cell });
    });
  });
  return found;
}

/** A "Vevő" címke alatti oszlop - ami ott van, az a vevő (vagyis mi) adata */
function findBuyerZones(lines) {
  const zones = [];
  lines.forEach((line, li) => {
    line.cells.forEach((cell, ci) => {
      if (!LABELS.buyer.test(cell.text) || cell.text.length > 40) return;
      const nextCell = line.cells[ci + 1];
      zones.push({ line: li, page: line.page, x: cell.x - 8, x2: nextCell ? nextCell.x - 4 : Infinity });
    });
  });
  return zones;
}

function cellsInColumnBelow(lines, li, cell, count) {
  const out = [];
  for (let k = 1; k <= count && li + k < lines.length; k++) {
    const next = lines[li + k];
    if (next.page !== lines[li].page) break;
    const under = next.cells.find((c) => c.x < cell.x2 + 8 && c.x2 > cell.x - 8);
    if (under) out.push(under);
  }
  return out;
}

function isOwn(text, ownNames) {
  const t = (text || '').toLowerCase();
  return ownNames.some((n) => n && t.includes(n.toLowerCase()));
}

function findSupplierName(lines, supplierTax, ownNames) {
  // 1) "Eladó" / "Szállító" címke után vagy alatta
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.cells.length; ci++) {
      const cell = line.cells[ci];
      const m = cell.text.match(LABELS.supplier);
      if (!m || m.index > 12) continue;
      const rest = parseName(cell.text.slice(m.index + m[0].length));
      if (rest && !isOwn(rest, ownNames)) return rest;
      for (const under of cellsInColumnBelow(lines, li, cell, 2)) {
        const name = parseName(under.text);
        if (name && !isOwn(name, ownNames)) return name;
      }
    }
  }
  // 2) Az eladó adószáma fölötti cellák közül a cégformát tartalmazó
  if (supplierTax) {
    const { line: li, cell } = supplierTax;
    for (let k = 0; k <= 5 && li - k >= 0; k++) {
      const up = lines[li - k].cells.find((c) => c.x < cell.x2 + 8 && c.x2 > cell.x - 8);
      if (up && COMPANY_SUFFIX.test(up.text) && !isOwn(up.text, ownNames)) {
        const name = parseName(up.text.replace(/adószám.*$/i, ''));
        if (name) return name;
      }
    }
  }
  // 3) Bárhol a dokumentum elején egy cégnév, ami nem a miénk
  for (const line of lines.slice(0, 25)) {
    for (const cell of line.cells) {
      if (COMPANY_SUFFIX.test(cell.text) && !isOwn(cell.text, ownNames) && !/vevő|buyer/i.test(cell.text)) {
        const name = parseName(cell.text.split(/,|adószám/i)[0]);
        if (name) return name;
      }
    }
  }
  return null;
}

// ---------- Fizetési mód, pénznem ----------

const PAYMENT_METHODS = [
  [/csoportos\s*beszedés/i, 'Csoportos beszedés'],
  [/utánvét/i, 'Utánvét'],
  [/bankkártya|kártyás|card/i, 'Bankkártya'],
  [/készpénz|cash/i, 'Készpénz'],
  [/átutalás|transfer|utalás/i, 'Átutalás'],
  [/paypal/i, 'PayPal'],
];

function parsePaymentMethod(text) {
  if (!text) return null;
  for (const [re, name] of PAYMENT_METHODS) if (re.test(text)) return name;
  return null;
}

function detectCurrency(fullText) {
  const counts = {
    EUR: (fullText.match(/\bEUR\b|€/g) || []).length,
    USD: (fullText.match(/\bUSD\b|\$/g) || []).length,
    HUF: (fullText.match(/\bHUF\b|\bFt\b|forint/gi) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'HUF';
}

// ---------- Összegek egyeztetése ----------

const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

/**
 * Az "Összesen: nettó áfa bruttó" sorból a hármas, ahol nettó + áfa = bruttó.
 * Az "Összesen" / "Total" feliratú sorok előnyt élveznek (onTotalLine); ha
 * több ilyen van (pl. tételsor-összesítő és ÁFA-összesítő), a legnagyobb.
 */
function findTotalsTriple(lines) {
  let best = null;
  lines.forEach((line) => {
    const nums = findAmounts(line.text);
    if (nums.length < 3) return;
    const onTotalLine = /összesen|total|mindösszesen|végösszeg/i.test(line.text);
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        for (let k = j + 1; k < nums.length; k++) {
          const [n, v, g] = [nums[i], nums[j], nums[k]];
          // Itt szigorú egyezés kell: a laza tűrés véletlen hármasokat is elfogadna
          if (g > 0 && n > 0 && v >= 0 && Math.abs(n + v - g) < 0.015) {
            const score = (onTotalLine ? 1e12 : 0) + g;
            if (!best || score > best.score) best = { net: n, vat: v, gross: g, score, onTotalLine };
          }
        }
      }
    }
  });
  return best;
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Fő függvény ----------

/**
 * @param {Buffer} buffer A PDF tartalma
 * @param {{ ownTaxNumbers?: string[], ownNames?: string[], knownSuppliers?: {id:number,name:string,tax_number:string}[] }} opts
 */
async function extractInvoice(buffer, opts = {}) {
  const ownKeys = (opts.ownTaxNumbers || []).map(taxKey).filter(Boolean);
  const ownNames = opts.ownNames || [];
  const result = {
    supplier_name: null,
    supplier_tax_number: null,
    supplier_id: null,
    invoice_number: null,
    issue_date: null,
    fulfillment_date: null,
    due_date: null,
    net_amount: null,
    vat_amount: null,
    gross_amount: null,
    currency: 'HUF',
    payment_method: null,
    buyer_tax_numbers: [],
    warnings: [],
    text: '',
  };

  let lines;
  try {
    lines = await readCells(buffer);
  } catch (e) {
    result.warnings.push(`A PDF nem olvasható: ${e.message}`);
    return result;
  }
  result.text = lines.map((l) => l.text).join('\n');
  if (result.text.replace(/\s/g, '').length < 30) {
    result.warnings.push('A PDF-ben nincs olvasható szöveg (valószínűleg beszkennelt kép) - az adatokat kézzel kell kitölteni.');
    return result;
  }

  result.invoice_number = findByLabel(lines, LABELS.invoiceNumber, parseInvoiceNumber);
  result.issue_date = findByLabel(lines, LABELS.issueDate, parseDate);
  result.fulfillment_date = findByLabel(lines, LABELS.fulfillmentDate, parseDate);
  result.due_date = findByLabel(lines, LABELS.dueDate, parseDate);
  result.payment_method = findByLabel(lines, LABELS.paymentMethod, parsePaymentMethod, { below: 2 })
    || parsePaymentMethod(result.text);
  result.currency = detectCurrency(result.text);

  // Összegek. A legmegbízhatóbb az "Összesen" sor nettó + ÁFA = bruttó
  // hármasa; a címkéket ("Fizetendő:", "Nettó összesen:") csak ugyanabban a
  // sorban keressük, mert a táblázatfejlécek ("Nettó összeg (Ft)") alatt
  // egy-egy tételsor összege állna, nem a végösszeg.
  let gross = findByLabel(lines, LABELS.gross, parseLastAmount, { lastOnLine: true, below: 0 });
  let net = findByLabel(lines, LABELS.net, parseLastAmount, { lastOnLine: true, below: 0 });
  let vat = findByLabel(lines, LABELS.vat, parseLastAmount, { lastOnLine: true, below: 0 });
  const triple = findTotalsTriple(lines);
  if (triple && triple.onTotalLine) {
    net = triple.net;
    vat = triple.vat;
    // A "Fizetendő" összeg gyakran kerekítve szerepel (4 112,02 → 4 112 Ft) -
    // ilyenkor a ténylegesen fizetendő, kerekített összeget tartjuk meg.
    if (gross === null || Math.abs(gross - triple.gross) >= 1) gross = triple.gross;
  } else {
    // Felül címke, alatta érték elrendezés (pl. "Fizetendő összeg" fejléc)
    if (gross === null) gross = findByLabel(lines, LABELS.gross, parseLastAmount, { lastOnLine: true, below: 1 });
    if (net === null) net = findByLabel(lines, LABELS.net, parseLastAmount, { lastOnLine: true, below: 1 });
    if (vat === null) vat = findByLabel(lines, LABELS.vat, parseLastAmount, { lastOnLine: true, below: 1 });
    if (triple && (gross === null || close(triple.gross, gross))) {
      if (gross === null) gross = triple.gross;
      if (net === null) net = triple.net;
      if (vat === null) vat = triple.vat;
    }
  }
  if (gross === null && net !== null && vat !== null) gross = net + vat;
  if (vat === null && gross !== null && net !== null && gross >= net) vat = gross - net;
  if (net === null && gross !== null && vat !== null && gross >= vat) net = gross - vat;
  result.gross_amount = gross === null ? null : round2(gross);
  result.net_amount = net === null ? null : round2(net);
  result.vat_amount = vat === null ? null : round2(vat);
  if (net !== null && vat !== null && gross !== null && !close(net + vat, gross)) {
    result.warnings.push('A nettó + ÁFA nem egyezik a bruttó végösszeggel - ellenőrizd az összegeket.');
  }

  // Felek: a "Vevő" oszlopában vagy a saját adószámunkkal egyező adószám a miénk
  const taxes = findTaxNumbers(lines, findBuyerZones(lines));
  taxes.forEach((t) => { if (ownKeys.includes(taxKey(t.tax))) t.buyer = true; });
  result.buyer_tax_numbers = [...new Set(taxes.filter((t) => t.buyer).map((t) => t.tax))];
  const buyerKeys = result.buyer_tax_numbers.map(taxKey);
  const supplierTax = taxes.find((t) => !t.buyer && !buyerKeys.includes(taxKey(t.tax)));
  if (supplierTax) result.supplier_tax_number = supplierTax.tax;

  // Ismert szállító (korábban már jóváhagyott számlája alapján)
  const known = (opts.knownSuppliers || []).find((s) => s.tax_number && supplierTax && taxKey(s.tax_number) === taxKey(supplierTax.tax));
  if (known) {
    result.supplier_id = known.id;
    result.supplier_name = known.name;
  } else {
    result.supplier_name = findSupplierName(lines, supplierTax, ownNames);
    const byName = result.supplier_name && (opts.knownSuppliers || [])
      .find((s) => s.name.toLowerCase() === result.supplier_name.toLowerCase());
    if (byName) result.supplier_id = byName.id;
  }

  // Kártyás / készpénzes számlánál a határidő általában maga a kiállítás napja
  if (!result.due_date && ['Készpénz', 'Bankkártya'].includes(result.payment_method)) {
    result.due_date = result.issue_date;
  }

  const missing = [];
  if (!result.supplier_name) missing.push('szállító');
  if (!result.invoice_number) missing.push('számlaszám');
  if (!result.issue_date) missing.push('kiállítás dátuma');
  if (!result.due_date) missing.push('fizetési határidő');
  if (result.gross_amount === null) missing.push('bruttó összeg');
  if (missing.length) result.warnings.push(`Nem sikerült felismerni: ${missing.join(', ')}.`);

  return result;
}

module.exports = { extractInvoice, taxKey, parseDate, normalizeNumber, findAmounts };
