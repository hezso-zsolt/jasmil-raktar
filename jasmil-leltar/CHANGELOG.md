# Jasmil — Release notes

Ez a dokumentum a fejlesztés folyamán elkészült verziókat foglalja össze,
időrendben, a legelső változattól a mostaniig. A verziószám a felület bal
oldali sávjában (a "Jasmil" felirat alatt) is megjelenik.

---

## 1.40.1 — Számlák: beolvasás csak gombnyomásra, pontosabb összegek

- Az app **nem nézi többé percenként** a számla-mappát. A mappába mentett
  PDF-eket a Számlák oldalon a **Mappa beolvasása** gombbal lehet
  beolvastatni, amikor szükség van rá.
- A Számlák oldal sem frissül magától percenként, a menü jelvénye az oldal
  megnyitásakor és beolvasáskor frissül.
- **Pontosabb összegfelismerés:** ha a számlán tételes táblázat van
  („Nettó összeg (Ft)”, „Bruttó összeg (Ft)” oszlopokkal), az app eddig az
  első tételsor összegét vehette végösszegnek. Mostantól az „Összesen” sor
  nettó + ÁFA = bruttó összegét használja, a kerekített „Fizetendő”
  összeggel (pl. Opennetworks telefonszámla: nettó 3 237,81, ÁFA 874,21,
  fizetendő 4 112 Ft).

---

## 1.40.0 — Bejövő számlák

- Új oldal a menüben: **Számlák**. Itt tartható nyilván minden beérkező
  szállítói számla: szállító, számlaszám, kiállítás, teljesítés és fizetési
  határidő, nettó / ÁFA / bruttó összeg, pénznem, fizetési mód, kategória
  és megjegyzés, a számla PDF-jével együtt.
- **Automatikus beolvasás mappából:** a letöltött számla-PDF-eket elég egy
  mappába menteni (alapból `data/szamlak-bejovo`, a **Beállítások** gombbal
  átállítható, pl. `C:\Claude_RAKTAR\szamlak`). Az app percenként átnézi
  a mappát, és minden új PDF-ből **helyben, internet nélkül** kiolvassa a
  fontos adatokat. A beolvasott fájl a mappán belül a `feldolgozott`
  almappába kerül. A **Mappa beolvasása most** gombbal azonnal is
  beolvastatható, és PDF a böngészőből is feltölthető.
- **Átnézés:** az automatikusan beolvasott számla „Ellenőrizendő” lesz. Az
  Átnézés ablakban bal oldalt a PDF, jobb oldalt a kiolvasott adatok
  látszanak; amit az app nem ismert fel, az sárga. Jóváhagyás után a
  számla „Fizetendő” lesz (kártyás vagy készpénzes számlánál alapból
  „Kifizetve”).
- A szállítókat az app megjegyzi: a következő számlájukat már az adószám
  alapján felismeri, és a korábban megadott kategóriát is kitölti.
- Ugyanazt a PDF-et nem veszi fel kétszer, és szól, ha ugyanattól a
  szállítótól ugyanilyen számlaszám már szerepel.
- **Áttekintés a lap tetején:** hány számla ellenőrizendő, mennyi a
  fizetendő összeg, mi esedékes 7 napon belül, mi járt le (pirossal), és
  mennyit fizettünk ki ebben a hónapban. A kártyára kattintva a lista
  arra szűr. A menüben a jelvény az ellenőrizendő + lejárt számlák számát
  mutatja.
- **Lista és szűrés:** állapot (ellenőrizendő / fizetendő / lejárt /
  kifizetve), szállító, kategória, kiállítási dátum és szabad szöveg
  szerint. A határidő mellett látszik, hány nap van még hátra, vagy hány
  napja járt le. Egy kattintással **kifizetettnek** jelölhető.
- **Export:** a szűrt lista CSV-be tölthető le, ami Excelben megnyitható
  (pl. a könyvelőnek).
- **Mentés:** a számlák adatai a napi mentésbe kerülnek, a PDF-ek pedig a
  `data/mentesek/szamla-pdfek/` mappába másolódnak át, így a NAS-ra is
  eljutnak.
- Korlátok: a beszkennelt (csak képet tartalmazó) PDF-ekből nem olvasható
  ki szöveg, ezeknél kézzel kell kitölteni az adatokat. A szokatlan
  felépítésű számláknál egy-egy adatot javítani kell az Átnézés ablakban.
- Frissítés után egyszer újra le kell futnia az `npm install`-nak (a
  `frissites.bat` ezt elvégzi), mert a PDF-olvasáshoz új összetevő kell.

---

## 1.39.0 — Automatikus napi mentés

- Az app mostantól **naponta automatikusan mentést készít** az adatbázisról
  és a Kvikk beállításokról a `data/mentesek/` mappába. Minden mentés egy
  dátummal elnevezett almappa (pl. `2026-10-03_1030`), benne a
  `jasmil.db` és a `kvikk-config.json` fájllal.
- A mentés futás közben is biztonságos: nem a működő adatbázisfájlt
  másolja, hanem egy önálló, mindig ép másolatot készít róla.
- Az első mentés induláskor készül, utána 24 óránként. Ha a gép közben
  alvó módban volt vagy újraindult, a mentés a következő alkalommal
  pótlódik.
