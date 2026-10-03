// ---------- Segédfüggvények ----------

function toast(message, type = 'ok') {
  const holder = document.getElementById('toast-holder');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  holder.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

async function api(method, url, body, extraHeaders) {
  const opts = { method, headers: { ...(extraHeaders || {}) } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* pl. 204 No Content */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Hiba (${res.status})`;
    const err = new Error(msg);
    err.data = data; // hibaválasz teljes törzse (pl. részletes lista), ha kell a hívónak
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// ---------- Navigáció ----------

const VIEW_TITLES = {
  search: 'Raktári keresés',
  inventory: 'Leltár / átvétel',
  placement: 'Elhelyezés',
  boxes: 'Dobozok',
  products: 'Termékek',
  watchlist: 'Termékfigyelő',
  orders: 'Rendelések',
  importexport: 'Import / export',
  invoices: 'Számlák',
  kvikkstats: 'Kvikk statisztika',
  overview: 'Áttekintés',
};

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('view-title').textContent = VIEW_TITLES[name];
  closeMobileNav();

  if (name === 'search') document.getElementById('search-scan').focus();
  if (name === 'boxes') loadBoxes();
  if (name === 'products') loadProducts();
  if (name === 'watchlist') loadWatchlist();
  if (name === 'orders') { showOrdersList(); loadOrders(); }
  if (name === 'overview') loadOverview();
  if (name === 'kvikkstats') loadKvikkStats();
  if (name === 'invoices') loadInvoices();
  if (name === 'inventory') { showSessionList(); loadSessions(); }
  if (name === 'placement') refreshBoxDatalist();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ---------- Hamburger menü (mobil) ----------

function openMobileNav() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mobile-nav-backdrop').classList.add('open');
}
function closeMobileNav() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-nav-backdrop').classList.remove('open');
}
document.getElementById('mobile-menu-toggle').addEventListener('click', openMobileNav);
document.getElementById('sidebar-close').addEventListener('click', closeMobileNav);
document.getElementById('mobile-nav-backdrop').addEventListener('click', closeMobileNav);

// =====================================================================
// GLOBÁLIS VONALKÓDOLVASÓ-FIGYELŐ
//
// Egy USB/Bluetooth HID-vonalkódolvasó a beolvasott kódot rendkívül gyorsan
// "gépeli be" (karakterek között ~ezredmásodpercek), majd Enter-rel zárja.
// Amíg a megfelelő beviteli mező fókuszban van, ezt a per-mezős keydown
// figyelők (lásd lentebb) simán kezelik. Ez a globális figyelő egy
// biztonsági háló arra az esetre, ha a felhasználó közben véletlenül
// máshova kattintott a nézeten belül (pl. egy táblázat sorára) — ilyenkor
// a beolvasás enélkül elveszne.
// =====================================================================

let scanBuffer = '';
let scanKeyTimes = [];
let lastScanKeyTime = 0;
const SCAN_MAX_GAP_MS = 400; // ha ennél tovább vár a következő karakter, új pufferként kezeljük (a régi elévült)
const SCAN_MIN_LENGTH = 3; // ennél rövidebb "kód" inkább véletlen billentyűzés
const SCAN_MAX_AVG_INTERVAL_MS = 45; // egy vonalkódolvasó karakterei ennél sűrűbben jönnek; emberi gépelés ennél lassabb

function isEditableElement(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  // Ha épp egy beviteli mezőben gépelnek/scannelnek, azt a mezőhöz kötött
  // saját figyelő kezeli — itt nincs teendő.
  if (isEditableElement(document.activeElement)) return;

  const now = Date.now();
  if (now - lastScanKeyTime > SCAN_MAX_GAP_MS) {
    scanBuffer = '';
    scanKeyTimes = [];
  }
  lastScanKeyTime = now;

  if (e.key === 'Enter') {
    const code = scanBuffer.trim();
    scanBuffer = '';
    const times = scanKeyTimes;
    scanKeyTimes = [];

    if (code.length < SCAN_MIN_LENGTH || times.length < SCAN_MIN_LENGTH) return;

    // Csak akkor kezeljük beolvasásnak, ha a karakterek valóban
    // vonalkódolvasó-sebességgel érkeztek — különben simán elengedjük
    // (pl. valaki véletlenül néhány billentyűt nyom, miközben nincs
    // fókuszban egy mező sem, majd Entert üt egy másik okból).
    const span = times[times.length - 1] - times[0];
    const avgInterval = span / (times.length - 1);
    if (avgInterval > SCAN_MAX_AVG_INTERVAL_MS) return;

    e.preventDefault();
    routeGlobalScan(code);
    return;
  }

  // Csak a nyomtatható, egykarakteres billentyűket gyűjtjük (a vonalkód
  // számjegyei/betűi) — a Shift, Tab, nyilak stb. nem kerülnek a pufferbe.
  if (e.key.length === 1) {
    scanBuffer += e.key;
    scanKeyTimes.push(now);
  }
});

function routeGlobalScan(code) {
  const activeBtn = document.querySelector('.nav-item.active');
  const view = activeBtn ? activeBtn.dataset.view : null;

  if (view === 'inventory' && currentSessionId) {
    fillAndSubmit('inv-scan', code);
    return;
  }

  const recountCountingVisible = recountId && !document.getElementById('recount-counting').classList.contains('hidden');
  if (view === 'placement' && recountCountingVisible) {
    fillAndSubmit('recount-scan', code);
    return;
  }

  if (view === 'placement' && activeBoxId) {
    fillAndSubmit('active-box-product', code);
    return;
  }

  if (view === 'orders' && currentPickingOrderId) {
    fillAndSubmit('verify-scan', code);
    return;
  }

  // Minden más esetben (más nézet, vagy leltár-nézet nyitott munkamenet
  // nélkül) a legegyszerűbb, mindig hasznos válasz: megmutatjuk, mi ez a
  // termék a Raktári keresésben — akkor is, ha közben nézetet kell váltani.
  if (view !== 'search') showView('search');
  fillAndSubmit('search-scan', code);
}

function fillAndSubmit(inputId, code) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = code;
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

// =====================================================================
// RAKTÁRI KERESÉS
// =====================================================================

const searchInput = document.getElementById('search-scan');
const searchResult = document.getElementById('search-result');

searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const code = searchInput.value.trim();
  if (!code) return;
  try {
    const product = await api('GET', `/api/products/lookup?code=${encodeURIComponent(code)}`);
    renderSearchResult(product);
  } catch (err) {
    searchResult.className = 'result-panel';
    searchResult.innerHTML = '';
    searchResult.appendChild(el('p', { class: 'hint', style: 'color:var(--bad)' }, err.message));
  }
  checkWatchlist(code);
  searchInput.select();
});

function renderSearchResult(p) {
  searchResult.className = 'result-panel';
  searchResult.innerHTML = '';
  const head = el('div', { class: 'product-head' }, [
    el('div', {}, [
      el('h2', {}, p.name),
      el('div', { class: 'product-meta' }, `SKU: ${p.sku}   ·   EAN: ${p.ean || '—'}   ·   ${p.category || ''} ${p.size || ''} ${p.color || ''}`),
    ]),
    el('div', { class: 'stock-badge' }, `${p.physical_stock} db`),
  ]);

  const locList = el('div', { class: 'location-list' });
  if (!p.placements.length) {
    locList.appendChild(el('p', { class: 'hint' }, '⚠ Ehhez a termékhez jelenleg nincs raktári hely hozzárendelve.'));
  } else {
    p.placements.forEach((pl) => {
      locList.appendChild(
        el('div', { class: 'location-row' }, [
          el('span', {}, `📦 ${pl.box_id}${pl.label ? ' — ' + pl.label : ''}`),
          el('span', {}, `${pl.qty} db`),
        ])
      );
    });
  }

  searchResult.appendChild(el('div', { class: 'product-card' }, [head, locList]));
}

// =====================================================================
// LELTÁR / ÁTVÉTEL
// =====================================================================

let currentSessionId = null;
let currentFilter = 'all';

async function loadSessions() {
  const sessions = await api('GET', '/api/inventory/sessions');
  const tbody = document.querySelector('#sessions-table tbody');
  tbody.innerHTML = '';
  if (!sessions.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'hint' }, 'Még nincs egy munkamenet sem.')));
    return;
  }
  sessions.forEach((s) => {
    const tr = el('tr', {}, [
      el('td', {}, s.name),
      el('td', {}, el('span', { class: `tag ${s.status === 'nyitott' ? 'tag-ok' : 'tag-neutral'}` }, s.status === 'lezart' ? 'lezárt' : s.status)),
      el('td', { class: 'mono' }, s.created_at),
      el('td', { class: 'mono' }, s.closed_at || '—'),
      el('td', { class: 'row-actions' }, [
        el('button', { class: 'btn btn-ghost btn-small', onclick: () => openSession(s.id) }, 'Megnyitás'),
        el('button', { class: 'btn btn-danger-outline btn-small', onclick: () => deleteSession(s) }, 'Törlés'),
      ]),
    ]);
    tbody.appendChild(tr);
  });
}

async function deleteSession(s) {
  const warning = s.status === 'nyitott'
    ? ' Figyelem: ez a munkamenet még nyitott, a benne eddig rögzített számlálási eredmények is véglegesen elvesznek.'
    : '';
  if (!confirm(`Biztosan törlöd a(z) "${s.name}" leltár-munkamenetet?${warning}`)) return;
  try {
    await api('DELETE', `/api/inventory/sessions/${s.id}`);
    toast('Munkamenet törölve.');
    loadSessions();
  } catch (err) {
    toast(err.message, 'err');
  }
}

document.getElementById('btn-new-session').addEventListener('click', async () => {
  const nameInput = document.getElementById('new-session-name');
  const name = nameInput.value.trim();
  if (!name) return toast('Adj nevet a munkamenetnek.', 'err');
  try {
    const session = await api('POST', '/api/inventory/sessions', { name });
    nameInput.value = '';
    toast('Munkamenet létrehozva.');
    await loadSessions();
    openSession(session.id);
  } catch (err) { toast(err.message, 'err'); }
});

function showSessionList() {
  document.getElementById('inventory-session-list').classList.remove('hidden');
  document.getElementById('inventory-session-detail').classList.add('hidden');
  currentSessionId = null;
}

document.getElementById('btn-back-sessions').addEventListener('click', () => { showSessionList(); loadSessions(); });

async function openSession(id) {
  currentSessionId = id;
  currentFilter = 'all';
  document.querySelectorAll('#view-inventory .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all'));
  document.getElementById('inventory-session-list').classList.add('hidden');
  document.getElementById('inventory-session-detail').classList.remove('hidden');
  document.getElementById('last-scanned').innerHTML = '';
  await refreshSessionItems();
  const invScan = document.getElementById('inv-scan');
  invScan.value = '';
  invScan.focus();
}

const FILTER_LABELS = {
  all: 'Összes',
  nemellenorzott: 'Nem ellenőrzött',
  ellenorzott: 'Eddig átvizsgált',
  eltero: 'Eltérés van',
  hiany: 'Hiány',
  tobblet: 'Többlet',
};

function matchesFilter(item, filter) {
  switch (filter) {
    case 'nemellenorzott': return !item.checked;
    case 'ellenorzott': return item.checked;
    case 'eltero': return item.difference !== 0;
    case 'hiany': return item.difference < 0;
    case 'tobblet': return item.difference > 0;
    default: return true;
  }
}

async function refreshSessionItems() {
  // Mindig a teljes, szűretlen listát kérjük le, és a szűrést kliens oldalon
  // végezzük — így egyetlen hálózati kéréssel meg tudjuk mutatni az összes
  // kategória (Összes / Nem ellenőrzött / Eltérés / Hiány / Többlet)
  // darabszámát is a chipeken, nem csak az épp kiválasztottét.
  const data = await api('GET', `/api/inventory/sessions/${currentSessionId}/items?filter=all`);
  const allItems = data.items;

  document.querySelectorAll('#view-inventory .chip').forEach((chip) => {
    const filter = chip.dataset.filter;
    const count = allItems.filter((it) => matchesFilter(it, filter)).length;
    chip.textContent = `${FILTER_LABELS[filter]} (${count})`;
  });

  const visibleItems = allItems.filter((it) => matchesFilter(it, currentFilter));

  document.getElementById('session-title').textContent =
    `${data.session.name} (${data.session.status}) — ${visibleItems.length} ${FILTER_LABELS[currentFilter].toLowerCase()}`;

  const tbody = document.querySelector('#inventory-items-table tbody');
  tbody.innerHTML = '';
  visibleItems.forEach((it, idx) => {
    const diffTag = it.difference === 0
      ? el('span', { class: 'tag tag-neutral' }, '0')
      : el('span', { class: `tag ${it.difference < 0 ? 'tag-bad' : 'tag-ok'}` }, (it.difference > 0 ? '+' : '') + it.difference);
    tbody.appendChild(
      el('tr', {}, [
        el('td', { class: 'mono' }, String(idx + 1)),
        el('td', { class: 'mono' }, it.sku),
        el('td', { class: 'mono' }, it.ean || '—'),
        el('td', {}, it.name),
        el('td', { class: 'mono' }, String(it.theoretical_qty)),
        el('td', { class: 'mono' }, String(it.counted_qty)),
        el('td', {}, diffTag),
        el('td', {}, it.checked ? '✓' : '—'),
        el('td', {}, el('button', {
          class: 'btn btn-ghost btn-small',
          onclick: () => promptSetQty(it),
        }, 'Módosítás')),
      ])
    );
  });
  if (!visibleItems.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '9', class: 'hint' }, 'Nincs a szűrésnek megfelelő tétel.')));
  }
}

function promptSetQty(item) {
  const value = prompt(`${item.name} — új megszámolt mennyiség:`, item.counted_qty);
  if (value === null) return;
  const qty = parseInt(value, 10);
  if (!Number.isInteger(qty) || qty < 0) return toast('Érvénytelen mennyiség.', 'err');
  api('POST', `/api/inventory/sessions/${currentSessionId}/set`, { product_id: item.product_id, counted_qty: qty })
    .then(() => { toast(`${item.name}: ${qty} db rögzítve.`); refreshSessionItems(); })
    .catch((err) => toast(err.message, 'err'));
}

document.querySelectorAll('#view-inventory .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#view-inventory .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    refreshSessionItems();
  });
});

const invScanInput = document.getElementById('inv-scan');

async function scanIntoSession(delta) {
  const code = invScanInput.value.trim();
  if (!code) return;
  try {
    const item = await api('POST', `/api/inventory/sessions/${currentSessionId}/scan`, { code, delta });
    renderLastScanned(item);
    await refreshSessionItems();
  } catch (err) {
    toast(err.message, 'err');
  }
  checkWatchlist(code);
  invScanInput.value = '';
  invScanInput.focus();
}

invScanInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') scanIntoSession(1);
});

document.querySelectorAll('#view-inventory .btn-quick').forEach((btn) => {
  btn.addEventListener('click', () => scanIntoSession(parseInt(btn.dataset.qty, 10)));
});

document.getElementById('btn-undo').addEventListener('click', async () => {
  try {
    const item = await api('POST', `/api/inventory/sessions/${currentSessionId}/undo`, {});
    renderLastScanned(item, true);
    toast('Utolsó művelet visszavonva.');
    await refreshSessionItems();
  } catch (err) { toast(err.message, 'err'); }
  invScanInput.focus();
});

function renderLastScanned(item, undone = false) {
  const box = document.getElementById('last-scanned');
  box.innerHTML = '';
  box.appendChild(
    el('div', { class: 'result-panel' }, [
      el('div', { class: 'product-head' }, [
        el('div', {}, [
          el('h2', {}, item.name),
          el('div', { class: 'product-meta' }, `SKU: ${item.sku}   ·   EAN: ${item.ean || '—'}`),
        ]),
        el('div', { class: 'stock-badge' }, `${item.counted_qty} db`),
      ]),
      el('p', { class: 'hint' }, [
        `Elméleti készlet: ${item.theoretical_qty} db   ·   Eltérés: `,
        el('strong', { style: item.difference < 0 ? 'color:var(--bad)' : item.difference > 0 ? 'color:var(--ok)' : '' },
          (item.difference > 0 ? '+' : '') + item.difference + ' db'),
        undone ? ' (visszavonva)' : '',
      ]),
    ])
  );
}

document.getElementById('btn-close-session').addEventListener('click', async () => {
  if (!confirm('Biztosan lezárod ezt a leltár-munkamenetet? Utána már nem módosítható.')) return;
  try {
    await api('POST', `/api/inventory/sessions/${currentSessionId}/close`, {});
    toast('Munkamenet lezárva.');
    await refreshSessionItems();
  } catch (err) { toast(err.message, 'err'); }
});

document.getElementById('btn-export-session').addEventListener('click', () => {
  window.open(`/api/io/inventory/${currentSessionId}/export?filter=${currentFilter}`, '_blank');
});

// =====================================================================
// AKTÍV DOBOZ — GYORS TÖMEGES ELHELYEZÉS
//
// Egy dobozt egyszer kiválasztunk ("aktívvá" tesszük), utána minden
// termék-beolvasás automatikusan abba a dobozba kerül, amíg másik
// dobozt nem választunk, vagy le nem zárjuk. Azonos termék ismételt
// beolvasása a listában is összevonva jelenik meg (mennyiség nő),
// nem új sorként — ugyanúgy, ahogy a fizikai elhelyezés is működik.
// =====================================================================

let activeBoxId = null;
let activeBoxSessionItems = new Map(); // product_id -> { sku, name, qty, size }
let activeBoxLastAction = null; // { product_id, sku, name, delta } — egylépéses visszavonáshoz
let activeBoxExpectedSize = null; // a doboz jelenlegi tartalmából automatikusan felismert domináns méret (null = nincs egyértelmű)

/**
 * A doboz "jellemző méretét" a jelenlegi (frissen lekérdezett) tartalmából
 * ismerjük fel: méret szerint összesítjük a darabszámokat (a méret nélküli
 * termékeket figyelmen kívül hagyva), és ha van EGYÉRTELMŰ többségi méret
 * (a legtöbb darabból van, nem döntetlen), azt tekintjük elvártnak. Üres
 * vagy már eleve kiegyenlítetten vegyes dobozoknál nincs egyértelmű
 * referencia, ilyenkor nem jelzünk semmit.
 */
function computeExpectedSize(contents) {
  const totals = new Map();
  for (const c of contents) {
    if (!c.size) continue;
    totals.set(c.size, (totals.get(c.size) || 0) + c.qty);
  }
  if (totals.size === 0) return null;
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 1) return sorted[0][0];
  if (sorted[0][1] > sorted[1][1]) return sorted[0][0]; // egyértelmű többség, nem döntetlen
  return null;
}

async function refreshActiveBoxExpectedSize() {
  if (!activeBoxId) return;
  try {
    const box = await api('GET', `/api/boxes/${encodeURIComponent(activeBoxId)}`);
    activeBoxExpectedSize = computeExpectedSize(box.contents);
  } catch (e) {
    activeBoxExpectedSize = null;
  }
}

function renderActiveBoxItems() {
  const tbody = document.querySelector('#active-box-items-table tbody');
  tbody.innerHTML = '';
  if (!activeBoxSessionItems.size) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '3', class: 'hint' }, 'Ebben a munkamenetben még nem lett termék beolvasva ebbe a dobozba.')));
    return;
  }
  // A legutóbb beolvasott termék kerüljön legfelülre, és tolja maga előtt a
  // többit: a Map beszúrási sorrendet tart, ezért a végéről visszafelé
  // haladunk. (A beolvasásnál a már meglévő tételt is a Map végére tesszük -
  // lásd scanActiveBoxProduct -, hogy egy újraolvasott termék is felugorjon.)
  Array.from(activeBoxSessionItems.values())
    .reverse()
    .forEach((item) => {
      const sizeMismatch = activeBoxExpectedSize && item.size && item.size !== activeBoxExpectedSize;
      tbody.appendChild(el('tr', { class: sizeMismatch ? 'row-size-mismatch' : '' }, [
        el('td', { class: 'mono' }, item.sku),
        el('td', {}, [
          item.name,
          sizeMismatch
            ? el('span', { class: 'tag tag-bad', style: 'margin-left:8px', title: `Ebben a dobozban eddig jellemzően "${activeBoxExpectedSize}" méret volt` }, `⚠️ ${item.size} — eltér a doboz méretétől (${activeBoxExpectedSize})`)
            : '',
        ]),
        el('td', { class: 'mono' }, String(item.qty)),
      ]));
    });
}

async function activateBox(boxId) {
  const feedback = document.getElementById('active-box-select-feedback');
  feedback.textContent = '';
  try {
    const box = await api('GET', `/api/boxes/${encodeURIComponent(boxId)}`);
    activeBoxId = box.id;
    activeBoxSessionItems = new Map();
    activeBoxLastAction = null;
    activeBoxExpectedSize = computeExpectedSize(box.contents);
    document.getElementById('active-box-id-label').textContent = box.id + (box.label ? ` — ${box.label}` : '');
    document.getElementById('active-box-select-row').classList.add('hidden');
    document.getElementById('active-box-active').classList.remove('hidden');
    renderActiveBoxItems();
    document.getElementById('active-box-input').value = '';
    document.getElementById('active-box-product').value = '';
    document.getElementById('active-box-product').focus();
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
}

function closeActiveBox() {
  if (!activeBoxId) return;
  window.open(`/api/boxes/${encodeURIComponent(activeBoxId)}/manifest`, '_blank');
  activeBoxId = null;
  activeBoxSessionItems = new Map();
  activeBoxLastAction = null;
  document.getElementById('active-box-active').classList.add('hidden');
  document.getElementById('active-box-select-row').classList.remove('hidden');
  document.getElementById('active-box-select-feedback').textContent = '';
  const input = document.getElementById('active-box-input');
  input.value = '';
  input.focus();
}

async function scanActiveBoxProduct(code) {
  if (!activeBoxId || !code) return;
  const feedback = document.getElementById('active-box-scan-feedback');
  try {
    const result = await api('POST', '/api/placements/place', { product_code: code, box_id: activeBoxId, qty: 1 });
    const existing = activeBoxSessionItems.get(result.product.id);
    const newQty = (existing ? existing.qty : 0) + 1;
    // Töröljük, majd újra beszúrjuk, hogy a Map végére kerüljön - így a
    // megjelenítéskor (ami visszafelé halad) a legutóbb beolvasott termék
    // kerül legfelülre, akkor is, ha korábban már volt beolvasva.
    activeBoxSessionItems.delete(result.product.id);
    activeBoxSessionItems.set(result.product.id, { sku: result.product.sku, name: result.product.name, qty: newQty, size: result.product.size });
    activeBoxLastAction = { product_id: result.product.id, sku: result.product.sku, name: result.product.name, delta: 1 };
    await refreshActiveBoxExpectedSize();
    renderActiveBoxItems();
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `✓ ${result.product.name} — most ${newQty} db ebben a dobozban (ebben a munkamenetben).`;
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
  checkWatchlist(code);
  const input = document.getElementById('active-box-product');
  input.value = '';
  input.focus();
}

async function undoLastActiveBoxAction() {
  const feedback = document.getElementById('active-box-scan-feedback');
  if (!activeBoxLastAction) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = 'Nincs visszavonható művelet.';
    return;
  }
  const { product_id, sku, name, delta } = activeBoxLastAction;
  try {
    await api('POST', '/api/placements/pick', { product_code: sku, box_id: activeBoxId, qty: delta });
    const existing = activeBoxSessionItems.get(product_id);
    if (existing) {
      const newQty = existing.qty - delta;
      if (newQty <= 0) activeBoxSessionItems.delete(product_id);
      else activeBoxSessionItems.set(product_id, { ...existing, qty: newQty });
    }
    activeBoxLastAction = null;
    await refreshActiveBoxExpectedSize();
    renderActiveBoxItems();
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `Visszavonva: ${name} (${delta} db).`;
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
  document.getElementById('active-box-product').focus();
}

document.getElementById('active-box-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const value = e.target.value.trim();
  if (value) activateBox(value);
});
document.getElementById('active-box-product').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const value = e.target.value.trim();
  if (value) scanActiveBoxProduct(value);
});
document.getElementById('btn-close-active-box').addEventListener('click', closeActiveBox);
document.getElementById('btn-undo-active-box').addEventListener('click', undoLastActiveBoxAction);

// =====================================================================
// DOBOZ ÚJRASZÁMOLÁSA (LELTÁR-KORREKCIÓ)
// =====================================================================

let recountId = null;
let recountBoxId = null;

function showRecountState(state) {
  // state: 'select' | 'counting' | 'summary'
  document.getElementById('recount-select-row').classList.toggle('hidden', state !== 'select');
  document.getElementById('recount-counting').classList.toggle('hidden', state !== 'counting');
  document.getElementById('recount-summary').classList.toggle('hidden', state !== 'summary');
}

function renderRecountCountingItems(items) {
  const tbody = document.querySelector('#recount-items-table tbody');
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '4', class: 'hint' }, 'Még nincs beolvasott tétel.')));
    return;
  }
  items.forEach((it) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mono' }, it.sku || '-'),
      el('td', { class: 'mono' }, it.ean || '-'),
      el('td', {}, it.name),
      el('td', { class: 'mono' }, String(it.counted_qty)),
    ]));
  });
}

function renderRecountSummary(items) {
  const tbody = document.querySelector('#recount-summary-table tbody');
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'hint' }, 'Ez a doboz üresen volt nyilvántartva, és nem is lett benne semmi beolvasva.')));
    return;
  }
  items.forEach((it) => {
    const diffCell = it.diff === 0
      ? el('span', {}, '0')
      : el('span', { class: it.diff > 0 ? 'tag tag-ok' : 'tag tag-bad' }, (it.diff > 0 ? '+' : '') + it.diff);
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mono' }, it.sku || '-'),
      el('td', { class: 'mono' }, it.ean || '-'),
      el('td', {}, it.name),
      el('td', { class: 'mono' }, String(it.recorded_qty)),
      el('td', { class: 'mono' }, String(it.counted_qty)),
      el('td', {}, diffCell),
    ]));
  });
}

async function startRecount(boxId) {
  const feedback = document.getElementById('recount-select-feedback');
  feedback.textContent = '';
  try {
    const data = await api('POST', `/api/boxes/${encodeURIComponent(boxId)}/recount/start`);
    recountId = data.recount.id;
    recountBoxId = data.recount.box_id;
    document.getElementById('recount-box-label').textContent = recountBoxId;
    document.getElementById('recount-summary-box-label').textContent = recountBoxId;
    if (data.recount.status === 'osszesitve') {
      renderRecountSummary(data.items);
      showRecountState('summary');
    } else {
      renderRecountCountingItems(data.items);
      showRecountState('counting');
      document.getElementById('recount-scan').value = '';
      document.getElementById('recount-scan').focus();
    }
    if (data.already_active) {
      toast('Ezen a dobozon már folyamatban van egy számolás — folytatjuk onnan.', 'ok');
    }
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
}

async function scanRecountProduct(code, delta) {
  if (!recountId || !code) return;
  const feedback = document.getElementById('recount-scan-feedback');
  try {
    const item = await api('POST', `/api/box-recounts/${recountId}/scan`, { code, delta: delta ?? 1 });
    const data = await api('GET', `/api/boxes/${encodeURIComponent(recountBoxId)}/recount`);
    renderRecountCountingItems(data.items);
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `✓ ${item.name} — eddig megszámolva: ${item.counted_qty} db.`;
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
  const input = document.getElementById('recount-scan');
  input.value = '';
  input.focus();
}

async function undoRecount() {
  const feedback = document.getElementById('recount-scan-feedback');
  try {
    const item = await api('POST', `/api/box-recounts/${recountId}/undo`);
    const data = await api('GET', `/api/boxes/${encodeURIComponent(recountBoxId)}/recount`);
    renderRecountCountingItems(data.items);
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `Visszavonva — ${item.name} most: ${item.counted_qty} db.`;
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
  document.getElementById('recount-scan').focus();
}

async function closeRecount() {
  if (!recountId) return;
  if (!confirm('Lezárod a számolást? Ezután megjelenik az eltérés-összevetés, de a doboz még mindig zárolva marad, amíg jóvá nem hagyod vagy el nem veted.')) return;
  try {
    const data = await api('POST', `/api/box-recounts/${recountId}/close`);
    renderRecountSummary(data.items);
    showRecountState('summary');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function applyRecount() {
  if (!recountId) return;
  if (!confirm('Jóváhagyod? A mennyiségek a megszámolt értékre íródnak át, és minden eltérés bekerül a készletmozgás-naplóba.')) return;
  try {
    await api('POST', `/api/box-recounts/${recountId}/apply`);
    toast(`"${recountBoxId}" doboz újraszámolása jóváhagyva és alkalmazva.`);
    resetRecountPanel();
    loadBoxes();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function cancelRecount() {
  if (!recountId) return;
  if (!confirm('Biztosan elveted a számolást? A megszámolt adatok elvesznek, a doboz nyilvántartott mennyisége NEM változik.')) return;
  try {
    await api('POST', `/api/box-recounts/${recountId}/cancel`);
    toast('Az újraszámolás elvetve, a doboz feloldva.');
    resetRecountPanel();
    loadBoxes();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function resetRecountPanel() {
  recountId = null;
  recountBoxId = null;
  document.getElementById('recount-box-input').value = '';
  document.getElementById('recount-select-feedback').textContent = '';
  showRecountState('select');
}

document.getElementById('recount-box-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const value = e.target.value.trim();
  if (value) startRecount(value);
});
document.getElementById('btn-recount-start').addEventListener('click', () => {
  const value = document.getElementById('recount-box-input').value.trim();
  if (value) startRecount(value);
});
document.getElementById('recount-scan').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const value = e.target.value.trim();
  if (value) scanRecountProduct(value, 1);
});
document.querySelectorAll('#recount-counting [data-recount-qty]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const value = document.getElementById('recount-scan').value.trim();
    if (!value) {
      toast('Előbb olvasd be vagy írd be a terméket.', 'err');
      return;
    }
    scanRecountProduct(value, Number(btn.dataset.recountQty));
  });
});
document.getElementById('btn-recount-undo').addEventListener('click', undoRecount);
document.getElementById('btn-recount-close').addEventListener('click', closeRecount);
document.getElementById('btn-recount-apply').addEventListener('click', applyRecount);
document.getElementById('btn-recount-cancel-1').addEventListener('click', cancelRecount);
document.getElementById('btn-recount-cancel-2').addEventListener('click', cancelRecount);

// =====================================================================
// ELHELYEZÉS / ÁTHELYEZÉS / KIVÉTEL / KAPACITÁS
// =====================================================================

function bindActionForm({ btnId, feedbackId, fields, url, buildBody, onSuccess }) {
  document.getElementById(btnId).addEventListener('click', async () => {
    const values = {};
    for (const f of fields) values[f] = document.getElementById(f).value.trim();
    const feedback = document.getElementById(feedbackId);
    try {
      const body = buildBody(values);
      const result = await api('POST', url, body);
      feedback.className = 'scan-feedback ok';
      feedback.textContent = onSuccess(result);
      fields.forEach((f) => {
        const inp = document.getElementById(f);
        if (inp.type !== 'number') inp.value = '';
      });
      document.getElementById(fields[0]).focus();
    } catch (err) {
      feedback.className = 'scan-feedback err';
      feedback.textContent = err.message;
    }
  });
}

// A "Termék elhelyezése dobozba" gombnak egyedi logikára van szüksége: mentés
// előtt megnézzük a termék elméleti (Shoprenter-import szerinti) készletét,
// és ha az 0 vagy negatív, egy átléphető megerősítő kérdéssel figyelmeztetünk
// — ez tipikusan azt jelzi, hogy rossz terméket olvastak be (elgépelt
// vonalkód, hasonló SKU), de legitim esetben (pl. új, még nem importált
// termék) simán folytatható.
document.getElementById('btn-place').addEventListener('click', async () => {
  const productCode = document.getElementById('place-product').value.trim();
  const boxId = document.getElementById('place-box').value.trim();
  const qty = parseInt(document.getElementById('place-qty').value, 10);
  const feedback = document.getElementById('place-feedback');
  if (!productCode || !boxId) return;

  try {
    const product = await api('GET', `/api/products/lookup?code=${encodeURIComponent(productCode)}`);

    if (product.theoretical_stock <= 0) {
      const proceed = confirm(
        `Figyelem: "${product.name}" (${product.sku}) elméleti készlete jelenleg ${product.theoretical_stock} db.\n\n` +
        `Ellenőrizd, hogy a megfelelő terméket olvastad-e be. Biztosan folytatod az elhelyezést?`
      );
      if (!proceed) {
        feedback.className = 'scan-feedback err';
        feedback.textContent = 'Elhelyezés megszakítva.';
        document.getElementById('place-product').select();
        return;
      }
    }

    const result = await api('POST', '/api/placements/place', { product_code: productCode, box_id: boxId, qty });
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `✓ ${result.product.name} elhelyezve (${result.box_id}). Új mennyiség ott: ${result.new_qty} db.`;
    checkWatchlist(productCode);
    document.getElementById('place-product').value = '';
    document.getElementById('place-box').value = '';
    document.getElementById('place-product').focus();
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
});

// Beolvasás-vezérelt munkafolyamat az elhelyezéshez, ahogy a specifikáció
// 15. pontja leírja: termék vonalkód → doboz vonalkód → mentés. Enter a
// termék mezőben a doboz mezőre ugrik; Enter a doboz mezőben (akár kézzel
// begépelve, akár a doboz QR-címkéjét leolvasva) rögtön menti a tételt.
document.getElementById('place-product').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  document.getElementById('place-box').focus();
});
document.getElementById('place-box').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  document.getElementById('btn-place').click();
});

bindActionForm({
  btnId: 'btn-transfer', feedbackId: 'transfer-feedback',
  fields: ['transfer-product', 'transfer-from', 'transfer-to', 'transfer-qty'],
  url: '/api/placements/transfer',
  buildBody: (v) => ({ product_code: v['transfer-product'], from_box_id: v['transfer-from'], to_box_id: v['transfer-to'], qty: parseInt(v['transfer-qty'], 10) }),
  onSuccess: (r) => `✓ ${r.product.name} áthelyezve. ${r.from_box_id}: ${r.from_qty} db, ${r.to_box_id}: ${r.to_qty} db.`,
});

bindActionForm({
  btnId: 'btn-pick', feedbackId: 'pick-feedback',
  fields: ['pick-product', 'pick-box', 'pick-qty'],
  url: '/api/placements/pick',
  buildBody: (v) => ({ product_code: v['pick-product'], box_id: v['pick-box'] || undefined, qty: parseInt(v['pick-qty'], 10) }),
  onSuccess: (r) => `✓ ${r.product.name} kivéve (${r.box_id}). Maradék ott: ${r.new_qty} db.`,
});

// A kapacitás-gomb egyedi logikát igényel (előbb fel kell oldani a terméket SKU/EAN alapján)
document.getElementById('btn-capacity').addEventListener('click', async () => {
  const boxId = document.getElementById('cap-box').value.trim();
  const code = document.getElementById('cap-product').value.trim();
  const maxQty = parseInt(document.getElementById('cap-qty').value, 10);
  const feedback = document.getElementById('cap-feedback');
  try {
    const product = await api('GET', `/api/products/lookup?code=${encodeURIComponent(code)}`);
    await api('POST', `/api/boxes/${encodeURIComponent(boxId)}/capacity`, { product_id: product.id, max_qty: maxQty });
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `✓ Kapacitás mentve: ${boxId} — ${product.name}: max ${maxQty} db.`;
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
});

// =====================================================================
// DOBOZOK
// =====================================================================

// A doboz-mezők (Elhelyezés nézet) kereshető javaslatlistája — ugyanaz a
// <datalist>, amit mind az 5 doboz-azonosító mező megoszt.
async function refreshBoxDatalist(boxes) {
  if (!boxes) boxes = await api('GET', '/api/boxes');
  const datalist = document.getElementById('boxes-datalist');
  datalist.innerHTML = '';
  boxes.forEach((b) => {
    datalist.appendChild(el('option', {
      value: b.id,
      label: b.label ? `${b.id} — ${b.label}` : b.id,
    }));
  });
}

// A címkenyomtatáshoz kijelölt dobozok. Külön tároljuk a táblázattól, hogy a
// keresés/szűrés miatti újrarajzolás ne veszítse el a korábbi kijelölést -
// így több keresés eredményéből is össze lehet válogatni a nyomtatandókat.
const selectedBoxIds = new Set();

function updateSelectedLabelsButton() {
  const btn = document.getElementById('btn-print-selected-labels');
  if (!btn) return;
  const count = selectedBoxIds.size;
  btn.disabled = count === 0;
  btn.textContent = count === 0 ? 'Kijelöltek címkéje' : `Kijelöltek címkéje (${count})`;
}

async function loadBoxes() {
  const q = document.getElementById('box-search').value.trim().toLowerCase();
  const allBoxes = await api('GET', '/api/boxes');
  refreshBoxDatalist(allBoxes);
  const boxes = q
    ? allBoxes.filter((b) => b.id.toLowerCase().includes(q) || (b.label || '').toLowerCase().includes(q))
    : allBoxes;

  // Ha időközben törölt dobozok maradtak a kijelölésben, takarítsuk ki.
  const existingIds = new Set(allBoxes.map((b) => b.id));
  for (const id of Array.from(selectedBoxIds)) {
    if (!existingIds.has(id)) selectedBoxIds.delete(id);
  }

  document.getElementById('boxes-heading').innerHTML =
    `Dobozok / raktári helyek <span class="tag tag-neutral">${boxes.length}${q ? ' találat' : ' db'}</span>`;
  const tbody = document.querySelector('#boxes-table tbody');
  tbody.innerHTML = '';
  if (!boxes.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '7', class: 'hint' }, q ? 'Nincs találat.' : 'Még nincs felvéve doboz.')));
    syncBoxesCheckAll(boxes);
    updateSelectedLabelsButton();
    return;
  }
  boxes.forEach((b) => {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = selectedBoxIds.has(b.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedBoxIds.add(b.id);
      else selectedBoxIds.delete(b.id);
      syncBoxesCheckAll(boxes);
      updateSelectedLabelsButton();
    });

    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'col-check' }, checkbox),
      el('td', { class: 'mono' }, [
        b.id,
        b.active_recount ? el('span', { class: 'tag tag-warn', style: 'margin-left:6px', title: 'Ezen a dobozon folyamatban lévő újraszámolás van - jóváhagyásig/elvetésig nem módosítható' }, b.active_recount.status === 'szamolas' ? '🔒 számolás alatt' : '🔒 összesítve') : '',
      ]),
      el('td', {}, b.label || '—'),
      el('td', { class: 'mono' }, [b.width_mm, b.height_mm, b.depth_mm].filter(Boolean).join(' × ') || '—'),
      el('td', { class: 'mono' }, b.volume_l ? String(b.volume_l) : '—'),
      el('td', { class: 'mono' }, String(b.used_units)),
      el('td', { class: 'row-actions' }, [
        el('button', { class: 'btn btn-ghost btn-small', onclick: () => showBoxDetail(b.id) }, 'Részletek'),
        el('button', { class: 'btn btn-ghost btn-small', onclick: () => window.open(`/api/boxes/${encodeURIComponent(b.id)}/label`, '_blank') }, 'Címke'),
        el('button', { class: 'btn btn-danger-outline btn-small', onclick: () => deleteBox(b) }, 'Törlés'),
      ]),
    ]));
  });

  syncBoxesCheckAll(boxes);
  updateSelectedLabelsButton();
}

// A fejléc jelölőnégyzete a jelenleg LÁTHATÓ (szűrt) sorokra vonatkozik.
function syncBoxesCheckAll(visibleBoxes) {
  const checkAll = document.getElementById('boxes-check-all');
  if (!checkAll) return;
  const visibleSelected = visibleBoxes.filter((b) => selectedBoxIds.has(b.id)).length;
  checkAll.checked = visibleBoxes.length > 0 && visibleSelected === visibleBoxes.length;
  checkAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleBoxes.length;
}

document.getElementById('boxes-check-all').addEventListener('change', async (e) => {
  const q = document.getElementById('box-search').value.trim().toLowerCase();
  const allBoxes = await api('GET', '/api/boxes');
  const visible = q
    ? allBoxes.filter((b) => b.id.toLowerCase().includes(q) || (b.label || '').toLowerCase().includes(q))
    : allBoxes;
  visible.forEach((b) => {
    if (e.target.checked) selectedBoxIds.add(b.id);
    else selectedBoxIds.delete(b.id);
  });
  loadBoxes();
});

document.getElementById('btn-print-selected-labels').addEventListener('click', () => {
  if (!selectedBoxIds.size) return;
  const ids = Array.from(selectedBoxIds).map((id) => encodeURIComponent(id)).join(',');
  window.open(`/api/boxes/labels/selected?ids=${ids}`, '_blank');
});

document.getElementById('box-search').addEventListener('input', debounce(loadBoxes, 250));

document.getElementById('btn-print-all-labels').addEventListener('click', () => {
  window.open('/api/boxes/labels/all', '_blank');
});

async function deleteBox(b) {
  const warning = b.used_units > 0
    ? ` Figyelem: jelenleg ${b.used_units} db termék van benne — a törléssel ez az elhelyezési adat elvész (a termékek összkészletéből csak az ebből a dobozból számított rész tűnik el, a többi elhelyezésük megmarad).`
    : '';
  if (!confirm(`Biztosan törlöd a(z) "${b.id}" dobozt?${warning}`)) return;
  try {
    await api('DELETE', `/api/boxes/${encodeURIComponent(b.id)}`);
    toast('Doboz törölve.');
    loadBoxes();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function showBoxDetail(id) {
  const box = await api('GET', `/api/boxes/${encodeURIComponent(id)}`);
  const content = el('div', {}, []);

  const contentTable = el('table', { class: 'table' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'SKU'), el('th', {}, 'Termék'), el('th', {}, 'Mennyiség'), el('th', {}, '')])),
    el('tbody', {}, box.contents.length
      ? box.contents.map((c) => el('tr', {}, [
          el('td', { class: 'mono' }, c.sku),
          el('td', {}, c.name),
          el('td', { class: 'mono' }, String(c.qty)),
          el('td', {}, el('button', {
            class: 'btn btn-danger-outline btn-small',
            onclick: () => removeFromBox(box.id, c),
          }, 'Kivétel')),
        ]))
      : el('tr', {}, el('td', { colspan: '4', class: 'hint' }, 'Ez a doboz jelenleg üres.'))),
  ]);
  content.appendChild(contentTable);

  if (box.capacities.length) {
    content.appendChild(el('h2', { style: 'margin-top:18px; font-size:15px' }, 'Beállított kapacitások'));
    content.appendChild(el('table', { class: 'table' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'SKU'), el('th', {}, 'Termék'), el('th', {}, 'Max db')])),
      el('tbody', {}, box.capacities.map((c) => el('tr', {}, [el('td', { class: 'mono' }, c.sku), el('td', {}, c.name), el('td', { class: 'mono' }, String(c.max_qty))]))),
    ]));
  }

  openContentModal(`📦 ${box.id}${box.label ? ' — ' + box.label : ''}`, content);
}

// Közvetlen kivétel a doboz-részletek ablakból, anélkül hogy át kellene
// menni az Elhelyezés nézetbe és újra be kellene írni a terméket/dobozt.
async function removeFromBox(boxId, contentRow) {
  const input = prompt(`Hány darab "${contentRow.name}" (${contentRow.sku}) kerüljön ki a(z) "${boxId}" dobozból?`, contentRow.qty);
  if (input === null) return; // Mégse
  const qty = parseInt(input, 10);
  if (!Number.isInteger(qty) || qty <= 0) return toast('Érvénytelen mennyiség.', 'err');
  if (qty > contentRow.qty) return toast(`Ott csak ${contentRow.qty} db van, ennyi nem vehető ki.`, 'err');

  try {
    await api('POST', '/api/placements/pick', { product_code: contentRow.sku, box_id: boxId, qty });
    toast(`${qty} db "${contentRow.name}" kivéve a(z) ${boxId} dobozból.`);
    await loadBoxes(); // a lista "foglalt db" oszlopa is frissüljön
    await showBoxDetail(boxId); // az ablak tartalma frissüljön a helyben maradva
  } catch (err) {
    toast(err.message, 'err');
  }
}

document.getElementById('btn-new-box').addEventListener('click', () => {
  openModal('Új doboz felvétele', [
    { id: 'm-box-id', label: 'Azonosító (pl. D-001)', type: 'text' },
    { id: 'm-box-label', label: 'Megnevezés', type: 'text' },
    { id: 'm-box-w', label: 'Szélesség (mm)', type: 'number' },
    { id: 'm-box-h', label: 'Magasság (mm)', type: 'number' },
    { id: 'm-box-d', label: 'Mélység (mm)', type: 'number' },
  ], async (values) => {
    await api('POST', '/api/boxes', {
      id: values['m-box-id'], label: values['m-box-label'] || null,
      width_mm: values['m-box-w'] ? parseInt(values['m-box-w'], 10) : null,
      height_mm: values['m-box-h'] ? parseInt(values['m-box-h'], 10) : null,
      depth_mm: values['m-box-d'] ? parseInt(values['m-box-d'], 10) : null,
    });
    toast('Doboz felvéve.');
    loadBoxes();
  });
});

// =====================================================================
// TERMÉKEK
// =====================================================================

let selectedProductIds = new Set();
let currentProductsList = [];

function updateBulkDeleteButton() {
  const btn = document.getElementById('btn-delete-selected-products');
  const n = selectedProductIds.size;
  btn.textContent = `Kijelöltek törlése (${n})`;
  btn.classList.toggle('hidden', n === 0);
}

async function loadProducts() {
  const q = document.getElementById('product-search').value.trim();
  const unplaced = document.getElementById('filter-unplaced').checked ? '1' : '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (unplaced) params.set('unplaced', unplaced);
  const products = await api('GET', `/api/products?${params.toString()}`);
  currentProductsList = products;
  const filtered = !!(q || unplaced);
  document.getElementById('products-heading').innerHTML =
    `Termékek <span class="tag tag-neutral">${products.length}${filtered ? ' találat' : ' db'}</span>`;

  selectedProductIds = new Set();
  updateBulkDeleteButton();
  document.getElementById('products-select-all').checked = false;

  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';
  if (!products.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '10', class: 'hint' }, 'Nincs találat.')));
    return;
  }
  products.forEach((p, idx) => {
    const checkbox = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        if (e.target.checked) selectedProductIds.add(p.id);
        else selectedProductIds.delete(p.id);
        updateBulkDeleteButton();
      },
    });
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'col-check' }, checkbox),
      el('td', { class: 'mono' }, String(idx + 1)),
      el('td', { class: 'mono' }, p.sku),
      el('td', { class: 'mono' }, p.ean || '—'),
      el('td', {}, p.name),
      el('td', {}, p.size || '—'),
      el('td', {}, p.color || '—'),
      el('td', { class: 'mono' }, String(p.theoretical_stock)),
      el('td', { class: 'mono' }, String(p.physical_stock)),
      el('td', { class: 'row-actions' }, [
        el('button', { class: 'btn btn-ghost btn-small', onclick: () => editProduct(p) }, 'Szerkesztés'),
        el('button', { class: 'btn btn-danger-outline btn-small', onclick: () => deleteProduct(p) }, 'Törlés'),
      ]),
    ]));
  });
}

document.getElementById('products-select-all').addEventListener('change', (e) => {
  const checked = e.target.checked;
  selectedProductIds = checked ? new Set(currentProductsList.map((p) => p.id)) : new Set();
  document.querySelectorAll('#products-table tbody input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
  updateBulkDeleteButton();
});

async function deleteSelectedProducts() {
  const ids = Array.from(selectedProductIds);
  if (!ids.length) return;

  const placedCount = currentProductsList.filter((p) => selectedProductIds.has(p.id) && p.physical_stock > 0).length;
  const warning = placedCount > 0
    ? ` Figyelem: ${placedCount} kijelölt terméknek jelenleg van raktáron elhelyezett készlete — ezek az elhelyezési adatok is elvesznek.`
    : '';

  if (!confirm(`Biztosan törlöd a kijelölt ${ids.length} terméket?${warning}`)) return;

  try {
    const result = await api('DELETE', '/api/products', { ids });
    toast(`${result.deleted} termék törölve.`);
    loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  }
}

document.getElementById('btn-delete-selected-products').addEventListener('click', deleteSelectedProducts);

async function deleteProduct(p) {
  const warning = p.physical_stock > 0
    ? ` Figyelem: jelenleg ${p.physical_stock} db van belőle raktári helyekre elhelyezve — a törléssel ezek az elhelyezési adatok is elvesznek.`
    : '';
  if (!confirm(`Biztosan törlöd a(z) "${p.name}" (${p.sku}) terméket?${warning}`)) return;
  try {
    await api('DELETE', `/api/products/${p.id}`);
    toast('Termék törölve.');
    loadProducts();
  } catch (err) {
    toast(err.message, 'err');
  }
}

document.getElementById('product-search').addEventListener('input', debounce(loadProducts, 250));
document.getElementById('filter-unplaced').addEventListener('change', loadProducts);

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.getElementById('btn-new-product').addEventListener('click', () => productModal());

function editProduct(p) {
  productModal(p);
}

function productModal(existing) {
  const isEdit = !!existing;
  openModal(isEdit ? `Termék szerkesztése — ${existing.sku}` : 'Új termék felvétele', [
    { id: 'm-p-sku', label: 'SKU / cikkszám', type: 'text', value: existing?.sku },
    { id: 'm-p-ean', label: 'EAN / vonalkód', type: 'text', value: existing?.ean },
    { id: 'm-p-name', label: 'Terméknév', type: 'text', value: existing?.name },
    { id: 'm-p-category', label: 'Kategória', type: 'text', value: existing?.category },
    { id: 'm-p-size', label: 'Méret', type: 'text', value: existing?.size },
    { id: 'm-p-color', label: 'Szín', type: 'text', value: existing?.color },
    { id: 'm-p-stock', label: 'Elméleti készlet', type: 'number', value: existing?.theoretical_stock ?? 0 },
  ], async (values) => {
    const body = {
      sku: values['m-p-sku'], ean: values['m-p-ean'] || null, name: values['m-p-name'],
      category: values['m-p-category'] || null, size: values['m-p-size'] || null, color: values['m-p-color'] || null,
      theoretical_stock: parseInt(values['m-p-stock'], 10) || 0,
    };
    if (isEdit) await api('PUT', `/api/products/${existing.id}`, body);
    else await api('POST', '/api/products', body);
    toast(isEdit ? 'Termék frissítve.' : 'Termék felvéve.');
    loadProducts();
  });
}

// =====================================================================
// IMPORT / EXPORT
// =====================================================================

document.getElementById('btn-import').addEventListener('click', async () => {
  const fileInput = document.getElementById('import-file');
  const resultBox = document.getElementById('import-result');
  if (!fileInput.files.length) return toast('Válassz ki egy CSV fájlt.', 'err');

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const res = await fetch('/api/io/products/import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import hiba.');

    resultBox.className = 'scan-feedback ok';
    let msg = `✓ Feldolgozva: ${data.total} sor. Új: ${data.imported}. Frissítve: ${data.updated}.`;
    if (data.skipped.length) msg += ` Kihagyva: ${data.skipped.length} sor.`;
    resultBox.textContent = msg;

    if (data.skipped.length) {
      const list = el('ul', { style: 'margin-top:8px; font-size:12.5px; color:var(--bad)' },
        data.skipped.slice(0, 20).map((s) => el('li', {}, `${s.row}. sor${s.sku ? ' (' + s.sku + ')' : ''}: ${s.reason}`)));
      resultBox.appendChild(list);
    }
    toast('Import kész.');
  } catch (err) {
    resultBox.className = 'scan-feedback err';
    resultBox.textContent = err.message;
  }
});

// =====================================================================
// ÁTTEKINTÉS
// =====================================================================

async function loadOverview() {
  const stats = await api('GET', '/api/reports/overview');
  const grid = document.getElementById('overview-stats');
  grid.innerHTML = '';
  const items = [
    ['Termékfajták', stats.totalProducts],
    ['Dobozok', stats.totalBoxes],
    ['Foglalt dobozok', stats.occupiedBoxes],
    ['Nincs elhelyezve', stats.unplacedProducts],
    ['Elhelyezett darabszám', stats.totalUnitsPlaced],
  ];
  items.forEach(([label, num]) => {
    grid.appendChild(el('div', { class: 'stat-box' }, [
      el('div', { class: 'num' }, String(num)),
      el('div', { class: 'label' }, label),
    ]));
  });

  await loadPlacementStatus();

  const movements = await api('GET', '/api/reports/movements?limit=100');
  const tbody = document.querySelector('#movements-table tbody');
  tbody.innerHTML = '';
  const opLabel = { bevetelezes: 'Bevételezés', kivetel: 'Kivétel', athelyezes: 'Áthelyezés', leltar_korrekcio: 'Leltár korrekció' };
  movements.forEach((m) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mono' }, m.created_at),
      el('td', {}, `${m.name} (${m.sku})`),
      el('td', { class: 'mono' }, m.source_box_id || '—'),
      el('td', { class: 'mono' }, m.dest_box_id || '—'),
      el('td', { class: 'mono' }, String(m.qty)),
      el('td', {}, opLabel[m.operation] || m.operation),
    ]));
  });
  if (!movements.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'hint' }, 'Még nincs rögzített készletmozgás.')));
  }
}

// ---------- Elhelyezettségi kimutatás ----------

let placementFilter = ''; // '' = mind | 'placed' | 'partial' | 'unplaced'

async function loadPlacementStatus() {
  let data;
  try {
    data = await api('GET', '/api/reports/placement-status');
  } catch (err) {
    toast(err.message, 'err');
    return;
  }

  const s = data.summary;

  // A szűrőgombok feliratán mutatjuk a darabszámokat
  document.querySelectorAll('[data-placement-filter]').forEach((btn) => {
    const key = btn.dataset.placementFilter;
    btn.classList.toggle('active', key === placementFilter);
    if (key === '') btn.textContent = `Mind (${s.total})`;
    else if (key === 'placed') btn.textContent = `Elhelyezve (${s.placed})`;
    else if (key === 'partial') btn.textContent = `Részben elhelyezve (${s.partial})`;
    else btn.textContent = `Nincs elhelyezve (${s.unplaced})`;
  });

  // Az export gomb a jelenlegi szűrést kövesse
  const exportLink = document.getElementById('btn-export-placement');
  exportLink.href = placementFilter
    ? `/api/reports/placement-status?status=${placementFilter}&format=csv`
    : '/api/reports/placement-status?format=csv';

  const rows = placementFilter ? data.rows.filter((r) => r.status === placementFilter) : data.rows;

  const tbody = document.querySelector('#placement-table tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'hint' }, 'Nincs ilyen termék.')));
    return;
  }

  // Nagy listánál nem rajzolunk ki mindent, mert lassú és átláthatatlan -
  // a teljes lista az exportból érhető el.
  const LIMIT = 300;
  rows.slice(0, LIMIT).forEach((r) => {
    const rowStyle =
      r.status === 'unplaced' ? 'background:#FBE9E7' : r.status === 'partial' ? 'background:#FFF3DE' : '';
    tbody.appendChild(el('tr', { style: rowStyle }, [
      el('td', { class: 'mono' }, r.sku),
      el('td', {}, r.name),
      el('td', { class: 'mono' }, String(r.theoretical_stock)),
      el('td', { class: 'mono' }, String(r.placed_qty)),
      el('td', { class: 'mono' }, r.missing_qty > 0 ? String(r.missing_qty) : '—'),
      el('td', {}, r.boxes || '—'),
    ]));
  });
  if (rows.length > LIMIT) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'hint' },
      `További ${rows.length - LIMIT} termék nincs kilistázva — a teljes lista a "Kimutatás exportálása" gombbal tölthető le.`)));
  }
}

document.querySelectorAll('[data-placement-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    placementFilter = btn.dataset.placementFilter;
    loadPlacementStatus();
  });
});

document.getElementById('btn-clear-movements').addEventListener('click', async () => {
  if (!confirm('Biztosan törlöd a teljes készletmozgás-naplót? Ez nem érinti a termékeket, dobozokat és a jelenlegi raktári elhelyezéseket, csak az előzmény-naplót — és nem vonható vissza.')) return;
  try {
    const result = await api('DELETE', '/api/reports/movements');
    toast(`${result.deleted} bejegyzés törölve a naplóból.`);
    loadOverview();
  } catch (err) {
    toast(err.message, 'err');
  }
});

// =====================================================================
// KVIKK STATISZTIKA / TÖMEGES CÍMKEGENERÁLÁS
// =====================================================================

let kvikkLastZipOrderIds = []; // a legutóbbi sikeres bulk-futás eredményeként letölthető rendelésazonosítók
let kvikkCurrentFrom = null; // az aktuálisan alkalmazott időszak-szűrés (null = "Mind")
let kvikkCurrentTo = null;

async function loadKvikkStats(from, to) {
  // Argumentum nélkül hívva megtartjuk a legutóbb alkalmazott szűrést (pl.
  // nav-váltáskor vagy bulk-generálás utáni frissítéskor ne ugorjon vissza
  // automatikusan "Mind"-ra).
  if (from !== undefined) kvikkCurrentFrom = from;
  if (to !== undefined) kvikkCurrentTo = to;

  let data;
  try {
    const query = [];
    if (kvikkCurrentFrom) query.push(`from=${encodeURIComponent(kvikkCurrentFrom)}`);
    if (kvikkCurrentTo) query.push(`to=${encodeURIComponent(kvikkCurrentTo)}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    data = await api('GET', `/api/reports/kvikk${qs}`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }

  // Időszak-jelző: alapból ("Mind") a teljes eddigi adatra vonatkozik a
  // kártyák tartalma, szűrésnél pedig a kijelölt tartományra - ezt itt
  // jelezzük ki, hogy mindig egyértelmű legyen, mit is nézünk.
  const periodEl = document.getElementById('kvikk-stats-period');
  if (kvikkCurrentFrom || kvikkCurrentTo) {
    const fromLabel = kvikkCurrentFrom || (data.data_since ? String(data.data_since).slice(0, 10) : '…');
    const toLabel = kvikkCurrentTo || 'ma';
    periodEl.textContent = `Összesítés a kijelölt időszakra: ${fromLabel} – ${toLabel}`;
  } else {
    periodEl.textContent = data.data_since
      ? `Összesítés a teljes eddigi adatból: ${String(data.data_since).slice(0, 10)} óta`
      : 'Összesítés a teljes eddigi adatból — még nem készült egyetlen Kvikk csomag sem.';
  }

  // Stat-kártyák
  const grid = document.getElementById('kvikk-stats');
  grid.innerHTML = '';
  const items = [
    ['Összes csomag', data.total],
    ['Kész címke', data.status_counts.label_created],
    ['Sikertelen', data.status_counts.failed],
    ['Utánvét összesen', `${data.cod.total_amount.toLocaleString('hu-HU')} Ft`],
    ['Vár még címkére', data.pending_orders.length],
  ];
  items.forEach(([label, num]) => {
    grid.appendChild(el('div', { class: 'stat-box' }, [
      el('div', { class: 'num' }, String(num)),
      el('div', { class: 'label' }, label),
    ]));
  });

  // Futár szerinti bontás
  const courierBody = document.querySelector('#kvikk-courier-table tbody');
  courierBody.innerHTML = '';
  if (!data.by_courier.length) {
    courierBody.appendChild(el('tr', {}, el('td', { colspan: '2', class: 'hint' }, 'Ebben az időszakban nem készült Kvikk címke.')));
  } else {
    data.by_courier.forEach((c) => {
      courierBody.appendChild(el('tr', {}, [
        el('td', {}, c.courier),
        el('td', { class: 'mono' }, String(c.c)),
      ]));
    });
  }

  // Napi bontás - egyszerű CSS oszlopdiagram
  const dailyHeading = document.getElementById('kvikk-daily-heading');
  dailyHeading.textContent = kvikkCurrentFrom || kvikkCurrentTo ? 'Napi bontás (kijelölt időszak)' : 'Napi bontás (utolsó 14 nap)';
  document.getElementById('kvikk-daily-truncated-note').classList.toggle('hidden', !data.daily_breakdown_truncated);

  const chart = document.getElementById('kvikk-daily-chart');
  chart.innerHTML = '';
  if (!data.daily_breakdown.length) {
    chart.appendChild(el('p', { class: 'hint' }, 'Ebben az időszakban nem készült Kvikk csomag.'));
  } else {
    const maxCount = Math.max(...data.daily_breakdown.map((d) => d.c), 1);
    data.daily_breakdown.forEach((d) => {
      const heightPct = Math.max((d.c / maxCount) * 100, 4);
      const dayLabel = d.day.slice(5).replace('-', '.'); // "09.21"
      chart.appendChild(el('div', { class: 'bar-col' }, [
        el('div', { class: 'bar-count' }, String(d.c)),
        el('div', { class: 'bar', style: `height:${heightPct}%` }),
        el('div', { class: 'bar-day' }, dayLabel),
      ]));
    });
  }

  // Legutóbbi sikertelen próbálkozások
  const failedBody = document.querySelector('#kvikk-failed-table tbody');
  failedBody.innerHTML = '';
  if (!data.recent_failed.length) {
    failedBody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'hint' }, 'Nincs sikertelen próbálkozás.')));
  } else {
    data.recent_failed.forEach((f) => {
      failedBody.appendChild(el('tr', {}, [
        el('td', {}, `#${f.shoprenter_order_id}`),
        el('td', {}, f.recipient_name || '-'),
        el('td', {}, f.courier || '-'),
        el('td', {}, f.error_message || '-'),
        el('td', { class: 'mono' }, f.updated_at),
      ]));
    });
  }

  // Rendelések Kvikk címke nélkül - a tömeges generálás listája
  const pendingBody = document.querySelector('#kvikk-pending-table tbody');
  pendingBody.innerHTML = '';
  if (!data.pending_orders.length) {
    pendingBody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'hint' }, 'Minden importált rendeléshez készült már Kvikk címke.')));
  } else {
    data.pending_orders.forEach((o) => {
      const statusCell = o.bulk_ready
        ? el('span', { class: 'kvikk-bulk-ok' }, '✓ valószínűleg kész')
        : el('span', { class: 'kvikk-bulk-reason' }, o.bulk_blocked_reason || '-');
      pendingBody.appendChild(
        el('tr', {}, [
          el('td', { class: 'col-check' }, el('input', {
            type: 'checkbox',
            class: 'kvikk-order-check',
            'data-order-id': o.shoprenter_order_id,
            'data-ready': o.bulk_ready ? '1' : '0',
          })),
          el('td', {}, `#${o.shoprenter_order_id}`),
          el('td', {}, o.customer_name || '-'),
          el('td', {}, o.shipping_method_text || '-'),
          el('td', {}, statusCell),
        ])
      );
    });
  }

  const badge = document.getElementById('kvikk-nav-badge');
  if (badge) {
    badge.textContent = String(data.pending_orders.length);
    badge.classList.toggle('hidden', data.pending_orders.length === 0);
  }

  document.getElementById('kvikk-select-all').checked = false;
  document.getElementById('kvikk-bulk-result').innerHTML = '';
  document.getElementById('btn-kvikk-download-zip').classList.add('hidden');
}

