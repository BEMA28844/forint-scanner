const assert = require('assert');
const H = require('../js/hu-de.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }

const receipt = `LIDL Magyarország Bt.
TEJ 2,8% 1L          349
KENYER FEHER         599
TURO RUDI            598
CSIRKE MELL          1299
ALMA                 499
SOR 0,5L             399
ASVANYVIZ SZENSAVAS  199
VAJ                  899
ZSIROS SERTES KOLBASZ 1290
HABCSÓK EPRES        349
ÖSSZESEN            6840
KÉSZPÉNZ            7000
VISSZAJÁRÓ           160
ÁFA
KEDVEZMÉNY           100
BETÉTDÍJ              50
`;

t('dictionary has a few hundred terms', () => {
  assert.ok(H.dictionarySize >= 200, String(H.dictionarySize));
});

t('sample receipt: common lines offline, rare line not covered', () => {
  const lines = receipt.split(/\n/).map(l => l.replace(/\s+\d[\d .]*$/, '').trim()).filter(l => /[a-z]/i.test(l));
  const rows = lines.map(l => ({ l, t: H.translateLine(l) }));
  const by = (s) => rows.find(r => H.fold(r.l).includes(H.fold(s)));
  assert.strictEqual(by('tej').t.de, 'Milch 2,8% 1l');
  assert.strictEqual(by('tej').t.complete, true);
  assert.strictEqual(by('kenyer').t.de, 'Weißbrot');
  assert.strictEqual(by('csirke').t.de, 'Hähnchenbrust');
  assert.strictEqual(by('asvanyviz').t.de, 'Mineralwasser mit Kohlensäure');
  assert.strictEqual(by('zsiros').t.complete, true);
  assert.strictEqual(by('zsiros').t.de, 'fett Schwein Wurst');
  const rare = by('habcsok');
  assert.strictEqual(rare.t.complete, false);
  assert.ok(rare.t.unknown.length >= 1);
});

t('header terms', () => {
  const h = H.headerLabels(receipt);
  ['Summe', 'Bar', 'Rückgeld', 'MwSt', 'Rabatt', 'Pfand'].forEach(w => assert.ok(h.includes(w), w + ' missing in ' + h.join(',')));
});

t('ocr without accents still matches', () => {
  const t1 = H.translateLine('ZSIRSZEGENY TEJ 1L');
  assert.ok(t1.de.toLowerCase().includes('milch'), t1.de);
  assert.strictEqual(t1.complete, true);
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
