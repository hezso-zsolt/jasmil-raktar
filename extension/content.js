/**
 * Jasmil – Kvikk Connect – content script
 *
 * A Shoprenter admin egy Vue/Vuetify alkalmazás, és szerencsére a rendelés
 * részletező oldalán a legtöbb mező stabil `data-test-id` attribútummal van
 * ellátva (ezt a #383 rendelés valódi HTML-je alapján ellenőriztük) - ezekre
 * a szelektorokra épül az alábbi kiolvasó logika, NEM a látható szöveg
 * címkéjére (az korábban megbízhatatlannak bizonyult).
 *
 * Ha a Shoprenter egy jövőbeli admin-frissítés során megváltoztatja ezeket az
 * attribútumokat, a lenti szelektorokat kell frissíteni. Amíg ez nem történik
 * meg, a kiolvasás pontos. A panelen minden mező továbbra is SZERKESZTHETŐ
 * marad a gomb megnyomása előtt, biztonsági hálóként.
 */

// ---------- Oldal-felismerés ----------

function isOrderDetailPage() {
  return !!(
    document.querySelector('[data-test-id="customerName"]') &&
    document.querySelector('[data-test-id="shippingMethod"]')
  );
}

/**
 * Elhagyott kosár-e a megnyitott oldal?
 *
 * A Shoprenterben minden kosárba tétel "Elhagyott kosár" állapotú
 * rendelésként kezdi, és csak a sikeres vásárlás után lesz belőle valódi
 * rendelés. Az elhagyott kosár részletező oldala ugyanúgy néz ki, mint egy
 * rendelésé (ugyanazok a data-test-id mezők), ezért a bővítmény eddig ezeket
 * is beküldte a leltár app "Rendelések" listájába - ez megtévesztő volt.
 *
 * Több jelet is nézünk, mert az elhagyott kosár oldal pontos HTML-jét nem
 * ismerjük:
 *  - az állapot (státusz) mező szövege "Elhagyott kosár",
 *  - van "Rendelés befejezése" gomb (ez csak elhagyott kosárnál látszik),
 *  - egy rövid felirat/címke pontosan "Elhagyott kosár" (a bal oldali menü
 *    "Elhagyott kosarak" pontja és a legördülő listák opciói nem számítanak).
 */
const ABANDONED_CART_RE = /elhagyott\s+kos[áa]r(?![a-záéíóöőúüű])/i;
// Ezeken belül nem keresünk: menük, legördülő opciók, és az állapot-előzmények
// (egy rendes rendelés előzményeiben is szerepelhet a korábbi "Elhagyott kosár").
const MENU_CONTAINERS = [
  "nav", '[role="listbox"]', '[role="menu"]', '[role="option"]', ".v-menu__content",
  ".v-navigation-drawer", ".v-list", "select", "#jkc-panel",
  '[data-test-id*="history" i]', '[class*="history" i]',
].join(", ");

function isAbandonedCartPage() {
  for (const el of document.querySelectorAll('[data-test-id*="status" i]')) {
    if (el.closest(MENU_CONTAINERS)) continue;
    const text = `${el.value || ""} ${el.getAttribute("data-test-value") || ""} ${el.textContent || ""}`;
    if (ABANDONED_CART_RE.test(text)) return true;
  }

  for (const el of document.querySelectorAll('button, a, [role="button"]')) {
    if (el.closest("#jkc-panel")) continue;
    if (/^rendelés\s+befejezése$/i.test((el.textContent || "").replace(/\s+/g, " ").trim())) return true;
  }

  for (const el of document.querySelectorAll("span, div, td, h1, h2, h3, label, .v-chip")) {
    if (el.children.length > 2) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 40 || !ABANDONED_CART_RE.test(text)) continue;
    if (el.closest(MENU_CONTAINERS)) continue;
    return true;
  }

  return false;
}

// A felhasználó a bővítmény beállításaiban kérheti, hogy az elhagyott
// kosarak is bekerüljenek a leltár appba (alapból nem).
async function shouldImportAbandonedCarts() {
  try {
    const { importAbandonedCarts } = await chrome.storage.local.get({ importAbandonedCarts: false });
    return !!importAbandonedCarts;
  } catch (e) {
    return false;
  }
}

