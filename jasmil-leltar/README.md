# Jasmil leltár- és raktárelhelyezési alkalmazás

Webszerveren futó belső alkalmazás a funkcionális specifikáció (1. verzió) alapján:
készletátvétel/leltár EAN-vonalkód-olvasással, és az új raktár fizikai
elhelyezés-nyilvántartása (termék → doboz → mennyiség).

A jelenlegi verziószám a felület bal oldali sávjában látható. A teljes
fejlesztési történet (minden verzió, mi változott) a
[`CHANGELOG.md`](./CHANGELOG.md) fájlban található.

## Technológia

- **Backend:** Node.js + Express, adatbázis: SQLite, a Node.js-be **beépített**
  `node:sqlite` modullal (Node.js 22.5+ szükséges hozzá). Ennek köszönhetően
  telepítéskor nincs szükség semmilyen natív fordításra (nem kell Visual
  Studio Build Tools Windows-on) — nincs külön adatbázis-szerver sem, a
  `data/jasmil.db` fájlban tárolódik minden.
- **Frontend:** egyszerű, build-lépés nélküli HTML/CSS/vanilla JS (statikus
  fájlok a `public/` mappában), az Express szolgálja ki.
- **Vonalkódolvasó:** a specifikációnak megfelelően a rendszer minden
  vonalkód-beviteli mezőt szabványos szöveges input mezőként kezel. A
  billentyűzet-emulációs (HID) USB-olvasók (pl. GMB POS-BS1100) enter-lezárással
  simán működnek — a mező a művelet után automatikusan visszakapja a fókuszt.

## Telepítés és indítás

```bash
npm install
npm start
```

Ezután a böngészőben: **http://localhost:3000**

## Több eszközről, párhuzamos munkavégzés

Induláskor a terminál kiírja a gép **helyi hálózati IP-címét** két
változatban: `http://` (böngészésre, adatbevitelre) és `https://` (ehhez
kell a kamerás vonalkódolvasás). Ezt a címet beírva bármelyik, ugyanahhoz a
WiFi-hez/hálózathoz csatlakozó telefon vagy laptop böngészőjében ugyanazt az
élő adatot éri el, mint a gépen futó szerver — így egyszerre több ember is
dolgozhat (pl. az egyik csapat számol a Leltár/átvétel nézetben, a másik
egyidejűleg pakol a dobozokba az Elhelyezés nézetben, mivel a két funkció
egymástól függetlenül működik).

Ehhez szükséges lehet egy kivétel engedélyezése a Windows Tűzfalban mindkét
portra (alapértelmezetten 3000 és 3443), ha a többi eszköz nem éri el az
oldalt.

## Kamerás vonalkódolvasás

A scan-mezők mellett (Raktári keresés, Leltár/átvétel, Elhelyezés termék és
doboz mezői) egy 📷 gomb nyitja meg a telefon/laptop kameráját élő
vonalkód-felismeréshez — külön kézi vonalkódolvasó hardver nélkül is
használható.

**Fontos korlátok:**
- Csak **https://** kapcsolaton működik (a böngészők biztonsági szabálya
  miatt) — a fenti `https://<IP>:3443` címet kell használni, nem a
  `http://`-t. Első csatlakozáskor a böngésző egy "nem biztonságos
  kapcsolat" figyelmeztetést mutat (mivel a tanúsítvány önaláírt, nem
  hivatalos hitelesítőtől származik) — ezen a "Speciális" / "Advanced" →
  "Folytatás mindenképp" gombbal kell egyszer túljutni eszközönként.
- A böngésző natív **BarcodeDetector API**-jára épül, külön könyvtár
  letöltése nélkül. Android Chrome-on és a legtöbb modern desktop
  Chrome/Edge-en jól működik; Safari/iOS támogatása verziófüggő és
  korlátozottabb lehet — ha a gomb hibaüzenetet ad a böngésző
  támogatásának hiányáról, a kézi beütés vagy egy külső (USB/Bluetooth)
  vonalkódolvasó továbbra is működik minden böngészőben.

