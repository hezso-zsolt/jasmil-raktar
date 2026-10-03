-- Jasmil leltár- és raktárelhelyezési alkalmazás
-- Adatbázis séma (SQLite)

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  ean TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  size TEXT,
  color TEXT,
  weight_g REAL,                       -- termék tömege grammban (csomagsúly-számításhoz)
  theoretical_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- Raktári hely / doboz (a specifikációban a kettő ugyanazt az azonosító-sémát
-- használja, egy fizikai tárolóegységet jelölnek, ezért egy táblában kezeljük).
CREATE TABLE IF NOT EXISTS boxes (
  id TEXT PRIMARY KEY,                 -- pl. 'D-001'
  label TEXT,                          -- megnevezés
  type TEXT,                           -- doboz / polc / raktári hely
  width_mm INTEGER,
  height_mm INTEGER,
  depth_mm INTEGER,
  volume_l REAL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dobozkapacitás termékenként (12. pont): egy adott dobozban egy adott
-- termékből maximum mennyi helyezhető el.
CREATE TABLE IF NOT EXISTS box_capacities (
  box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  max_qty INTEGER NOT NULL,
  PRIMARY KEY (box_id, product_id)
);

-- Elhelyezés: termék <-> doboz, mennyiséggel (13. pont, N:N kapcsolat)
CREATE TABLE IF NOT EXISTS placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, box_id)
);

-- Készletmozgás napló (24. pont)
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_box_id TEXT REFERENCES boxes(id) ON DELETE SET NULL,
  dest_box_id TEXT REFERENCES boxes(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL,
  operation TEXT NOT NULL   -- 'bevetelezes' | 'kivetel' | 'athelyezes' | 'leltar_korrekcio'
);

-- Termékfigyelő: olyan termékek, amikre külön figyelmeztetést kérünk,
-- ha beolvasásra kerülnek (pl. mert vevő rendelte, félre kell tenni).
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  requested_qty INTEGER NOT NULL,
  fulfilled_qty INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',   -- 'aktiv' | 'kesz'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watchlist_product ON watchlist(product_id);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nyitott',  -- 'nyitott' | 'lezart'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- Az adott leltár-munkamenetben termékenkénti számlálási eredmény.
-- theoretical_qty: a munkamenet indításakor "befagyasztott" elméleti készlet.
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  theoretical_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,   -- 0/1: volt-e legalább egy beolvasás
  last_scanned_at TEXT,
  UNIQUE (session_id, product_id)
);

-- Az adott munkamenetben végrehajtott lépések naplója (undo-hoz is)
CREATE TABLE IF NOT EXISTS inventory_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Kvikk Connect (Shoprenter -> Kvikk futárcímke integráció)
-- ============================================================

-- Egy Shoprenter rendeléshez létrehozott Kvikk csomag/futárcímke.
-- A shoprenter_order_id UNIQUE megkötése biztosítja, hogy ugyanahhoz a
-- rendeléshez ne jöhessen létre kétszer Kvikk csomag (dupla címkegenerálás
-- elleni védelem).
CREATE TABLE IF NOT EXISTS kvikk_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoprenter_order_id TEXT NOT NULL UNIQUE,
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_email TEXT,
  address_zip TEXT,
  address_city TEXT,
  address_street TEXT,
  address_country TEXT DEFAULT 'HU',
  cod_amount REAL,
  cod_currency TEXT DEFAULT 'HUF',
  package_value REAL,                        -- csomag értéke Ft-ban (Kvikk "value" mezője, kötelező)
  weight_kg REAL,
  courier TEXT NOT NULL,
  pickup_point_id TEXT,
  pickup_point_type TEXT,                    -- a Kvikk deliveryPointType mezője, a keresési találatból átvéve
  shipping_method_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'label_created' | 'failed'
  kvikk_tracking_number TEXT,
  courier_tracking_number TEXT,
  label_base64 TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kvikk_shipments_order ON kvikk_shipments(shoprenter_order_id);

