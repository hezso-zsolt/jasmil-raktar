# Jasmil Kvikk Connect — a leltár alkalmazásba integrálva

Ez a csomag a korábbi különálló `backend/` szolgáltatás helyett a már
meglévő **Jasmil leltár alkalmazásba** építi be a Kvikk integrációt — így
nem kell két külön Node.js szolgáltatást futtatnod, csak egyet.

```
jasmil-leltar/   ← a leltár app, kiegészítve a Kvikk Connect végpontokkal
extension/       ← Chrome-bővítmény (frissítve: az új /api/kvikk/* utakra mutat)
```

Ha nálad már fut egy korábbi `jasmil-leltar` telepítés, ezt a mappát
másold rá (vagy hasonlítsd össze fájlonként) — az új fájlok:
`lib/kvikkConfig.js`, `lib/kvikkClient.js`, `lib/kvikkAuth.js`,
`routes/kvikkShipments.js`, `routes/kvikkCouriers.js`,
`routes/kvikkWebhook.js`, valamint a `db/schema.sql` és `server.js`
módosult (két új tábla, három új route bekötve).

## Telepítés / indítás

```bash
cd jasmil-leltar
npm install
npm start
```

Indításkor a terminálban megjelenik minden szükséges adat:

```
Jasmil leltár alkalmazás fut:
  → ezen a gépen (HTTP):   http://localhost:3000
  ...
  Kvikk Connect (Chrome-bővítmény) beállításaihoz:
  → Backend URL:      http://localhost:3000
  → Extension token:  <ide egy hosszú, automatikusan generált string kerül>
  → Kvikk mód:        MOCK (nincs valódi Kvikk hívás)
```

Ezt a két értéket (Backend URL, Extension token) másold be a Chrome-bővítmény
beállításaiba.

## Chrome-bővítmény betöltése

1. `chrome://extensions` → Fejlesztői mód bekapcsolása
2. „Kicsomagolt bővítmény betöltése” → az `extension/` mappa kiválasztása
3. Kattints a bővítmény ikonjára, illeszd be a fenti Backend URL-t és Extension
   tokent, majd „Kapcsolat tesztelése” → zöld pöttyöt kell látnod.

Ezután a Shoprenter admin rendelés részletező oldalán megjelenik a Kvikk
panel, ugyanúgy, ahogy korábban — a különbség csak annyi, hogy most a leltár
alkalmazás szolgálja ki a kéréseket a különálló backend helyett.

## Mi változott a korábbi (különálló backend) verzióhoz képest

| | Korábban | Most |
|---|---|---|
| Hány Node.js folyamatot kell futtatni | 2 (leltár app + Kvikk backend) | 1 (leltár app, kibővítve) |
| Adattárolás | külön JSON fájl (`backend/data/shipments.json`) | a leltár app saját SQLite adatbázisában (`kvikk_shipments` tábla) |
| Beállítások | `.env` fájl | `data/kvikk-config.json` (automatikusan létrejön, a token is auto-generált) |
| Extension backend URL / útvonalak | `http://localhost:3001`, `/api/shipments` | `http://localhost:3000`, `/api/kvikk/shipments` |

A korábbi különálló `backend/` mappára a jövőben nincs szükség — törölhető.
