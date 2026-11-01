const assert = require('assert');
const F = require('../js/fuel.js');
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message); } }

t('distKm ~1 km north', () => {
  const d = F.distKm({ lat: 47, lon: 19 }, { lat: 47.009, lon: 19 });
  assert.ok(d > 0.95 && d < 1.05, String(d));
});

t('nearest: sort, radius, limit 5, way center', () => {
  const pos = { lat: 47, lon: 19 };
  const at = (kmNorth, name, extra) => {
    const lat = 47 + kmNorth / 111.32;
    return { type: 'node', lat, lon: 19, tags: { name, brand: 'X', ...((extra && extra.tags) || {}) }, ...(extra || {}) };
  };
  const elements = [
    at(8, 'Far'),
    at(1, 'One'),
    { type: 'way', center: { lat: 47 + 2 / 111.32, lon: 19 }, tags: { brand: 'MOL', 'addr:street': 'Kossuth', 'addr:housenumber': '1', 'addr:city': 'Keszthely' } },
    at(3, 'Three'),
    at(4, 'Four'),
    at(12, 'Outside'),
    at(0.4, 'Near'),
    at(6, 'Six'),
    { type: 'node', tags: { name: 'NoCoord' } },
  ];
  const list = F.nearestFuelStations(elements, pos, 10, 5);
  assert.strictEqual(list.length, 5);
  assert.deepStrictEqual(list.map(s => s.name), ['Near', 'One', 'MOL', 'Three', 'Four']);
  assert.ok(list.every(s => s.d <= 10));
  assert.ok(list[2].address.includes('Kossuth 1'));
  assert.ok(list[2].address.includes('Keszthely'));
  assert.ok(list[0].d < list[1].d);
});

t('tankerkoenig parses e5/diesel and drops 1.009 placeholder', () => {
  const real = F.parseTankerkoenig({
    ok: true, status: 'ok', stations: [
      { name: 'Aral', brand: 'ARAL', lat: 52.5, lng: 13.4, e5: 1.759, e10: 1.719, diesel: 1.659 },
      { name: 'Demo', brand: 'X', lat: 52.51, lng: 13.41, e5: 1.009, e10: 1.009, diesel: 1.009 },
    ],
  });
  assert.strictEqual(real.ok, true);
  assert.strictEqual(real.stations.length, 1);
  assert.strictEqual(real.stations[0].petrol.price, 1.759);
  assert.strictEqual(real.stations[0].diesel.price, 1.659);
  assert.strictEqual(real.stations[0].petrol.currency, 'EUR');
  assert.strictEqual(real.stations[0].source, 'Tankerkönig (MTS-K)');
  const demo = F.parseTankerkoenig({
    ok: true, stations: [{ name: 'Demo', lat: 1, lng: 2, e5: 1.009, e10: 1.009, diesel: 1.009 }],
  });
  assert.strictEqual(demo.stations.length, 0);
  assert.ok(demo.warning);
});