// Kvikk statisztika - időszak-szűrő (gyorsgombok + egyedi dátumtartomány)
function applyKvikkPeriod(days) {
  document.querySelectorAll('[data-kvikk-period]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kvikkPeriod === (days === null ? 'all' : String(days)));
  });
  if (days === null) {
    document.getElementById('kvikk-from').value = '';
    document.getElementById('kvikk-to').value = '';
    loadKvikkStats(null, null);
    return;
  }
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  document.getElementById('kvikk-from').value = fmt(from);
  document.getElementById('kvikk-to').value = fmt(to);
  loadKvikkStats(fmt(from), fmt(to));
}

document.querySelectorAll('[data-kvikk-period]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.kvikkPeriod;
    applyKvikkPeriod(val === 'all' ? null : Number(val));
  });
});

document.getElementById('btn-kvikk-apply-range').addEventListener('click', () => {
  const from = document.getElementById('kvikk-from').value || null;
  const to = document.getElementById('kvikk-to').value || null;
  document.querySelectorAll('[data-kvikk-period]').forEach((btn) => btn.classList.remove('active'));
  if (!from && !to) {
    document.querySelector('[data-kvikk-period="all"]').classList.add('active');
  }
  loadKvikkStats(from, to);
});

document.getElementById('kvikk-select-all').addEventListener('change', (e) => {
  document.querySelectorAll('.kvikk-order-check').forEach((cb) => { cb.checked = e.target.checked; });
});