> Node.js 22.5 vagy újabb szükséges (a beépített `node:sqlite` modul miatt).
> A `node -v` paranccsal ellenőrizheted a verziót. Induláskor egy
> `ExperimentalWarning: SQLite is an experimental feature...` figyelmeztetés
> jelenik meg a terminálban — ez normális, nem hiba, az alkalmazás emiatt
> ugyanúgy működik.

A `PORT` környezeti változóval más port is beállítható:
```bash
PORT=8080 npm start
```

## Kvikk Connect (Shoprenter → Kvikk integráció)

Ez az alkalmazás egyben a **Jasmil Kvikk Connect** Chrome-bővítmény
backendjeként is szolgál (Shoprenter Silver rendelésekből Kvikk
futárcímke létrehozása) — külön szervert nem kell hozzá futtatni.

Amikor elindítod az appot (`npm start`), a terminál kiírja a bővítmény
beállításához szükséges adatokat:

```
Kvikk Connect (Chrome-bővítmény) beállításaihoz:
→ Backend URL:      http://localhost:3000
→ Extension token:  <automatikusan generált token>
→ Kvikk mód:        MOCK (nincs valódi Kvikk hívás)
```

Ezt a Backend URL-t és Extension tokent kell megadni a Chrome-bővítmény
beállításai között (a bővítmény ikonjára kattintva). Több eszközön történő
használathoz a fenti helyi hálózati IP-cím is használható Backend URL-ként.

**Kvikk API bekötése valódi kulccsal:**

1. Szerezz egy Kvikk API-kulcsot: `app.kvikk.hu` → Beállítások → API Key → „New Key”.
2. Nyisd meg a `data/kvikk-config.json` fájlt (az első induláskor jön létre automatikusan), és állítsd be:
   - `kvikkApiKey`: a most létrehozott kulcs
   - `mockMode`: `false`
3. Indítsd újra az appot (`Ctrl+C`, majd `npm start`). A terminál ilyenkor automatikusan lekérdezi és kiírja a Kvikk fiókodhoz tartozó **feladókat** (`senderId`) és az **aktív futárokat**, pl.:
   ```
   Kvikk fiók adatai (data/kvikk-config.json → senderId beállításához):
   → Feladó: "Jasmil Hungary" (Budapest) → senderId: 668c5f8c2d6d7579f2233b4f
   → Aktív futárok: MPL, Foxpost, Packeta, GLS, DPD
   ```
4. Másold be a kiírt `senderId` értéket a `data/kvikk-config.json` `senderId` mezőjébe, majd indítsd újra még egyszer.

Ha ez megvan, a „KVIKK CÍMKE LÉTREHOZÁSA” gomb már valódi Kvikk csomagot és letölthető PDF címkét hoz létre.

**Fontos technikai részletek** (a Kvikk hivatalos API dokumentációja alapján, `api.kvikk.hu/docs`):
- A súlyt a rendszer automatikusan grammra váltja (a panelen kg-ban add meg).
- A „Csomag értéke” mező kötelező a Kvikk felé — alapból a rendelés bruttó végösszegével van előtöltve, de felülírható.
- A csomagpont-keresés futárfüggő: előbb válaszd ki a futárt, utána keress rá a pontra (a Kvikk API nem szöveges keresést biztosít, hanem a teljes pontlistát futáronként — ezt tölti le és keresi a rendszer a háttérben, gyorsítótárazva).
- A csomagpont-keresés az "MPL postán maradó" (a csomagot egy megjelölt postán tárolják, ott veszi át a vevő) találatait is listázza az MPL automata/postapont mellett — ez ugyanaz a kereső, csak más ponttípussal (`mpl_posta`). Ha a Shoprenter szállítási mód szövege "postán maradó"-ra utal, a panel erre is figyelmeztet.
- **A `lib/kvikkClient.js`-ben lévő `DELIVERY_POINT_TYPES_BY_COURIER` táblázat típuskódjait (különösen az MPL-ét) egy korábbi, gyorsítótárazott Kvikk-dokumentáció állapot alapján javítottuk (2026-09-23) — élesítés előtt egy próbakereséssel (bármelyik futár, tetszőleges keresőszó) érdemes leellenőrizni a saját Kvikk fiókodban, hogy tényleg találatot ad.**

