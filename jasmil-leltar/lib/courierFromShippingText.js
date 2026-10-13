/**
 * Kitalálja a Kvikk futárt a Shoprenter szállítási mód szövegéből, ha az
 * név szerint említi (pl. "Foxpost csomagautomata", "Packeta Z-BOX",
 * "MPL - postán maradó", "GLS házhozszállítás").
 *
 * A szállítási mód szövege automatás/csomagpontos rendelésnél gyakran a
 * konkrét pontot is tartalmazza, így rendelésenként más - ezért a megtanult
 * (pontos szövegre mentett) futár-preferencia ilyenkor nem talál, és enélkül
 * a bővítmény a lista első futárját (MPL) ajánlaná.
 *
 * Ha a szöveg több futárt is említ, a szövegben előbb szereplő nyer.
 * Nincs találat esetén null.
 */
const COURIER_PATTERNS = [
  { courier: 'foxpost', pattern: /foxpost/i },
  { courier: 'packeta', pattern: /packeta|z-?box|z-?pont/i },
  { courier: 'gls', pattern: /\bgls\b/i },
  { courier: 'dpd', pattern: /\bdpd\b/i },
  { courier: 'famafutar', pattern: /f[aá]ma\s*fut[aá]r/i },
  { courier: 'mpl', pattern: /\bmpl\b|magyar\s*posta|post[aá]pont|post[aá]n?\s*marad[oó]/i },
];

function courierFromShippingText(shippingMethodText) {
  if (!shippingMethodText) return null;
  let best = null;
  for (const { courier, pattern } of COURIER_PATTERNS) {
    const m = pattern.exec(shippingMethodText);
    if (m && (best === null || m.index < best.index)) best = { courier, index: m.index };
  }
  return best ? best.courier : null;
}

module.exports = { courierFromShippingText };
