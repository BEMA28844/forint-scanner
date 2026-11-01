/* Preis-Parser für Forint-Preisschilder und Kassenbons (UMD: Browser + Node-Tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForintParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NBSP = '\u00a0';

  function normalizeOcr(s) {
    return String(s || '')
      .replace(/[\u2009\u202f\u00a0]/g, ' ')
      .replace(/[‘’´`']/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/\bF[tT1l]\b|\bFT\b/g, 'Ft')
      .replace(/(\d)\s*[Ff][tTl1]\b/g, '$1 Ft');
  }

  // Wandelt einen Zahl-Token (z. B. "1 299", "1.299", "12,990", "1299,-", "499,00") in eine Ganzzahl HUF um
  function tokenToHuf(tok) {
    let t = String(tok).trim().replace(/[,.]-+$/, '').replace(/-+$/, '');
    t = t.replace(/[,.]00$/, '');           // ",00" Nachkommastellen
    t = t.replace(/[ '.]/g, '');           // Tausendertrenner
    if (/,\d{3}$/.test(t)) t = t.replace(',', '');
    t = t.replace(/,\d{1,2}$/, '');         // sonstige Dezimalstellen abschneiden
    if (!/^\d+$/.test(t)) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }

  // Findet Preis-Kandidaten in einer Textzeile
  const NUM = "(\\d{1,3}(?:[ .']\\d{3})+|\\d{1,7})(?:[,.](?:-+|00|\\d{1,2}(?!\\d)))?";
  const RE_PRICE = new RegExp(
    '(?:(HUF|Ft)\\s*)?' + NUM + '\\s*(Ft|HUF|forint|,-|-)?(\\s*\\/\\s*(?:kg|l|db|liter|100\\s*g|m))?',
    'gi'
  );

  function findPrices(line) {
    const s = normalizeOcr(line);
    const out = [];
    RE_PRICE.lastIndex = 0;
    let m;
    while ((m = RE_PRICE.exec(s))) {
      const full = m[0];
      const prefix = m[1], num = m[2], suffix = m[3], unit = m[4];
      // Dezimal-Strich (",-") ist im Token selbst enthalten
      const dashEnd = /[,.]-+/.test(full);
      const value = tokenToHuf(full.replace(/^(HUF|Ft)\s*/i, '').replace(/\s*(Ft|HUF|forint)?(\s*\/.*)?$/i, ''));
      if (value == null || value <= 0) continue;
      let score = 0;
      if (suffix && /ft|huf|forint/i.test(suffix)) score += 5;
      if (prefix) score += 4;
      if (dashEnd || suffix === ',-') score += 4;
      if (/[ .']\d{3}/.test(num)) score += 2;
      if (unit) score -= 6;                   // Grundpreis (Ft/kg) ist meist nicht der Verkaufspreis
      if (value < 10) score -= 4;
      if (value > 2000000) score -= 10;
      if (/^\d{8,}$/.test(num.replace(/\D/g, ''))) score -= 10; // Barcodes etc.
      // Prozentangaben, Uhrzeiten, Datumsangaben ausschließen
      const after = s.slice(m.index + full.length, m.index + full.length + 2);
      const before = s.slice(Math.max(0, m.index - 1), m.index);
      if (/^\s?%/.test(after)) continue;
      if (/^[:.]\d/.test(after) || before === ':' ) score -= 6;
      out.push({ value, raw: full.trim(), score, unit: !!unit, explicit: score >= 4 });
    }
    return out;
  }

  // Bester Preis aus einem OCR-Ergebnis. lines: [{text, height}] oder string
  function bestPrice(input) {
    const lines = typeof input === 'string'
      ? input.split(/\n/).map(t => ({ text: t, height: 1 }))
      : input;
    let best = null;
    const maxH = Math.max(1, ...lines.map(l => l.height || 1));
    for (const l of lines) {
      for (const p of findPrices(l.text)) {
        const sc = p.score + 4 * ((l.height || 1) / maxH) - (l.edge ? 5 : 0);
        if (p.score < 0) continue;
        // Nackte Zahlen nur, wenn sie plausibel aussehen (>= 2 Ziffern)
        if (!p.explicit && p.value < 20) continue;
        if (!best || sc > best.sc) best = { ...p, sc };
      }
    }
    return best ? { value: best.value, raw: best.raw, explicit: best.explicit, unit: best.unit } : null;
  }

  function formatHuf(n) {
    if (n == null || !Number.isFinite(n)) return '–';
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + NBSP + 'Ft';
  }
  function formatEur(n) {
    if (n == null || !Number.isFinite(n)) return '–';
    return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.') + NBSP + '€';
  }

  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ---------- Kassenbon ----------
  const SKIP = /(osszesen|osszeg|fizetend|visszajar|keszpenz|bankkartya|kartya|afa|ado\s?szam|adoszam|nyugta|penztar|kerekites|resz\s?osszeg|reszosszeg|szamla|nav|ap\s?[a-z]?\d|datum|ido|koszonjuk|tranz|terminal|egyenleg|bonus|pont|engedmeny osszesen|total|subtotal|cash|change|card|sum)/;
  const TOTAL = /(osszesen|fizetendo|total)/;
  const CHAINS = ['LIDL', 'ALDI', 'SPAR', 'INTERSPAR', 'TESCO', 'PENNY', 'AUCHAN', 'CBA', 'COOP', 'PRIMA', 'METRO', 'ROSSMANN', 'DM', 'MÜLLER', 'MOL', 'OMV', 'SHELL', 'REAL', 'NAPI', 'MANNA', 'ABC'];

  function detectMarket(text) {
    const head = normalizeOcr(text).split(/\n/).slice(0, 8).join(' ').toUpperCase();
    for (const c of CHAINS) {
      const re = new RegExp('(^|[^A-ZÁÉÍÓÖŐÚÜŰ])' + c + '([^A-ZÁÉÍÓÖŐÚÜŰ]|$)');
      if (re.test(head)) return c.charAt(0) + c.slice(1).toLowerCase();
    }
    return '';
  }

  function parseReceipt(text) {
    const lines = normalizeOcr(text).split(/\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const items = [];
    let total = null;
    let pendingQty = null;
    for (const line of lines) {
      const n = normName(line);
      // Mengenzeile z. B. "2 db x 199" oder "2 x 199 Ft"
      const q = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:db|kg|x|\*)\s*(?:x\s*)?(\d[\d .]*)\s*(?:Ft)?\s*\/?\s*(?:db|kg)?$/i);
      if (q) { pendingQty = parseFloat(q[1].replace(',', '.')); continue; }
      if (TOTAL.test(n)) {
        const p = line.match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{1,2}|,-)?\s*(?:Ft)?\s*$/);
        if (p && total == null) total = tokenToHuf(p[0].replace(/\s*Ft\s*$/, ''));
        continue;
      }
      if (SKIP.test(n)) continue;
      // Zeile: Text ... Preis [Steuerkennzeichen]
      const m = line.match(/^(.*?[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű].*?)\s+(-?\d{1,3}(?:[ .]\d{3})+|-?\d{1,6})(?:[,.](?:\d{1,2}|-))?\s*(?:Ft)?\s*(?:[A-E]\d{0,2}|[A-E]00|\*)?$/);
      if (!m) continue;
      let name = m[1].replace(/\s{2,}/g, ' ').trim();
      // Steuerkennzeichen (A00, B00, C00 … auch als OCR-Fehler „BoO0“) und Satzzeichen am Namensende entfernen
      for (let k = 0; k < 2; k++) name = name.replace(/[\s\-–.:*]+$/, '').replace(/\s+[A-E5][0oOQD]{1,3}$/i, '').trim();
      const neg = m[2].startsWith('-');
      const value = tokenToHuf(m[2].replace('-', ''));
      if (!value || value > 500000 || name.length < 2) continue;
      if (/^\d+$/.test(name.replace(/\s/g, ''))) continue;
      items.push({ name, huf: neg ? -value : value, qty: pendingQty || 1 });
      pendingQty = null;
    }
    return { items: items.filter(i => i.huf > 0), discounts: items.filter(i => i.huf < 0), total, market: detectMarket(text) };
  }

  return { findPrices, bestPrice, tokenToHuf, formatHuf, formatEur, normName, parseReceipt, detectMarket, normalizeOcr };
});