document.getElementById('btn-kvikk-select-ready').addEventListener('click', () => {
  document.querySelectorAll('.kvikk-order-check').forEach((cb) => {
    cb.checked = cb.dataset.ready === '1';
  });
  document.getElementById('kvikk-select-all').checked = false;
});

document.getElementById('btn-kvikk-bulk-generate').addEventListener('click', async () => {
  const selected = Array.from(document.querySelectorAll('.kvikk-order-check:checked')).map((cb) => cb.dataset.orderId);
  if (!selected.length) {
    toast('Előbb jelölj ki legalább egy rendelést.', 'err');
    return;
  }
  if (!confirm(`Kvikk csomag/címke generálása ${selected.length} rendeléshez. Ez a Kvikk fiókodban valódi csomagot hoz létre (nem visszavonható). Folytatod?`)) {
    return;
  }

  const btn = document.getElementById('btn-kvikk-bulk-generate');
  btn.disabled = true;
  btn.textContent = 'Generálás folyamatban…';

  try {
    const res = await api('POST', '/api/kvikk/shipments/bulk', { shoprenter_order_ids: selected }, kvikkAuthHeader());

    const resultBox = document.getElementById('kvikk-bulk-result');
    resultBox.innerHTML = '';
    resultBox.appendChild(
      el('div', { class: 'card', style: 'margin-bottom:16px' }, [
        el('h2', {}, `Eredmény: ${res.created} új címke, ${res.already_existed} már megvolt, ${res.failed} sikertelen`),
        el('ul', {}, res.results.map((r) =>
          el('li', {}, r.ok
            ? `#${r.shoprenter_order_id} — ${r.already_existed ? 'már volt hozzá címke' : 'sikeresen legenerálva'}`
            : `#${r.shoprenter_order_id} — kihagyva: ${r.reason}`
          )
        )),
      ])
    );

    kvikkLastZipOrderIds = res.results.filter((r) => r.ok).map((r) => r.shoprenter_order_id);
    const zipBtn = document.getElementById('btn-kvikk-download-zip');
    zipBtn.classList.toggle('hidden', kvikkLastZipOrderIds.length === 0);

    toast(`${res.created} új Kvikk címke legenerálva.`, res.failed ? 'err' : 'ok');
    await loadKvikkStats();
    // az újratöltés törli a "legutóbbi eredmény" dobozt is - visszaírjuk, hogy a ZIP gomb elérhető maradjon
    if (kvikkLastZipOrderIds.length) {
      document.getElementById('btn-kvikk-download-zip').classList.remove('hidden');
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kijelöltek címkéinek legenerálása';
  }
});

document.getElementById('btn-kvikk-download-zip').addEventListener('click', async () => {
  if (!kvikkLastZipOrderIds.length) return;
  const url = `/api/kvikk/shipments/labels-zip?order_ids=${kvikkLastZipOrderIds.map(encodeURIComponent).join(',')}`;
  try {
    const res = await fetch(url, { headers: kvikkAuthHeader() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body && body.error) || `Hiba (${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'kvikk-cimkek.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    toast(err.message, 'err');
  }
});

// =====================================================================
// TERMÉKFIGYELŐ
// =====================================================================

async function loadWatchlist() {
  const items = await api('GET', '/api/watchlist');
  const activeCount = items.filter((i) => i.status === 'aktiv').length;

  document.getElementById('watchlist-heading').innerHTML =
    `Figyelt tételek <span class="tag tag-neutral">${items.length} db</span>`;

  const badge = document.getElementById('watchlist-nav-badge');
  badge.textContent = String(activeCount);
  badge.classList.toggle('hidden', activeCount === 0);

  const tbody = document.querySelector('#watchlist-table tbody');
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '8', class: 'hint' }, 'Még nincs figyelt tétel felvéve.')));
    return;
  }
  items.forEach((item) => {
    const statusTag = item.status === 'kesz'
      ? el('span', { class: 'tag tag-ok' }, 'Kész')
      : el('span', { class: 'tag tag-bad' }, 'Aktív');
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mono' }, item.sku),
      el('td', { class: 'mono' }, item.ean || '—'),
      el('td', {}, item.name),
      el('td', { class: 'mono' }, String(item.requested_qty)),
      el('td', { class: 'mono' }, String(item.fulfilled_qty)),
      el('td', {}, item.note || '—'),
      el('td', {}, statusTag),
      el('td', {}, el('button', { class: 'btn btn-danger-outline btn-small', onclick: () => deleteWatchItem(item) }, 'Törlés')),
    ]));
  });
}

async function deleteWatchItem(item) {
  if (!confirm(`Biztosan törlöd a(z) "${item.name}" figyelt tételt?`)) return;
  try {
    await api('DELETE', `/api/watchlist/${item.id}`);
    toast('Figyelt tétel törölve.');
    loadWatchlist();
  } catch (err) {
    toast(err.message, 'err');
  }
}

document.getElementById('btn-add-watch').addEventListener('click', async () => {
  const code = document.getElementById('watch-product').value.trim();
  const qty = parseInt(document.getElementById('watch-qty').value, 10);
  const note = document.getElementById('watch-note').value.trim();
  const feedback = document.getElementById('watch-add-feedback');
  if (!code) return toast('Add meg a termék kódját.', 'err');
  try {
    const item = await api('POST', '/api/watchlist', { product_code: code, requested_qty: qty, note: note || null });
    feedback.className = 'scan-feedback ok';
    feedback.textContent = `✓ Felvéve a figyelőlistára: ${item.name} (${item.requested_qty} db).`;
    document.getElementById('watch-product').value = '';
    document.getElementById('watch-qty').value = '1';
    document.getElementById('watch-note').value = '';
    document.getElementById('watch-product').focus();
    loadWatchlist();
  } catch (err) {
    feedback.className = 'scan-feedback err';
    feedback.textContent = err.message;
  }
});

// Induláskor, és minden beolvasás után meghívva ellenőrzi, hogy a
// beolvasott kód szerepel-e valamelyik AKTÍV figyelt tételben — ha igen,
// feltűnő figyelmeztető ablakot mutat. Csendben elnyeli a hibát, ha nem
// sikerülne (ez egy kiegészítő funkció, nem szabad megzavarnia a fő
// munkafolyamatot, pl. a leltár-számlálást vagy az elhelyezést).
async function checkWatchlist(code) {
  if (!code) return;
  try {
    const items = await api('GET', `/api/watchlist/check?code=${encodeURIComponent(code)}`);
    if (items.length) showWatchlistAlert(items);
  } catch (e) {
    /* csendben elnyeljük */
  }
}

async function updateWatchlistBadge() {
  try {
    const items = await api('GET', '/api/watchlist');
    const activeCount = items.filter((i) => i.status === 'aktiv').length;
    const badge = document.getElementById('watchlist-nav-badge');
    badge.textContent = String(activeCount);
    badge.classList.toggle('hidden', activeCount === 0);
  } catch (e) {
    /* csendben elnyeljük */
  }
}

function buildWatchAlertCard(item) {
  const progressEl = el('div', { class: 'progress' });
  const actionsEl = el('div', { class: 'actions' });

  function renderState(current) {
    progressEl.innerHTML = '';
    const remaining = current.requested_qty - current.fulfilled_qty;
    if (current.status === 'kesz') {
      progressEl.appendChild(el('span', { class: 'done' }, `✓ Teljesítve: ${current.fulfilled_qty} / ${current.requested_qty} db`));
    } else {
      progressEl.appendChild(el('span', {}, `${current.fulfilled_qty} / ${current.requested_qty} db félretéve — még ${remaining} db kellene`));
    }
    actionsEl.innerHTML = '';
    if (current.status !== 'kesz') {
      actionsEl.appendChild(el('button', {
        class: 'btn btn-primary btn-small',
        onclick: async () => {
          try {
            const updated = await api('POST', `/api/watchlist/${current.id}/fulfill`);
            Object.assign(current, updated);
            renderState(current);
            toast(`Félretéve: ${updated.name} (${updated.fulfilled_qty}/${updated.requested_qty})`);
            updateWatchlistBadge();
            const watchlistView = document.getElementById('view-watchlist');
            if (watchlistView && !watchlistView.classList.contains('hidden')) loadWatchlist();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      }, 'Félretéve (+1)'));
    }
  }

  const card = el('div', { class: 'watch-alert-item' }, [
    el('div', { class: 'name' }, item.name),
    el('div', { class: 'meta' }, `SKU: ${item.sku}   ·   EAN: ${item.ean || '—'}`),
    item.note ? el('div', { class: 'note' }, `„${item.note}”`) : null,
    progressEl,
    actionsEl,
  ]);
  renderState(item);
  return card;
}

function showWatchlistAlert(items) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const cards = items.map(buildWatchAlertCard);
  const backdrop = el('div', { class: 'watch-alert-backdrop' }, [
    el('div', { class: 'watch-alert' }, [
      el('div', { class: 'watch-alert-title' }, '⚠️ Figyelt termék került elő!'),
      ...cards,
      el('div', { class: 'watch-alert-close-row' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => { root.innerHTML = ''; } }, 'Bezárás'),
      ]),
    ]),
  ]);
  root.appendChild(backdrop);
}

// =====================================================================
// MODAL
// =====================================================================

// Egyszerű, csak-olvasható tartalom (pl. táblázatok) megjelenítésére szolgáló
// modal — nincs mentés, csak egy "Bezárás" gomb. Szélesebb, mint az
// űrlap-modal, mert táblázatokat is kényelmesen kell tudnia mutatni.
// =====================================================================
// KAMERÁS VONALKÓDOLVASÓ
//
// A böngésző natív BarcodeDetector API-ját használja (nincs hozzá külön
// letöltendő könyvtár). Ehhez "biztonságos kapcsolat" (https:// vagy
// localhost) és a böngésző támogatása szükséges — ha ezek közül bármelyik
// hiányzik, egyértelmű hibaüzenetet adunk ahelyett, hogy csendben nem
// csinálna semmit.
// =====================================================================

let activeCameraStream = null;
// Folyamatos módban (pl. visszaellenőrzésnél) a kamera beolvasás után
// nyitva marad; ide írjuk az utolsó beolvasás eredményét, hogy a
// képernyőn is látszódjon, ne csak hangjelzés legyen.
let cameraStatusEl = null;
const CAMERA_REPEAT_MS = 1500; // ugyanazt a kódot ennyi ideig nem olvassuk be újra

function stopCameraStream() {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach((track) => track.stop());
    activeCameraStream = null;
  }
}

async function openCameraScanner(targetInputId, continuous = false) {
  if (!window.isSecureContext) {
    toast('A kamerás beolvasás csak https:// kapcsolaton érhető el. Nyisd meg az alkalmazást a https:// címen.', 'err');
    return;
  }
  if (!('BarcodeDetector' in window)) {
    toast('A böngésződ nem támogatja a kamerás vonalkódolvasást — kérlek gépeld be vagy olvasd be külső vonalkódolvasóval.', 'err');
    return;
  }

  const root = document.getElementById('modal-root');
  root.innerHTML = '';

  let stopped = false;

  const video = el('video', { autoplay: 'true', playsinline: 'true', muted: 'true' });
  video.muted = true;
  video.playsInline = true;
  const closeBtn = el('button', { class: 'camera-overlay-close', onclick: () => { stopped = true; closeCameraOverlay(); } }, '✕');
  const statusEl = continuous ? el('div', { class: 'camera-overlay-status hidden' }) : null;
  const overlay = el('div', { class: 'camera-overlay' }, [
    el('div', { class: 'camera-overlay-bar' }, [
      el('span', {}, continuous
        ? 'Olvasd be a termékeket egymás után — ha végeztél, zárd be ✕'
        : 'Tartsd a vonalkódot / QR-kódot a keretbe'),
      closeBtn,
    ]),
    video,
    el('div', { class: 'camera-frame-hint' }),
    statusEl,
  ]);
  root.appendChild(overlay);
  cameraStatusEl = statusEl;

  function closeCameraOverlay() {
    stopCameraStream();
    cameraStatusEl = null;
    root.innerHTML = '';
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    });
  } catch (err) {
    root.innerHTML = '';
    toast('Nem sikerült elérni a kamerát: ' + err.message, 'err');
    return;
  }
  activeCameraStream = stream;
  video.srcObject = stream;

  const detector = new window.BarcodeDetector();
  let lastValue = null;
  let lastValueAt = 0;

  async function scanLoop() {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const value = codes[0].rawValue;
        if (continuous) {
          // Ugyanaz a termék a keretben maradva ne számolódjon többször.
          const now = Date.now();
          if (value !== lastValue || now - lastValueAt > CAMERA_REPEAT_MS) {
            lastValue = value;
            lastValueAt = now;
            fillAndSubmit(targetInputId, value);
          } else {
            lastValueAt = now;
          }
          requestAnimationFrame(scanLoop);
          return;
        }
        stopped = true;
        closeCameraOverlay();
        fillAndSubmit(targetInputId, value);
        return;
      }
    } catch (e) {
      // egy-egy sikertelen frame nem hiba, csak próbáljuk a következőt
    }
    requestAnimationFrame(scanLoop);
  }

  video.addEventListener('loadedmetadata', scanLoop);
}

document.querySelectorAll('.btn-camera').forEach((btn) => {
  btn.addEventListener('click', () => openCameraScanner(btn.dataset.cameraTarget, btn.dataset.cameraContinuous === 'true'));
});

function openContentModal(title, contentNode) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) root.innerHTML = ''; } }, [
    el('div', { class: 'modal modal-wide' }, [
      el('h2', {}, title),
      contentNode,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-primary', onclick: () => { root.innerHTML = ''; } }, 'Bezárás'),
      ]),
    ]),
  ]);
  root.appendChild(backdrop);
}

function openModal(title, fields, onSave) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const inputs = fields.map((f) =>
    el('div', {}, [
      el('label', {}, f.label),
      el('input', { id: f.id, type: f.type, value: f.value ?? '' }),
    ])
  );
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) root.innerHTML = ''; } }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, title),
      ...inputs,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: () => { root.innerHTML = ''; } }, 'Mégse'),
        el('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            const values = {};
            fields.forEach((f) => { values[f.id] = document.getElementById(f.id).value.trim(); });
            try {
              await onSave(values);
              root.innerHTML = '';
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Mentés'),
      ]),
    ]),
  ]);
  root.appendChild(backdrop);
  const firstInput = document.getElementById(fields[0].id);
  if (firstInput) firstInput.focus();
}

// ---------- Rendelések / komissiózás ----------

let currentPickingOrderId = null;
// Alapértelmezetten csak az összekészítésre váró rendeléseket mutatjuk -
// a csomagolónak jellemzően ez a napi munkalistája. A szűrő átkapcsolható.
let ordersFilter = 'pending'; // 'pending' | 'picked' | 'all'

function showOrdersList() {
  document.getElementById('orders-list-panel').classList.remove('hidden');
  document.getElementById('orders-picking-panel').classList.add('hidden');
  currentPickingOrderId = null;
}

function showPickingPanel() {
  document.getElementById('orders-list-panel').classList.add('hidden');
  document.getElementById('orders-picking-panel').classList.remove('hidden');
}

async function loadOrders() {
  let orders = [];
  try {
    orders = await api('GET', '/api/orders');
  } catch (err) {
    toast(err.message, 'err');
    return;
  }

  const pending = orders.filter((o) => !o.picked_at).length;
  const picked = orders.length - pending;

  // Szűrés a kiválasztott nézet szerint
  let visible = orders;
  if (ordersFilter === 'pending') visible = orders.filter((o) => !o.picked_at);
  else if (ordersFilter === 'picked') visible = orders.filter((o) => o.picked_at);

  const filterLabel =
    ordersFilter === 'pending' ? 'összekészítésre vár' : ordersFilter === 'picked' ? 'összekészítve' : 'összesen';
  document.getElementById('orders-heading').textContent = `Rendelések — ${visible.length} ${filterLabel}`;

  // A szűrőgombok feliratán mutatjuk a darabszámokat is
  document.querySelectorAll('[data-orders-filter]').forEach((btn) => {
    const key = btn.dataset.ordersFilter;
    btn.classList.toggle('active', key === ordersFilter);
    if (key === 'pending') btn.textContent = `Összekészítésre vár (${pending})`;
    else if (key === 'picked') btn.textContent = `Összekészítve (${picked})`;
    else btn.textContent = `Mind (${orders.length})`;
  });

  const badge = document.getElementById('orders-nav-badge');
  if (badge) {
    badge.textContent = String(pending);
    badge.classList.toggle('hidden', pending === 0);
  }

  const tbody = document.querySelector('#orders-table tbody');
  tbody.innerHTML = '';

  if (!visible.length) {
    const emptyText =
      orders.length === 0
        ? 'Még nincs beolvasott rendelés. Nyiss meg egy rendelést a Shoprenter adminban a Kvikk Connect bővítménnyel.'
        : ordersFilter === 'pending'
        ? 'Nincs összekészítésre váró rendelés. 🎉'
        : 'Nincs ilyen állapotú rendelés.';
    tbody.appendChild(el('tr', {}, [el('td', { colspan: '6', class: 'hint' }, emptyText)]));
    return;
  }

  for (const order of visible) {
    const statusParts = [];
    if (order.picked_at) statusParts.push('✅ összekészítve');
    else statusParts.push('⏳ vár');
    if (order.unmatched_count > 0) statusParts.push(`⚠️ ${order.unmatched_count} ismeretlen cikkszám`);
    if (order.kvikk_tracking_number) statusParts.push('📦 van Kvikk címke');
    if (order.verified_at) statusParts.push('🔎 ellenőrizve');
    else if (order.verify_scan_count > 0) statusParts.push('🔎 ellenőrzés eltér / folyamatban');
    if (order.stock_deducted_at) statusParts.push('📉 készlet könyvelve');

    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, `#${order.shoprenter_order_id}`),
        el('td', {}, order.customer_name || '-'),
        el('td', {}, `${order.item_count} féle / ${order.unit_count} db`),
        el('td', {}, order.shipping_method_text || '-'),
        el('td', {}, statusParts.join(' · ')),
        el('td', {}, [
          el('button', {
            class: 'btn btn-primary',
            onclick: () => openPicking(order.id),
          }, 'Összekészítés'),
        ]),
      ])
    );
  }
}

