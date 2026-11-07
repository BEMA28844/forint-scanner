const assert = require('assert');
const R = require('../js/receipts.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }

const receipts = [
  { id: 1, market: 'Lidl', items: [{ name: 'Milch' }, { name: 'Brot' }] },
  { id: 2, market: 'Spar', items: [{ name: 'Apfel' }] },
];
const scans = [
  { id: 10, name: 'Milch', receiptId: 1 },
  { id: 11, name: 'Brot', receiptId: 1 },
  { id: 12, name: 'Apfel', receiptId: 2 },
  { id: 13, name: 'Kamera-Artikel' },
];

t('cancel leaves every receipt', () => {
  const out = R.applyDelete(receipts, scans, 1, false);
  assert.strictEqual(out.deleted, false);
  assert.strictEqual(out.receipts.length, 2);
  assert.strictEqual(out.scans.length, 4);
});

t('confirm deletes one receipt and its lines only', () => {
  const out = R.applyDelete(receipts, scans, 1, true);
  assert.strictEqual(out.deleted, true);
  assert.deepStrictEqual(out.receipts.map(r => r.id), [2]);
  assert.deepStrictEqual(out.scans.map(s => s.id), [12, 13]);
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
