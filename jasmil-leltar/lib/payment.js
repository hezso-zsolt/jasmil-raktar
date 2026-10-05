/**
 * Bankszámlaszámok a bejövő számlákhoz: a magyar számlaszám ellenőrzése
 * (ellenőrző számjegyek) és IBAN-ná alakítása az összehasonlításhoz.
 */

/** A magyar számlaszám 8-as blokkjainak ellenőrző számjegye (9-7-3-1 súlyozás) */
function blockValid(digits) {
  const weights = [9, 7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * weights[i % 4];
  return sum % 10 === 0;
}

/**
 * Szövegből magyar bankszámlaszámot csinál ("11773016-12345678[-00000000]"
 * vagy "HU.. ...." IBAN). Hibás ellenőrző számjegynél null. strict módban
 * (kézzel beírt mezőnél) a teljes szövegnek számlaszámnak kell lennie.
 */
function normalizeAccount(text, { strict = false } = {}) {
  if (!text) return null;
  if (strict && !/^(HU\d{2})?(\d{16}|\d{24})$/.test(String(text).toUpperCase().replace(/[\s-]/g, ''))) return null;
  let digits = null;
  const iban = String(text).toUpperCase().replace(/\s/g, '').match(/HU\d{2}(\d{24})/);
  if (iban) digits = iban[1];
  else {
    const m = String(text).match(/(\d{8})[\s-]?(\d{8})(?:[\s-]?(\d{8}))?/);
    if (m) digits = m[1] + m[2] + (m[3] || '');
  }
  if (!digits) return null;
  const first = digits.slice(0, 8);
  const rest = digits.slice(8);
  if (!blockValid(first) || !blockValid(rest)) return null;
  const parts = [first, rest.slice(0, 8)];
  if (rest.length === 16) parts.push(rest.slice(8));
  return parts.join('-');
}

function toIban(account) {
  const acc = normalizeAccount(account);
  if (!acc) return null;
  const bban = acc.replace(/-/g, '').padEnd(24, '0');
  // ISO 13616: az ország (HU = 17 30) + "00" a végére, mod 97
  const numeric = `${bban}173000`;
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  return `HU${check}${bban}`;
}

module.exports = { normalizeAccount, toIban };