t('tankerkoenig error', () => {
  const r = F.parseTankerkoenig({ ok: false, status: 'error', message: 'apikey falsch' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'apikey falsch');
  assert.deepStrictEqual(r.stations, []);
});

t('nakordoni nested, legacy list, missing key', () => {
  const r = F.parseNakordoniFuel({
    ok: true,
    data: { stations: [{
      name: 'MOL', brand: 'MOL', lat: '46.77', lon: '17.24',
      prices: {
        petrol: { price: 645, currency: 'HUF', updated_at: '2026-11-01T08:00:00Z', stale: false },
        diesel: { price: '709', currency: 'HUF', updated_at: '2026-11-01T08:00:00Z', stale: true },
        e10: { price: 630, currency: 'HUF' },
      },
    }] },
  });
  assert.strictEqual(r.stations.length, 1);
  assert.strictEqual(r.stations[0].petrol.price, 645);
  assert.strictEqual(r.stations[0].petrol.currency, 'HUF');
  assert.strictEqual(r.stations[0].diesel.stale, true);
  assert.strictEqual(r.stations[0].lat, 46.77);
  const legacy = F.parseNakordoniFuel({
    data: { data: [{ brand: 'OMV', latitude: 47.5, longitude: 19.0, prices: [{ fuel_type: 'e5', price: 1.7, currency: 'EUR' }, { fuel: 'diesel', price: 1.8, currency: 'EUR', updated_at: '2026-11-01' }] }] },
  });
  assert.strictEqual(legacy.stations[0].petrol.price, 1.7);
  assert.strictEqual(legacy.stations[0].diesel.price, 1.8);
  assert.strictEqual(legacy.stations[0].lon, 19);
  const err = F.parseNakordoniFuel({ ok: false, error: { code: 'missing_api_key', message: 'API key required' } });
  assert.strictEqual(err.ok, false);
  assert.ok(err.error.includes('API key'));
});

t('fuel-prices stations: live AT kept, DE rejected, stale dropped', () => {
  const now = Date.parse('2026-11-01T22:00:00Z');
  const at = F.parseFuelPricesStations({
    ok: true,
    data: { country: 'AT', stations: [{ name: 'BP', lat: 48.2, lng: 16.3, prices: {
      sp95: { price: 1.879, updated: '2026-11-01T21:40:01+02:00' },
      diesel: { price: 2.299, updated: '2026-11-01T21:40:01+02:00' },
    } }] },
  }, now);
  assert.strictEqual(at.stations.length, 1);
  assert.strictEqual(at.stations[0].petrol.price, 1.879);
  assert.strictEqual(at.stations[0].diesel.price, 2.299);
  const de = F.parseFuelPricesStations({ ok: true, data: { country: 'DE', stations: [{ name: 'X', lat: 1, lng: 2, prices: { e5: { price: 1.009, updated: '2026-11-01T00:00:00Z' }, diesel: { price: 1.009, updated: '2026-11-01T00:00:00Z' } } }] } }, now);
  assert.strictEqual(de.ok, false);
  assert.strictEqual(de.stations.length, 0);
  const old = F.parseFuelPricesStations({
    ok: true,
    data: { country: 'AT', stations: [{ name: 'Old', lat: 1, lng: 2, prices: { sp95: { price: 1.5, updated: '2026-01-01T00:00:00Z' }, diesel: { price: 1.6, updated: '2026-01-01T00:00:00Z' } } }] },
  }, now);
  assert.strictEqual(old.stations.length, 0);
});

t('weekly average is national, with HUF local, not a station price', () => {
  const w = F.parseWeeklyAverage({
    url: 'https://www.fuel-prices.eu/Hungary/',
    temporalCoverage: '2026-10-26',
    spatialCoverage: { identifier: 'HU', name: 'Hungary' },
    fp: { prices: [
      { fuel_group: 'petrol', fuel_code: 'E5', value: 1.754, local: { currency: 'HUF', value: 644.616 }, basis: 'national weekly average' },
      { fuel_group: 'diesel', fuel_code: 'B7', value: 1.93, local: { currency: 'HUF', value: 709.298 } },
    ] },
  });
  assert.strictEqual(w.basis, 'national weekly average');
  assert.strictEqual(w.country, 'HU');
  assert.strictEqual(w.petrol.price, 1.754);
  assert.strictEqual(w.petrol.local.price, 644.616);
  assert.strictEqual(w.diesel.local.currency, 'HUF');
  assert.strictEqual(w.source, 'European Commission Weekly Oil Bulletin');
  assert.strictEqual(F.parseWeeklyAverage({}), null);
});

t('matchPrices closest within 0.35 km only', () => {
  const stations = [
    { name: 'A', lat: 47, lon: 19 },
    { name: 'B', lat: 47.02, lon: 19 },
  ];
  const quotes = [{ lat: 47.0015, lon: 19, petrol: { price: 1.5, currency: 'EUR' }, diesel: null, source: 'x' }];
  const m = F.matchPrices(stations, quotes, 0.35);
  assert.strictEqual(m[0].quote.source, 'x');
  assert.ok(m[0].quoteKm < 0.25);
  assert.strictEqual(m[1].quote, null);
});

t('rankPlaces prefers HU over an earlier BG hit', () => {
  const ranked = F.rankPlaces([
    { label: '8360, Bulgaria', country: 'bg' },
    { label: '8360, Keszthely', country: 'hu' },
    { label: 'other', country: 'de' },
  ]);
  assert.strictEqual(ranked[0].country, 'hu');
  assert.strictEqual(ranked[1].country, 'de');
  assert.strictEqual(ranked[2].country, 'bg');
});

t('nominatim search parse', () => {
  const list = F.parseNominatimSearch([
    { lat: '42.09', lon: '27.42', display_name: '8360, Bulgaria', address: { country_code: 'bg' } },
    { lat: '46.76', lon: '17.24', display_name: 'Keszthely', address: { country_code: 'hu' } },
    { lat: 'nope', lon: '1', display_name: 'bad' },
  ]);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].country, 'HU');
  assert.strictEqual(list[0].lat, 46.76);
});

t('maps urls', () => {
  assert.strictEqual(F.mapsUrl('apple', 46.767508, 17.24628), 'https://maps.apple.com/?daddr=46.767508,17.246280&dirflg=d');
  assert.strictEqual(F.mapsUrl('google', 52.5, 13.4), 'https://www.google.com/maps/dir/?api=1&destination=52.500000,13.400000&travelmode=driving');
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
