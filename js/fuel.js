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
  const GEO_PRIMARY = 'de,hu,at';
  const GEO_FALLBACK = 'de,hu,at,sk,si,hr,ro,cz,pl,ch,nl,fr,it';
  const OVERPASS_FUEL = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    // Die vier darüber sind oft in der Warteschlange oder antworten mit 502. Dieser Spiegel
    // liefert dieselbe schlanke Abfrage in der Regel innerhalb einer Sekunde.
    'https://overpass.openstreetmap.fr/api/interpreter',
  ];

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

  function normCurrency(c) {
    const s = String(c || '').trim().toUpperCase();
    if (s === '€' || s === 'EUR') return 'EUR';
    if (s === 'FT' || s === 'HUF') return 'HUF';
    return s || null;
  }

  function pricePoint(value, currency, updated, stale) {
    const price = num(value);
    if (price == null || price <= 0) return null;
    return { price, currency: normCurrency(currency), updated: updated || null, stale: !!stale };
  }

  function formatUpdatedAt(v) {
    if (v == null || v === '') return '';
    let t;
    if (typeof v === 'number') t = v < 1e12 ? v * 1000 : v;
    else {
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}/.test(s)) t = Date.parse(s.replace(' ', 'T') + 'Z');
      else t = Date.parse(s);
    }
    if (!Number.isFinite(t)) return String(v);
    return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatFuelPrice(p, eurPerHuf) {
    if (!p || !(Number(p.price) > 0)) return null;
    const cur = normCurrency(p.currency) || 'EUR';
    let text;
    if (cur === 'HUF') {
      text = Math.round(p.price) + ' Ft/l';
      if (eurPerHuf > 0) text += ' · ' + (Number(p.price) * eurPerHuf).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €/l';
    } else if (cur === 'EUR') {
      text = Number(p.price).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €/l';
    } else text = p.price + ' ' + cur + '/l';
    if (p.stale) text += ' · veraltet';
    return text;
  }

  function pinPrice(station) {
    const q = (station && station.quote) || station || {};
    const pool = [q.e10, q.petrol, q.diesel].filter(p => p && p.price > 0);
    const fresh = pool.filter(p => !p.stale);
    const pick = (fresh.length ? fresh : pool).slice().sort((a, b) => a.price - b.price)[0];
    if (!pick) return '';
    const cur = normCurrency(pick.currency) || 'EUR';
    if (cur === 'HUF') return Math.round(pick.price) + ' Ft';
    if (cur === 'EUR') return Number(pick.price).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €';
    return String(pick.price);
  }

  function shortBrand(station) {
    let s = String((station && (station.brand || station.name)) || '').trim();
    s = s.split(/\s+[-–|]\s+/)[0].replace(/\s+tankstelle$/i, '').trim();
    if (s.length <= 14) return s;
    const cut = s.slice(0, 13).replace(/\s+\S*$/, '').trim();
    return (cut || s.slice(0, 13)) + '…';
  }

  function pinCaption(station) {
    const price = pinPrice(station);
    const brand = shortBrand(station);
    if (brand && price) return brand + ' · ' + price;
    return price || brand || '';
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
  const EXTRA_GRADES = [['superplus', 'Super Plus'], ['super100', 'Super 100'], ['premdiesel', 'Premium-Diesel'], ['lpg', 'Autogas']];

  function parseNakordoniFuel(json) {
    if (!json || typeof json !== 'object') return { ok: false, error: 'Leere Antwort', stations: [] };
    if (json.ok === false) {
      const err = json.error;
      const message = (err && (err.message || err.code)) || json.message || 'nakordoni-Fehler';
      return { ok: false, error: String(message), stations: [] };
    }
    const data = json.data;
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') list = data.stations || data.data || data.results || [];
    else if (Array.isArray(json.stations)) list = json.stations;
    if (!Array.isArray(list)) list = [];
    const stations = [];
    list.forEach(s => {
      if (!s || typeof s !== 'object') return;
      const lat = num(s.lat != null ? s.lat : s.latitude != null ? s.latitude : s.location && s.location.lat);
      const lon = num(s.lon != null ? s.lon : s.lng != null ? s.lng : s.longitude != null ? s.longitude : s.location && (s.location.lon != null ? s.location.lon : s.location.lng));
      if (lat == null || lon == null) return;
      const prices = s.prices;
      const petrol = pickGrade(prices, PETROL_KEYS);
      const e10 = pickGrade(prices, ['e10']);
      const diesel = pickGrade(prices, DIESEL_KEYS);
      const map = gradeMap(prices);
      const extras = [];
      EXTRA_GRADES.forEach(([grade, fallback]) => {
        const v = map[grade];
        if (v == null) return;
        const point = (typeof v === 'number' || typeof v === 'string')
          ? pricePoint(v, null, null, false)
          : pricePoint(v.price != null ? v.price : v.value, v.currency || v.currency_symbol, v.updated_at || v.updated, v.stale);
        if (!point) return;
        extras.push(Object.assign({ grade, label: (v && v.local_name) || fallback }, point));
      });
      const quote = { source: 'nakordoni.eu', sourceUrl: 'https://nakordoni.eu/', petrol, e10, diesel, extras };
      const d = num(s.distance_km);
      stations.push({
        lat, lon, d: d == null ? null : d,
        name: s.name || s.brand || 'Tankstelle',
        brand: s.brand || '',
        address: s.address || '',
        country: s.country || '',
        petrol, e10, diesel, extras, quote,
        source: 'nakordoni.eu',
        sourceUrl: 'https://nakordoni.eu/',
      });
    });
    stations.sort((a, b) => (a.d == null ? 99 : a.d) - (b.d == null ? 99 : b.d));
    return {
      ok: true, stations, rows: list.length,
      attribution: json.attribution || 'Data by nakordoni.eu',
      terms: json.terms || 'https://nakordoni.eu/en/p/developer_api_terms',
    };
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
      town: addressTown(p.address),
      postcode: p.address && p.address.postcode ? String(p.address.postcode) : '',
    })).filter(p => p.lat != null && p.lon != null));
  }

  function addressTown(address) {
    const a = address || {};
    return a.city || a.town || a.village || a.municipality || a.hamlet || '';
  }

  function parseLongPlace(label) {
    const parts = String(label || '').split(',').map(s => s.trim()).filter(Boolean);
    let postcode = '';
    const names = [];
    const skip = /^(landkreis|kreis|bezirk|regierungsbezirk)\b|^(deutschland|germany|ungarn|hungary|magyarország|österreich|austria|schweiz|switzerland|niedersachsen|bayern|baden-württemberg|nordrhein-westfalen|hessen|sachsen|thüringen|brandenburg|mecklenburg-vorpommern|schleswig-holstein|rheinland-pfalz|saarland|bremen|hamburg|berlin|transdanubien|dunántúl)$/i;
    parts.forEach(part => {
      if (/^\d{4,5}$/.test(part)) { if (!postcode) postcode = part; return; }
      if (skip.test(part)) return;
      names.push(part);
    });
    let town = names[0] || '';
    names.forEach(n => {
      names.forEach(other => {
        if (n !== other && other.toLowerCase().endsWith(n.toLowerCase()) && n.length >= 3) town = n;
      });
    });
    return { town, postcode };
  }

  function shortPlace(p) {
    if (!p) return '';
    let town = p.town || '';
    let plz = p.postcode || '';
    if ((!town || !plz) && p.label) {
      const parsed = parseLongPlace(p.label);
      if (!town) town = parsed.town;
      if (!plz) plz = parsed.postcode;
    }
    if (town && plz) return town + ' (' + plz + ')';
    return town || plz || '';
  }

  function placeHeading(p) {
    const short = shortPlace(p);
    return short ? 'Tankstellen bei ' + short : '';
  }

  function nominatimSearchUrl(q, opts) {
    opts = opts || {};
    const p = ['format=jsonv2', 'addressdetails=1', 'limit=5', 'q=' + encodeURIComponent(q)];
    if (opts.countrycodes) p.push('countrycodes=' + opts.countrycodes);
    if (opts.bias && opts.bias.lat != null && opts.bias.lon != null) {
      const d = 0.6, lat = Number(opts.bias.lat), lon = Number(opts.bias.lon);
      p.push('viewbox=' + [lon - d, lat + d, lon + d, lat - d].join(','));
      p.push('bounded=0');
    }
    return 'https://nominatim.openstreetmap.org/search?' + p.join('&');
  }

  function overpassFuelQuery(lat, lon) {
    const la = Number(lat).toFixed(6), lo = Number(lon).toFixed(6);
    return '[out:json][timeout:8];(node(around:10000,' + la + ',' + lo + ')[amenity=fuel];way(around:10000,' + la + ',' + lo + ')[amenity=fuel];);out center 50;';
  }

  function bestPlace(list, bias) {
    const ranked = rankPlaces(list || []);
    if (!ranked.length) return null;
    const home = ranked.filter(p => ['DE', 'HU', 'AT'].includes(String(p.country || '').toUpperCase()));
    const pool = home.length ? home : ranked;
    if (!bias || bias.lat == null || bias.lon == null) return pool[0];
    return pool.slice().sort((a, b) => distKm(bias, a) - distKm(bias, b))[0];
  }

  function mapsUrl(app, lat, lon) {
    const la = Number(lat).toFixed(6), lo = Number(lon).toFixed(6);
    if (app === 'apple') return 'https://maps.apple.com/?daddr=' + la + ',' + lo + '&dirflg=d';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + la + ',' + lo + '&travelmode=driving';
  }

  return {
    LIVE_STATION_COUNTRIES, WEEKLY_SLUG, PREFERRED_COUNTRIES, GEO_PRIMARY, GEO_FALLBACK, OVERPASS_FUEL,
    distKm, nearestFuelStations, parseNakordoniFuel, parseTankerkoenig, parseFuelPricesStations,
    parseWeeklyAverage, matchPrices, rankPlaces, parseNominatimSearch, nominatimSearchUrl, overpassFuelQuery,
    bestPlace, mapsUrl, isPlaceholderQuote, formatFuelPrice, formatUpdatedAt, pinPrice, pinCaption, shortBrand, shortPlace, normCurrency, placeHeading,
  };
});