// A panel kulcsa: rendelésszám + elhagyott kosár jelzés. Így ha egy kosárból
// a "Rendelés befejezése" után valódi rendelés lesz (ugyanazzal a számmal),
// a panel újraépül, és a rendelés ekkor már bekerül a leltár appba.
function currentPanelKey() {
  const orderId = extractOrderNumber();
  if (!orderId) return "";
  return isAbandonedCartPage() ? `${orderId}:kosar` : orderId;
}

// ---------- Segédfüggvények ----------

function textOf(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : "";
}

// Az input mezőknél a látható .value mellett a Shoprenter egy data-test-value
// attribútumban is tárolja a tényleges értéket (ez akkor is megbízható, ha a
// mező megjelenítése valamiért csonkolva van, pl. hosszú e-mail cím).
function inputValueOf(selector) {
  const el = document.querySelector(selector);
  if (!el) return "";
  return (el.value || el.getAttribute("data-test-value") || "").trim();
}

function extractOrderNumber() {
  const headingText = textOf('[data-test-id="orderEditPageHeaderTitle"]');
  const m = headingText.match(/#\s*(\d+)/);
  if (m) return m[1];
  // Tartalék: a "Szállítólevél-azonosító" sor linkje ugyanezt az azonosítót mutatja.
  return textOf('[data-test-id="invoice"]');
}

function extractCustomer() {
  return {
    name: textOf('[data-test-id="customerName"]'),
    email: inputValueOf('input[data-test-id="orderEmail"]'),
    phone: inputValueOf('input[data-test-id="orderTelephone"]'),
  };
}

function extractAddress() {
  const address1 = textOf('[data-test-id="shippingAddress1"]');
  const address2 = textOf('[data-test-id="shippingAddress2"]');
  return {
    name: textOf('[data-test-id="shippingName"]'),
    zip: textOf('[data-test-id="shippingPostcode"]'),
    city: textOf('[data-test-id="shippingCity"]'),
    street: address2 ? `${address1}, ${address2}` : address1,
    country: textOf('[data-test-id="shippingCountry"]') || "Magyarország",
  };
}

function extractShippingMethodText() {
  return textOf('[data-test-id="shippingMethod"]');
}

function extractPaymentMethodText() {
  return textOf('[data-test-id="paymentMethod"]');
}

/**
 * Az összesítő táblázat (Nettó/ÁFA/Bruttó/Utánvét/Összesen bruttó) soraiban a
 * pontos, kerekítetlen forint összeg a total-value-input mező data-test-value
 * attribútumában van (pl. "25779.998") - ezt kerekítjük a legközelebbi egész
 * forintra (25779.998 → 25780 Ft, ami pontosan egyezik a fejlécben mutatott
 * "Összesen: 25.780 Ft" értékkel).
 */
function findTotalRowAmount(labelPattern) {
  const rows = document.querySelectorAll('[data-test-id="total-row"]');
  for (const row of rows) {
    const nameEl = row.querySelector('[data-test-id="total-name"]');
    if (nameEl && labelPattern.test(nameEl.textContent)) {
      const valueEl = row.querySelector('[data-test-id="total-value-input"]');
      const raw = valueEl && (valueEl.getAttribute("data-test-value") || valueEl.value);
      if (raw) return Math.round(parseFloat(raw));
    }
  }
  return null;
}

function extractGrossTotal() {
  return findTotalRowAmount(/összesen\s*bruttó/i);
}

/**
 * Az utánvétnél BESZEDENDŐ összeg meghatározása.
 *
 * FONTOS: az összesítő táblázat "Utánvét:" sora NEM a beszedendő összeg,
 * hanem csak az utánvét-kezelési DÍJ (pl. 490 Ft). A futárnak a vevő a teljes
 * végösszeget fizeti (termékek + szállítás + utánvét díj), ami az "Összesen
 * bruttó" sor. Korábban a díjtételt küldtük a Kvikk felé beszedendő összegként,
 * ami súlyosan hibás utánvét-összeget eredményezett.
 *
 * Utánvétes-e a rendelés? Két jelből következtetünk, mert önmagában egyik sem
 * teljesen megbízható:
 *  - a "Fizetési mód" mező szövege tartalmazza-e az "utánvét" szót, ÉS/VAGY
 *  - van-e egyáltalán "Utánvét" díjsor az összesítőben.
 * Ha a fizetés online/bankkártyás volt, nincs utánvét (0-t küldünk).
 */
function isCashOnDeliveryOrder() {
  const paymentText = extractPaymentMethodText();
  const paymentSaysCod = /ut[áa]nv[ée]t/i.test(paymentText);
  const hasCodFeeRow = findTotalRowAmount(/ut[áa]nv[ée]t/i) !== null;
  return paymentSaysCod || hasCodFeeRow;
}

function extractCodAmount() {
  if (!isCashOnDeliveryOrder()) return null;
  // A beszedendő összeg a teljes bruttó végösszeg, NEM az utánvét díjsor.
  return extractGrossTotal();
}

/**
 * A rendelés terméksorainak kiolvasása (komissiózáshoz és súlyszámításhoz).
 *
 * A Shoprenter nem tesz ki külön data-test-id-t a cikkszámra: az a termék
 * nevének végén, zárójelben szerepel (pl. "... 100% pamut (J25K-43P103-3099-12)").
 * Ezért a nevet és az SKU-t szét kell bontani. A link href-jéből a Shoprenter
 * belső product_id-ját is elmentjük, ami stabilabb azonosító.
 */
function extractOrderItems() {
  const rows = document.querySelectorAll('[data-test-id="productTableRow"]');
  const items = [];

  for (const row of rows) {
    const link = row.querySelector('[data-test-id="productEdit"]');
    if (!link) continue;

    const fullText = (link.textContent || "").replace(/\s+/g, " ").trim();

    // Az UTOLSÓ, a szöveg végén álló zárójeles rész a cikkszám - a névben
    // máshol is lehet zárójel (pl. "40 (L)").
    const skuMatch = fullText.match(/\(([^()]+)\)\s*$/);
    const sku = skuMatch ? skuMatch[1].trim() : null;
    const name = skuMatch ? fullText.slice(0, skuMatch.index).trim() : fullText;

    const qtyInput = row.querySelector('[data-test-id="orderEditProductQuantity"]');
    const qtyRaw = qtyInput && (qtyInput.getAttribute("data-test-value") || qtyInput.value);
    const qty = qtyRaw ? parseInt(qtyRaw, 10) : 1;

    const href = link.getAttribute("href") || "";
    const pidMatch = href.match(/product_id=(\d+)/);

    items.push({
      sku,
      name,
      qty,
      shoprenter_product_id: pidMatch ? pidMatch[1] : null,
    });
  }

  return items;
}

function extractOrderData() {
  const customer = extractCustomer();
  const address = extractAddress();
  return {
    orderNumber: extractOrderNumber(),
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    address,
    shippingMethodText: extractShippingMethodText(),
    paymentMethodText: extractPaymentMethodText(),
    codAmount: extractCodAmount(),
    grossTotal: extractGrossTotal(),
    items: extractOrderItems(),
  };
}

// ---------- Háttér (backend) kommunikáció a service workeren keresztül ----------

function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || "Ismeretlen hiba"));
        return;
      }
      resolve(response);
    });
  });
}

