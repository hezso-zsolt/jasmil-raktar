/**
 * Utalási adatok a bejövő számlákhoz: magyar bankszámlaszám ellenőrzése,
 * IBAN és BIC képzése, és a csoportos utalási fájl (ISO 20022 pain.001.001.03
 * XML), amit a bankok internetbankja egyben be tud tölteni.
 */

// A számlaszám első 3 jegye (pénzforgalmi jelzőszám) → a bank BIC-kódja.
// Csak a gyakori bankok; ismeretlen banknál nem készül QR-kód.
const BANK_BIC = {
  101: 'MKKBHUHB', // MBH (volt Budapest Bank)
  103: 'MKKBHUHB', // MBH (volt MKB)
  104: 'OKHBHUHB', // K&H
  107: 'CIBHHUHB', // CIB
  109: 'BACXHUHB', // UniCredit
  111: 'CIBHHUHB', // CIB
  116: 'GIBAHUHB', // Erste
  117: 'OTPVHUHB', // OTP
  120: 'UBRTHUHB', // Raiffeisen
  121: 'GNBAHUHB', // Gránit
  162: 'HBWEHUHB', // MagNet
};

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

function bicFor(account) {
  const acc = normalizeAccount(account);
  return acc ? BANK_BIC[Number(acc.slice(0, 3))] || null : null;
}

const xml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// A pain.001 név- és közleménymezői a "SEPA karakterkészletet" várják; a
// magyar ékezeteket a bankok általában elfogadják, de a vezérlőkaraktereket
// és a túl hosszú szöveget levágjuk.
const clip = (s, n) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

const pad2 = (n) => String(n).padStart(2, '0');
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Csoportos átutalási fájl (pain.001.001.03, forint átutalások).
 * @param {{ debtorName: string, debtorAccount: string, executionDate?: string,
 *           items: { id: number, name: string, account: string, amount: number, reference: string }[] }} opts
 */
function buildPain001({ debtorName, debtorAccount, executionDate, items }) {
  const now = new Date();
  const stamp = `${localDate(now).replace(/-/g, '')}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const msgId = `JASMIL-${stamp}`;
  const total = items.reduce((s, it) => s + it.amount, 0);
  const debtorIban = toIban(debtorAccount);
  const debtorBic = bicFor(debtorAccount);
  const tx = items.map((it, i) => {
    const bic = bicFor(it.account);
    return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xml(clip(`SZAMLA-${it.id}`, 35))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="HUF">${it.amount.toFixed(2)}</InstdAmt></Amt>${bic ? `
        <CdtrAgt><FinInstnId><BIC>${bic}</BIC></FinInstnId></CdtrAgt>` : ''}
        <Cdtr><Nm>${xml(clip(it.name, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${toIban(it.account)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xml(clip(it.reference, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${localDate(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}</CreDtTm>
      <NbOfTxs>${items.length}</NbOfTxs>
      <CtrlSum>${total.toFixed(2)}</CtrlSum>
      <InitgPty><Nm>${xml(clip(debtorName, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${msgId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${items.length}</NbOfTxs>
      <CtrlSum>${total.toFixed(2)}</CtrlSum>
      <ReqdExctnDt>${executionDate || localDate(now)}</ReqdExctnDt>
      <Dbtr><Nm>${xml(clip(debtorName, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId>${debtorBic ? `<BIC>${debtorBic}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

module.exports = { normalizeAccount, toIban, bicFor, buildPain001 };