async function openPicking(orderRowId) {
  let data;
  try {
    data = await api('GET', `/api/orders/${orderRowId}/picking`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }

  currentPickingOrderId = orderRowId;
  showPickingPanel();

  document.getElementById('picking-heading').textContent =
    `#${data.order.shoprenter_order_id} — ${data.order.customer_name || 'ismeretlen vevő'}`;

  // Figyelmeztetések (hiányzó termék, kevés készlet)
  const problemsBox = document.getElementById('picking-problems');
  problemsBox.innerHTML = '';
  if (data.problems > 0) {
    problemsBox.appendChild(
      el('div', { class: 'card', style: 'border-left:4px solid #c0392b' }, [
        el('h2', {}, `⚠️ ${data.problems} tétel figyelmet igényel`),
        el('ul', {}, data.items.filter((i) => i.problem).map((i) =>
          el('li', {}, `${i.sku || '(nincs cikkszám)'} — ${i.name || ''}: ${i.problem}`)
        )),
      ])
    );
  }

  // Doboz szerinti bejárás
  const byBoxHolder = document.getElementById('picking-by-box');
  byBoxHolder.innerHTML = '';
  if (!data.by_box.length) {
    byBoxHolder.appendChild(el('p', { class: 'hint' }, 'Egyik termék sincs dobozhoz rendelve.'));
  } else {
    for (const box of data.by_box) {
      byBoxHolder.appendChild(
        el('div', { class: 'picking-box-group' }, [
          el('strong', {}, `${box.box_id}${box.label ? ' — ' + box.label : ''}`),
          el('ul', {}, box.items.map((it) => {
            const codeParts = [it.sku, it.ean].filter(Boolean).join(' / ');
            return el('li', {}, [
              el('span', { class: 'picking-item-qty' }, `${it.needed_qty} db`),
              ' — ',
              el('span', { class: 'picking-item-name' }, it.name || '(ismeretlen termék)'),
              codeParts ? el('span', { class: 'picking-item-code' }, ` [${codeParts}]`) : '',
              ` (a dobozban: ${it.in_box_qty} db)`,
            ]);
          })),
        ])
      );
    }
  }

  // Tételes táblázat
  const tbody = document.querySelector('#picking-table tbody');
  tbody.innerHTML = '';
  for (const item of data.items) {
    const where = item.placements.length
      ? item.placements.map((p) => `${p.box_id} (${p.qty} db)`).join(', ')
      : '—';
    tbody.appendChild(
      el('tr', { style: item.problem ? 'background:#fdeaea' : '' }, [
        el('td', {}, item.sku || '-'),
        el('td', {}, item.product_name || item.name || '-'),
        el('td', {}, `${item.qty} db`),
        el('td', {}, where),
        el('td', {}, item.matched ? `${item.available_qty} db` : 'ismeretlen termék'),
      ])
    );
  }

  const toggleBtn = document.getElementById('btn-toggle-picked');
  toggleBtn.textContent = data.order.picked_at ? 'Mégsem készült össze' : 'Összekészítettnek jelölés';

  const deductBtn = document.getElementById('btn-deduct-stock');
  const deductHint = document.getElementById('deduct-stock-hint');
  if (data.order.stock_deducted_at) {
    deductBtn.textContent = 'Készletcsökkentés visszavonása';
    deductBtn.disabled = false;
    deductHint.textContent = `Könyvelve: ${String(data.order.stock_deducted_at).replace('T', ' ').slice(0, 16)}`;
  } else if (!data.order.picked_at) {
    deductBtn.textContent = 'Készletcsökkentés könyvelése';
    deductBtn.disabled = true;
    deductHint.textContent = 'Előbb jelöld a rendelést összekészítettnek.';
  } else {
    deductBtn.textContent = 'Készletcsökkentés könyvelése';
    deductBtn.disabled = false;
    deductHint.textContent = '';
  }

  await loadVerify(orderRowId);
}

document.querySelectorAll('[data-orders-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ordersFilter = btn.dataset.ordersFilter;
    loadOrders();
  });
});

