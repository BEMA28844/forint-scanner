const assert = require('assert');
const P = require('../js/parse.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }
const bp = s => (P.bestPrice(s) || {}).value;

t('space thousands + Ft', () => assert.strictEqual(bp('1 299 Ft'), 1299));
t('dot thousands + Ft', () => assert.strictEqual(bp('1.299 Ft'), 1299));
t('comma dash', () => assert.strictEqual(bp('1299,-'), 1299));
t('HUF suffix', () => assert.strictEqual(bp('549 HUF'), 549));
t('HUF prefix', () => assert.strictEqual(bp('HUF 12 990'), 12990));
t('FT uppercase', () => assert.strictEqual(bp('899 FT'), 899));
t('Ft glued', () => assert.strictEqual(bp('899Ft'), 899));
t('ocr F1', () => assert.strictEqual(bp('2 499 F1'), 2499));
t('nbsp', () => assert.strictEqual(bp('3\u00a0490\u00a0Ft'), 3490));
t('decimals ,00', () => assert.strictEqual(bp('499,00 Ft'), 499));
t('big number on tag', () => assert.strictEqual(bp('Tej 2,8%\n1 L\n349'), 349));
t('unit price ignored', () => assert.strictEqual(bp([{text:'Pick szalámi 899 Ft', height: 40},{text:'Egységár: 4 495 Ft/kg', height: 12}]), 899));
t('unit price only line low', () => assert.strictEqual(bp('2 598 Ft/kg\n1 299 Ft'), 1299));
t('percent ignored', () => assert.strictEqual(bp('-30%\n699 Ft'), 699));
t('none', () => assert.strictEqual(P.bestPrice('Hello world'), null));
t('larger line wins', () => assert.strictEqual(bp([{text:'129', height:10},{text:'1 990', height: 60}]), 1990));
t('formatHuf', () => assert.strictEqual(P.formatHuf(1299), '1\u00a0299\u00a0Ft'));
t('formatEur', () => assert.strictEqual(P.formatEur(3.3189), '3,32\u00a0€'));
t('formatEur thousands', () => assert.strictEqual(P.formatEur(1234.5), '1.234,50\u00a0€'));
t('normName', () => assert.strictEqual(P.normName('Túró Rudi  Pöttyös!'), 'turo rudi pottyos'));

const receipt = `LIDL Magyarország Bt.
1037 Budapest, Montevideo u. 1.
ADÓSZÁM: 12345678-2-44
TEJ 2,8% 1L          B00     349
KENYÉR FEHÉR         B00     599
2 db x 299
TÚRÓ RUDI            C00     598
PAPRIKA KG           B00   1 249
KEDVEZMÉNY                  -100
ÖSSZESEN:                  2 695
BANKKÁRTYA                 2 695
`;
t('receipt items', () => {
  const r = P.parseReceipt(receipt);
  assert.deepStrictEqual(r.items.map(i => [i.name, i.huf]), [['TEJ 2,8% 1L', 349], ['KENYÉR FEHÉR', 599], ['TÚRÓ RUDI', 598], ['PAPRIKA KG', 1249]]);
  assert.strictEqual(r.items[2].qty, 2);
  assert.strictEqual(r.total, 2695);
  assert.strictEqual(r.market, 'Lidl');
  assert.strictEqual(r.discounts.length, 1);
});
t('receipt Ft suffix', () => {
  const r = P.parseReceipt('SPAR\nCOCA COLA 1,75L 649 Ft\nÖSSZESEN 649 Ft');
  assert.deepStrictEqual(r.items.map(i => [i.name, i.huf]), [['COCA COLA 1,75L', 649]]);
  assert.strictEqual(r.market, 'Spar');
});
t('receipt OCR tax code noise', () => {
  const r = P.parseReceipt('TEJ 2,85 1L BoO0 - 349\nKENYER FEHER Boo - 599');
  assert.deepStrictEqual(r.items.map(i => [i.name, i.huf]), [['TEJ 2,85 1L', 349], ['KENYER FEHER', 599]]);
});
t('edge-cut number penalised', () => assert.strictEqual(bp([{text:'1 299 Ft', height: 90},{text:'299', height: 99, edge: true}]), 1299));
console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