// ---------- UI ----------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function base64ToBlobUrl(base64, mime = "application/pdf") {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mime });
  return URL.createObjectURL(blob);
}

async function buildPanel() {
  const data = extractOrderData();

  const panel = el("div", { class: "jkc-panel", id: "jkc-panel" });
  // Megjegyezzük, melyik rendeléshez épült ez a panel, hogy a Shoprenter
  // Vue-alapú, oldalújratöltés nélküli rendelésváltásakor észrevegyük,
  // ha a panel már egy korábbi rendelés adatait mutatja (lásd init()).
  const abandoned = isAbandonedCartPage();
  panel.dataset.jkcOrderId = abandoned ? `${data.orderNumber}:kosar` : data.orderNumber || "";
  const header = el("div", { class: "jkc-header" }, [
    el("span", { class: "jkc-logo", text: "JASMIL" }),
    el("span", { class: "jkc-title", text: `Kvikk Connect — #${data.orderNumber || "?"}` }),
    el("button", {
      class: "jkc-close",
      text: "×",
      title: "Bezárás",
      onclick: () => panel.classList.toggle("jkc-collapsed"),
    }),
  ]);
  panel.appendChild(header);

  const body = el("div", { class: "jkc-body" });
  panel.appendChild(body);
  body.appendChild(el("div", { class: "jkc-loading", text: "Ellenőrzés…" }));
  document.body.appendChild(panel);

  // Már létezik-e Kvikk csomag ehhez a rendeléshez?
  let existing = null;
  try {
    const res = await sendToBackground("CHECK_EXISTING_SHIPMENT", { orderId: data.orderNumber });
    existing = res && res.shipment ? res.shipment : null;
  } catch (e) {
    // ha a backend nem elérhető, ezt jelezzük, de a panel a "létrehozás" nézetet mutatja
  }

  // Ha a lekérdezés alatt a felhasználó továbblapozott egy másik rendelésre,
  // ez a panel már elavult - eldobjuk, hogy soha ne mutasson egy másik
  // rendelés adatait, és az init() majd felépíti a helyeset.
  if (currentPanelKey() !== panel.dataset.jkcOrderId) {
    panel.remove();
    return;
  }

  // A rendelést beküldjük a leltár appba, hogy megjelenjen a "Rendelések"
  // menüpont komissiózó listáján (melyik termék melyik dobozban van).
  // Ez csak adatrögzítés, nem jár Kvikk-költséggel, ezért a háttérben fut,
  // és ha nem sikerül, az nem akadályozza a címke létrehozását.
  // Elhagyott kosarat alapból NEM küldünk be: az nem valódi rendelés.
  const skipImport = abandoned && !(await shouldImportAbandonedCarts());
  if (data.items && data.items.length && !skipImport) {
    sendToBackground("IMPORT_ORDER", {
      shoprenter_order_id: data.orderNumber,
      customer_name: data.customerName,
      shipping_method_text: data.shippingMethodText,
      payment_method_text: data.paymentMethodText,
      gross_total: data.grossTotal,
      recipient_phone: data.customerPhone,
      recipient_email: data.customerEmail,
      address: data.address,
      cod_amount: data.codAmount,
      items: data.items,
    }).catch(() => {
      /* a leltár app nem érhető el - a Kvikk funkciók ettől még működnek */
    });
  }

  body.innerHTML = "";

  if (abandoned) {
    body.appendChild(
      el("div", {
        class: "jkc-alert jkc-alert-warn",
        text: skipImport
          ? "🛒 Ez egy elhagyott kosár, nem valódi rendelés – nem került be a leltár app Rendelések listájába."
          : "🛒 Ez egy elhagyott kosár, nem valódi rendelés (a beállítások szerint ettől még bekerült a Rendelések közé).",
      })
    );
  }

  if (existing) {
    renderExistingView(body, existing);
  } else {
    await renderCreateView(body, data);
  }
}