document.getElementById('btn-orders-back').addEventListener('click', () => {
  showOrdersList();
  loadOrders();
});

const toggleBtn = () => document.getElementById('btn-toggle-picked');
document.getElementById('btn-toggle-picked').addEventListener('click', async () => {
  if (!currentPickingOrderId) return;
  // Nem tiltjuk, csak rákérdezünk, ha a visszaellenőrzés elkezdődött, de eltérést mutat.
  const v = lastVerifySummary;
  const markingPicked = toggleBtn().textContent === 'Összekészítettnek jelölés';
  if (markingPicked && v && v.scan_count > 0 && !v.complete) {
    const parts = [];
    if (v.missing_units) parts.push(`${v.missing_units} db hiányzik`);
    if (v.over_units) parts.push(`${v.over_units} db túl sok`);
    if (v.wrong_units) parts.push(`${v.wrong_units} db nem a rendelés része`);
    if (!confirm(`A vonalkódos ellenőrzés eltérést mutat (${parts.join(', ')}). Biztosan összekészítettnek jelölöd?`)) return;
  }
  try {
    const res = await api('POST', `/api/orders/${currentPickingOrderId}/picked`);
    toast(res.picked_at ? 'Összekészítve.' : 'Visszaállítva.', 'ok');
    await openPicking(currentPickingOrderId);
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.getElementById('btn-deduct-stock').addEventListener('click', async () => {
  if (!currentPickingOrderId) return;
  try {
    const res = await api('POST', `/api/orders/${currentPickingOrderId}/deduct-stock`);
    if (res.stock_deducted_at === null) {
      toast(`Készletcsökkentés visszavonva (${res.reversed_items} tétel).`, 'ok');
    } else {
      let msg = `Készlet lekönyvelve (${res.deducted_lines} tétel).`;
      if (res.skipped_unmatched && res.skipped_unmatched.length) {
        msg += ` ⚠️ ${res.skipped_unmatched.length} ismeretlen cikkszámú tétel NEM lett könyvelve.`;
      }
      toast(msg, 'ok');
    }
    await openPicking(currentPickingOrderId);
  } catch (err) {
    if (err.data && err.data.shortfalls && err.data.shortfalls.length) {
      const lines = err.data.shortfalls
        .map((s) => `${s.sku || '(nincs cikkszám)'} — ${s.name || ''}: hiányzik ${s.missing_qty} db`)
        .join('\n');
      alert(`Nincs elég elhelyezett készlet, a könyvelés nem történt meg:\n\n${lines}`);
    } else {
      toast(err.message, 'err');
    }
  }
});

// Teljes képernyős, nagybetűs nézet a "Doboz szerint" listához - hogy
// távolabbról (pl. a raktár másik sarkából, egy állványra kitett
// tabletről) is olvasható legyen a cikkszám/vonalkód és a mennyiség.
const pickingByBoxCard = document.getElementById('picking-by-box-card');
const pickingFullscreenBtn = document.getElementById('btn-picking-fullscreen');
pickingFullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement === pickingByBoxCard) {
    document.exitFullscreen();
  } else if (pickingByBoxCard.requestFullscreen) {
    pickingByBoxCard.requestFullscreen().catch((err) => {
      toast(`Nem sikerült teljes képernyőre váltani: ${err.message}`, 'err');
    });
  } else {
    toast('A böngésződ nem támogatja a teljes képernyős nézetet.', 'err');
  }
});
document.addEventListener('fullscreenchange', () => {
  const isFullscreen = document.fullscreenElement === pickingByBoxCard;
  pickingByBoxCard.classList.toggle('picking-fullscreen', isFullscreen);
  pickingFullscreenBtn.textContent = isFullscreen ? '✕ Kilépés a nagyításból' : '🔍 Nagyítás';
});

