const express = require('express');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const pkg = require('./package.json');

const app = express();
const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

app.use(express.json());
// Fejlesztés közben ez a belső eszköz gyakran frissül — letiltjuk a böngésző
// gyorsítótárazását a statikus fájlokon (app.js, style.css, index.html), hogy
// egy újraindítás után mindig a friss verziót töltse be a felhasználó, ne a
// böngésző cache-éből egy elavultat.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

app.use('/api/products', require('./routes/products'));
app.use('/api/boxes', require('./routes/boxes'));
app.use('/api/placements', require('./routes/placements'));
app.use('/api/inventory', require('./routes/inventory'));
// Ez a router két erőforrás-útvonalat is definiál (boxes/:id/recount/... és
// box-recounts/...), ezért gyökér szinten ('/api') van felfűzve, nem egy
// fix előtaggal, mint a többi.
app.use('/api', require('./routes/boxRecounts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/io', require('./routes/importExport'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/invoices', require('./routes/invoices'));

// --- Kvikk Connect (Shoprenter -> Kvikk futárcímke integráció) ---
// A leltár app többi végpontjával ellentétben ezeket egy tokennel védjük,
// mert valódi Kvikk-költséggel járó futárcímke-létrehozást indítanak el.
const { requireKvikkToken } = require('./lib/kvikkAuth');
app.use('/api/kvikk/shipments', requireKvikkToken, require('./routes/kvikkShipments'));
app.use('/api/kvikk/couriers', requireKvikkToken, require('./routes/kvikkCouriers'));
app.use('/api/kvikk/webhook', require('./routes/kvikkWebhook')); // saját HMAC-ellenőrzéssel, nem Bearer tokennel

// A leltár app SAJÁT felülete (pl. a "Kvikk statisztika" nézet tömeges
// címkegenerálás gombja) is hívja a fenti, tokennel védett végpontokat.
// Mivel az app többi része szándékosan nem kér hitelesítést (lásd fent),
// ugyanezen a bizalmi szinten adjuk oda neki a tokent is - aki hozzáfér
// ehhez a felülethez, úgyis hozzáférne pl. a placements/pick végponthoz is,
// ami a tényleges raktári készletet mozgatja. Ez KIZÁRÓLAG a helyi
// felületnek szól; a token ettől még kiszűri a véletlen/külső hívásokat.
app.get('/api/kvikk/internal-token', (req, res) => {
  const kvikkConfig = require('./lib/kvikkConfig').loadConfig();
  res.json({ token: kvikkConfig.extensionToken });
});

app.get('/api/health', (req, res) => {
  const kvikkConfig = require('./lib/kvikkConfig').loadConfig();
  res.json({ ok: true, mock_mode: kvikkConfig.mockMode || !kvikkConfig.kvikkApiKey });
});
app.get('/api/version', (req, res) => res.json({ version: pkg.version }));

// Minden más útvonalon az SPA index.html-jét szolgáljuk ki
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Egységes hibaválasz
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Váratlan szerverhiba történt.' });
});

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

// Önaláírt HTTPS-tanúsítvány generálása induláskor, mindig az aktuális
// hálózati IP-kre érvényesen. Erre a mobiltelefon kamerájának eléréséhez
// van szükség: a böngészők biztonsági okból csak https:// (vagy pontosan
// localhost) kapcsolaton engedik a kamerát, sima http:// LAN-címen nem.
async function generateCertificate(lanAddresses) {
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanAddresses.map((ip) => ({ type: 7, ip })),
  ];
  const attrs = [{ name: 'commonName', value: lanAddresses[0] || 'localhost' }];
  return selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
}