**Kvikk → Jasmil visszirányú értesítések (webhook):** a rendszer fogadni tudja a Kvikk csomagállapot-változásait (`/api/kvikk/webhook`), és el is menti azokat a csomaghoz. Ehhez:
1. Lépj be az `app.kvikk.hu` felületre → Beállítások → Webhooks → hozz létre egy új webhookot, URL-nek add meg: `http://<a te backend címed>/api/kvikk/webhook` (nyilvánosan elérhető címnek kell lennie, `localhost` erre nem alkalmas — erről lásd a Kvikk dokumentációját).
2. A létrehozáskor kapott titkos kulcsot másold be a `data/kvikk-config.json` `webhookSecret` mezőjébe.
3. Ettől kezdve a `kvikk_shipments` tábla `status` mezője automatikusan frissül (`dispatched` / `shipped` / `delivered` / `returned`) minden állapotváltozáskor.

A Kvikk végpontok (`/api/kvikk/...`) — a leltár app többi részétől
eltérően — az Extension tokennel védettek, mivel valódi Kvikk-költséggel
járó műveletet (futárcímke-létrehozás) indítanak el.

Az alkalmazás egyetlen `data/jasmil.db` fájlba írja az adatokat — a mappa
biztonsági mentése a teljes állapotot menti.

### Rendelések / Összekészítés — készletcsökkentés könyvelése

A Kvikk Connect bővítmény által beküldött rendelések a **Rendelések**
nézetben komissiózhatók (doboz szerinti bejárási sorrenddel). Az
"Összekészítettnek jelölés" után elérhetővé válik a **"Készletcsökkentés
könyvelése"** gomb, ami a rendelés tételeit ténylegesen levonja a raktári
elhelyezésekből (szükség esetén több dobozból összesítve).

- Ha egy tételhez nincs elég összesített készlet, **semmi nem kerül
  levonásra** — a felület megmutatja, melyik tételből mennyi hiányzik.
- Ismeretlen (a leltárban nem azonosított) cikkszámú tételek kimaradnak a
  könyvelésből, erről figyelmeztetés jelenik meg.
- A gomb újbóli megnyomása egy már könyvelt rendelésnél **pontosan
  visszavonja** a korábbi levonást (nem könyvel duplán) — ez véd a téves
  kattintás ellen.
- Minden könyvelés/visszavonás bekerül a Készletmozgás-naplóba is
  (Áttekintés nézet).

### Kvikk statisztika és tömeges címkegenerálás

A **"Kvikk statisztika"** menüpont összesített képet ad a Kvikk Connect
forgalomról (kész/sikertelen/vár még, futár szerinti bontás, utánvét-
forgalom, napi bontás), és innen indítható a **tömeges címkegenerálás**:
több, még címke nélküli rendelés kijelölése után egy gombbal mindegyikhez
legenerálható a Kvikk csomag, anélkül hogy egyenként meg kellene nyitni
őket a Shoprenter adminban.

Ehhez a rendelésnek rendelkeznie kell rögzített címmel/telefonszámmal
(ezt a bővítmény a rendelés első megnyitásakor küldi be), ismert tétel-
súlyokkal, és a szállítási módhoz tartozó alapértelmezett futárral (ezt
az első, egyenkénti címkézéskor jegyzi meg a rendszer). Ami ennek nem
felel meg (pl. csomagpontos rendelés), azt a felület kihagyja és
megmondja, miért — ezeket egyenként, a Shoprenterből kell intézni.

A legenerált címkék egy kattintással, egyetlen ZIP fájlban is letölthetők.

### Eltérő méret kiemelése az aktív dobozban

A "Gyors tömeges elhelyezés (aktív doboz)" munkafolyamat (Elhelyezés nézet)
automatikusan felismeri a doboz **jellemző méretét** a jelenlegi
tartalmából (a legtöbb darabszámmal szereplő méret, ha van egyértelmű
többség), és ha egy ettől eltérő méretű terméket olvasol be, azt halvány
piros háttérrel kiemeli a beolvasott tételek listájában — így gyorsan
észrevehető, ha véletlenül rossz méret került egy dobozba. Ez nem
blokkoló figyelmeztetés, csak vizuális jelzés.