// ---------- Vonalkódos visszaellenőrzés ----------
// Az összekészített csomag tartalmát egyenként beolvassuk, és a szerver
// összeveti a rendelés tételeivel. Minden beolvasás után nagy, színes
// visszajelzés + rövid hang, hogy a csomagolónak ne kelljen a képernyőt
// figyelnie: magas csippanás = rendben, mély búgás = hiba.

let lastVerifySummary = null;
let audioCtx = null;

function verifyBeep(ok) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = ok ? 'sine' : 'square';
    osc.frequency.value = ok ? 1400 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.08 : 0.35));
  } catch (e) { /* hang nélkül is működik */ }
}

function verifyStatusTag(status) {
  if (status === 'ok') return el('span', { class: 'tag tag-ok' }, '✓ rendben');
  if (status === 'missing') return el('span', { class: 'tag tag-warn' }, 'hiányzik');
  if (status === 'over') return el('span', { class: 'tag tag-bad' }, 'túl sok');
  return el('span', { class: 'tag tag-bad' }, 'nem rendelt');
}

function renderVerify(summary) {
  lastVerifySummary = summary;

  const progress = document.getElementById('verify-progress');
  const scannedUnits = summary.needed_units - summary.missing_units;
  if (summary.complete) {
    progress.className = 'tag tag-ok';
    progress.textContent = '✓ Minden stimmel';
  } else if (summary.over_units || summary.wrong_units) {
    progress.className = 'tag tag-bad';
    progress.textContent = `${scannedUnits} / ${summary.needed_units} db · eltérés`;
  } else {
    progress.className = summary.scan_count ? 'tag tag-warn' : 'tag tag-neutral';
    progress.textContent = `${scannedUnits} / ${summary.needed_units} db`;
  }

  const tbody = document.querySelector('#verify-table tbody');
  tbody.innerHTML = '';
  // Előbb a még teendőt igénylő sorok, a rendben lévők a lista végén.
  const order = { over: 0, missing: 1, ok: 2 };
  const lines = summary.lines.slice().sort((a, b) => order[a.status] - order[b.status]);

  for (const extra of summary.extras) {
    const codeText = [extra.sku, extra.ean].filter(Boolean).join(' / ') || extra.code;
    tbody.appendChild(
      el('tr', { class: 'verify-row-bad' }, [
        el('td', {}, verifyStatusTag('wrong')),
        el('td', { class: 'mono' }, codeText || '-'),
        el('td', {}, extra.known_product ? extra.name || '-' : 'Ismeretlen kód — nincs ilyen termék a leltárban'),
        el('td', {}, `${extra.scanned_qty} / 0 db`),
        el('td', {}, 'Vedd ki a csomagból'),
      ])
    );
  }
  for (const line of lines) {
    const codeText = [line.sku, line.ean].filter(Boolean).join(' / ');
    // Vonalkód nélküli (vagy a leltárban nem szereplő) terméket kézzel is
    // le lehet pipálni, különben az ellenőrzés sosem lenne hiánytalan.
    const manualBtn = line.status === 'missing'
      ? el('button', {
          class: 'btn btn-ghost btn-small',
          title: 'Ha a terméken nincs olvasható vonalkód',
          onclick: () => verifyScan({ manual_key: line.key }),
        }, '+1 kézzel')
      : '';
    tbody.appendChild(
      el('tr', { class: line.status === 'ok' ? 'verify-row-ok' : line.status === 'over' ? 'verify-row-bad' : '' }, [
        el('td', {}, verifyStatusTag(line.status)),
        el('td', { class: 'mono' }, codeText || '-'),
        el('td', {}, line.name || '-'),
        el('td', {}, `${line.scanned_qty} / ${line.needed_qty} db`),
        el('td', {}, manualBtn),
      ])
    );
  }
  if (!summary.lines.length && !summary.extras.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', class: 'hint' }, 'A rendelésnek nincsenek tételei.')]));
  }
}

