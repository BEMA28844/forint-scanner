const assert = require('assert');
const S = require('../js/setup.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }

t('hash nak tk map', () => {
  const p = S.parseHash('#nak=NKD-DEV-TEST&tk=tanker-test&map=google');
  assert.deepStrictEqual(p, { nak: 'NKD-DEV-TEST', tk: 'tanker-test', map: 'google' });
});

t('decodes reserved characters and ignores a bad map', () => {
  const p = S.parseHash('#nak=a%26b%3Dc&map=safari');
  assert.strictEqual(p.nak, 'a&b=c');
  assert.strictEqual(p.map, undefined);
});

t('empty and unrelated hashes are ignored', () => {
  assert.strictEqual(S.parseHash(''), null);
  assert.strictEqual(S.parseHash('#camera'), null);
  assert.strictEqual(S.parseHash('#nak='), null);
});

t('link uses a hash and never a query string', () => {
  const url = S.buildLink('https://bema28844.github.io/forint-scanner/?x=1', {
    nak: 'NKD-DEV-TEST', tk: 'a b', map: 'apple',
  });
  assert.strictEqual(url.indexOf('?'), -1);
  assert.ok(url.startsWith('https://bema28844.github.io/forint-scanner/#'));
  assert.strictEqual(S.parseHash('#' + url.split('#')[1]).nak, 'NKD-DEV-TEST');
  assert.strictEqual(S.parseHash('#' + url.split('#')[1]).tk, 'a b');
  assert.strictEqual(S.parseHash('#' + url.split('#')[1]).map, 'apple');
});

t('standalone detection', () => {
  assert.strictEqual(S.isStandalone({ standalone: true }, () => ({ matches: false })), true);
  assert.strictEqual(S.isStandalone({}, (q) => ({ matches: q.indexOf('standalone') !== -1 })), true);
  assert.strictEqual(S.isStandalone({}, () => ({ matches: false })), false);
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
