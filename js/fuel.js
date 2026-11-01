/* Tankstellen: Distanz, Overpass-Auswahl, Preis-Parser (UMD: Browser + Node-Tests).
   Keine Preise erfinden – Parser verwerfen Platzhalter und liefern nur, was die Quelle hergibt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForintFuel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Länder mit echten Kassenpreisen auf fuel-prices.eu (ohne Schlüssel, CORS).
  // DE antwortet dort nur mit dem Platzhalter 1,009; HU hat keine Stationsdaten.
  const LIVE_STATION_COUNTRIES = ['AT', 'AU', 'DK', 'ES', 'FR', 'GR', 'HR', 'IS', 'IT', 'RO', 'SE', 'SI'];
  const WEEKLY_SLUG = {
    HU: 'Hungary', DE: 'Germany', AT: 'Austria', SK: 'Slovakia', SI: 'Slovenia', HR: 'Croatia',
    RO: 'Romania', PL: 'Poland', CZ: 'Czechia', CH: 'Switzerland', FR: 'France', IT: 'Italy',
    NL: 'Netherlands', ES: 'Spain', DK: 'Denmark',
  };
  // Bei mehrdeutigen Treffern (z. B. PLZ 8360) diese Länder nach vorne sortieren.
  const PREFERRED_COUNTRIES = ['de', 'hu', 'at', 'sk', 'si', 'hr', 'ro', 'cz', 'pl'];

  function distKm(a, b) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function pricePoint(value, currency, updated, stale) {
    const price = num(value);
    if (price == null || price <= 0) return null;
    return { price, currency: currency ? String(currency).toUpperCase() : null, updated: updated || null, stale: !!stale };
  }

  // Der Tankerkönig-Demoschlüssel und die unveröffentlichten DE-Daten von fuel-prices.eu
  // liefern für alle Sorten exakt 1,009. Das ist kein Kassenpreis.
  function isPlaceholderQuote(petrol, diesel, extra) {
    const vals = [petrol, diesel, extra].filter(Boolean).map(p => p.price);
    if (vals.length < 2) return false;
    return vals.every(v => Math.abs(v - 1.009) < 1e-6);
  }

  function stationFromElement(el) {
    const t = el.tags || {};
    const lat = num(el.lat != null ? el.lat : el.center && el.center.lat);
    const lon = num(el.lon != null ? el.lon : el.center && el.center.lon);
    if (lat == null || lon == null) return null;
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ').trim();
    const address = [street, [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const brand = t.brand || '';
    const name = t.name || brand || t.operator || 'Tankstelle';
    return { lat, lon, name, brand, address, opening: t.opening_hours || '' };
  }

  function nearestFuelStations(elements, pos, radiusKm, limit) {
    const radius = radiusKm == null ? 10 : radiusKm;
    const max = limit == null ? 5 : limit;
    return (elements || []).map(stationFromElement).filter(Boolean)
      .map(s => ({ ...s, d: distKm(pos, s) }))
      .filter(s => s.d <= radius + 1e-6)
      .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
      .slice(0, max);
  }

  function gradeMap(pr) {
    const out = {};
    if (!pr) return out;
    if (Array.isArray(pr)) {
      pr.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const k = String(item.fuel_type || item.fuel || item.grade || item.name || '').toLowerCase();
        if (k) out[k] = item;
      });
      return out;
    }
    if (typeof pr === 'object') {
      Object.keys(pr).forEach(k => { out[String(k).toLowerCase()] = pr[k]; });
    }
    return out;
  }

  function pickGrade(pr, keys) {
    const map = gradeMap(pr);
    for (let i = 0; i < keys.length; i++) {
      const v = map[keys[i]];
      if (v == null || v === '') continue;
      if (typeof v === 'number' || typeof v === 'string') return pricePoint(v, null, null, false);
      const point = pricePoint(v.price != null ? v.price : v.value, v.currency || v.currency_symbol, v.updated_at || v.updated || v.ts, v.stale);
      if (point) return point;
    }
    return null;
  }

  const PETROL_KEYS = ['petrol', 'e5', 'sp95', 'petrol95', 'benzin', 'pb95', 'benzin95', 'euro95', '95'];
  const DIESEL_KEYS = ['diesel', 'b7', 'gazolaj', 'gázolaj', 'diesel_b7'];

  function parseNakordoniFuel(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'Leere Antwort', stations: [] };
    if (json.ok === false) {
      const err = json.error;
      const message = (err && (err.message || err.code)) || json.message || 'nakordoni-Fehler';
      return { ok: false, error: String(message), stations: [] };
    }
    const data = json.data && typeof json.data === 'object' ? json.data : {};
    let list = data.stations || data.data || json.stations || [];
    if (!Array.isArray(list)) list = [];
    const stations = [];
    list.forEach(s => {
      if (!s || typeof s !== 'object') return;
      const lat = num(s.lat != null ? s.lat : s.latitude != null ? s.latitude : s.location && s.location.lat);
      const lon = num(s.lon != null ? s.lon : s.lng != null ? s.lng : s.longitude != null ? s.longitude : s.location && (s.location.lon != null ? s.location.lon : s.location.lng));
      const petrol = pickGrade(s.prices, PETROL_KEYS);
      const diesel = pickGrade(s.prices, DIESEL_KEYS);
      if (!petrol && !diesel) return;
      stations.push({
        lat, lon,
        name: s.name || s.brand || '',
        brand: s.brand || '',
        petrol, diesel,
        source: 'nakordoni.eu',
        sourceUrl: 'https://nakordoni.eu/',
      });
    });
    return { ok: true, stations };
  }

  function parseTankerkoenig(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'Leere Antwort', stations: [] };
    if (json.ok === false || json.status === 'error') {
      return { ok: false, error: String(json.message || 'Tankerkönig-Fehler'), stations: [] };
    }
    const stations = [];
    let dropped = 0;
    (json.stations || []).forEach(s => {
      if (!s || typeof s !== 'object') return;
      const petrol = pricePoint(s.e5, 'EUR', null, false);
      const diesel = pricePoint(s.diesel, 'EUR', null, false);
      const e10 = pricePoint(s.e10, 'EUR', null, false);
      if (isPlaceholderQuote(petrol, diesel, e10)) { dropped++; return; }
      if (!petrol && !diesel) return;
      stations.push({
        lat: num(s.lat), lon: num(s.lng != null ? s.lng : s.lon),
        name: s.name || s.brand || '',
        brand: s.brand || '',
        petrol, diesel,
        source: 'Tankerkönig (MTS-K)',
        sourceUrl: 'https://creativecommons.tankerkoenig.de/',
      });
    });
    const warning = dropped && !stations.length ? 'Keine echten Preise (Demo- oder Platzhalterdaten).' : '';
    return { ok: true, stations, warning };
  }

  function fromFuelPricesGrade(g, nowMs, maxAgeMs) {
    if (!g || typeof g !== 'object') return null;
    const updated = g.updated || (g.ts ? new Date(g.ts * 1000).toISOString() : null);
    const point = pricePoint(g.price, 'EUR', updated, false);
    if (!point) return null;
    if (updated && nowMs) {
      const t = Date.parse(updated);
      if (Number.isFinite(t) && nowMs - t > maxAgeMs) return null;
    }
    return point;
  }

  function parseFuelPricesStations(json, nowMs) {
    if (!json || json.ok === false) return { ok: false, error: (json && json.error) || 'keine Stationspreise', stations: [] };
    const data = json.data || {};
    const country = data.country || '';
    if (country === 'DE' || country === 'HU') return { ok: false, error: 'Keine Kassenpreise für ' + country, stations: [] };
    const maxAgeMs = 7 * 24 * 3600 * 1000;
    const stations = [];
    (data.stations || []).forEach(s => {
      const prices = s.prices || {};
      const petrol = fromFuelPricesGrade(prices.sp95 || prices.e5, nowMs, maxAgeMs);
      const diesel = fromFuelPricesGrade(prices.diesel, nowMs, maxAgeMs);
      const e10 = fromFuelPricesGrade(prices.e10, nowMs, maxAgeMs);
      if (isPlaceholderQuote(petrol, diesel, e10)) return;
      if (!petrol && !diesel) return;
      stations.push({
        lat: num(s.lat), lon: num(s.lng != null ? s.lng : s.lon),
        name: s.name || s.brand || '',
        brand: s.brand || '',
        petrol, diesel,
        source: 'fuel-prices.eu',
        sourceUrl: 'https://www.fuel-prices.eu/',
      });
    });
    return { ok: true, stations, attribution: json.attribution || null };
  }

  function parseWeeklyAverage(json) {
    const prices = json && json.fp && json.fp.prices;
    if (!Array.isArray(prices)) return null;
    const petrol = prices.find(p => p && (p.fuel_group === 'petrol' || p.fuel_code === 'E5'));
    const diesel = prices.find(p => p && (p.fuel_group === 'diesel' || p.fuel_code === 'B7'));
    if (!petrol && !diesel) return null;
    const one = (p) => p && num(p.value) != null ? {
      price: num(p.value),
      currency: 'EUR',
      local: p.local && num(p.local.value) != null ? { price: num(p.local.value), currency: String(p.local.currency || '').toUpperCase() } : null,
    } : null;
    return {
      basis: 'national weekly average',
      week: json.temporalCoverage || (json.fp && json.fp.updated) || null,
      country: (json.spatialCoverage && json.spatialCoverage.identifier) || null,
      countryName: (json.spatialCoverage && json.spatialCoverage.name) || null,
      petrol: one(petrol),
      diesel: one(diesel),
      source: 'European Commission Weekly Oil Bulletin',
      via: 'fuel-prices.eu',
      url: json.url || 'https://www.fuel-prices.eu/',
    };
  }

  function matchPrices(stations, quotes, maxKm) {
    const limit = maxKm == null ? 0.35 : maxKm;
    return (stations || []).map(s => {
      let best = null, bestD = limit;
      (quotes || []).forEach(q => {
        if (q.lat == null || q.lon == null) return;
        if (!q.petrol && !q.diesel) return;
        const d = distKm(s, q);
        if (d <= bestD) { best = q; bestD = d; }
      });
      return { ...s, quote: best, quoteKm: best ? bestD : null };
    });
  }

  function rankPlaces(list) {
    const pref = new Set(PREFERRED_COUNTRIES);
    return (list || []).map((p, i) => ({ p, i })).sort((a, b) => {
      const ac = pref.has(String(a.p.country || '').toLowerCase()) ? 0 : 1;
      const bc = pref.has(String(b.p.country || '').toLowerCase()) ? 0 : 1;
      return ac - bc || a.i - b.i;
    }).map(x => x.p);
  }

  function parseNominatimSearch(arr) {
    if (!Array.isArray(arr)) return [];
    return rankPlaces(arr.map(p => ({
      lat: num(p.lat),
      lon: num(p.lon),
      label: p.display_name || '',
      country: p.address && p.address.country_code ? String(p.address.country_code).toUpperCase() : null,
    })).filter(p => p.lat != null && p.lon != null));
  }

  function mapsUrl(app, lat, lon) {
    const la = Number(lat).toFixed(6), lo = Number(lon).toFixed(6);
    if (app === 'apple') return 'https://maps.apple.com/?daddr=' + la + ',' + lo + '&dirflg=d';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + la + ',' + lo + '&travelmode=driving';
  }

  return {
    LIVE_STATION_COUNTRIES, WEEKLY_SLUG, PREFERRED_COUNTRIES,
    distKm, nearestFuelStations, parseNakordoniFuel, parseTankerkoenig, parseFuelPricesStations,
    parseWeeklyAverage, matchPrices, rankPlaces, parseNominatimSearch, mapsUrl, isPlaceholderQuote,
  };
});