function showVerifyFeedback(type, title, detail) {
  const box = document.getElementById('verify-feedback');
  box.className = `verify-feedback verify-${type}`;
  box.innerHTML = '';
  box.appendChild(el('div', { class: 'verify-feedback-title' }, title));
  if (detail) box.appendChild(el('div', { class: 'verify-feedback-detail' }, detail));
  if (cameraStatusEl) {
    cameraStatusEl.className = `camera-overlay-status verify-feedback verify-${type}`;
    cameraStatusEl.innerHTML = box.innerHTML;
  }
}

function hideVerifyFeedback() {
  document.getElementById('verify-feedback').className = 'verify-feedback hidden';
}

async function loadVerify(orderRowId) {
  hideVerifyFeedback();
  document.getElementById('verify-scan').value = '';
  try {
    renderVerify(await api('GET', `/api/orders/${orderRowId}/verify`));
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function verifyScan(body) {
  if (!currentPickingOrderId) return;
  let res;
  try {
    res = await api('POST', `/api/orders/${currentPickingOrderId}/verify/scan`, body);
  } catch (err) {
    verifyBeep(false);
    showVerifyFeedback('bad', err.message);
    return;
  }
  renderVerify(res);

  const s = res.scanned;
  const what = [s.name, s.sku || s.code].filter(Boolean).join(' — ');
  if (res.result === 'ok') {
    verifyBeep(true);
    if (res.complete) showVerifyFeedback('ok', '✓ Minden stimmel, a csomag hiánytalan.', what);
    else showVerifyFeedback('ok', `✓ Rendben (${s.scanned_qty} / ${s.needed_qty} db)`, `${what} · még ${res.missing_units} db hiányzik a csomagból`);
  } else if (res.result === 'over') {
    verifyBeep(false);
    showVerifyFeedback('bad', `✕ Túl sok! Ebből csak ${s.needed_qty} db kell, ez már a ${s.scanned_qty}. darab.`, `${what} · tegyél vissza ${s.scanned_qty - s.needed_qty} db-ot`);
  } else if (res.result === 'wrong') {
    verifyBeep(false);
    showVerifyFeedback('bad', '✕ Rossz termék! Ez nem része a rendelésnek.', `${what} · vedd ki a csomagból`);
  } else {
    verifyBeep(false);
    showVerifyFeedback('bad', `✕ Ismeretlen kód: ${s.code}`, 'Nincs ilyen EAN-kódú vagy cikkszámú termék a leltárban.');
  }
}

const verifyInput = document.getElementById('verify-scan');
verifyInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = verifyInput.value.trim();
  if (!code) return;
  verifyInput.value = '';
  await verifyScan({ code });
  verifyInput.focus();
});

