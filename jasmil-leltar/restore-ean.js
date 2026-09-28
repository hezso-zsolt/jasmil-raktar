/**
 * EAN helyreállító script
 * ------------------------
 * Visszatölti a vonalkódokat (EAN) az élő adatbázisba egy korábbi biztonsági
 * másolatból vagy egy eredeti termék-CSV-ből, CIKKSZÁM alapján párosítva.
 *
 * Csak az EAN mezőt írja - minden más adathoz (készlet, elhelyezések, súlyok,
 * rendelések, dobozok) hozzá sem nyúl.
 *
 * HASZNÁLAT (a jasmil-leltar mappában, LEÁLLÍTOTT szerver mellett):
 *
 *   Biztonsági mentésből:
 *     node restore-ean.js --from-db "C:\\utvonal\\backup\\jasmil.db"
 *
 *   Eredeti termék-CSV-ből (kell benne cikkszám és EAN oszlop):
 *     node restore-ean.js --from-csv "C:\\utvonal\\termekek.csv"
 *
 *   Próbafutás (nem ír semmit, csak megmutatja, mi történne):
 *     node restore-ean.js --from-db "...\\jasmil.db" --dry-run
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
const fromDb = argValue('--from-db');
const fromCsv = argValue('--from-csv');
const dryRun = args.includes('--dry-run');

if (!fromDb && !fromCsv) {
  console.error('Add meg a forrást: --from-db <backup jasmil.db> VAGY --from-csv <termekek.csv>');
  process.exit(1);
}

const liveDbPath = path.join(__dirname, 'data', 'jasmil.db');
if (!fs.existsSync(liveDbPath)) {
  console.error(`Nem található az élő adatbázis: ${liveDbPath}`);
  process.exit(1);
}

function isValidEan(value) {
  const v = String(value || '').trim();
  // Csak tiszta számjegysor fogadható el. Az Excel által elrontott
  // "8.60507E+12" alakot szándékosan kizárjuk, mert visszafejthetetlen.
  return /^\d{6,14}$/.test(v) ? v : null;
}

// ---- Forrás beolvasása: sku -> ean ----
const sourceMap = new Map();

if (fromDb) {
  if (!fs.existsSync(fromDb)) {
    console.error(`Nem található a megadott mentés: ${fromDb}`);
    process.exit(1);
  }
  const backup = new DatabaseSync(fromDb, { readOnly: true });

  // Az adatbázis WAL módban fut: a legfrissebb adatok egy külön
  // "<név>.db-wal" fájlban vannak, amíg a rendszer be nem olvasztja őket.
  // Ha a mentéskor csak a .db fájlt másolták, a tábla akár üres/hiányos is
  // lehet - ezt itt érthetően jelezzük ahelyett, hogy nyers SQL hibát dobnánk.
  let rows;
  try {
    rows = backup.prepare('SELECT sku, ean FROM products WHERE ean IS NOT NULL').all();
  } catch (e) {
    console.error('\n❌ A megadott mentésben nem található a "products" tábla.');
    console.error('   Ez szinte mindig azt jelenti, hogy a mentés hiányos: az adatbázis');
    console.error('   WAL módban fut, ezért a .db fájl mellé tartozik egy "-wal" fájl is.');
    console.error('\n   Mit tegyél: másold át a mentésbe a data mappa MINDEN fájlját, különösen ezeket:');
    console.error(`     ${path.basename(fromDb)}`);
    console.error(`     ${path.basename(fromDb)}-wal`);
    console.error(`     ${path.basename(fromDb)}-shm`);
    console.error('   majd futtasd újra ezt a scriptet ugyanarra a .db fájlra.\n');
    process.exit(1);
  }

  for (const r of rows) {
    const ean = isValidEan(r.ean);
    if (ean) sourceMap.set(String(r.sku).trim(), ean);
  }
  backup.close();
  console.log(`Forrás (mentés): ${rows.length} sor, ebből ${sourceMap.size} érvényes EAN.`);
}

if (fromCsv) {
  if (!fs.existsSync(fromCsv)) {
    console.error(`Nem található a megadott CSV: ${fromCsv}`);
    process.exit(1);
  }
  const { parse } = require('csv-parse/sync');
  const text = fs.readFileSync(fromCsv, 'utf8');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, delimiter, bom: true });

  const pick = (row, names) => {
    for (const key of Object.keys(row)) {
      if (names.includes(key.toLowerCase().trim())) return row[key];
    }
    return undefined;
  };

  let invalid = 0;
  for (const row of records) {
    const sku = String(pick(row, ['sku', 'cikkszam', 'cikkszám']) || '').trim();
    const eanRaw = pick(row, ['ean', 'vonalkod', 'vonalkód', 'gtin', 'barcode']);
    if (!sku) continue;
    const ean = isValidEan(eanRaw);
    if (ean) sourceMap.set(sku, ean);
    else if (eanRaw) invalid++;
  }
  console.log(`Forrás (CSV): ${records.length} sor, ${sourceMap.size} érvényes EAN.`);
  if (invalid) {
    console.log(`  ⚠️  ${invalid} sorban sérült/érvénytelen EAN volt (pl. Excel tudományos jelölés) - ezeket kihagytuk.`);
  }
}

if (!sourceMap.size) {
  console.error('A forrásban nincs egyetlen érvényes EAN sem. Nincs mit visszatölteni.');
  process.exit(1);
}

// ---- Visszatöltés ----
const db = new DatabaseSync(liveDbPath);
const products = db.prepare('SELECT id, sku, ean FROM products').all();

let restored = 0;
let alreadyOk = 0;
let notInSource = 0;
const update = db.prepare('UPDATE products SET ean = ?, updated_at = datetime(\'now\') WHERE id = ?');

for (const p of products) {
  const sourceEan = sourceMap.get(String(p.sku).trim());
  if (!sourceEan) {
    notInSource++;
    continue;
  }
  if (isValidEan(p.ean) === sourceEan) {
    alreadyOk++;
    continue;
  }
  if (!dryRun) update.run(sourceEan, p.id);
  restored++;
}

console.log('');
console.log(dryRun ? '--- PRÓBAFUTÁS (semmi nem íródott) ---' : '--- KÉSZ ---');
console.log(`  Termékek az adatbázisban:     ${products.length}`);
console.log(`  Visszaállított EAN:           ${restored}`);
console.log(`  Már helyes volt:              ${alreadyOk}`);
console.log(`  Nincs a forrásban (kihagyva): ${notInSource}`);

db.close();

if (dryRun) {
  console.log('\nHa az eredmény rendben van, futtasd újra a --dry-run kapcsoló nélkül.');
}
