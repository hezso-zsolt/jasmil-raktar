/**
 * Felismeri, ha egy Shoprenter szállítási mód szövege csomagpontra,
 * csomagautomatára VAGY "postán maradó" átvételre utal (pl. "Packeta Group
 * csomagautomata", "FOXPOST A-BOX", "MPL PostaPont", "MPL - postán maradó").
 *
 * Ezeknél a konkrét pontot/postát KÉZZEL kell kiválasztani a Kvikk
 * csomagpont-keresőjével - nincs megbízható automatikus mód rá (pl. a
 * "postán maradó" esetén a vevő címéhez tartozó postát kellene kitalálni,
 * ami több postát kiszolgáló irányítószámoknál tévedhet). Ezért:
 *   - a bővítmény (extension/content.js - ott KÜLÖN, ide nem importált
 *     másolatban tartjuk karban, mert a böngésző-bővítmény külön fut) ilyen
 *     esetben figyelmeztet és megerősítést kér a csomagoló felé, ha mégsem
 *     választott pontot,
 *   - a leltár app tömeges Kvikk-címkegenerálása (routes/kvikkShipments.js)
 *     és a "Kvikk statisztika" nézet "kész a tömeges generálásra" jelzése
 *     (routes/reports.js) automatikusan KIHAGYJA ezeket - ezeket egyenként,
 *     a Shoprenterből kell intézni.
 *
 * FONTOS: ha ezt a mintát módosítod, a extension/content.js saját (külön
 * karbantartott) másolatát is frissítsd ugyanígy - lásd az ottani komment.
 */
const PICKUP_POINT_HINT_PATTERN =
  /csomagautomata|csomagpont|automata|postapont|post[aá]pont|z-?box|átvételi\s*pont|post[aá]n?\s*marad[oó]/i;

function looksLikePickupPointOrder(shippingMethodText) {
  return !!(shippingMethodText && PICKUP_POINT_HINT_PATTERN.test(shippingMethodText));
}

module.exports = { PICKUP_POINT_HINT_PATTERN, looksLikePickupPointOrder };