async function start() {
  const lanAddresses = getLanAddresses();

  http.createServer(app).listen(HTTP_PORT, '0.0.0.0');

  let httpsStarted = false;
  try {
    const pems = await generateCertificate(lanAddresses);
    https.createServer({ key: pems.private, cert: pems.cert }, app).listen(HTTPS_PORT, '0.0.0.0');
    httpsStarted = true;
  } catch (e) {
    console.error('Nem sikerült elindítani a HTTPS-szervert (a kamerás beolvasás emiatt nem lesz elérhető):', e.message);
  }

  console.log(`Jasmil leltár alkalmazás fut:`);
  console.log(`  → ezen a gépen (HTTP):   http://localhost:${HTTP_PORT}`);
  if (httpsStarted) console.log(`  → ezen a gépen (HTTPS):  https://localhost:${HTTPS_PORT}`);

  const kvikkConfig = require('./lib/kvikkConfig').loadConfig();
  const kvikkIsLive = !kvikkConfig.mockMode && !!kvikkConfig.kvikkApiKey;

  // A mentés a Kvikk beállítások betöltése után indul, hogy egy vadonatúj
  // telepítésnél a kvikk-config.json már létezzen, és bekerüljön a mentésbe.
  const backup = require('./lib/backup');
  backup.startBackupSchedule();
  console.log(`\n  Automatikus napi mentés helye: ${backup.BACKUP_DIR}`);
  console.log(`  (ezt a mappát érdemes a NAS-ra menteni, pl. Synology Drive Clienttel)`);

  const invoiceInbox = require('./lib/invoiceInbox');
  invoiceInbox.startInboxWatcher();
  console.log(`\n  Bejövő számlák figyelt mappája: ${invoiceInbox.getSettings().inbox_dir}`);
  console.log(`  (az ide mentett PDF-eket az app percenként beolvassa; a Számlák oldalon módosítható)`);
  console.log(`\n  Kvikk Connect (Chrome-bővítmény) beállításaihoz:`);
  console.log(`  → Backend URL:      http://localhost:${HTTP_PORT}  (vagy a lenti hálózati cím)`);
  console.log(`  → Extension token:  ${kvikkConfig.extensionToken}`);
  console.log(`  → Kvikk mód:        ${kvikkIsLive ? 'ÉLES (valódi Kvikk hívások)' : 'MOCK (nincs valódi Kvikk hívás)'}`);
  console.log(`  (a token és a Kvikk API adatok a data/kvikk-config.json fájlban módosíthatók)`);

  if (kvikkIsLive) {
    if (!kvikkConfig.senderId) {
      console.log(`\n  ⚠️  Nincs beállítva Kvikk feladó (senderId) - csomag létrehozása egyelőre hibát fog adni.`);
    }
    try {
      const kvikk = require('./lib/kvikkClient');
      const account = await kvikk.getAccountDetails();
      console.log(`\n  Kvikk fiók adatai (data/kvikk-config.json → senderId beállításához):`);
      (account.senders || []).forEach((s) => {
        const mark = s._id === kvikkConfig.senderId ? ' ← jelenleg ez van beállítva' : '';
        console.log(`  → Feladó: "${s.name}" (${s.city || ''}) → senderId: ${s._id}${mark}`);
      });
      const activeCouriers = (account.couriers || []).filter((c) => c.status === 'active').map((c) => c.name);
      console.log(`  → Aktív futárok: ${activeCouriers.join(', ') || '(nincs aktív futár a fiókban)'}`);
    } catch (e) {
      console.log(`\n  ⚠️  Nem sikerült lekérdezni a Kvikk fiók adatait: ${e.message}`);
      console.log(`     Ellenőrizd, hogy helyes-e a kvikkApiKey a data/kvikk-config.json fájlban.`);
    }
  }

  if (lanAddresses.length) {
    lanAddresses.forEach((addr) => {
      console.log(`  → helyi hálózaton:       http://${addr}:${HTTP_PORT}`);
      if (httpsStarted) console.log(`                           https://${addr}:${HTTPS_PORT}  (kamerás beolvasáshoz ezt használd)`);
    });
    console.log(`\n  Több eszközről egyszerre a fenti hálózati címeket használva lehet dolgozni.`);
    console.log(`  A kamerás vonalkód-beolvasás csak a https:// címen működik — első`);
    console.log(`  csatlakozáskor a böngésző egy biztonsági figyelmeztetést mutat majd`);
    console.log(`  (mivel a tanúsítvány önaláírt, nem hivatalos hitelesítőtől), ezen`);
    console.log(`  a "Speciális" / "Advanced" → "Folytatás mindenképp" gombbal lehet túljutni.`);
    console.log(`  Feltétel: minden eszköz ugyanahhoz a WiFi/hálózathoz csatlakozzon,`);
    console.log(`  és a Windows Tűzfal engedélyezze a bejövő kapcsolatot ezeken a portokon.`);
  } else {
    console.log(`\n  Nem található aktív hálózati kapcsolat — csak erről a gépről érhető el.`);
  }
}

start();