### Dobozonkénti újraszámolás (leltár-korrekció)

Az **Elhelyezés** nézetben, az "aktív doboz" panel alatt található a
**"Doboz újraszámolása (leltár-korrekció)"** panel — ez különbözik a
Leltár nézet termékalapú, teljes raktárra vonatkozó "Leltár-munkamenetek"
funkciójától: ez itt **dobozonkénti**, egymástól független újraszámolás,
így nem kell az egész raktárt egyszerre "befagyasztani", és több ember is
dolgozhat párhuzamosan különböző dobozokon.

Menete:
1. Kiválasztod a dobozt, elindítod a számolást — a doboz **zárolva** lesz
   (nem lehet bele elhelyezni, belőle kivenni, vagy áthelyezni, amíg a
   számolás jóváhagyásra/elvetésre nem kerül). A "Dobozok" listán 🔒 jelzés
   mutatja, mely dobozok vannak épp számolás alatt.
2. Fizikailag kiveszed és egyenként beolvasod a tartalmát (+1/+10/−1,
   visszavonható) — ez **vak számolás**: a nyilvántartott mennyiség nem
   látszik közben, csak lezáráskor, hogy ne "igazíts hozzá" tudat alatt.
3. Lezáráskor megjelenik az **eltérés-összevetés** (nyilvántartott vs.
   megszámolt, piros = hiány, zöld = többlet) — azokra a termékekre is,
   amik nyilvántartva voltak, de elő sem kerültek, illetve amik korábban
   nem is szerepeltek ott.
4. **Jóváhagyáskor** a mennyiségek a megszámolt értékre íródnak át, és
   minden eltérés bekerül a készletmozgás-naplóba "leltár-korrekció"
   okkal. **Elvetéskor** semmi nem változik, a doboz egyszerűen feloldódik.

### Bejövő számlák

A **Számlák** oldalon a beérkező (szállítói) számlák tarthatók nyilván.

1. A letöltött számla-PDF-eket egy **figyelt mappába** kell menteni
   (alapból `data/szamlak-bejovo`, a Számlák oldal **Beállítások** gombjával
   bármelyik mappára átállítható). Az app percenként átnézi a mappát, de a
   **Mappa beolvasása most** gombbal azonnal is beolvastatható. PDF a
   böngészőből is feltölthető.
2. Minden új PDF-ből az app **helyben** (internet nélkül) kiolvassa a
   szállítót, az adószámát, a számlaszámot, a kiállítás / teljesítés
   dátumát, a fizetési határidőt, a nettó / ÁFA / bruttó összeget, a
   pénznemet és a fizetési módot. A számla **ellenőrizendő** állapotba kerül;
   a beolvasott fájl a figyelt mappán belül a `feldolgozott` almappába kerül.
3. Az **Átnézés** ablakban bal oldalt a PDF, jobb oldalt a kinyert adatok
   látszanak; a fel nem ismert mezők sárgák. Jóváhagyás után a számla
   **fizetendő** (vagy kifizetett) lesz. A szállítót az app megjegyzi, így
   a következő számlájánál adószám alapján felismeri.
4. A lista szűrhető állapot (ellenőrizendő / fizetendő / lejárt / kifizetve),
   szállító, kategória, kiállítási dátum és szabad szöveg szerint, és a
   szűrt lista CSV-be (Excelben megnyitható) exportálható.

A beszkennelt, csak képet tartalmazó PDF-ekből nem olvasható szöveg - ezeknél
az adatokat kézzel kell kitölteni. A PDF-ek másolata a `data/szamlak/`
mappába kerül, a napi mentés pedig a `data/mentesek/szamla-pdfek/` mappába
viszi át őket.

## Funkciók / munkafolyamatok

- **Raktári keresés** — EAN/SKU beolvasása → azonnal látszik a termék és az
  összes raktári hely + mennyiség, ahol megtalálható (16–17. pont).