- A legutóbbi **14 mentés** marad meg, a régebbiek automatikusan törlődnek.
- Indításkor a terminál kiírja a mentési mappa pontos helyét. Ezt a mappát
  érdemes a Synology NAS-ra menteni (pl. Synology Drive Clienttel), így a
  gép meghibásodása esetén sem vesznek el az adatok.
- Visszaállítás: állítsd le az appot, a mentésből másold vissza a
  `jasmil.db` és a `kvikk-config.json` fájlt a `data/` mappába (a régi
  `jasmil.db-wal` és `jasmil.db-shm` fájlt töröld), majd indítsd újra.

---

## 1.38.0 — Vonalkódos visszaellenőrzés összekészítés után

- Új rész a **Rendelések → Összekészítés** oldalon: **"Visszaellenőrzés
  vonalkóddal"**. Az összekészített termékeket egyenként beolvasod (kézi
  vonalkódolvasóval vagy kamerával), és a rendszer tételenként összeveti
  őket a rendelés mennyiségeivel.
- Minden beolvasás után **nagy, színes visszajelzés és hangjelzés**:
  - zöld + rövid csippanás: rendben, ez a termék kell (pl. "2 / 3 db");
  - piros + mély búgás: **rossz termék** (nem része a rendelésnek),
    **túl sok** (ebből már megvan a kellő mennyiség), vagy **ismeretlen
    kód** (nincs ilyen termék a leltárban).
- A tételtáblázat soronként mutatja az állapotot (rendben / hiányzik /
  túl sok / nem rendelt), a teendőt igénylő sorok kerülnek felülre. Ha
  minden stimmel, **"✓ Minden stimmel"** jelzés jelenik meg.
- Vonalkód nélküli terméknél a hiányzó sor mellett **"+1 kézzel"** gombbal
  lehet pipálni. Van **"Utolsó visszavonása"** és **"Ellenőrzés
  újrakezdése"** gomb is.
- A kamera ebben a részben **folyamatos módban** fut: nem záródik be minden
  termék után, egymás után lehet beolvasni a csomag tartalmát, az
  eredmény a kameraképen alul is megjelenik. Ugyanaz a vonalkód a keretben
  tartva nem számolódik többször.
- A kézi (USB) olvasó akkor is ide olvas be, ha a beviteli mező épp nincs
  fókuszban, amíg az összekészítő oldal nyitva van.
- Az ellenőrzés **nem blokkol**: ha eltérés van, és így jelölöd a rendelést
  összekészítettnek, a rendszer csak rákérdez. A beolvasások a szerveren
  tárolódnak, így oldalfrissítés vagy másik eszköz után is megmaradnak.
- A rendeléslistán **"🔎 ellenőrizve"** jelzés mutatja a hiánytalanul
  visszaellenőrzött rendeléseket (eltérés vagy félbehagyott ellenőrzés
  esetén "🔎 ellenőrzés eltér / folyamatban"). Ha a rendelés tételei a
  Shoprenterből újraimportálva megváltoznak, az "ellenőrizve" állapot
  újraszámolódik.
- Egyes olvasók az EAN-13 kód elejéről levágják a 0-t; az ilyen beolvasást
  is felismeri.

## 1.37.0 — Modernebb felület