function renderExistingView(body, shipment) {
  body.appendChild(el("div", { class: "jkc-alert jkc-alert-warn" }, [
    el("strong", { text: "⚠️ Ehhez a rendeléshez már készült Kvikk csomag." }),
  ]));
  body.appendChild(trackingSummary(shipment));
  body.appendChild(labelButton(shipment));
}

function trackingSummary(shipment) {
  const wrap = el("div", { class: "jkc-tracking" });
  wrap.appendChild(el("div", { text: `Kvikk tracking: ${shipment.kvikk_tracking_number || "-"}` }));
  wrap.appendChild(el("div", { text: `Futár tracking: ${shipment.courier_tracking_number || "-"}` }));
  wrap.appendChild(el("div", { text: `Futár: ${shipment.courier || "-"}` }));
  return wrap;
}

function labelButton(shipment) {
  const btn = el("button", { class: "jkc-btn jkc-btn-secondary", text: "Címke megnyitása" });
  btn.addEventListener("click", () => {
    if (!shipment.label_base64) {
      alert("Nincs elmentett címke ehhez a csomaghoz.");
      return;
    }
    const url = base64ToBlobUrl(shipment.label_base64, "application/pdf");
    window.open(url, "_blank");
  });
  return btn;
}

async function renderCreateView(body, data) {
  const form = el("div", { class: "jkc-form" });

  const nameInput = labeledInput(form, "Vevő neve", data.customerName);
  const phoneInput = labeledInput(form, "Telefonszám", data.customerPhone);
  const emailInput = labeledInput(form, "E-mail", data.customerEmail);
  const zipInput = labeledInput(form, "Irányítószám", data.address.zip, "jkc-w-small");
  const cityInput = labeledInput(form, "Település", data.address.city);
  const streetInput = labeledInput(form, "Közterület, házszám", data.address.street);
  const codInput = labeledInput(
    form,
    "Utánvét: beszedendő teljes összeg (Ft) — üresen = nincs utánvét",
    data.codAmount != null ? String(data.codAmount) : ""
  );
  const valueInput = labeledInput(
    form,
    "Csomag értéke (Ft) — kötelező",
    data.grossTotal != null ? String(data.grossTotal) : ""
  );

  form.appendChild(
    el("div", { class: "jkc-readonly-note", text: `Shoprenter szállítási mód: „${data.shippingMethodText || "-"}” (csak tájékoztató jelleggel)` })
  );

  // Futár választó
  const courierRow = el("div", { class: "jkc-field" });
  courierRow.appendChild(el("label", { text: "Kvikk futár" }));
  const courierSelect = el("select", { class: "jkc-select" });
  courierRow.appendChild(courierSelect);
  form.appendChild(courierRow);

  try {
    const couriersRes = await sendToBackground("GET_COURIERS");
    const couriers = (couriersRes && couriersRes.couriers) || [];
    let preferredCourier = null;
    try {
      const prefRes = await sendToBackground("GET_COURIER_PREFERENCE", {
        shippingMethodText: data.shippingMethodText,
      });
      preferredCourier = prefRes && prefRes.courier;
    } catch (e) {
      /* nincs javaslat - nem gond */
    }
    for (const c of couriers) {
      const opt = el("option", { value: c.code, text: c.label });
      if (preferredCourier && preferredCourier === c.code) opt.selected = true;
      courierSelect.appendChild(opt);
    }
  } catch (e) {
    courierRow.appendChild(
      el("div", { class: "jkc-alert jkc-alert-error", text: `Nem sikerült betölteni a futárlistát: ${e.message}` })
    );
  }

  // Súly - ha a leltárban meg vannak adva a termék tömegek, automatikusan
  // kiszámoljuk a tételekből. Ha valamelyik súly hiányzik, jelezzük, és marad
  // az alapértelmezett érték, hogy a csomagoló kézzel pótolja.
  const weightInput = labeledInput(form, "Súly (kg)", "1.00", "jkc-w-small");
  const weightNote = el("div", { class: "jkc-readonly-note", text: "Súly számítása a leltár adataiból…" });
  form.appendChild(weightNote);

  if (data.items && data.items.length) {
    sendToBackground("CALCULATE_WEIGHT", { items: data.items })
      .then((res) => {
        if (res && res.complete && res.total_kg > 0) {
          weightInput.value = res.total_kg.toFixed(2);
          weightNote.textContent = `Súly a leltár adataiból számolva: ${res.total_g} g. Felülírható.`;
        } else if (res && res.missing && res.missing.length) {
          const names = res.missing.map((m) => m.sku || m.name || "?").join(", ");
          weightNote.textContent = `Nem számolható pontos súly, mert hiányzik: ${names}. Add meg kézzel, vagy töltsd ki a súlyokat a leltárban.`;
        } else {
          weightNote.textContent = "Nem számolható pontos súly. Add meg kézzel.";
        }
      })
      .catch(() => {
        weightNote.textContent = "A súly automatikus számítása nem érhető el. Add meg kézzel.";
      });
  } else {
    weightNote.textContent = "Nem sikerült kiolvasni a rendelés tételeit, a súlyt add meg kézzel.";
  }

  // Csomagpont kereső (futárfüggő - a Kvikk pontlistája futáronként külön kérdezhető le)
  //
  // Felismerjük, ha a Shoprenter szállítási mód szövege csomagpontra/automatára
  // VAGY "postán maradó" küldeményre utal (pl. "Packeta Group csomagautomata",
  // "FOXPOST A-BOX", "MPL PostaPont", "MPL - postán maradó"). Ilyenkor a
  // küldés gomb figyelmeztet és megerősítést kér, ha mégsem lett kiválasztva
  // pont - ez védi ki, hogy egy ilyen rendelés véletlenül házhozszállításként
  // menjen ki (ez korábban ténylegesen megtörtént, a "postán maradó" esetet
  // pedig 2026-09-23-ig egyáltalán nem ismerte fel a rendszer).
  const PICKUP_POINT_HINT_PATTERN = /csomagautomata|csomagpont|automata|postapont|post[aá]pont|z-?box|átvételi\s*pont|post[aá]n?\s*marad[oó]/i;
  const looksLikePickupPointOrder = PICKUP_POINT_HINT_PATTERN.test(data.shippingMethodText || "");

  const pickupRow = el("div", { class: "jkc-field" });
  pickupRow.appendChild(
    el("label", {
      text: looksLikePickupPointOrder
        ? "⚠️ Csomagpont / postai átvétel (a szállítási mód alapján ez valószínűleg kell)"
        : "Csomagpont / postai átvétel (csak automata/pont/postán maradó választás esetén)",
    })
  );
  if (looksLikePickupPointOrder) {
    pickupRow.appendChild(
      el("div", {
        class: "jkc-alert jkc-alert-warn",
        text: "A vásárló a szállítási mód szövege alapján feltehetően csomagpontot/automatát vagy „postán maradó” átvételt választott. Keress rá és válaszd ki alább (MPL esetén a keresés a postán maradó pontokat is listázza), különben a rendszer megerősítést fog kérni.",
      })
    );
  }
  const pickupSearch = el("input", { type: "text", class: "jkc-input", placeholder: "Keresés: pl. város, üzlet neve…" });
  const pickupResults = el("div", { class: "jkc-pickup-results" });
  let selectedPickupPoint = null;
  const selectedPickupLabel = el("div", { class: "jkc-pickup-selected" });

  let searchTimeout = null;
  pickupSearch.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const q = pickupSearch.value.trim();
    pickupResults.innerHTML = "";
    if (q.length < 2) return;
    const courier = courierSelect.value;
    if (!courier) {
      pickupResults.appendChild(el("div", { class: "jkc-pickup-item", text: "Előbb válassz futárt fent." }));
      return;
    }
    pickupResults.appendChild(el("div", { class: "jkc-pickup-item", text: "Keresés…" }));
    searchTimeout = setTimeout(async () => {
      try {
        const res = await sendToBackground("SEARCH_PICKUP_POINTS", { q, courier });
        const points = (res && res.points) || [];
        pickupResults.innerHTML = "";
        if (!points.length) {
          pickupResults.appendChild(el("div", { class: "jkc-pickup-item", text: "Nincs találat ehhez a futárhoz." }));
          return;
        }
        for (const point of points) {
          const item = el("div", { class: "jkc-pickup-item", text: point.name });
          item.addEventListener("click", () => {
            selectedPickupPoint = point; // { id, name, type, ... } - a "type" mezőt a Kvikk API adja
            selectedPickupLabel.textContent = `Kiválasztva: ${point.name}`;
            pickupResults.innerHTML = "";
            pickupSearch.value = "";
          });
          pickupResults.appendChild(item);
        }
      } catch (e) {
        pickupResults.innerHTML = "";
        pickupResults.appendChild(
          el("div", { class: "jkc-alert jkc-alert-error", text: `Csomagpont-keresés hiba: ${e.message}` })
        );
      }
    }, 300);
  });

  pickupRow.appendChild(pickupSearch);
  pickupRow.appendChild(pickupResults);
  pickupRow.appendChild(selectedPickupLabel);
  form.appendChild(pickupRow);

  const statusArea = el("div", { class: "jkc-status" });

  const submitBtn = el("button", { class: "jkc-btn jkc-btn-primary", text: "KVIKK CÍMKE LÉTREHOZÁSA" });
  submitBtn.addEventListener("click", async () => {
    if (looksLikePickupPointOrder && !selectedPickupPoint) {
      const proceedAnyway = confirm(
        "A vásárló a szállítási mód szövege alapján valószínűleg csomagpontot/automatát vagy „postán maradó” átvételt választott, de nincs kiválasztva pont — így HÁZHOZSZÁLLÍTÁSKÉNT megy ki a csomag.\n\nBiztosan így küldöd?"
      );
      if (!proceedAnyway) return;
    }

    statusArea.innerHTML = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Küldés…";

    const payload = {
      shoprenter_order_id: data.orderNumber,
      recipient_name: nameInput.value.trim(),
      recipient_phone: phoneInput.value.trim(),
      recipient_email: emailInput.value.trim(),
      address: {
        zip: zipInput.value.trim(),
        city: cityInput.value.trim(),
        street: streetInput.value.trim(),
        country: "HU",
      },
      cod_amount: codInput.value.trim() ? Number(codInput.value.trim()) : 0,
      package_value: Number(valueInput.value.trim() || "0"),
      weight_kg: Number(weightInput.value.trim() || "0"),
      courier: courierSelect.value,
      pickup_point_id: selectedPickupPoint ? selectedPickupPoint.id : null,
      pickup_point_type: selectedPickupPoint ? selectedPickupPoint.type : null,
      shipping_method_text: data.shippingMethodText,
    };

    try {
      const res = await sendToBackground("CREATE_SHIPMENT", payload);
      submitBtn.disabled = false;
      submitBtn.textContent = "KVIKK CÍMKE LÉTREHOZÁSA";

      if (res.already_exists) {
        statusArea.innerHTML = "";
        statusArea.appendChild(
          el("div", { class: "jkc-alert jkc-alert-warn", text: "⚠️ Ehhez a rendeléshez már készült Kvikk csomag." })
        );
        statusArea.appendChild(trackingSummary(res.shipment));
        statusArea.appendChild(labelButton(res.shipment));
        return;
      }

      statusArea.appendChild(el("div", { class: "jkc-alert jkc-alert-success", text: "Csomag sikeresen létrehozva" }));
      statusArea.appendChild(trackingSummary(res.shipment));
      statusArea.appendChild(labelButton(res.shipment));
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "KVIKK CÍMKE LÉTREHOZÁSA";
      statusArea.innerHTML = "";
      statusArea.appendChild(
        el("div", { class: "jkc-alert jkc-alert-error" }, [
          el("strong", { text: "Kvikk API hiba" }),
          el("div", { text: err.message || "A Kvikk nem tudta létrehozni a csomagot." }),
        ])
      );
    }
  });

  form.appendChild(submitBtn);
  form.appendChild(statusArea);
  body.appendChild(form);
}

