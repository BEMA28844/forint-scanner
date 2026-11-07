const assert = require('assert');
const F = require('../js/fuel.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }

const here = { lat: 52.99, lon: 8.85, town: 'Weyhe', postcode: '28844' };
const saved = { lat: 46.76, lon: 17.24, town: 'Keszthely', postcode: '8360' };

t('fresh GPS shows that place', () => {
  const d = F.fuelStartDecision({ status: 'ok', loc: here }, saved);
  assert.strictEqual(d.action, 'show');
  assert.strictEqual(d.loc.town, 'Weyhe');
  assert.strictEqual(d.hint, '');
});

t('pending stays on the loading state', () => {
  const d = F.fuelStartDecision({ status: 'pending' }, saved);
  assert.strictEqual(d.action, 'loading');
  assert.ok(d.info.includes('ermittelt'));
});

t('denied with a saved place does not ask for a search', () => {
  const d = F.fuelStartDecision({ status: 'denied' }, saved);
  assert.strictEqual(d.action, 'saved');
  assert.strictEqual(d.loc.town, 'Keszthely');
  assert.ok(!/verweigert/.test(d.info));
  assert.ok(d.info.includes('letzten Ort'));
});

t('timeout with a saved place keeps the last place', () => {
  const d = F.fuelStartDecision({ status: 'timeout' }, saved);
  assert.strictEqual(d.action, 'saved');
  assert.ok(d.info.includes('Zeitüberschreitung'));
});

t('denied without a saved place asks for a postcode', () => {
  const d = F.fuelStartDecision({ status: 'denied' }, null);
  assert.strictEqual(d.action, 'manual');
  assert.strictEqual(d.hint, 'Ort oder PLZ eingeben – die App merkt sich den Ort.');
  assert.ok(!/verweigert/.test(d.hint));
});

t('three fuel grades are always listed', () => {
  const lines = F.fuelGradeLines({ petrol: { price: 2.059, currency: 'EUR' }, diesel: null });
  assert.deepStrictEqual(lines.map(g => g.label), ['Super E5', 'Super E10', 'Diesel']);
  assert.strictEqual(lines[0].price.price, 2.059);
  assert.strictEqual(lines[1].price, null);
  assert.strictEqual(lines[2].price, null);
  assert.strictEqual(F.formatFuelPrice(lines[1].price), null);
});

t('nearest five keep e5 e10 and diesel', () => {
  const stations = [0, 1, 2, 3, 4, 5].map(i => ({
    lat: 52.99, lon: 8.85 + i * 0.01, name: 'S' + i,
    petrol: { price: 2 + i / 100, currency: 'EUR' },
    e10: { price: 1.9 + i / 100, currency: 'EUR' },
    diesel: { price: 2.1 + i / 100, currency: 'EUR' },
  }));
  const nearest = F.nearestFuelStations(stations.map(s => ({ lat: s.lat, lon: s.lon, tags: { name: s.name } })), { lat: 52.99, lon: 8.85 }, 10, 5);
  assert.strictEqual(nearest.length, 5);
  assert.strictEqual(nearest[0].name, 'S0');
  const lines = F.fuelGradeLines(stations[0]);
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.every(g => g.price && g.price.price > 0));
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
