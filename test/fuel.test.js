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

t('place heading uses town and postcode', () => {
  assert.strictEqual(F.placeHeading({ town: 'Weyhe', postcode: '28844' }), 'Tankstellen bei Weyhe (28844)');
  assert.strictEqual(F.placeHeading({ town: 'Keszthely' }), 'Tankstellen bei Keszthely');
  assert.strictEqual(F.placeHeading(null), '');
});

t('long nominatim name shortens to Weyhe (28844)', () => {
  const label = '28844, Kirchweyhe, Weyhe, Landkreis Diepholz, Niedersachsen, Deutschland';
  assert.strictEqual(F.shortPlace({ label }), 'Weyhe (28844)');
  assert.strictEqual(F.placeHeading({ label }), 'Tankstellen bei Weyhe (28844)');
});

t('pin caption shows brand and cheapest price', () => {
  assert.strictEqual(F.pinCaption({ brand: 'CLASSIC', quote: { e10: { price: 2.259, currency: 'EUR' } } }), 'CLASSIC · 2,259 €');
  assert.strictEqual(F.pinCaption({ brand: 'ARAL', quote: { petrol: { price: 2.289, currency: 'EUR' } } }), 'ARAL · 2,289 €');
  assert.strictEqual(F.shortBrand({ name: 'CLASSIC Weyhe - Kirchweyhe' }), 'CLASSIC Weyhe');
  const long = F.shortBrand({ name: 'Sehr langer Stationsname ohne Marke' });
  assert.ok(long.length <= 14, long);
  assert.ok(long.endsWith('…'));
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

t('bestPlace picks Weyhe over the Italian 28844', () => {
  const p = F.bestPlace([
    { lat: 45.98, lon: 8.26, label: '28844, Villadossola, Italien', country: 'IT' },
    { lat: 52.988728, lon: 8.850828, label: '28844, Kirchweyhe, Weyhe, Deutschland', country: 'DE' },
  ]);
  assert.strictEqual(p.country, 'DE');
  assert.ok(p.label.includes('Weyhe'));
});

t('bestPlace biases toward the last location inside de/hu/at', () => {
  const list = [
    { lat: 47.5, lon: 19.0, label: 'Budapest', country: 'HU' },
    { lat: 52.99, lon: 8.85, label: 'Weyhe', country: 'DE' },
    { lat: 45.9, lon: 8.2, label: 'Italien', country: 'IT' },
  ];
  assert.strictEqual(F.bestPlace(list, { lat: 47.4, lon: 19.1 }).label, 'Budapest');
  assert.strictEqual(F.bestPlace(list, { lat: 53, lon: 9 }).label, 'Weyhe');
  assert.notStrictEqual(F.bestPlace(list, null).country, 'IT');
});

t('nominatim url prefers de,hu,at and biases', () => {
  const u = F.nominatimSearchUrl('28844', { countrycodes: F.GEO_PRIMARY, bias: { lat: 47, lon: 19 } });
  assert.ok(u.includes('countrycodes=de%2Chu%2Cat') || u.includes('countrycodes=de,hu,at'));
  assert.ok(u.includes('q=28844'));
  assert.ok(u.includes('viewbox='));
  assert.ok(u.includes('bounded=0'));
  assert.strictEqual(F.GEO_PRIMARY, 'de,hu,at');
});

t('overpass fuel query is lean', () => {
  const q = F.overpassFuelQuery(52.9887284, 8.850828);
  assert.ok(q.includes('node(around:10000,52.988728,8.850828)[amenity=fuel]'));
  assert.ok(q.includes('way(around:10000,52.988728,8.850828)[amenity=fuel]'));
  assert.ok(q.includes('out center 50'));
  assert.ok(!/relation/.test(q));
  assert.ok(F.OVERPASS_FUEL[0].includes('overpass-api.de'));
  assert.ok(F.OVERPASS_FUEL[1].includes('kumi.systems'));
  assert.ok(F.OVERPASS_FUEL[2].includes('private.coffee'));
  assert.ok(F.OVERPASS_FUEL[3].includes('maps.mail.ru'));
  assert.ok(F.OVERPASS_FUEL[F.OVERPASS_FUEL.length - 1].includes('openstreetmap.fr'));
});

t('maps urls', () => {
  assert.strictEqual(F.mapsUrl('apple', 46.767508, 17.24628), 'https://maps.apple.com/?daddr=46.767508,17.246280&dirflg=d');
  assert.strictEqual(F.mapsUrl('google', 52.5, 13.4), 'https://www.google.com/maps/dir/?api=1&destination=52.500000,13.400000&travelmode=driving');
});

t('nakordoni Weyhe fixture: e5, e10, diesel, EUR format, pin price', () => {
  const de = require('./fixtures/nak_de.json');
  const r = F.parseNakordoniFuel(de);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attribution, 'Data by nakordoni.eu');
  assert.ok(r.terms.includes('nakordoni.eu'));
  assert.strictEqual(r.stations.length, 5);
  const classic = r.stations[0];
  assert.strictEqual(classic.name, 'CLASSIC Weyhe - Kirchweyhe');
  assert.strictEqual(classic.lon, 8.87077);
  assert.strictEqual(classic.address, 'Kirchweyher Straße 4, 28844 Weyhe');
  assert.strictEqual(classic.petrol.price, 2.059);
  assert.strictEqual(classic.e10.price, 1.999);
  assert.strictEqual(classic.diesel.price, 2.189);
  assert.strictEqual(classic.quote.petrol.currency, 'EUR');
  assert.ok(classic.extras.some(x => x.grade === 'lpg' && x.price === 1.109));
  assert.strictEqual(F.formatFuelPrice(classic.petrol), '2,059 €/l');
  assert.strictEqual(F.pinPrice(classic), '1,999 €');
  const staleLpg = r.stations[3].extras.find(x => x.grade === 'lpg');
  assert.strictEqual(staleLpg.stale, true);
  assert.ok(F.formatFuelPrice(staleLpg).includes('veraltet'));
});

t('nakordoni Keszthely fixture: HUF to EUR and missing Benzin', () => {
  const hu = require('./fixtures/nak_hu.json');
  const r = F.parseNakordoniFuel(hu);
  assert.strictEqual(r.stations.length, 5);
  const volan = r.stations[0];
  assert.strictEqual(volan.diesel.price, 702);
  assert.strictEqual(volan.diesel.currency, 'HUF');
  assert.strictEqual(volan.diesel.stale, true);
  assert.strictEqual(volan.petrol, null);
  assert.strictEqual(F.formatFuelPrice(volan.petrol, 1.76 / 645), null);
  const staleE5 = r.stations[1].petrol;
  assert.strictEqual(staleE5.price, 645);
  assert.strictEqual(staleE5.stale, true);
  assert.strictEqual(F.formatFuelPrice(staleE5, 1.76 / 645), '645 Ft/l · 1,76 €/l · veraltet');
  const mol = r.stations[2];
  assert.strictEqual(mol.petrol.price, 644);
  assert.strictEqual(mol.petrol.stale, false);
  assert.strictEqual(mol.e10.price, 640);
  assert.strictEqual(F.formatFuelPrice(mol.petrol, 1.76 / 644), '644 Ft/l · 1,76 €/l');
  assert.ok(F.formatFuelPrice(volan.diesel, 1.76 / 645).startsWith('702 Ft/l · '));
  assert.ok(F.formatFuelPrice(volan.diesel, 1.76 / 645).includes('veraltet'));
  assert.strictEqual(F.pinPrice(mol), '640 Ft');
  const updated = F.formatUpdatedAt(staleE5.updated);
  const expected = new Date('2026-10-23T13:00:00Z').toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  assert.strictEqual(updated, expected);
});

console.log(`${n - fail}/${n} Tests bestanden`);
process.exit(fail ? 1 : 0);