- **Hibajavítás:** a csak bizonyos helyzetben látható elemek eddig mindig
  látszottak (pl. üres munkamenet-részletező a Leltár oldalon, üres
  "Összekészítés" rész a Rendeléseknél, üres "Aktív doboz" és "Számolás
  alatt" sáv az Elhelyezésnél, piros "0" jelvény a menüben). Mostantól
  csak akkor jelennek meg, amikor kell.
- **Frissebb megjelenés:** lekerekített kártyák finom árnyékkal,
  egységes beviteli mezők (fókuszban narancs kerettel), visszafogottabb
  menü-kiemelés, átláthatóbb táblázatfejlécek, nagyobb térköz a
  szakaszok között.
- A táblázatok soraiban a **Törlés** gomb mostantól csak piros szöveg,
  keret nélkül, így nem vonja el a figyelmet (rámutatva kiemelődik).
- **Mobilon** a táblázatok sorai kártyákká alakulnak, minden adat előtt
  az oszlop nevével, így nem kell oldalra görgetni. A felső sáv a
  menügombbal görgetéskor is látható marad.
- A lezárt leltár-munkamenet állapota ékezettel, "lezárt" formában jelenik meg.

## 1.36.0 — Eltérő méret kiemelése az aktív dobozban

- Az **Elhelyezés** nézet "Gyors tömeges elhelyezés (aktív doboz)" munka-
  folyamatánál a rendszer mostantól automatikusan felismeri a doboz
  **jellemző méretét** a jelenlegi tartalmából (a legtöbb darabszámmal
  szereplő méret, ha van egyértelmű többség), és ha egy ettől eltérő
  méretű terméket olvasol be, azt **halvány piros háttérrel** és egy
  "⚠️ eltér a doboz méretétől" jelzéssel kiemeli a beolvasott tételek
  listájában.
- A felismerés élő: minden beolvasás/visszavonás után újraszámolódik a
  doboz teljes (nem csak az aktuális munkamenetben beolvasott) tartalma
  alapján.
- Szándékosan **nem blokkoló**: nem állítja meg a szkennelést, csak
  vizuálisan kiemeli — a csomagoló dönti el, hogy valóban hiba történt-e.
- Üres, méret nélküli terméket tartalmazó, vagy már eleve kiegyenlítetten
  vegyes méretű (nincs egyértelmű többség) dobozoknál nincs mihez
  viszonyítani, ezért ott a rendszer nem jelez semmit.

## 1.35.0 — Dobozonkénti újraszámolás (leltár-korrekció)

- Új panel az **Elhelyezés** nézetben: **"Doboz újraszámolása (leltár-korrekció)"**.
  Kiválasztasz egy dobozt, elindítod a számolást, fizikailag kiveszed és
  egyenként (vonalkóddal vagy cikkszámmal) újra beolvasod a tartalmát — a
  meglévő "aktív doboz" munkafolyamathoz hasonló, jól ismert kezeléssel
  (+1 / +10 / −1 gombok, "utolsó visszavonása").
- **Vak számolás**: amíg a számolás tart, a felület NEM mutatja a
  nyilvántartott (korábbi) mennyiséget — csak a "Lezárás és összevetés"
  gomb megnyomása után, hogy a csomagoló ne "igazítson hozzá" tudat alatt.
- **Zárolás számolás közben**: amíg egy dobozon számolás fut (a lezárás és
  a jóváhagyás/elvetés közötti idő is beleértve), abba a dobozba nem lehet
  elhelyezni, belőle kivenni, vagy áthelyezni — sem kézzel, sem a
  rendelés-kivétel automatikus dobozválasztásán keresztül. A "Dobozok"
  listán egy 🔒 jelzés mutatja, mely dobozok vannak épp számolás alatt.
- **Lezáráskor eltérés-összevetés**: SKU/EAN/termék szerint táblázatban
  látszik a nyilvántartott, a megszámolt és az eltérés (piros = hiány,
  zöld = többlet) — azokra a termékekre is, amik a dobozban voltak
  nyilvántartva, de újraszámoláskor egyáltalán nem kerültek elő (teljes
  hiány), illetve amik korábban nem is szerepeltek ott (talált többlet).
- **Jóváhagyás vagy elvetés**: jóváhagyáskor a mennyiségek a megszámolt
  értékre íródnak át, és minden eltérés bekerül a készletmozgás-naplóba
  "leltár-korrekció" okkal. Elvetéskor semmi nem változik a
  nyilvántartásban, a doboz egyszerűen feloldódik.
- Ez egy **külön, dobozonkénti** munkafolyamat a meglévő, termékalapú
  "Leltár-munkamenetek" mellett (Leltár nézet) — az utóbbi a teljes
  raktárra vonatkozó, egyszerre futó összevetésre való, ez pedig arra,
  hogy dobozonként, egymástól függetlenül, akár több emberrel
  párhuzamosan is újra lehessen számolni, anélkül hogy az egész raktárt
  "be kellene fagyasztani".

## 1.34.0 — Időszakra szűrés a Kvikk statisztikán

- A "Kvikk statisztika" nézet fölé egy szűrősáv került: gyorsgombok
  (**7 nap / 30 nap / 90 nap / Mind**) és egyedi dátumtartomány (–tól/–ig)
  is választható.
- Szűréskor az összes összesítő (Összes csomag, Kész címke, Sikertelen,
  Utánvét összesen, futár szerinti bontás, legutóbbi sikertelen
  próbálkozások) a kijelölt időszakra vonatkozik, és a felirat is ezt
  mutatja ("Összesítés a kijelölt időszakra: ... – ...").
- A napi bontás diagramja is a kijelölt tartományt mutatja (alapból,
  "Mind" nézetben továbbra is az utolsó 14 napot) — 62 napnál hosszabb
  tartománynál a diagram a legutóbbi 62 napra korlátozódik (a kártyák
  ettől függetlenül a teljes kijelölt időszakra összesítenek), erről a
  felület jelzést ad.
- A "Vár még címkére" lista (tömeges címkegenerálás alapja) szándékosan
  NEM szűrt — az mindig az összes, jelenleg címke nélküli rendelést
  mutatja, függetlenül a kijelölt időszaktól.

## 1.33.0 — Időszak feltüntetése a Kvikk statisztikán

- A "Kvikk statisztika" nézet stat-kártyái (Összes csomag, Kész címke,
  Sikertelen, Utánvét összesen, Vár még) eddig nem jelezték, milyen
  időszakra vonatkoznak — valójában a rendszer teljes eddigi
  élettartamára összesítenek. Mostantól a kártyák fölött szövegesen
  látszik: "Összesítés a teljes eddigi adatból: ÉÉÉÉ-HH-NN óta" (az első
  valaha legenerált Kvikk csomag dátuma), illetve ha még egy csomag sem
  készült, ezt is jelzi a felület.

## 1.32.1 — Még nagyobb betűméret a nagyított nézetben

- A 🔍 Nagyítás gombbal nyíló teljes képernyős nézet betűmérete jelentősen
  megnőtt (doboz-azonosító 38px, tétel sor 32px, cikkszám/vonalkód 26px),
  hogy messzebbről is jól olvasható legyen.

## 1.32.0 — Cikkszám/vonalkód a doboz szerinti listán + nagyított nézet

- Az Összekészítés "Doboz szerint (bejárási sorrend)" listáján eddig csak a
  termék neve látszott — mostantól a **cikkszám és a vonalkód (EAN)** is
  megjelenik minden tétel mellett (`[cikkszám / vonalkód]` formában), hogy
  kétség esetén egyértelműen azonosítható legyen a termék.
- Új **🔍 Nagyítás** gomb a lista fölött: teljes képernyős, nagybetűs
  nézetre vált (a böngésző natív teljes képernyő funkciójával), hogy egy
  polcra kitett táblagépről is jól olvasható legyen távolabbról. Kilépés az
  Esc billentyűvel vagy a gomb újbóli megnyomásával.

## 1.31.1 — Hibajavítás: "Postán maradó" szállítási mód + MPL csomagpont-keresés

- **A bővítmény eddig nem ismerte fel a "postán maradó" (MPL) szállítási
  módot csomagpontos rendelésként** — ilyenkor a rendszer házhozszállításnak
  hitte, és nem figyelmeztetett, hogy pontot (postát) kellene választani.
  Mostantól a "postán maradó" szövegű rendeléseknél is megjelenik a
  figyelmeztetés és a csomagpont-kereső, ugyanúgy, mint csomagautomatánál.
- **Ennél mélyebb, önmagában is hibás működést okozó problémát is találtunk
  és javítottunk**: az MPL csomagpont/automata-keresés a Kvikk hivatalos
  API-dokumentációjától eltérő, rossz típuskódokat használt
  ("postapont"/"csomagautomata"/"mpl" a helyes "mpl_postapont"/
  "mpl_automata"/"mpl_posta" helyett). Éles (nem MOCK) üzemmódban ez
  valószínűleg azt jelentette, hogy az MPL csomagpontos/automatás keresés
  **soha nem adott vissza találatot** — ezt is javítottuk.
  ⚠️ **Élesítés előtt érdemes egy tesztkereséssel (MPL futár, tetszőleges
  keresőszó) ellenőrizni a saját Kvikk fiókodban**, hogy valóban ez a
  helyes típuskód-hármas — a javítás a Kvikk dokumentációjának egy
  korábbi, gyorsítótárazott állapota alapján készült, nem élő API-hívással
  lett leellenőrizve.
- Technikai: a csomagpont/"postán maradó" felismerő mintát (eddig 3 helyen,
  külön-külön másolva) egy közös helyre (`lib/pickupPointDetection.js`)
  vontuk össze a szerveroldali (leltár app) résznél, hogy legközelebb egy
  ilyen javítás ne maradhasson félkész egy elfelejtett másolat miatt. A
  bővítmény (Chrome-only, más futási környezet) saját másolatot tart.

## 1.31.0 — Tömeges Kvikk-címkegenerálás és Kvikk statisztika

- **Új menüpont: "Kvikk statisztika"** — összesített kép a Kvikk Connect
  forgalomról: hány csomag készült / sikertelen / vár még, utánvét-forgalom,
  futár szerinti bontás, napi bontás (utolsó 14 nap), legutóbbi sikertelen
  próbálkozások, és az összes olyan importált rendelés, amihez még nincs
  Kvikk címke.
- **Tömeges címkegenerálás**: a fenti listáról több rendelés is kijelölhető
  egyszerre, és egy gombbal mindegyikhez legenerálható a Kvikk csomag/
  futárcímke — nem kell egyenként megnyitni őket a Shoprenter adminban.
  A rendszer csak azokhoz generál automatikusan, amikhez:
  - van rögzített telefonszám és teljes cím (ezt a bővítmény attól kezdve
    küldi be, hogy valaki egyszer megnyitotta az adott rendelést),
  - a szállítási mód szövege alapján NEM tűnik csomagpontos/automatás
    rendelésnek (azoknál a pontot kézzel kell kiválasztani),
  - a szállítási módhoz már van korábban (egyenkénti címkézéskor)
    megjegyzett alapértelmezett Kvikk futár,
  - minden tételének ismert a súlya a leltárban.

  A kihagyott rendeléseknél a felület pontosan megmutatja, mi hiányzik.
- **ZIP-letöltés**: a tömegesen (vagy korábban egyenként) legyártott
  címkék PDF-jei egy kattintással letölthetők egyetlen ZIP fájlban.
- A bővítmény mostantól a rendelés megnyitásakor a telefonszámot, e-mail
  címet és a szállítási címet is beküldi a leltár appba (eddig csak a
  tételeket és az alapadatokat küldte) — ez teszi lehetővé a fenti tömeges
  generálást anélkül, hogy a Shoprentert újra meg kellene nyitni.
- Technikai: a leltár app saját felülete a tokennel védett Kvikk
  végpontokat (`/api/kvikk/shipments/...`) egy belső, csak a helyi
  felületnek szánt token-végponton (`/api/kvikk/internal-token`) keresztül
  éri el — ugyanazon a bizalmi szinten, mint az app többi (hitelesítés
  nélküli) végpontja.

## 1.30.0 — Készletcsökkentés könyvelése rendelésekhez

- Az **Összekészítés** felületen (Rendelések) új gomb: **"Készletcsökkentés
  könyvelése"** — az összekészítést követően egy kattintással levonja a
  rendelés tételeit a raktári elhelyezésekből (dobozokból), a legtöbbet
  tartalmazó dobozból kezdve, szükség esetén több doboz között megosztva.
- A gomb csak összekészített (✅) rendelésnél aktív; a rendeléslistán és az
  Összekészítés fejlécén is jelzi a felület, ha egy rendeléshez már történt
  könyvelés (📉 készlet könyvelve).
- **Védelem duplikált könyvelés ellen**: ha egy rendeléshez már történt
  könyvelés, a gomb újbóli megnyomása nem könyvel még egyszer, hanem
  pontosan **visszavonja** a korábbi levonást (az `order_stock_deductions`
  tábla tételes, dobozonkénti bontása alapján) — ez véd a téves kattintás
  ellen.
- **Részleges könyvelés nincs**: ha egy tételhez nincs elég összesített
  elhelyezett készlet az összes dobozban, a teljes könyvelés elmarad
  (semmi nem kerül levonásra), és a felület pontosan megmutatja, melyik
  tételből mennyi hiányzik.
- Az ismeretlen cikkszámú (a leltár termékei közt nem azonosított) tételek
  könyvelése kimarad, erről a felület figyelmeztetést ad, de a többi tétel
  könyvelését nem akadályozza.
- Minden könyvelt (és visszavont) mozgás bekerül a meglévő készletmozgás-
  naplóba (`stock_movements`, "kivetel" / "bevetelezes" művelettel) is.

## 1.29.0 — Elhelyezettségi kimutatás

- Az **Áttekintés** nézetben új kimutatás: melyik termék van elhelyezve
  dobozokban és melyik nincs, termékenként a készlettel, az elhelyezett
  mennyiséggel és a dobozok felsorolásával.
- Három állapot, szűrhetően: **elhelyezve**, **részben elhelyezve**
  (van belőle dobozban, de kevesebb, mint a készlet — vagyis maradt még
  bedobozolatlan mennyiség) és **nincs elhelyezve**. A szűrőgombok mutatják
  az egyes csoportok darabszámát, a sorok színe pedig kiemeli a hiányosakat.
- A kimutatás CSV-be exportálható, a szűrést követve (pl. csak a nem
  elhelyezett termékek listája).

## 1.28.1 — EAN helyreállító script

- Új `restore-ean.js` segédscript: visszatölti a vonalkódokat egy korábbi
  biztonsági mentésből (`--from-db`) vagy az eredeti termék-CSV-ből
  (`--from-csv`), cikkszám alapján párosítva. Csak az EAN mezőt írja, minden
  más adathoz (készlet, elhelyezések, súlyok, rendelések) hozzá sem nyúl.
  `--dry-run` kapcsolóval előbb megnézhető, mi történne.
- A script felismeri és érthetően jelzi, ha a megadott mentés hiányos
  (WAL mód miatt a `.db` mellé a `-wal` fájl is kell).

## 1.28.0 — EAN-védelem az importban

- **Az import többé nem tudja tönkretenni a vonalkódokat.** Az Excel a 13 jegyű
  EAN-okat megnyitáskor tudományos jelölésre alakítja ("8.60507E+12"), amiből
  az eredeti érték nem állítható vissza. Az ilyen értékeket az import mostantól
  eldobja (a sor többi adata, pl. a súly, ettől még importálódik), és az
  eredményben jelzi, hány ilyen volt.
- Az üresen hagyott EAN sem írja felül a meglévőt - ugyanaz a logika, mint a
  súlyoknál, így részleges importok biztonságosak.
- A "Termékek + súlyok export" fájlból kikerült az EAN oszlop: a súlyok
  kitöltéséhez nincs rá szükség, viszont épp ez volt a hibaforrás.

## 1.27.0 — Válogatott doboz-címke nyomtatás

- A Dobozok listájában mostantól jelölőnégyzettel kiválasztható, mely dobozok
  címkéjét szeretnéd kinyomtatni, majd a **Kijelöltek címkéje** gombbal
  egyetlen nyomtatható ívre kerülnek.
- A fejléc jelölőnégyzetével az összes éppen látható (szűrt) sor egyszerre
  kijelölhető.
- A kijelölés túléli a keresést, így több keresés eredményéből is össze
  lehet válogatni a nyomtatandó címkéket.
- Az egyedi „Címke” és az „Összes címke nyomtatása” gomb változatlanul
  megmaradt.

## 1.26.0 — Elhelyezési sorrend + rendelés-szűrő

- **Elhelyezés:** a dobozba beolvasott termékek listáján mostantól a
  legutóbb beolvasott termék van legfelül, és tolja maga előtt a többit.
  Ha egy már beolvasott terméket olvasol be újra, az is felugrik a tetejére
  (a mennyisége természetesen összeadódik).
- **Rendelések:** alapértelmezetten csak az összekészítésre váró rendelések
  látszanak. A szűrő átkapcsolható „Összekészítve” vagy „Mind” nézetre; a
  gombok felirata mutatja az egyes nézetekbe tartozó rendelések számát.

## 1.25.0 — Termék export a súlyok feltöltéséhez

- **Új: „Termékek + súlyok export”** az Import / export menüpontban. A
  letöltött CSV oszlopnevei pontosan megegyeznek azzal, amit a termék import
  elfogad, így a `suly_g` oszlop kitöltése után változtatás nélkül
  visszatölthető.
- Ahol már van megadva súly, az az exportban is megjelenik, így látszik,
  mi van kész és mi hiányzik még.
- Részletekben is haladhatsz: az üresen hagyott súly nem írja felül a
  korábban megadott értéket.

## 1.24.0 — Rendelések / komissiózás + csomagsúly-számítás

- **Új menüpont: Rendelések.** A Shoprenter adminban megnyitott rendeléseket a
  Kvikk Connect bővítmény automatikusan beküldi ide, és a leltár megmutatja,
  **melyik terméket melyik dobozból** kell kivenni.
- Doboz szerinti bejárási sorrend: a tételek dobozonként csoportosítva
  jelennek meg, hogy egy körrel végig lehessen menni a raktáron.
- Figyelmeztetés, ha egy termék nincs elhelyezve egyetlen dobozban sem, ha
  kevesebb van elhelyezve, mint amennyi kell, vagy ha a Shoprenter cikkszáma
  nem szerepel a leltár termékei között (ilyenkor a tétel akkor is látszik,
  némán soha nem tűnik el).
- Rendelések összekészítettnek jelölhetők, és a menüpont jelvénye mutatja,
  hány rendelés vár még összekészítésre.
- **Új: termék tömeg (`weight_g`).** Ha ki van töltve, a Kvikk panel
  automatikusan kiszámolja a csomag súlyát a rendelés tételeiből (kézzel
  továbbra is felülírható). Ha valamelyik termék súlya hiányzik, a panel
  ezt konkrétan megnevezve jelzi.
- A termék CSV import mostantól kezeli a súly oszlopot is
  (`suly_g` / `gramm`, vagy `suly_kg` / `suly`). Egy súly oszlop NÉLKÜLI
  készlet-import nem törli a korábban feltöltött súlyokat.

## 1.23.2 — Csomagpont-keresés javítás

- A Kvikk `/delivery-points` végpont KÖTELEZŐEN kéri a `type` paramétert is,
  amit korábban nem küldtünk - emiatt a csomagpont-keresés mindig üres
  találatot adott. Javítva.
- A `courier` és a `type` nem azonos: a Packeta Z-Pontoknál például
  `type=zpont`, de a pont `courier` mezője `packeta`. A 2026. januári
  Foxpost-Packeta összeolvadás miatt egy futárválasztáshoz több ponttípus is
  tartozhat, ezért futáronként több típust kérdezünk le és fésülünk össze
  (Foxpost: foxpost + zpont + zbox).
- A találatok mostantól a teljes címmel jelennek meg
  (pl. „A-BOX Kiskunhalas Coop Szabadkai út — 6400 Kiskunhalas, Szabadkai út 3.”),
  hogy a hasonló nevű pontok között egyértelmű legyen a választás.

## 1.23.1 — Kvikk API base URL javítás

- A Kvikk API helyes elérési útja `https://api.kvikk.hu/v1` (nem
  `https://api.kvikk.hu`, ahogy korábban feltételeztük) - a `/v1` előtag
  nélkül minden valódi végpont 404-et adott. Az alapértelmezett
  `kvikkApiBaseUrl` mostantól ezt tartalmazza.

## 1.23.0 — Kvikk Connect: valódi Kvikk API

- A Kvikk integráció mostantól a hivatalos Kvikk API-t hívja (`api.kvikk.hu`),
  nem csak MOCK módban működik. Ehhez pontosítottuk a mezőneveket a valódi
  dokumentáció alapján: a súly grammban megy ki, bekerült a kötelező
  „csomag értéke” (`value`) mező és a fiók `senderID`-ja.
- A csomagpont-keresés (`/api/kvikk/couriers/delivery-points`) mostantól
  futárfüggő, és a Kvikk teljes pontlistáját tölti le/gyorsítótárazza
  futáronként, mivel a Kvikk API nem biztosít szöveges keresést.
- A futárlista élőben, a Kvikk fiók `/account-details` végpontjáról jön
  (csak az éppen aktív futárokat mutatja), nem statikus lista.
- Valódi Kvikk webhook-fogadás: a `kvikk-webhook-signature` fejléc
  HMAC-SHA256 ellenőrzésével, a hivatalos payload-formátum szerint.
- Induláskor, ha be van kapcsolva az éles Kvikk mód, a terminál kiírja a
  fiókhoz tartozó feladókat (`senderId` beállításához) és aktív futárokat.

## 1.22.0 — Kvikk Connect integráció

- **Új: Kvikk Connect backend végpontok** (`/api/kvikk/shipments`,
  `/api/kvikk/couriers`) — a Shoprenter Silver admin felületen futó Kvikk
  Connect Chrome-bővítmény ezen keresztül hoz létre Kvikk csomagot és
  futárcímkét, Shoprenter Gold-váltás nélkül. Külön alkalmazás/szerver
  futtatása helyett mostantól a leltár app egy indítással ezt is kiszolgálja.
- Új adatbázis táblák: `kvikk_shipments` (létrehozott csomagok, dupla
  címkegenerálás elleni védelemmel), `kvikk_courier_preferences` (a
  csomagoló legutóbbi futárválasztásainak megjegyzése szállítási módonként).
- A Kvikk végpontok — a leltár app többi részétől eltérően — egy tokennel
  védettek, mivel valódi Kvikk-költséggel járó műveletet indítanak. A token
  induláskor automatikusan generálódik, és a terminálra kiíródik (lásd a
  README "Kvikk Connect" szakaszát).
- Nem került új npm függőség a projektbe — a Kvikk kliens a beépített
  `fetch`-et használja, a beállítások egy egyszerű
  `data/kvikk-config.json` fájlban tárolódnak.

## 1.21.0 — Termékfigyelő

- **Új nézet: Termékfigyelő.** Felvehető, mely termékeket (SKU/EAN alapján),
  mennyit és milyen megjegyzéssel (pl. vevő neve, rendelésszám) kell
  figyelni, mert vevő rendelte és félre kell tenni, ha előkerül.
- Ha egy figyelt termék **bárhol** a rendszerben beolvasásra kerül (Raktári
  keresés, Leltár/átvétel számlálás, Elhelyezés — akár az aktív dobozos,
  akár az egyedi elhelyezés), a normál művelet lefut, és **ezzel egyidejűleg
  egy feltűnő figyelmeztető ablak** jelenik meg.
- A figyelmeztetésben egy "Félretéve" gomb jelzi, hogy az adott darabot
  fizikailag kiemelted — ez tisztán nyilvántartási művelet, semmilyen
  raktári adatot (készletet, elhelyezést) nem mozgat. Ha ezzel eléri a
  kért mennyiséget, a tétel automatikusan "Kész" állapotba kerül.
- A bal oldali sávban egy piros jelvény mutatja, hány aktív (még nem
  teljesített) figyelt tétel van.
- A Termékfigyelő listában minden tétel (aktív és kész is) egyenként
  törölhető.

## 1.20.0 — Aktív doboz munkafolyamat, verziószám, release notes

- **Új: "Aktív doboz" gyors tömeges elhelyezés** az Elhelyezés nézetben —
  ideális, ha sok különböző terméket kell egyesével sok dobozba szétosztani
  (pl. egy teljes raktár kezdeti feltöltésekor):
  - a dobozt egyszer választod ki (beolvasással vagy a kereshető listából),
  - utána csak a termékeket kell beolvasni, mindegyik automatikusan az
    aktív dobozba kerül, azonnali mentéssel,
  - azonos termék ismételt beolvasása a munkamenet-listában is összevontan
    jelenik meg (a mennyiség nő, nem jön létre új sor),
  - "Utolsó visszavonása" gomb elgépelés esetére,
  - "Doboz lezárása" gomb: kiüríti az aktív dobozt, és automatikusan
    megnyit egy nyomtatható tartalom-összesítőt (QR-kóddal és a doboz
    teljes, aktuális tartalmával) — ezt rá lehet ragasztani a fizikai
    dobozra.
- **Verziószám a felületen** — a bal oldali sáv mutatja, melyik verzió fut
  éppen (`GET /api/version` végpont, a `package.json`-ból).
- Ez a dokumentum (`CHANGELOG.md`) létrehozva, a teljes eddigi fejlesztési
  történet visszamenőleg dokumentálva.

## 1.19.0 — Táblázat-sorok gombjainak igazítási hibája

- A Termékek, Dobozok és Munkamenetek táblázatokban a sor-műveleti gombok
  (Szerkesztés/Törlés stb.) néha külön sorra törtek keskenyebb helyen —
  mostantól mindig egy sorban maradnak, szükség esetén a táblázat inkább
  oldalra görgethető.

## 1.18.0 — Leltár-export szűrés javítása

- Az "Export CSV" gomb a Leltár/átvétel nézetben korábban mindig a teljes,
  szűretlen listát exportálta. Mostantól pontosan azt exportálja, ami épp
  a képernyőn látszik (Összes / Nem ellenőrzött / Eddig átvizsgált /
  Eltérés van / Hiány / Többlet) — a fájlnév is jelzi az aktív szűrést.

## 1.17.0 — Tömeges műveletek és kiegészítő szűrők

- **Termékek:** kijelölt (vagy akár az összes szűrt) termék egyszerre
  törölhető, jelölőnégyzetekkel és egy tranzakcióban törlő szerver oldali
  végponttal.
- **Áttekintés:** a készletmozgás-napló egy gombbal teljesen üríthető
  (pl. teszteléskor felvitt adatok eltüntetésére).
- **Elhelyezés:** minden doboz-azonosító mező kereshető javaslatlistát
  (`<datalist>`) kapott a már felvett dobozokból, a vonalkód-/QR-beolvasás
  megtartása mellett.
- **Leltár/átvétel:** új "Eddig átvizsgált" szűrő chip (a "Nem
  ellenőrzött" komplementere).

## 1.16.0 — Kamerás vonalkódolvasás és HTTPS

- A szerver mostantól egyszerre HTTP-n és HTTPS-en is fut, automatikusan
  generált önaláírt tanúsítvánnyal (nincs hozzá kézi telepítés).
- Kamera-gomb (📷) a legfontosabb beolvasó-mezők mellett (Raktári
  keresés, Leltár/átvétel, Elhelyezés) — a böngésző natív
  `BarcodeDetector` API-jára épül, külön könyvtár nélkül.
- A kamera csak `https://` kapcsolaton érhető el (böngésző-biztonsági
  szabály) — ezt a felület egyértelmű hibaüzenettel jelzi, ha valaki
  `http://`-n próbálja.

## 1.15.0 — Hamburger menü mobilon

- A korábbi, vízszintesen görgethető navigációs sáv helyett valódi,
  kicsúszó hamburger menü mobil nézetben (900px alatti szélességnél).

## 1.14.0 — Mobil-optimalizálás

- Minden táblázat saját kereten belül oldalra görgethetővé vált, hogy ne
  törjön szét keskeny képernyőn.
- Nagyobb érintési célterületek, teljes szélességű gombok és mezők,
  átrendezett fejlécek 480px alatti (telefon méretű) képernyőkön.

## 1.13.0 — Doboz-tartalom kivétele közvetlenül

- A doboz "Részletek" ablakában minden tartalom-sor mellé "Kivétel" gomb
  került — nem kell átváltani az Elhelyezés nézetbe egy egyszerű
  kivételhez.

## 1.12.0 — Figyelmeztetés nulla elméleti készletű terméknél

- Ha egy 0 (vagy negatív) elméleti készletű terméket próbálsz elhelyezni,
  egy átléphető megerősítő kérdés figyelmeztet — tipikusan elgépelt vagy
  rossz vonalkódra utal.

## 1.11.0 — Doboz-részletek modálban, kereséssel

- A "Részletek" nézet a lista alján megjelenő panel helyett egy felugró
  ablakban (modalban) nyílik — nagy dobozszámnál (100+) sem kell görgetni
  érte.
- Kereső mező a Dobozok nézet tetején, azonosító/megnevezés szerint.

## 1.10.0 — QR-címkék és beolvasás-vezérelt elhelyezés

- Minden dobozhoz nyomtatható QR-címke generálható (egyenként vagy
  egyszerre az összes doboznak) — a fizikai dobozra ragasztva ezután
  vonalkódolvasóval vagy telefonkamerával is beolvasható a doboz-azonosító.
- Az Elhelyezés "Termék dobozba helyezése" űrlapja beolvasás-vezérelt
  munkafolyamatot kapott: termék beolvasása → Enter a doboz mezőre ugrik →
  doboz beolvasása → Enter azonnal ment.
- A szerver mostantól a helyi hálózaton (LAN) is elérhető, induláskor
  kiírja a hálózati címet — több eszközről egyszerre lehet dolgozni.

## 1.9.0 — Sorszám-oszlop

- "#" oszlop a Termékek és a Leltár-tételek táblázatokban, a mindenkori
  (szűrt) sorrendet követve.

## 1.8.0 — Élő szűrő-számlálók a Leltár/átvételnél

- A leltár szűrő-chipek (Összes / Nem ellenőrzött / Eltérés van / Hiány /
  Többlet) mindegyike mutatja a hozzá tartozó darabszámot, a lista
  fejléce pedig az aktuálisan látható találatok számát.

## 1.7.0 — Darabszám-jelvények

- A Termékek és Dobozok nézet fejlécében egy jelvény mutatja az aktuális
  (esetleg szűrt) találatok számát.

## 1.6.0 — Leltár-munkamenet törlése

- A Leltár/átvétel munkamenetek listájában "Törlés" gomb, megerősítő
  kérdéssel (nyitott munkamenetnél külön figyelmeztetéssel).

## 1.5.0 — Böngésző-gyorsítótárazás kikapcsolása

- A szerver mostantól minden statikus fájlon (HTML/CSS/JS) letiltja a
  böngésző-gyorsítótárazást, hogy frissítés után mindig a friss verzió
  töltődjön be, ne egy elavult, cache-elt változat.

## 1.4.0 — Hiányzó törlés-funkciók pótlása a felületen

- A backend már korábban is tudott terméket és dobozt törölni, de a
  felületen sehol nem volt hozzá gomb — pótolva, megerősítő kérdéssel és
  a még elhelyezett készletre vonatkozó figyelmeztetéssel.

## 1.3.0 — Globális vonalkódolvasó-figyelő

- Beépített figyelő, ami akkor is felismeri egy fizikai vonalkódolvasó
  jellegzetesen gyors beütését, ha véletlenül nem a megfelelő mező van
  fókuszban — időzítés alapján megkülönbözteti az emberi gépeléstől, és
  automatikusan a megfelelő helyre (leltár-számlálás vagy raktári
  keresés) irányítja a beolvasást.

## 1.2.0 — Windows-kompatibilitási javítás

- Az adatbázis-motor `better-sqlite3`-ról a Node.js-be beépített
  `node:sqlite` modulra váltott, hogy Windows-on ne legyen szükség natív
  fordításra (Visual Studio Build Tools) a telepítéskor.
- Javítva egy hiba, ami miatt egy doboz törlése sikertelen volt, ha
  szerepelt a készletmozgás-naplóban (`stock_movements` idegenkulcs-
  hivatkozás `ON DELETE SET NULL`-ra állítva).

## 1.1.0 — CSV-import finomítás

- Sikeresen tesztelve a Shoprenter-export valós formátumával: a
  vonalkód-oszlop tudományos jelölésének javítása, illetve a terméknévből
  méret és szín automatikus kinyerése import-kész CSV előállításához.

## 1.0.0 — Kezdeti verzió

Az eredeti funkcionális specifikáció alapján felépített teljes
alkalmazás:

- **Készletátvétel / leltár** — munkamenetek, folyamatos vonalkód-
  számlálás, gyors "+10" funkció, kézi korrekció, eltérés-kimutatás.
- **Raktári elhelyezés** — termékek fizikai elhelyezése dobozokban/
  tárolóhelyeken, áthelyezés, kivétel, dobozkapacitás-kezelés.
- **Raktári keresés** — EAN/SKU alapján azonnali termék- és
  elhelyezés-lekérdezés.
- **Termékek és dobozok** — teljes CRUD felület.
- **Import / export** — CSV-alapú termékimport (Shoprenter-kompatibilis
  oszlopnevekkel), raktári elhelyezés és dobozok CSV-exportja.
- **Áttekintés** — raktár-kihasználtsági mutatók, készletmozgás-napló.
- Node.js + Express backend, SQLite adatbázis, egyszerű, build-lépés
  nélküli HTML/CSS/vanilla JS felület.
