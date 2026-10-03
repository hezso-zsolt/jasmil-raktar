const fs = require('fs');
const path = require('path');
const db = require('../db/database');

/**
 * Automatikus napi mentés a data/mentesek/ mappába.
 *
 * Az adatbázis WAL módban fut, ezért futás közben NEM elég a jasmil.db fájlt
 * egyszerűen átmásolni (a legfrissebb adatok egy része a -wal fájlban van, és
 * a kettő másolás közben elcsúszhat). Ehelyett a SQLite "VACUUM INTO"
 * parancsával készítünk egy önálló, mindig konzisztens másolatot, amit egy
 * külső mentőprogram (pl. Synology Drive Client) nyugodtan átvihet a NAS-ra.
 *
 * Minden mentés egy külön, dátummal elnevezett almappa:
 *   data/mentesek/2026-10-03_0300/jasmil.db
 *   data/mentesek/2026-10-03_0300/kvikk-config.json
 * A legutóbbi KEEP_COUNT mentést tartjuk meg, a régebbieket töröljük.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.JASMIL_BACKUP_DIR || path.join(DATA_DIR, 'mentesek');
const KEEP_COUNT = 14;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(e.name)
      && fs.existsSync(path.join(BACKUP_DIR, e.name, 'jasmil.db')))
    .map((e) => e.name)
    .sort();
}

function lastBackupTime() {
  const backups = listBackups();
  if (!backups.length) return null;
  return fs.statSync(path.join(BACKUP_DIR, backups[backups.length - 1], 'jasmil.db')).mtime;
}

function createBackup() {
  const name = stamp(new Date());
  const target = path.join(BACKUP_DIR, name);
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  // Ideiglenes mappába mentünk, és csak a végén nevezzük át: így a NAS-ra
  // szinkronizáló program sosem lát félkész mentést.
  const dbFile = path.join(tmp, 'jasmil.db');
  db.prepare('VACUUM INTO ?').run(dbFile);
  const configFile = path.join(DATA_DIR, 'kvikk-config.json');
  if (fs.existsSync(configFile)) fs.copyFileSync(configFile, path.join(tmp, 'kvikk-config.json'));

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  mirrorInvoicePdfs();

  const backups = listBackups();
  backups.slice(0, Math.max(0, backups.length - KEEP_COUNT)).forEach((old) => {
    fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  });
  return target;
}

/**
 * A bejövő számlák PDF-jei (data/szamlak/) nem kerülnek bele minden napi
 * mentésbe (14 példányban feleslegesen sok helyet foglalnának), hanem egy
 * közös data/mentesek/szamla-pdfek/ mappába másoljuk át azokat, amik ott még
 * nincsenek meg. Így a NAS-ra is egyszer jutnak el. Törölt számla PDF-je a
 * mentésből nem törlődik.
 */
const INVOICE_DIR = path.join(DATA_DIR, 'szamlak');
const INVOICE_MIRROR_DIR = path.join(BACKUP_DIR, 'szamla-pdfek');

function mirrorInvoicePdfs(src = INVOICE_DIR, dest = INVOICE_MIRROR_DIR) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) mirrorInvoicePdfs(from, to);
    else if (entry.isFile() && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function backupIfDue() {
  const last = lastBackupTime();
  if (last && Date.now() - last.getTime() < BACKUP_INTERVAL_MS) return;
  try {
    const target = createBackup();
    console.log(`[mentés] Elkészült: ${target}`);
  } catch (e) {
    console.error('[mentés] Nem sikerült elkészíteni a mentést:', e.message);
  }
}

// Induláskor, majd óránként megnézzük, eltelt-e 24 óra az utolsó mentés óta.
// Így akkor is lesz napi mentés, ha a gép közben alvó módban volt vagy
// újraindult.
function startBackupSchedule() {
  backupIfDue();
  setInterval(backupIfDue, CHECK_INTERVAL_MS).unref();
}

module.exports = { BACKUP_DIR, createBackup, listBackups, startBackupSchedule };