- **Globális scanner-figyelő** — ha véletlenül nem a szkennelő mezőben van a
  fókusz (pl. egy táblázat sorára kattintottál), a rendszer akkor is felismeri
  a vonalkódolvasó jellegzetesen gyors beütését (a karakterek közti idő alapján
  megkülönbözteti az emberi gépeléstől), és automatikusan a megfelelő helyre
  irányítja: nyitott leltár-munkamenetben a számláláshoz adja hozzá, egyébként
  a Raktári keresésben mutatja meg a terméket.
- **Leltár / átvétel** — leltár-munkamenetek indítása, amely "befagyasztja" az
  aktuális elméleti készletet; folyamatos vonalkód-beolvasás (+1 db /
  gyors "+10 db" / kézi korrekció / utolsó lépés visszavonása), élő
  eltérés-kijelzés, szűrés (nincs eltérés / hiány / többlet / nem ellenőrzött),
  CSV-export, munkamenet lezárása vagy törlése (6–9. pont).
- **Elhelyezés** — termék dobozba helyezése, két doboz közti áthelyezés,
  készlet kivétele (rendelés-összekészítéshez), dobozonkénti,
  termékenkénti maximális kapacitás beállítása és ellenőrzése (11–19, 23. pont).
  A doboz-azonosító mezők kereshető javaslatlistával (`<datalist>`) segítik a
  meglévő dobozok gyors kiválasztását, miközben a vonalkód-/QR-beolvasás
  továbbra is ugyanúgy működik ezekben a mezőkben.
  **Aktív doboz mód:** egy dobozt egyszer kiválasztva utána csak a termékeket
  kell folyamatosan beolvasni (mindegyik automatikusan abba a dobozba kerül),
  ideális nagy mennyiségű, vegyes tételes kezdeti feltöltéshez — a "Doboz
  lezárása" gombbal automatikusan megnyílik egy nyomtatható tartalom-
  összesítő (QR-kóddal) a dobozra ragasztáshoz.
- **Dobozok** — raktári helyek/dobozok felvétele, mérete, tartalma,
  kapacitásai egy nézetben (10–12, 20. pont). Minden dobozhoz nyomtatható
  QR-címke generálható (egyenként vagy egyszerre az összes doboznak) — a
  fizikai dobozra ragasztva a doboz-azonosító ezután vonalkódolvasóval vagy
  telefonkamerával is beolvasható, kézi begépelés helyett (15. pont).
- **Termékek** — CRUD, keresés SKU/EAN/név szerint, "nincs elhelyezve" szűrő,
  egyenkénti és **tömeges (kijelölt) törlés** (3, 22. pont).
- **Termékfigyelő** — olyan termékek nyilvántartása (kért mennyiséggel és
  megjegyzéssel), amikre külön figyelni kell, mert vevő rendelte és félre
  kell tenni. Ha egy figyelt termék bárhol a rendszerben (Raktári keresés,
  Leltár/átvétel, Elhelyezés) beolvasásra kerül, egy feltűnő figyelmeztető
  ablak jelenik meg, ahol egy kattintással jelölhető, hogy az adott
  darabot félretetted — ez tisztán nyilvántartási funkció, nem mozgat
  semmit a tényleges raktári készletben.
- **Import / export** — termékadatok CSV-importja (Shoprenter-exporttal
  kompatibilis oszlopnevekkel: sku/cikkszam, ean/vonalkod, name/nev,
  category/kategoria, size/meret, color/szin, stock/keszlet), duplikáció- és
  hiányzó mező-ellenőrzéssel; raktári elhelyezés és dobozok CSV-exportja
  (27–28. pont).
- **Áttekintés** — raktár-kihasználtság, nem elhelyezett termékek száma,
  legutóbbi készletmozgások naplója, a napló teljes ürítésének lehetőségével
  (pl. tesztadatok eltüntetésére) (20, 24. pont).

## Adatmodell

```
Termék (sku, ean, név, kategória, méret, szín, elméleti_készlet)
  │
  ├─ Elhelyezés (N:N) → Doboz (id, méret, kapacitás)
  │     └─ Dobozkapacitás (doboz, termék, max_db)
  │
  ├─ Leltár-munkamenet → Leltártétel (elméleti, megszámolt, eltérés)
  │
  └─ Készletmozgás-napló (bevételezés / kivétel / áthelyezés)
```