document.getElementById('btn-verify-undo').addEventListener('click', async () => {
  if (!currentPickingOrderId) return;
  try {
    renderVerify(await api('POST', `/api/orders/${currentPickingOrderId}/verify/undo`));
    hideVerifyFeedback();
    toast('Utolsó beolvasás visszavonva.', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.getElementById('btn-verify-reset').addEventListener('click', async () => {
  if (!currentPickingOrderId) return;
  if (!confirm('Biztosan újrakezded az ellenőrzést? Az eddigi beolvasások törlődnek.')) return;
  try {
    renderVerify(await api('POST', `/api/orders/${currentPickingOrderId}/verify/reset`));
    hideVerifyFeedback();
  } catch (err) {
    toast(err.message, 'err');
  }
});

async function updateOrdersBadge() {
  try {
    const orders = await api('GET', '/api/orders');
    const pending = orders.filter((o) => !o.picked_at).length;
    const badge = document.getElementById('orders-nav-badge');
    if (badge) {
      badge.textContent = String(pending);
      badge.classList.toggle('hidden', pending === 0);
    }
  } catch (e) { /* nem kritikus */ }
}

// ---------- Bejövő számlák ----------

const invoiceFilter = { status: 'all', q: '', supplier_id: '', category: '', from: '', to: '' };
const INVOICE_PAID_BY_DEFAULT = ['Készpénz', 'Bankkártya'];
const PAYMENT_METHOD_OPTIONS = ['Átutalás', 'Bankkártya', 'Készpénz', 'Csoportos beszedés', 'Utánvét', 'PayPal'];

function fmtMoney(n, currency = 'HUF') {
  if (n === null || n === undefined || n === '') return '—';
  const digits = currency === 'HUF' ? 0 : 2;
  const s = Number(n).toLocaleString('hu-HU', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return currency === 'HUF' ? `${s} Ft` : `${s} ${currency}`;
}

function fmtSums(sums) {
  const entries = Object.entries(sums || {});
  if (!entries.length) return fmtMoney(0);
  return entries.map(([cur, sum]) => fmtMoney(sum, cur)).join(' + ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${y}.${m}.${d}.`;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00`) - new Date(`${fromIso}T00:00:00`)) / 86400000);
}

function invoiceQuery() {
  const params = new URLSearchParams();
  Object.entries(invoiceFilter).forEach(([k, v]) => { if (v) params.set(k, v); });
  return params.toString();
}

function invoiceStatusTag(inv) {
  if (inv.status === 'ellenorizendo') return el('span', { class: 'tag tag-warn' }, 'Ellenőrizendő');
  if (inv.status === 'fizetve') return el('span', { class: 'tag tag-ok' }, `Kifizetve ${inv.paid_at ? fmtDate(inv.paid_at) : ''}`.trim());
  if (inv.overdue) return el('span', { class: 'tag tag-bad' }, 'Lejárt');
  return el('span', { class: 'tag tag-neutral' }, 'Fizetendő');
}

function dueCell(inv) {
  if (!inv.due_date) return el('td', { class: 'mono' }, '—');
  const text = [el('span', {}, fmtDate(inv.due_date))];
  if (inv.status === 'fizetendo') {
    const diff = daysBetween(localToday(), inv.due_date);
    let note = null;
    if (diff < 0) note = `${-diff} napja lejárt`;
    else if (diff === 0) note = 'ma esedékes';
    else if (diff <= 7) note = `${diff} nap múlva`;
    if (note) text.push(el('div', { class: diff < 0 ? 'invoice-due-note bad' : 'invoice-due-note' }, note));
  }
  return el('td', { class: inv.overdue ? 'mono invoice-overdue' : 'mono' }, text);
}

function renderInvoiceStats(s) {
  const grid = document.getElementById('invoice-stats');
  grid.innerHTML = '';
  const boxes = [
    { num: String(s.to_review), label: 'Ellenőrizendő', status: 'ellenorizendo', cls: s.to_review ? 'stat-warn' : '' },
    { num: String(s.to_pay.count), label: `Fizetendő — ${fmtSums(s.to_pay.sums)}`, status: 'fizetendo' },
    { num: String(s.due_soon.count), label: `7 napon belül esedékes — ${fmtSums(s.due_soon.sums)}`, status: 'fizetendo' },
    { num: String(s.overdue.count), label: `Lejárt — ${fmtSums(s.overdue.sums)}`, status: 'lejart', cls: s.overdue.count ? 'stat-bad' : '' },
    { num: String(s.paid_this_month.count), label: `Kifizetve ebben a hónapban — ${fmtSums(s.paid_this_month.sums)}`, status: 'fizetve' },
  ];
  boxes.forEach((b) => {
    grid.appendChild(el('div', {
      class: `stat-box stat-clickable ${b.cls || ''}`,
      title: 'Kattints a szűréshez',
      onclick: () => setInvoiceStatusFilter(b.status),
    }, [
      el('div', { class: 'num' }, b.num),
      el('div', { class: 'label' }, b.label),
    ]));
  });
  updateInvoicesBadgeFrom(s);
}

function updateInvoicesBadgeFrom(s) {
  const badge = document.getElementById('invoices-nav-badge');
  const n = s.to_review + s.overdue.count;
  badge.textContent = String(n);
  badge.classList.toggle('hidden', n === 0);
}

async function updateInvoicesBadge() {
  try {
    updateInvoicesBadgeFrom(await api('GET', '/api/invoices/summary'));
  } catch (e) { /* nem kritikus */ }
}

function setInvoiceStatusFilter(status) {
  invoiceFilter.status = status;
  document.querySelectorAll('#invoice-status-filter .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.invoiceStatus === status);
  });
  loadInvoices();
}

function fillSelect(select, options, emptyLabel) {
  const current = select.value;
  select.innerHTML = '';
  select.appendChild(el('option', { value: '' }, emptyLabel));
  options.forEach(([value, label]) => select.appendChild(el('option', { value: String(value) }, label)));
  select.value = options.some(([v]) => String(v) === current) ? current : '';
}

let invoiceSuppliers = [];
let invoiceCategories = [];

async function loadInvoiceLookups() {
  [invoiceSuppliers, invoiceCategories] = await Promise.all([
    api('GET', '/api/invoices/suppliers'),
    api('GET', '/api/invoices/categories'),
  ]);
  fillSelect(document.getElementById('invoice-supplier-filter'),
    invoiceSuppliers.map((s) => [s.id, s.name]), 'Minden szállító');
  fillSelect(document.getElementById('invoice-category-filter'),
    invoiceCategories.map((c) => [c, c]), 'Minden kategória');
}

async function loadInvoiceSettings() {
  try {
    const s = await api('GET', '/api/invoices/settings');
    document.getElementById('invoice-inbox-dir').textContent = s.inbox_dir;
    const last = s.last_scan;
    const info = document.getElementById('invoice-last-scan');
    if (last) {
      const at = new Date(last.at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      info.textContent = last.errors.length
        ? `Utolsó beolvasás ${at}: ${last.errors.join(' · ')}`
        : `Utolsó beolvasás: ${at}`;
      info.classList.toggle('invoice-scan-error', last.errors.length > 0);
    }
    return s;
  } catch (e) {
    return null;
  }
}

async function loadInvoices() {
  let data;
  try {
    [data] = await Promise.all([
      api('GET', `/api/invoices?${invoiceQuery()}`),
      loadInvoiceLookups(),
      loadInvoiceSettings(),
    ]);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  renderInvoiceStats(data.summary);
  document.getElementById('btn-invoice-export').href = `/api/invoices/export?${invoiceQuery()}`;
  document.getElementById('invoices-heading').innerHTML =
    `Számlák <span class="tag tag-neutral">${data.invoices.length} db</span>`;

  const tbody = document.querySelector('#invoices-table tbody');
  tbody.innerHTML = '';
  if (!data.invoices.length) {
    const empty = invoiceFilter.status === 'all' && !invoiceFilter.q && !invoiceFilter.supplier_id && !invoiceFilter.from && !invoiceFilter.to && !invoiceFilter.category;
    tbody.appendChild(el('tr', {}, el('td', { colspan: '8', class: 'hint' },
      empty ? 'Még nincs számla. Ments egy számla-PDF-et a figyelt mappába, vagy töltsd fel a fenti gombbal.' : 'Nincs a szűrésnek megfelelő számla.')));
  }
  data.invoices.forEach((inv) => {
    const actions = [];
    if (inv.status === 'ellenorizendo') {
      actions.push(el('button', { class: 'btn btn-primary btn-small', onclick: (e) => { e.stopPropagation(); openInvoiceModal(inv.id); } }, 'Átnézés'));
    } else if (inv.status === 'fizetendo') {
      actions.push(el('button', { class: 'btn btn-ghost btn-small', onclick: (e) => { e.stopPropagation(); markInvoicePaid(inv); } }, '✓ Kifizetve'));
    }
    const supplierCell = [el('div', { class: 'invoice-supplier' }, inv.supplier_name || '(ismeretlen szállító)')];
    if (inv.status === 'ellenorizendo' && inv.extract_warnings.length) {
      supplierCell.push(el('div', { class: 'invoice-due-note bad' }, '⚠ hiányos adatok'));
    }
    tbody.appendChild(el('tr', { class: 'invoice-row', onclick: () => openInvoiceModal(inv.id) }, [
      el('td', {}, supplierCell),
      el('td', { class: 'mono' }, inv.invoice_number || '—'),
      el('td', { class: 'mono' }, fmtDate(inv.issue_date)),
      dueCell(inv),
      el('td', { class: 'mono num-col' }, fmtMoney(inv.gross_amount, inv.currency)),
      el('td', {}, inv.category || '—'),
      el('td', {}, invoiceStatusTag(inv)),
      el('td', { class: 'invoice-actions' }, actions),
    ]));
  });
  document.getElementById('invoices-total').textContent = data.invoices.length
    ? `A listában szereplő számlák bruttó összege: ${fmtSums(data.totals)}`
    : '';
}

async function markInvoicePaid(inv) {
  try {
    await api('POST', `/api/invoices/${inv.id}/pay`, { paid: true });
    toast(`Kifizetettnek jelölve: ${inv.supplier_name || ''} ${inv.invoice_number || ''}`.trim());
    loadInvoices();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function invoiceField(label, input, { wide = false } = {}) {
  return el('div', { class: wide ? 'invoice-field wide' : 'invoice-field' }, [el('label', {}, label), input]);
}

function datalist(id, values) {
  return el('datalist', { id }, values.map((v) => el('option', { value: v })));
}

async function openInvoiceModal(id) {
  let inv = null;
  if (id) {
    try {
      inv = await api('GET', `/api/invoices/${id}`);
    } catch (err) {
      toast(err.message, 'err');
      return;
    }
    if (!invoiceSuppliers.length) await loadInvoiceLookups().catch(() => {});
  }
  const isReview = inv && inv.status === 'ellenorizendo';
  const v = (k) => (inv && inv[k] !== null && inv[k] !== undefined ? String(inv[k]) : '');
  const input = (name, attrs = {}) => {
    const node = el('input', { type: 'text', name, value: v(name), autocomplete: 'off', ...attrs });
    if (isReview && attrs['data-required'] && !node.value) node.classList.add('invoice-missing');
    node.addEventListener('input', () => node.classList.remove('invoice-missing'));
    return node;
  };

  const f = {
    supplier_name: input('supplier_name', { list: 'invoice-supplier-list', 'data-required': '1' }),
    supplier_tax_number: input('supplier_tax_number', { placeholder: 'pl. 12345678-2-42' }),
    invoice_number: input('invoice_number', { 'data-required': '1' }),
    issue_date: input('issue_date', { type: 'date', 'data-required': '1' }),
    fulfillment_date: input('fulfillment_date', { type: 'date' }),
    due_date: input('due_date', { type: 'date', 'data-required': '1' }),
    net_amount: input('net_amount', { inputmode: 'decimal' }),
    vat_amount: input('vat_amount', { inputmode: 'decimal' }),
    gross_amount: input('gross_amount', { inputmode: 'decimal', 'data-required': '1' }),
    currency: el('select', { name: 'currency' }, ['HUF', 'EUR', 'USD'].map((c) => el('option', { value: c }, c))),
    payment_method: input('payment_method', { list: 'invoice-payment-list' }),
    category: input('category', { list: 'invoice-category-list', placeholder: 'pl. Áru, Rezsi' }),
    note: el('textarea', { name: 'note', rows: '2' }),
    status: el('select', { name: 'status' }, [
      el('option', { value: 'fizetendo' }, 'Fizetendő'),
      el('option', { value: 'fizetve' }, 'Kifizetve'),
    ]),
    paid_at: input('paid_at', { type: 'date' }),
  };
  f.currency.value = v('currency') || 'HUF';
  f.note.value = v('note');
  if (inv && inv.status === 'fizetve') f.status.value = 'fizetve';
  else if (isReview && INVOICE_PAID_BY_DEFAULT.includes(inv.payment_method)) f.status.value = 'fizetve';
  else f.status.value = 'fizetendo';
  if (f.status.value === 'fizetve' && !f.paid_at.value) f.paid_at.value = (inv && inv.issue_date) || localToday();

  const paidField = invoiceField('Kifizetés napja', f.paid_at);
  const syncPaid = () => paidField.classList.toggle('hidden', f.status.value !== 'fizetve');
  f.status.addEventListener('change', () => {
    if (f.status.value === 'fizetve' && !f.paid_at.value) f.paid_at.value = localToday();
    syncPaid();
  });
  syncPaid();

  // Nettó + ÁFA → bruttó, ha a bruttó üres vagy eddig is az összegük volt
  const num = (node) => {
    const n = Number(node.value.replace(/\s/g, '').replace(',', '.'));
    return node.value.trim() && Number.isFinite(n) ? n : null;
  };
  let lastAutoGross = null;
  const recalc = () => {
    const n = num(f.net_amount);
    const a = num(f.vat_amount);
    if (n === null || a === null) return;
    const g = num(f.gross_amount);
    if (g === null || g === lastAutoGross) {
      lastAutoGross = Math.round((n + a) * 100) / 100;
      f.gross_amount.value = String(lastAutoGross);
      f.gross_amount.classList.remove('invoice-missing');
    }
  };
  f.net_amount.addEventListener('change', recalc);
  f.vat_amount.addEventListener('change', recalc);
  // Ismert szállító kiválasztásakor az adószám és a kategória is kitöltődik
  f.supplier_name.addEventListener('change', () => {
    const s = invoiceSuppliers.find((x) => x.name.toLowerCase() === f.supplier_name.value.trim().toLowerCase());
    if (!s) return;
    if (!f.supplier_tax_number.value && s.tax_number) f.supplier_tax_number.value = s.tax_number;
    if (!f.category.value && s.default_category) f.category.value = s.default_category;
  });

  const form = el('div', { class: 'invoice-form' }, [
    invoiceField('Szállító', f.supplier_name, { wide: true }),
    invoiceField('Szállító adószáma', f.supplier_tax_number),
    invoiceField('Számlaszám', f.invoice_number),
    invoiceField('Kiállítás dátuma', f.issue_date),
    invoiceField('Teljesítés dátuma', f.fulfillment_date),
    invoiceField('Fizetési határidő', f.due_date),
    invoiceField('Fizetési mód', f.payment_method),
    invoiceField('Nettó összeg', f.net_amount),
    invoiceField('ÁFA', f.vat_amount),
    invoiceField('Bruttó összeg (fizetendő)', f.gross_amount),
    invoiceField('Pénznem', f.currency),
    invoiceField('Kategória', f.category),
    invoiceField('Állapot', f.status),
    paidField,
    invoiceField('Megjegyzés', f.note, { wide: true }),
    datalist('invoice-supplier-list', invoiceSuppliers.map((s) => s.name)),
    datalist('invoice-category-list', invoiceCategories),
    datalist('invoice-payment-list', PAYMENT_METHOD_OPTIONS),
  ]);

  const side = [];
  if (isReview) {
    side.push(el('div', { class: 'invoice-review-note' }, [
      el('strong', {}, 'Automatikusan beolvasott adatok. '),
      'Vesd össze a bal oldali PDF-fel, javítsd, ha kell, majd mentsd. A sárga mezőket nem sikerült felismerni.',
    ]));
  }
  if (inv && inv.extract_warnings.length) {
    side.push(el('ul', { class: 'invoice-warnings' }, inv.extract_warnings.map((w) => el('li', {}, w))));
  }
  side.push(form);

  const pdfPane = inv && inv.has_file
    ? el('div', { class: 'invoice-pdf' }, [
      el('iframe', { src: `/api/invoices/${inv.id}/pdf#view=FitH&navpanes=0`, title: 'Számla PDF' }),
      el('a', { class: 'btn btn-ghost btn-small', href: `/api/invoices/${inv.id}/pdf`, target: '_blank', rel: 'noopener' }, 'PDF megnyitása új lapon'),
    ])
    : null;

  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const save = async () => {
    const body = {};
    Object.entries(f).forEach(([k, node]) => { body[k] = node.value; });
    if (body.status !== 'fizetve') body.paid_at = '';
    try {
      const saved = inv
        ? await api('PUT', `/api/invoices/${inv.id}`, body)
        : await api('POST', '/api/invoices', body);
      if (saved.duplicate_of) toast(`Figyelem: ugyanez a számlaszám ettől a szállítótól már szerepel (#${saved.duplicate_of}).`, 'err');
      else toast(isReview ? 'Számla jóváhagyva.' : 'Számla elmentve.');
      close();
      loadInvoices();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  const remove = async () => {
    if (!confirm('Biztosan törlöd ezt a számlát? A hozzá tartozó PDF másolata is törlődik az appból.')) return;
    try {
      await api('DELETE', `/api/invoices/${inv.id}`);
      toast('Számla törölve.');
      close();
      loadInvoices();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const title = !inv ? 'Új számla kézi rögzítése' : isReview ? 'Beolvasott számla átnézése' : 'Számla adatai';
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, [
    el('div', { class: `modal modal-invoice ${pdfPane ? 'has-pdf' : ''}` }, [
      el('h2', {}, title),
      el('div', { class: 'invoice-modal-body' }, [pdfPane, el('div', { class: 'invoice-side' }, side)]),
      el('div', { class: 'modal-actions' }, [
        inv ? el('button', { class: 'btn btn-danger-outline invoice-delete', onclick: remove }, 'Törlés') : null,
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Mégse'),
        el('button', { class: 'btn btn-primary', onclick: save }, isReview ? 'Jóváhagyás és mentés' : 'Mentés'),
      ]),
    ]),
  ]);
  root.appendChild(backdrop);
  (isReview ? form.querySelector('.invoice-missing') : f.supplier_name)?.focus();
}

function invoiceImportToast(r) {
  const parts = [];
  if (r.imported) parts.push(`${r.imported} új számla beolvasva`);
  if (r.duplicates) parts.push(`${r.duplicates} már szerepelt`);
  if (!r.imported && !r.duplicates && !r.errors.length) parts.push('Nem találtam új PDF-et a mappában');
  if (parts.length) toast(`${parts.join(', ')}.`);
  if (r.errors.length) toast(r.errors.join(' · '), 'err');
}

document.getElementById('btn-invoice-scan').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    invoiceImportToast(await api('POST', '/api/invoices/scan'));
    await loadInvoices();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    e.target.disabled = false;
  }
});

document.getElementById('invoice-upload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const fd = new FormData();
  files.forEach((file) => fd.append('files', file));
  try {
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `Hiba (${res.status})`);
    invoiceImportToast(r);
    await loadInvoices();
    if (r.imported === 1 && r.ids.length === 1) openInvoiceModal(r.ids[0]);
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.getElementById('btn-invoice-new').addEventListener('click', async () => {
  if (!invoiceSuppliers.length) await loadInvoiceLookups().catch(() => {});
  openInvoiceModal(null);
});

document.getElementById('btn-invoice-settings').addEventListener('click', async () => {
  const s = await loadInvoiceSettings();
  if (!s) return toast('Nem sikerült betölteni a beállításokat.', 'err');
  openModal('Számlák beállításai', [
    { id: 'set-inbox-dir', label: 'Figyelt mappa (ide mentsd a letöltött számla-PDF-eket, pl. C:\\Claude_RAKTAR\\szamlak)', type: 'text', value: s.inbox_dir },
    { id: 'set-own-tax', label: 'Saját adószám(ok), vesszővel elválasztva — így biztosan nem a saját cégünket veszi szállítónak', type: 'text', value: s.own_tax_numbers.join(', ') },
    { id: 'set-own-names', label: 'Saját cégnév (vagy részlete), vesszővel elválasztva', type: 'text', value: s.own_names.join(', ') },
  ], async (vals) => {
    await api('PUT', '/api/invoices/settings', {
      inbox_dir: vals['set-inbox-dir'],
      own_tax_numbers: vals['set-own-tax'].split(',').map((x) => x.trim()).filter(Boolean),
      own_names: vals['set-own-names'].split(',').map((x) => x.trim()).filter(Boolean),
    });
    toast('Beállítások elmentve.');
    loadInvoices();
  });
});

document.querySelectorAll('#invoice-status-filter .chip').forEach((chip) => {
  chip.addEventListener('click', () => setInvoiceStatusFilter(chip.dataset.invoiceStatus));
});
document.getElementById('invoice-search').addEventListener('input', debounce((e) => {
  invoiceFilter.q = e.target.value.trim();
  loadInvoices();
}, 300));
[['invoice-supplier-filter', 'supplier_id'], ['invoice-category-filter', 'category'], ['invoice-from', 'from'], ['invoice-to', 'to']]
  .forEach(([elId, key]) => {
    document.getElementById(elId).addEventListener('change', (e) => {
      invoiceFilter[key] = e.target.value;
      loadInvoices();
    });
  });
document.getElementById('btn-invoice-clear-filters').addEventListener('click', () => {
  Object.assign(invoiceFilter, { q: '', supplier_id: '', category: '', from: '', to: '' });
  ['invoice-search', 'invoice-supplier-filter', 'invoice-category-filter', 'invoice-from', 'invoice-to']
    .forEach((elId) => { document.getElementById(elId).value = ''; });
  setInvoiceStatusFilter('all');
});


// ---------- Mobilos táblázat-címkék ----------
// Keskeny kijelzőn a táblázat-sorok kártyákként jelennek meg (style.css),
// ahol minden cella elé kiírjuk az oszlop nevét. Ehhez a cellák data-label
// attribútumát a táblázat fejlécéből töltjük ki, bármikor változik a tartalom.
function labelTableCells(table) {
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  if (!headers.length) return;
  table.querySelectorAll('tbody tr').forEach((tr) => {
    let col = 0;
    Array.from(tr.children).forEach((td) => {
      if (!td.hasAttribute('colspan') && !td.hasAttribute('data-label')) td.setAttribute('data-label', headers[col] || '');
      col += Number(td.getAttribute('colspan')) || 1;
    });
  });
}
document.querySelectorAll('table.table').forEach(labelTableCells);
new MutationObserver((mutations) => {
  const tables = new Set();
  mutations.forEach((m) => {
    const t = m.target.closest && m.target.closest('table.table');
    if (t) tables.add(t);
    m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches('table.table')) tables.add(n);
      n.querySelectorAll('table.table').forEach((t) => tables.add(t));
    });
  });
  tables.forEach(labelTableCells);
}).observe(document.body, { childList: true, subtree: true });

// ---------- Induláskor ----------
showView('search');
updateWatchlistBadge();
updateOrdersBadge();
updateInvoicesBadge();

api('GET', '/api/version')
  .then((data) => { document.getElementById('app-version').textContent = `v${data.version}`; })
  .catch(() => { /* ha ez nem sikerül, nem kritikus, a felület enélkül is működik */ });

// A tokennel védett Kvikk-végpontokhoz (tömeges címkegenerálás, ZIP-letöltés)
// szükséges Authorization fejlécet a szerver adja oda a saját felületének.
let kvikkInternalToken = null;
api('GET', '/api/kvikk/internal-token')
  .then((data) => { kvikkInternalToken = data.token; })
  .catch(() => { /* ha ez nem sikerül, a Kvikk statisztika nézet jelezni fogja hibaüzenetben */ });

function kvikkAuthHeader() {
  return kvikkInternalToken ? { Authorization: `Bearer ${kvikkInternalToken}` } : {};
}