-- Melyik Shoprenter szállítási mód szöveghez legutóbb melyik Kvikk futárt
-- választotta a csomagoló - ezt ajánljuk fel legközelebb alapértelmezettként.
CREATE TABLE IF NOT EXISTS kvikk_courier_preferences (
  shipping_method_text TEXT PRIMARY KEY,
  courier TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Shoprenter rendelések (komissiózáshoz)
-- ============================================================

-- A Shoprenter adminból a Kvikk Connect bővítménnyel beszippantott rendelés.
-- Szándékosan külön a kvikk_shipments táblától: egy rendelést akkor is látni
-- akarunk a komissiózó listán, ha még nem készült hozzá Kvikk címke.
CREATE TABLE IF NOT EXISTS shoprenter_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoprenter_order_id TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  shipping_method_text TEXT,
  payment_method_text TEXT,
  gross_total REAL,
  recipient_phone TEXT,
  recipient_email TEXT,
  address_zip TEXT,
  address_city TEXT,
  address_street TEXT,
  address_country TEXT,
  cod_amount REAL,
  picked_at TEXT,                       -- mikor jelölték összekészítettnek (NULL = még nincs kész)
  stock_deducted_at TEXT,               -- mikor könyvelték le a készletcsökkentést (NULL = még nincs könyvelve)
  verified_at TEXT,                     -- mikor stimmelt hiánytalanul a vonalkódos visszaellenőrzés (NULL = nincs / eltér)
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A rendelés tételei. A product_id szándékosan NULLABLE: ha egy Shoprenter
-- cikkszámhoz nincs párja a leltár termékei közt, a tételt akkor is eltároljuk
-- (és a felületen jelezzük), nem dobjuk el némán.
CREATE TABLE IF NOT EXISTS shoprenter_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES shoprenter_orders(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  shoprenter_product_id TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sr_order_items_order ON shoprenter_order_items(order_id);

-- Egy rendeléshez könyvelt készletcsökkentés tételes bontása (melyik
-- dobozból mennyi ment le). Ez teszi lehetővé a pontos visszavonást, ha a
-- csomagoló tévedésből könyvelt, vagy a rendelés mégsem lett feladva.
CREATE TABLE IF NOT EXISTS order_stock_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES shoprenter_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  box_id TEXT REFERENCES boxes(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_stock_deductions_order ON order_stock_deductions(order_id);

-- Összekészítés utáni vonalkódos visszaellenőrzés: minden beolvasás egy sor.
-- Szándékosan nem a rendelés tételeihez (shoprenter_order_items.id) kötjük,
-- mert a rendelés újraimportálásakor a tételek újraíródnak - az összevetés
-- mindig a beolvasott termék (product_id) vagy kód alapján, frissen készül.
-- A rendelésben nem szereplő / ismeretlen kódokat is eltároljuk, hogy a
-- felület meg tudja mutatni, mi került tévesen a csomagba.
CREATE TABLE IF NOT EXISTS order_verify_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES shoprenter_orders(id) ON DELETE CASCADE,
  code TEXT,                            -- a beolvasott (vagy kézzel jóváhagyott tételnél a cikkszám)
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  manual INTEGER NOT NULL DEFAULT 0,    -- 1 = vonalkód nélkül, kézzel pipálva
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_verify_scans_order ON order_verify_scans(order_id);

-- ============================================================
-- Dobozonkénti újraszámolás (leltár-korrekció)
-- ============================================================

-- Egy doboz újraszámolási munkamenete. Amíg 'szamolas' vagy 'osszesitve'
-- állapotban van, a doboz zárolva van: nem lehet bele elhelyezni, belőle
-- kivenni, vagy áthelyezni (lásd lib/boxLock.js) - így a fizikai
-- újraszámolás közben (amikor a doboz tartalma ténylegesen a kézben/a
-- pulton van) nem csúszhat el az adat egy párhuzamos művelettől.
--   'szamolas'   - folyamatban, vak számolás (a nyilvántartott mennyiség
--                  még nem látszik a felületen, hogy ne "igazítsanak hozzá")
--   'osszesitve' - a számolás lezárva, az eltérés-összevetés elkészült és
--                  látszik, de MÉG NEM lett alkalmazva a placements táblán -
--                  a doboz még mindig zárolva van, amíg jóváhagyás/elvetés
--                  nem történik
--   'lezart'     - jóváhagyva, az eltérések bekerültek a placements táblába
--                  és a mozgásnaplóba ('leltar_korrekcio'), a doboz feloldva
--   'megszakitva'- elvetve (számolás közben vagy összesítés után), semmi
--                  nem változott a placements táblán, a doboz feloldva
CREATE TABLE IF NOT EXISTS box_recounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'szamolas',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_box_recounts_box ON box_recounts(box_id);
-- Egyszerre csak egy AKTÍV (szamolas VAGY osszesitve állapotú) újraszámolás
-- lehet egy dobozon - ez a parciális egyedi index kényszeríti ki.
CREATE UNIQUE INDEX IF NOT EXISTS idx_box_recounts_one_active
  ON box_recounts(box_id) WHERE status IN ('szamolas', 'osszesitve');

-- Termékenkénti eredmény egy újraszámolási munkamenetben.
-- recorded_qty: a doboz nyilvántartott (placements) mennyisége a számolás
--   INDÍTÁSAKOR - mivel a doboz onnantól zárolva van, ez időközben nem
--   változhat, ezért elég egyszer, induláskor lefényképezni.
-- counted_qty: amit a csomagoló ténylegesen beolvasott - ezt a felület
--   'szamolas' állapotban NEM veti össze a recorded_qty-vel (vak számolás).
CREATE TABLE IF NOT EXISTS box_recount_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recount_id INTEGER NOT NULL REFERENCES box_recounts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  recorded_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  UNIQUE (recount_id, product_id)
);

-- Egyes beolvasási lépések naplója, csak a "visszavonás" (undo) működéséhez -
-- ugyanaz a minta, mint az inventory_actions táblánál.
CREATE TABLE IF NOT EXISTS box_recount_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recount_id INTEGER NOT NULL REFERENCES box_recounts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Bejövő számlák ----------

-- Szállítók. Az adószám alapján ismeri fel az app egy új számla küldőjét,
-- ha attól a szállítótól már jóváhagytunk korábban számlát.
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tax_number TEXT,
  default_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tax ON suppliers(tax_number);

-- status: 'ellenorizendo' = a mappából/feltöltésből automatikusan beolvasva,
--                          még át kell nézni
--         'fizetendo'     = jóváhagyva, még nincs kifizetve
--         'fizetve'       = kifizetve (paid_at: a fizetés napja)
-- A "lejárt" állapotot nem tároljuk: fizetendő + a határidő elmúlt.
-- file_name: a data/szamlak/ mappán belüli relatív útvonal (a PDF másolata)
-- file_hash: a PDF SHA-256 lenyomata, hogy ugyanazt a fájlt ne olvassuk be kétszer
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  supplier_tax_number TEXT,
  invoice_number TEXT,
  issue_date TEXT,
  fulfillment_date TEXT,
  due_date TEXT,
  net_amount REAL,
  vat_amount REAL,
  gross_amount REAL,
  currency TEXT NOT NULL DEFAULT 'HUF',
  payment_method TEXT,
  category TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'ellenorizendo',
  paid_at TEXT,
  source TEXT NOT NULL DEFAULT 'kezi',
  file_name TEXT,
  original_file_name TEXT,
  file_hash TEXT,
  extract_warnings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_hash ON invoices(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, due_date);

-- Egyszerű kulcs-érték beállítások (pl. a figyelt számla-mappa útvonala).
-- Az adatbázisban vannak, így a napi mentés ezeket is menti.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