A fizikai összkészlet mindig az adott termék összes elhelyezésének összegéből
számolódik (nincs külön, kézzel karbantartandó "összkészlet" mező) — így
elhelyezés és fizikai készlet sosem futhat szét egymástól.

## Ami az 1. verzióban szándékosan nincs benne

A specifikáció 31. pontja szerint ezek nem részei az első verziónak, de az
adatmodell felkészült a későbbi bővítésükre:

- mobiltelefon kamerás vonalkódolvasás (jelenleg USB HID-olvasóra / kézi
  bevitelre épül, asztali/laptop használatra),
- automatikus dobozméret-optimalizálás, AI-alapú elhelyezési javaslat,
- automatikus raktári útvonaltervezés,
- több raktár egyidejű kezelése,
- automatikus Shoprenter-szinkronizáció (jelenleg kézi CSV import/export).

## API végpontok (áttekintés)

| Terület | Végpontok |
|---|---|
| Termékek | `GET/POST /api/products`, `GET/PUT/DELETE /api/products/:id`, `DELETE /api/products` (tömeges), `GET /api/products/lookup?code=` |
| Dobozok | `GET/POST /api/boxes`, `GET/PUT/DELETE /api/boxes/:id`, `POST /api/boxes/:id/capacity`, `GET /api/boxes/:id/label`, `GET /api/boxes/labels/all`, `GET /api/boxes/:id/manifest` (tartalom-összesítő) |
| Elhelyezés | `POST /api/placements/place`, `/pick`, `/transfer` |
| Doboz-újraszámolás | `POST /api/boxes/:boxId/recount/start`, `GET /api/boxes/:boxId/recount`, `POST /api/box-recounts/:id/scan`, `/set`, `/undo`, `/close`, `/apply`, `/cancel`, `GET /api/box-recounts/history` |
| Rendelések | `GET /api/orders`, `POST /api/orders/import`, `GET /api/orders/:id/picking`, `POST /api/orders/:id/picked`, `POST /api/orders/:id/deduct-stock` (könyvelés / visszavonás), `POST /api/orders/calculate-weight`, `DELETE /api/orders/:id` |
| Kvikk | `GET /api/kvikk/shipments/:orderId`, `POST /api/kvikk/shipments`, `POST /api/kvikk/shipments/bulk` (tömeges), `GET /api/kvikk/shipments/labels-zip?order_ids=` (ZIP), `GET /api/kvikk/couriers`, `GET /api/kvikk/couriers/preference`, `GET /api/kvikk/couriers/delivery-points`, `GET /api/reports/kvikk` (statisztika) |
| Leltár | `GET/POST /api/inventory/sessions`, `DELETE /api/inventory/sessions/:id`, `GET /api/inventory/sessions/:id/items`, `POST /scan`, `/set`, `/undo`, `/close` |
| Riportok | `GET /api/reports/overview`, `/unplaced`, `/movements`, `DELETE /api/reports/movements` (napló ürítése) |
| Verzió | `GET /api/version` |
| Termékfigyelő | `GET/POST /api/watchlist`, `GET /api/watchlist/check?code=`, `POST /api/watchlist/:id/fulfill`, `DELETE /api/watchlist/:id` |
| Számlák | `GET/POST /api/invoices`, `GET/PUT/DELETE /api/invoices/:id`, `GET /api/invoices/:id/pdf`, `POST /api/invoices/:id/pay`, `POST /api/invoices/scan`, `POST /api/invoices/upload`, `GET/PUT /api/invoices/settings`, `GET /api/invoices/summary`, `/suppliers`, `/categories`, `/export` |
| Import/export | `POST /api/io/products/import`, `GET /api/io/inventory/:id/export`, `/warehouse/export`, `/boxes/export` |

## Hibaüzenetek

A rendszer a specifikációban (26. pont) leírt esetekben magyar nyelvű,
egyértelmű hibaüzenetet ad: ismeretlen EAN, ismeretlen SKU, nincs raktári
hely, megtelt doboz, hibás mennyiség.