function labeledInput(parent, labelText, value, extraClass = "") {
  const field = el("div", { class: "jkc-field" });
  field.appendChild(el("label", { text: labelText }));
  const input = el("input", { type: "text", class: `jkc-input ${extraClass}`.trim(), value: value || "" });
  field.appendChild(input);
  parent.appendChild(field);
  return input;
}

// ---------- Indítás ----------

/**
 * A Shoprenter admin egy Vue-alkalmazás: a rendelések közti navigáció
 * (pl. "Előző"/"Következő" nyilak vagy a rendeléslistából való visszalépés)
 * NEM tölti újra az oldalt, csak kicseréli a tartalmat. Ezért nem elég azt
 * figyelni, hogy van-e már panel - azt is nézni kell, hogy a meglévő panel
 * MELYIK rendeléshez épült. Ha közben rendelést váltottak, eldobjuk a régi
 * panelt, és újat építünk a friss adatokkal.
 */
let isBuilding = false;

async function init() {
  if (isBuilding) return;
  if (!isOrderDetailPage()) return;

  const currentKey = currentPanelKey();
  if (!currentKey) return;

  const existingPanel = document.getElementById("jkc-panel");
  if (existingPanel) {
    if (existingPanel.dataset.jkcOrderId === currentKey) return; // ugyanaz a rendelés, nincs teendő
    existingPanel.remove(); // rendelésváltás történt -> újraépítés
  }

  isBuilding = true;
  try {
    await buildPanel();
  } finally {
    isBuilding = false;
  }
}

// A DOM változásait figyeljük, de csak "lecsengés" után reagálunk (debounce),
// mert a Vue rendelésváltáskor sok apró DOM-módosítást végez egymás után,
// és a panelt csak a végleges, betöltött állapotból érdemes felépíteni.
let initDebounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(initDebounceTimer);
  initDebounceTimer = setTimeout(init, 250);
});
observer.observe(document.body, { childList: true, subtree: true });

init();
