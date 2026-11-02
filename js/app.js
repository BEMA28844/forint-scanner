/* Forint → Euro Scanner – App-Logik */
(() => {
  'use strict';
  const P = window.ForintParse;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem('fs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => localStorage.setItem('fs.' + k, JSON.stringify(v)),
  };
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const fmtDate = (ts) => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  function toast(msg, ms = 2500) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  async function fetchJson(url, opts = {}, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  // ---------------- Wechselkurs ----------------
  const state = { eurPerHuf: null, rateInfo: null, scans: [], paused: false, pos: null, market: '' };

  function hufToEur(huf) { return state.eurPerHuf ? huf * state.eurPerHuf : null; }

  function renderRate() {
    const manual = parseFloat(LS.get('manualRate', ''));
    if (manual > 0) {
      state.eurPerHuf = 1 / manual;
      $('#rateMain').textContent = `1 € = ${manual.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Ft`;
      $('#rateSub').textContent = 'Manueller Kurs (Einstellungen)';
      return;
    }
    const ri = LS.get('rate', null);
    if (!ri) { $('#rateMain').textContent = 'Kein Kurs – bitte online gehen'; $('#rateSub').textContent = ''; state.eurPerHuf = null; return; }
    state.eurPerHuf = ri.eurPerHuf;
    const hufPerEur = 1 / ri.eurPerHuf;
    $('#rateMain').textContent = `1 € = ${hufPerEur.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Ft · 1.000 Ft = ${P.formatEur(1000 * ri.eurPerHuf)}`;
    $('#rateSub').textContent = `${ri.source}, Stand ${new Date(ri.date).toLocaleDateString('de-DE')}${ri.offline ? ' (gespeichert, offline)' : ''}`;
  }

  async function loadRate() {
    renderRate();
    try {
      const j = await fetchJson('https://api.frankfurter.dev/v1/latest?from=HUF&to=EUR');
      if (!j.rates || !j.rates.EUR) throw new Error('kein Kurs');
      LS.set('rate', { eurPerHuf: j.rates.EUR, date: j.date, source: 'EZB-Referenzkurs', fetched: Date.now() });
    } catch (e) {
      try { // Ersatzquelle (kein EZB-Kurs, aber kostenlos)
        const j = await fetchJson('https://open.er-api.com/v6/latest/HUF');
        if (j.result !== 'success') throw new Error('fail');
        LS.set('rate', { eurPerHuf: j.rates.EUR, date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10), source: 'open.er-api.com (Marktkurs)', fetched: Date.now() });
      } catch (e2) {
        const ri = LS.get('rate', null); if (ri) { ri.offline = true; LS.set('rate', ri); }
      }
    }
    const ri = LS.get('rate', null); if (ri && navigator.onLine) { delete ri.offline; LS.set('rate', ri); }
    renderRate();
    refreshEurs();
  }

  // ---------------- Standort / Markt ----------------
  function getPos(opts = {}) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('Kein GPS verfügbar'));
      navigator.geolocation.getCurrentPosition(p => { state.pos = { lat: p.coords.latitude, lon: p.coords.longitude, ts: Date.now() }; res(state.pos); },
        e => rej(new Error(e.code === 1 ? 'Standortfreigabe verweigert' : e.code === 3 ? 'Standort-Zeitüberschreitung' : 'Standort nicht ermittelbar')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000, ...opts });
    });
  }
  function distKm(a, b) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Fragt mehrere öffentliche Overpass-Server parallel (gestaffelt) ab, der schnellste gewinnt
  function overpass(q, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let pending = OVERPASS.length, done = false;
      OVERPASS.forEach((url, i) => setTimeout(() => {
        if (done) { pending--; return; }
        fetchJson(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, timeoutMs)
          .then(j => { if (!done) { done = true; resolve(j); } })
          .catch(() => { if (--pending === 0 && !done) reject(new Error('Kartendienst (OpenStreetMap) gerade nicht erreichbar')); });
      }, i * 2500));
    });
  }
  let marketPromise = null;
  async function detectMarket(force) {
    const fixed = LS.get('fixedMarket', '');
    if (fixed) { state.market = fixed; $('#marketPill').textContent = '🏪 ' + fixed; return fixed; }
    if (marketPromise && !force) return marketPromise;
    marketPromise = (async () => {
      try {
        const pos = await getPos();
        let name = '';
        const nomP = fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=de&lat=${pos.lat}&lon=${pos.lon}`).catch(() => null);
        try {
          const j = await overpass(`[out:json][timeout:15];nwr(around:200,${pos.lat},${pos.lon})[shop~"supermarket|convenience|discount|department_store|greengrocer|bakery|butcher|chemist|mall|general|kiosk"][name];out center tags;`);
          const els = (j.elements || []).map(e => ({ name: e.tags.name, brand: e.tags.brand, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, city: e.tags['addr:city'] }))
            .filter(e => e.lat).map(e => ({ ...e, d: distKm(pos, e) })).sort((a, b) => a.d - b.d);
          const opts = els.map(e => e.name + (e.city ? ' ' + e.city : ''));
          LS.set('nearbyShops', [...new Set(opts)].slice(0, 10));
          if (els[0]) name = els[0].name + (els[0].city ? ' ' + els[0].city : '');
        } catch (e) { /* weiter mit Nominatim */ }
        if (!name) {
          const j = (await nomP) || {};
          const a = j.address || {};
          name = j.name || [a.shop, a.road, a.city || a.town || a.village].filter(Boolean).join(', ') || j.display_name || '';
        }
        state.market = name;
        $('#marketPill').textContent = name ? '🏪 ' + name : '';
        updateDatalists();
        return name;
      } catch (e) {
        $('#marketPill').textContent = '';
        return '';
      } finally { setTimeout(() => { marketPromise = null; }, 120000); }
    })();
    return marketPromise;
  }

  // ---------------- Daten ----------------
  async function loadScans() {
    state.scans = await DB.all();
    renderTicker(); renderHistory(); updateDatalists();
  }
  function lastFor(name, excludeId) {
    const k = P.normName(name); if (!k) return null;
    return state.scans.find(s => s.key === k && s.id !== excludeId) || null;
  }
  function lastText(s) {
    return `Zuletzt: ${P.formatHuf(s.huf)} (${P.formatEur(hufToEur(s.huf))}) bei ${s.market || 'unbekannt'} am ${fmtDay(s.ts)}`;
  }
  function updateDatalists() {
    const names = [...new Set(state.scans.map(s => s.name))].slice(0, 200);
    $('#articleList').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
    const markets = [...new Set([state.market, ...LS.get('nearbyShops', []), ...state.scans.map(s => s.market)].filter(Boolean))].slice(0, 50);
    $('#marketList').innerHTML = markets.map(n => `<option value="${esc(n)}">`).join('');
  }
  function refreshEurs() { renderTicker(); renderHistory(); }

  function renderTicker() {
    const items = state.scans.slice(0, 20);
    const inner = $('#tickerInner');
    if (!items.length) { inner.innerHTML = '<span>Noch keine Preise gespeichert – scanne ein Preisschild oder einen Kassenbon.</span>'; return; }
    const html = items.map(s => `<span>${esc(s.name)} – <b>${esc(P.formatHuf(s.huf))}</b> (${esc(P.formatEur(hufToEur(s.huf)))}) – ${esc(s.market || '?')}</span>`).join('');
    inner.innerHTML = html;
    inner.style.animationDuration = Math.max(20, items.length * 7) + 's';
  }

  function renderHistory() {
    const q = P.normName($('#histSearch').value);
    const list = state.scans.filter(s => !q || P.normName(s.name + ' ' + s.market).includes(q));
    $('#histList').innerHTML = list.length ? list.map(s => {
      const prev = lastFor(s.name, s.id) && state.scans.find(x => x.key === s.key && x.ts < s.ts);
      const diff = prev ? s.huf - prev.huf : 0;
      return `<li><div class="t"><span>${esc(s.name)}</span><span>${esc(P.formatHuf(s.huf))} <span class="eur">${esc(P.formatEur(hufToEur(s.huf)))}</span></span></div>
        <div class="m">${esc(s.market || 'Markt unbekannt')} · ${esc(fmtDate(s.ts))}${s.src === 'receipt' ? ' · 🧾' : ''}${prev ? ` · vorher ${esc(P.formatHuf(prev.huf))} (${diff > 0 ? '+' : ''}${diff} Ft)` : ''}</div>
        <div class="acts"><button data-del="${s.id}">🗑 Löschen</button></div></li>`;
    }).join('') : '<li class="small">Keine Einträge.</li>';
  }
  $('#histSearch').addEventListener('input', renderHistory);
  $('#histList').addEventListener('click', async (e) => {
    const id = e.target.dataset.del; if (!id) return;
    if (!confirm('Eintrag löschen?')) return;
    await DB.del(Number(id)); await loadScans();
  });
  $('#btnExport').addEventListener('click', () => {
    const rows = [['Datum', 'Artikel', 'Preis HUF', 'Preis EUR', 'Markt', 'Quelle']]
      .concat(state.scans.map(s => [new Date(s.ts).toISOString(), s.name, s.huf, (hufToEur(s.huf) || 0).toFixed(2), s.market, s.src]));
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = 'forint-preise.csv'; a.click();
  });

  // ---------------- Tabs ----------------
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
    state.paused = b.dataset.view !== 'camera' || state.userPaused;
    if (b.dataset.view === 'fuel') { openFuelTab(); setTimeout(() => fuelMap && fuelMap.invalidateSize(), 60); }
  }));

  // ---------------- OCR ----------------
  const abs = (p) => new URL(p, location.href).href;
  const TESS = { workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract/core'), langPath: abs('vendor/tesseract/lang') };
  let priceWorker = null, textWorker = null;
  async function getPriceWorker() {
    if (!priceWorker) priceWorker = (async () => {
      const w = await Tesseract.createWorker('eng', 1, TESS);
      await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '0123456789 .,-FtHUft/kgl%' });
      return w;
    })();
    return priceWorker;
  }
  async function getTextWorker() {
    if (!textWorker) textWorker = Tesseract.createWorker('hun', 1, TESS);
    return textWorker;
  }

  // ---------------- Kamera / Live-Erkennung ----------------
  const video = $('#video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, loopRunning = false, recent = [], shown = null, shownAt = 0, frameNo = 0;

  async function startCamera() {
    $('#camErr').textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) { $('#camErr').textContent = 'Kamera nicht verfügbar. Die App muss über https geöffnet werden.'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      video.srcObject = stream; await video.play();
      $('#camStart').classList.add('hidden');
      LS.set('camOk', true);
      detectMarket();
      $('#ocrStatus').textContent = 'OCR lädt…';
      await getPriceWorker();
      $('#ocrStatus').textContent = 'Suche Preis…';
      if (!loopRunning) loop();
    } catch (e) {
      $('#camErr').textContent = 'Kamera-Fehler: ' + (e.name === 'NotAllowedError' ? 'Zugriff verweigert. In iOS: Einstellungen › Safari › Kamera › Erlauben.' : e.message);
    }
  }
  $('#btnStartCam').addEventListener('click', startCamera);

  function grabCrop() {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    // sichtbaren Bereich (object-fit: cover) berechnen und Rahmen (8%..92%, 30%..60%) darauf abbilden
    const el = video.getBoundingClientRect();
    const scale = Math.max(el.width / vw, el.height / vh);
    const dispW = vw * scale, dispH = vh * scale;
    const offX = (dispW - el.width) / 2, offY = (dispH - el.height) / 2;
    const sx = (offX + el.width * 0.04) / scale, sy = (offY + el.height * 0.30) / scale;
    const sw = (el.width * 0.92) / scale, sh = (el.height * 0.30) / scale;
    const target = Math.min(1000, sw);
    const k = target / sw;
    canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
    ctx.filter = 'grayscale(1) contrast(1.6)';
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    return canvas;
  }

  function linesFromResult(data) {
    const W = canvas.width;
    return (data.lines || []).map(l => ({ text: l.text, height: (l.bbox.y1 - l.bbox.y0), edge: l.bbox.x0 < 6 || l.bbox.x1 > W - 6 }));
  }

  async function loop() {
    loopRunning = true;
    while (stream) {
      const t0 = Date.now();
      if (!state.paused && video.readyState >= 2) {
        try {
          const c = grabCrop();
          if (c) {
            const w = await getPriceWorker();
            const { data } = await w.recognize(c);
            window.__lastOcr = { text: data.text, lines: linesFromResult(data) };
            const p = P.bestPrice(linesFromResult(data).length ? linesFromResult(data) : data.text);
            recent.push(p ? p.value : null); if (recent.length > 3) recent.shift();
            const counts = {}; recent.forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; });
            const stable = Object.entries(counts).find(([v, n]) => n >= 2 || (p && p.explicit && Number(v) === p.value));
            if (stable) { shown = Number(stable[0]); shownAt = Date.now(); }
            frameNo++;
            if (LS.get('ocrText', false) && state.scans.length && frameNo % 3 === 0) matchArticle(c);
          }
        } catch (e) { console.warn('OCR', e); }
        renderOverlay();
      }
      const wait = Math.max(150, 900 - (Date.now() - t0));
      await new Promise(r => setTimeout(r, wait));
    }
    loopRunning = false;
  }

  let matched = null, matchedAt = 0;
  async function matchArticle(c) {
    try {
      const w = await getTextWorker();
      const { data } = await w.recognize(c);
      const txt = ' ' + P.normName(data.text) + ' ';
      const keys = [...new Set(state.scans.map(s => s.key))].filter(k => k.length >= 4);
      const hit = keys.find(k => txt.includes(' ' + k + ' ')) || keys.find(k => k.split(' ').filter(t => t.length >= 4).every(t => txt.includes(t)) && k.split(' ').some(t => t.length >= 4));
      if (hit) { matched = state.scans.find(s => s.key === hit); matchedAt = Date.now(); }
    } catch (e) { console.warn(e); }
  }

  function renderOverlay() {
    const ov = $('#overlay');
    if (shown && Date.now() - shownAt < 4000) {
      ov.classList.remove('hidden');
      $('#ovEur').textContent = state.eurPerHuf ? P.formatEur(hufToEur(shown)) : 'Kein Kurs';
      $('#ovHuf').textContent = P.formatHuf(shown);
      $('#ocrStatus').textContent = state.paused ? 'Pausiert' : 'Erkannt ✓';
    } else {
      ov.classList.add('hidden');
      $('#ocrStatus').textContent = state.paused ? 'Pausiert' : 'Suche Preis…';
    }
    const last = matched && Date.now() - matchedAt < 8000 ? matched : null;
    $('#ovLast').classList.toggle('hidden', !last);
    if (last) { $('#ovLast').textContent = `${last.name} · ${lastText(last)}`; ov.classList.remove('hidden'); }
  }

  $('#btnPause').addEventListener('click', () => {
    state.userPaused = !state.userPaused; state.paused = state.userPaused;
    $('#btnPause').textContent = state.paused ? '▶︎ Weiter' : '⏸ Pause';
    if (state.paused) { shownAt = Date.now() + 1e9; } else { shownAt = Date.now(); }
    renderOverlay();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stream?.getTracks().forEach(t => t.stop()); stream = null; }
    else if (LS.get('camOk', false) && $('#view-camera').classList.contains('active') && !stream) startCamera();
  });

  // ---------------- Speichern-Dialog ----------------
  const dlg = $('#saveDlg');
  function updSaveDlg() {
    const huf = parseInt($('#svHuf').value, 10);
    $('#svEur').value = huf > 0 && state.eurPerHuf ? P.formatEur(hufToEur(huf)) : '';
    const l = lastFor($('#svName').value);
    $('#svLast').textContent = l ? lastText(l) : '';
  }
  function openSave(huf) {
    $('#svHuf').value = huf || '';
    $('#svName').value = matched && Date.now() - matchedAt < 8000 ? matched.name : '';
    $('#svMarket').value = LS.get('fixedMarket', '') || state.market || '';
    updSaveDlg();
    dlg.showModal();
    if (!$('#svMarket').value) detectMarket().then(m => { if (!$('#svMarket').value) $('#svMarket').value = m; });
    setTimeout(() => $('#svName').focus(), 50);
  }
  ['input', 'change'].forEach(ev => { $('#svName').addEventListener(ev, updSaveDlg); $('#svHuf').addEventListener(ev, updSaveDlg); });
  $('#btnSave').addEventListener('click', () => openSave(shown && Date.now() - shownAt < 15000 ? shown : (shown || '')));
  $('#btnManual').addEventListener('click', () => openSave(''));
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const huf = parseInt($('#svHuf').value, 10);
    const name = $('#svName').value.trim() || 'Artikel';
    if (!(huf > 0)) { toast('Kein gültiger Preis'); return; }
    const market = $('#svMarket').value.trim();
    await DB.add({ name, key: P.normName(name), huf, eurPerHuf: state.eurPerHuf, market, ts: Date.now(), lat: state.pos?.lat, lon: state.pos?.lon, src: 'camera' });
    await loadScans();
    toast(`Gespeichert: ${name} ${P.formatHuf(huf)}`);
  });

  // ---------------- Tankstellen ----------------
  const F = window.ForintFuel;
  let fuelSeq = 0, fuelGeoTimer = null, lastNominatim = 0, routeTarget = null;

  function mapsPref() {
    const v = LS.get('mapsApp', 'apple');
    return v === 'google' ? 'google' : 'apple';
  }
  function showFuelWhere(place) {
    const el = $('#fuelWhere');
    if (!el) return;
    el.textContent = F.placeHeading(place) || '';
  }
  function saveFuelPlace(loc) {
    const place = {
      lat: loc.lat, lon: loc.lon,
      label: loc.label || '',
      town: loc.town || '',
      postcode: loc.postcode || '',
      country: loc.country || '',
      query: loc.query || '',
      ts: Date.now(),
    };
    LS.set('fuelPos', place);
    showFuelWhere(place);
    const hint = $('#fuelHint');
    if (hint) hint.classList.add('hidden');
    return place;
  }
  function showLastFuel() { showFuelWhere(LS.get('fuelPos', null)); }
  function kmText(d) { return (Math.round(d * 10) / 10).toFixed(1).replace('.', ',') + ' km'; }
  function whenText(v) { return v ? F.formatUpdatedAt(v) : ''; }
  function priceHtml(p) {
    const text = F.formatFuelPrice(p, state.eurPerHuf);
    if (!text) return '<span class="missing">Preis nicht verfügbar</span>';
    return '<b class="' + (p.stale ? 'stale' : '') + '">' + esc(text) + '</b>';
  }
  function openExternal(url) {
    // Home-Screen-PWA: ein echter target=_blank-Klick verlässt die App (Safari),
    // und Safari übergibt maps.apple.com / Google Maps an die Karten-App.
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function openRouteSheet(st) {
    routeTarget = st;
    const pref = mapsPref();
    $('#routeName').textContent = (st.name || 'Tankstelle') + (st.address ? ' · ' + st.address : '');
    $('#routeApple').classList.toggle('primary', pref === 'apple');
    $('#routeGoogle').classList.toggle('primary', pref === 'google');
    $('#routeApple').textContent = pref === 'apple' ? '🍎 Apple Karten (Standard)' : '🍎 Apple Karten';
    $('#routeGoogle').textContent = pref === 'google' ? '🗺 Google Maps (Standard)' : '🗺 Google Maps';
    $('#routeDlg').showModal();
  }
  function chooseRoute(app) {
    if (!routeTarget) return;
    LS.set('mapsApp', app === 'google' ? 'google' : 'apple');
    const url = F.mapsUrl(app, routeTarget.lat, routeTarget.lon);
    const dlg = $('#routeDlg');
    if (dlg.open) dlg.close();
    openExternal(url);
  }
  $('#routeApple').addEventListener('click', () => chooseRoute('apple'));
  $('#routeGoogle').addEventListener('click', () => chooseRoute('google'));
  $('#routeCancel').addEventListener('click', () => { if ($('#routeDlg').open) $('#routeDlg').close(); });

  async function fetchJsonSoft(url, timeoutMs = 20000, headers) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'origin', headers: Object.assign({ Accept: 'application/json' }, headers || {}) });
      const json = await r.json().catch(() => null);
      return { http: r.status, json };
    } catch (e) {
      return { http: 0, json: null, error: e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message };
    } finally { clearTimeout(to); }
  }
  async function nominatimGet(url) {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatim));
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastNominatim = Date.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal, referrerPolicy: 'origin',
        headers: { Accept: 'application/json', 'Accept-Language': 'de' },
      });
      if (r.status === 429) throw new Error('Nominatim-Limit, bitte kurz warten');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  let fuelMap = null, fuelLayer = null, fuelHere = null, fuelCardStation = null;
  function ensureFuelMap() {
    const el = $('#fuelMap');
    el.classList.remove('hidden');
    if (fuelMap || !window.L) { if (fuelMap) setTimeout(() => fuelMap.invalidateSize(), 40); return fuelMap; }
    fuelMap = L.map(el, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>',
    }).addTo(fuelMap);
    fuelMap.setView([51.2, 10.4], 6);
    setTimeout(() => fuelMap.invalidateSize(), 60);
    return fuelMap;
  }
  function renderFuelMap(loc, stations) {
    const map = ensureFuelMap();
    if (!map || !loc) return;
    if (fuelLayer) map.removeLayer(fuelLayer);
    if (fuelHere) map.removeLayer(fuelHere);
    fuelLayer = L.layerGroup().addTo(map);
    fuelHere = L.circleMarker([loc.lat, loc.lon], { radius: 8, color: '#eef5f1', weight: 2, fillColor: '#2fbf71', fillOpacity: 1 })
      .addTo(map).bindTooltip('Standort');
    const bounds = [[loc.lat, loc.lon]];
    stations.forEach((s, i) => {
      const caption = F.pinCaption(s);
      const wide = Math.min(168, Math.max(34, caption.length * 7 + 12));
      const marker = L.marker([s.lat, s.lon], {
        title: s.name,
        icon: L.divIcon({
          className: 'fuel-pin-wrap',
          html: '<div class="fuel-pin">' + (i + 1) + '</div>' + (caption ? '<div class="fuel-pin-price">' + esc(caption) + '</div>' : ''),
          iconSize: caption ? [wide, 52] : [34, 34],
          iconAnchor: caption ? [wide / 2, 17] : [17, 17],
        }),
      });
      marker.on('click', () => showFuelCard(s, i));
      marker.addTo(fuelLayer);
      bounds.push([s.lat, s.lon]);
    });
    if (stations.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    else map.setView([loc.lat, loc.lon], 13);
    setTimeout(() => { map.invalidateSize(); layoutPinLabels(); }, 80);
    if (!map._pinLayout) {
      map._pinLayout = () => layoutPinLabels();
      map.on('zoomend', map._pinLayout);
    }
  }
  function layoutPinLabels() {
    const nodes = [...document.querySelectorAll('#fuelMap .fuel-pin-price')];
    nodes.forEach(n => { n.style.transform = ''; });
    nodes.forEach((n, i) => {
      let guard = 0;
      while (guard < 5) {
        const a = n.getBoundingClientRect();
        const hit = nodes.slice(0, i).some(o => {
          const b = o.getBoundingClientRect();
          return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < (a.width + b.width) / 2 - 2
            && Math.abs((a.top + a.height / 2) - (b.top + b.height) / 2) < (a.height + b.height) / 2 + 2;
        });
        if (!hit) break;
        guard++;
        const shift = (guard % 2 ? 1 : -1) * 16 * Math.ceil(guard / 2);
        n.style.transform = 'translate(' + shift + 'px, ' + (guard % 2 ? 8 : 0) + 'px)';
      }
    });
  }
  function quoteMeta(q) {
    if (!q) return '';
    const updated = (q.petrol && q.petrol.updated) || (q.e10 && q.e10.updated) || (q.diesel && q.diesel.updated);
    const whenLabel = updated ? 'Aktualisiert: ' + whenText(updated) : '';
    if (String(q.source || '').toLowerCase().includes('nakordoni')) {
      return '<a href="https://nakordoni.eu" target="_blank" rel="noopener">Preise: nakordoni.eu</a>' + (whenLabel ? ' · ' + esc(whenLabel) : '');
    }
    return 'Quelle: ' + esc(q.source || '') + (whenLabel ? ' · ' + esc(whenLabel) : '');
  }
  function extraHtml(q) {
    if (!q || !q.extras || !q.extras.length) return '';
    return 'Weitere Sorten: ' + q.extras.map(x => esc(x.label || x.grade) + ' ' + priceHtml(x)).join(' · ');
  }
  function showFuelCard(s, index) {
    fuelCardStation = s;
    const q = s.quote;
    $('#fcName').textContent = (index + 1) + '. ' + (s.name || 'Tankstelle');
    $('#fcDist').textContent = kmText(s.d);
    $('#fcAddr').textContent = s.address || '';
    $('#fcPetrol').innerHTML = 'Benzin 95: ' + priceHtml(q && q.petrol);
    $('#fcE10').innerHTML = q && q.e10 ? 'E10: ' + priceHtml(q.e10) : '';
    $('#fcE10').classList.toggle('hidden', !(q && q.e10));
    $('#fcDiesel').innerHTML = 'Diesel: ' + priceHtml(q && q.diesel);
    $('#fcExtra').innerHTML = extraHtml(q);
    $('#fcMeta').innerHTML = quoteMeta(q);
    const pref = mapsPref();
    $('#fcRoute').textContent = pref === 'google' ? 'Route in Google Maps' : 'Route in Apple Karten';
    $('#fcAlt').textContent = pref === 'google' ? 'Stattdessen Apple Karten' : 'Stattdessen Google Maps';
    $('#fuelCard').classList.remove('hidden');
    $('#fuelList').querySelectorAll('li').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === index));
    if (fuelMap) fuelMap.panTo([s.lat, s.lon]);
  }
  function openFuelRoute(app) {
    if (!fuelCardStation) return;
    openExternal(F.mapsUrl(app, fuelCardStation.lat, fuelCardStation.lon));
  }
  $('#fcRoute').addEventListener('click', () => openFuelRoute(mapsPref()));
  $('#fcAlt').addEventListener('click', () => openFuelRoute(mapsPref() === 'google' ? 'apple' : 'google'));
  function renderFuel(stations, noteHtml) {
    $('#fuelInfo').innerHTML = noteHtml;
    $('#fuelList').innerHTML = stations.length ? stations.map((s, i) => {
      const title = esc(s.name) + (s.brand && s.name && s.brand !== s.name ? ' – ' + esc(s.brand) : '');
      const q = s.quote;
      return `<li data-i="${i}"><div class="t"><span>${i + 1}. ⛽ ${title}</span><span>${esc(kmText(s.d))}</span></div>
        <div class="m">${esc(s.address || '')}</div>
        <div class="fuelprices"><span>Benzin 95: ${priceHtml(q && q.petrol)}</span>${q && q.e10 ? `<span>E10: ${priceHtml(q.e10)}</span>` : ''}<span>Diesel: ${priceHtml(q && q.diesel)}</span></div>
        ${extraHtml(q) ? `<div class="m">${extraHtml(q)}</div>` : ''}
        ${q ? `<div class="m">${quoteMeta(q)}</div>` : ''}</li>`;
    }).join('') : '<li class="small">Keine Tankstelle im Umkreis von 10 km.</li>';
    $('#fuelList').querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => showFuelCard(stations[Number(li.dataset.i)], Number(li.dataset.i))));
  }
  function showFuelFail(loc, message) {
    $('#fuelInfo').innerHTML = esc(message) + '<br><button type="button" id="btnFuelRetry" class="secondary">Erneut versuchen</button>';
    const btn = $('#btnFuelRetry');
    if (btn) btn.addEventListener('click', () => { const seq = ++fuelSeq; loadFuelAt(loc, seq); });
    $('#fuelCard').classList.add('hidden');
    $('#fuelList').innerHTML = '';
    if (loc) renderFuelMap(loc, []);
  }
  function weeklyHtml(w) {
    if (!w) return '';
    const bit = (label, p) => {
      if (!p) return label + ': Preis nicht verfügbar';
      let s = label + ' ' + p.price.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €/l';
      if (p.local && p.local.currency === 'HUF') s += ' (ca. ' + Math.round(p.local.price) + ' Ft/l)';
      return s;
    };
    const where = w.countryName || w.country || '';
    return `Landesdurchschnitt ${esc(where)} (EU-Bulletin, Woche ${esc(String(w.week || '').slice(0, 10))}, <b>kein Kassenpreis</b>): ${esc(bit('Benzin 95', w.petrol))}, ${esc(bit('Diesel', w.diesel))}. Quelle: <a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">fuel-prices.eu</a>.`;
  }
  function keyHint(country) {
    const parts = [];
    if (!LS.get('fuelKey', '').trim() && (country === 'HU' || !country)) parts.push('Kassenpreise in Ungarn: kostenloser Schlüssel unter <a href="https://nakordoni.eu/en/developers" target="_blank" rel="noopener noreferrer">nakordoni.eu/en/developers</a> (Einstellungen).');
    if (!LS.get('tankerKey', '').trim() && (country === 'DE' || !country)) parts.push('Kassenpreise in Deutschland: kostenloser Tankerkönig-Schlüssel unter <a href="https://creativecommons.tankerkoenig.de/" target="_blank" rel="noopener noreferrer">creativecommons.tankerkoenig.de</a> (Einstellungen).');
    return parts.join(' ');
  }

  async function countryFor(loc) {
    if (loc.country && loc.town) return loc.country;
    try {
      const j = await nominatimGet(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=14&lat=${loc.lat}&lon=${loc.lon}`);
      const a = (j && j.address) || {};
      const cc = a.country_code ? String(a.country_code).toUpperCase() : '';
      const town = a.city || a.town || a.village || a.municipality || (j && j.name) || '';
      if (cc && !loc.country) loc.country = cc;
      if (town && !loc.town) loc.town = town;
      if (a.postcode && !loc.postcode) loc.postcode = String(a.postcode);
      if (town && (!loc.label || loc.label === 'Aktueller Standort')) loc.label = town;
    } catch (e) { /* Land unbekannt, Preise dann nur mit Schlüssel-Diensten */ }
    return loc.country || '';
  }

  async function fetchOverpassFuel(q, onStatus) {
    const errors = [];
    for (let i = 0; i < F.OVERPASS_FUEL.length; i++) {
      const url = F.OVERPASS_FUEL[i];
      const host = url.split('/')[2];
      if (onStatus) onStatus('Suche Tankstellen (' + (i + 1) + '/' + F.OVERPASS_FUEL.length + ', ' + host + ')…');
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch(url, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(q),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j || !Array.isArray(j.elements)) throw new Error('keine Daten');
        return j;
      } catch (e) {
        errors.push(host + ': ' + (e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message));
      } finally { clearTimeout(to); }
    }
    throw new Error(errors.join(' · '));
  }
  async function fetchNakordoni(lat, lon, key) {
    const qs = 'lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&radius_km=10&limit=5&lang=de';
    const headers = { Authorization: 'Bearer ' + key };
    const urls = [
      'https://nakordoni.eu/api/v2/data/fuel-stations?' + qs,
      'https://nakordoni.eu/api/v2/data/fuel?mode=nearest&' + qs,
    ];
    let last = { http: 0, json: null, error: 'nicht erreichbar' };
    for (let i = 0; i < urls.length; i++) {
      last = await fetchJsonSoft(urls[i], 15000, headers);
      if (last.http && last.http !== 404) break;
    }
    const parsed = F.parseNakordoniFuel(last.json || { ok: false, error: { message: last.error || ('HTTP ' + last.http) } });
    const code = last.json && last.json.error && (last.json.error.code || last.json.error.message);
    const diag = !parsed.ok
      ? 'nakordoni: HTTP ' + (last.http || 0) + (code ? ' ' + code : '')
      : parsed.stations.length
        ? 'nakordoni: HTTP ' + last.http + ', ' + parsed.stations.length + ' Stationen mit Preis'
        : 'nakordoni: HTTP ' + last.http + ', ' + (parsed.rows || 0) + ' Einträge, keine Preise';
    return { parsed, diag };
  }
  function nakoCredit(parsed) {
    const text = parsed && parsed.attribution ? parsed.attribution : 'Data by nakordoni.eu';
    const terms = parsed && parsed.terms ? parsed.terms : 'https://nakordoni.eu/en/p/developer_api_terms';
    return '<a href="https://nakordoni.eu" target="_blank" rel="noopener">' + esc(text) + '</a> · <a href="' + esc(terms) + '" target="_blank" rel="noopener">Nutzungsbedingungen</a>';
  }
  function showNakoStations(loc, seq, prefix, parsed) {
    const stations = parsed.stations.slice(0, 5).map(s => {
      if (s.d == null) s.d = distKm(loc, s);
      if (!s.quote) s.quote = { source: 'nakordoni.eu', petrol: s.petrol, e10: s.e10, diesel: s.diesel, extras: s.extras };
      return s;
    });
    if (!loc.country && stations[0] && stations[0].country) loc.country = stations[0].country;
    saveFuelPlace(loc);
    renderFuelMap(loc, stations);
    renderFuel(stations, stations.length + ' Tankstellen mit Preisen. ' + nakoCredit(parsed));
  }
  async function loadFuelAt(loc, seq, prefix) {
    const info = $('#fuelInfo');
    try {
      $('#fuelCard').classList.add('hidden');
      renderFuelMap(loc, []);
      const lat = Number(loc.lat).toFixed(6), lon = Number(loc.lon).toFixed(6);
      const nako = LS.get('fuelKey', '').trim();
      let nakoInfo = '';
      if (nako) {
        if (seq === fuelSeq) info.textContent = (prefix || '') + 'Lade Spritpreise (nakordoni)…';
        const res = await fetchNakordoni(lat, lon, nako);
        if (seq !== fuelSeq) return;
        if (res.parsed.ok && res.parsed.stations.length) {
          showNakoStations(loc, seq, prefix, res.parsed);
          return;
        }
        nakoInfo = res.diag || 'nakordoni ohne Stationen';
        info.textContent = (prefix || '') + nakoInfo + ' – OpenStreetMap als Ersatz…';
      }
      const countryP = countryFor(loc);
      let elements = null;
      try {
        const j = await fetchOverpassFuel(F.overpassFuelQuery(loc.lat, loc.lon), (msg) => { if (seq === fuelSeq) info.textContent = (prefix || '') + msg; });
        elements = j.elements || [];
      } catch (e) {
        if (seq !== fuelSeq) return;
        showFuelFail(loc, (prefix || '') + 'Tankstellen nicht geladen. ' + e.message);
        return;
      }
      if (seq !== fuelSeq) return;
      let stations = F.nearestFuelStations(elements, loc, 10, 5).map(s => ({ ...s, quote: null }));
      saveFuelPlace(loc);
      renderFuelMap(loc, stations);
      renderFuel(stations, stations.length + ' nächste Tankstellen im Umkreis von 10 km. Preise werden geladen…');
      const country = await countryP;
      if (seq !== fuelSeq) return;
      if (country && !loc.country) loc.country = country;
      saveFuelPlace(loc);
      const quotes = [];
      const warnings = [];
      const jobs = [];
      const tanker = LS.get('tankerKey', '').trim();
      const watch = (p) => p.catch(e => warnings.push(e.message || 'Preisquelle fehlgeschlagen'));
      if (tanker && (!country || country === 'DE')) jobs.push(watch(fetchJsonSoft('https://creativecommons.tankerkoenig.de/json/list.php?lat=' + lat + '&lng=' + lon + '&rad=10&sort=dist&type=all&apikey=' + encodeURIComponent(tanker)).then(r => {
        const parsed = F.parseTankerkoenig(r.json || { ok: false, message: r.error || ('HTTP ' + r.http) });
        if (!parsed.ok) warnings.push('Tankerkönig: HTTP ' + (r.http || 0) + ' ' + parsed.error);
        else { if (parsed.warning) warnings.push('Tankerkönig: ' + parsed.warning); quotes.push(...parsed.stations); }
      })));
      if (country && F.LIVE_STATION_COUNTRIES.includes(country)) jobs.push(watch(fetchJsonSoft('https://www.fuel-prices.eu/live/api.php?action=stations&country=' + country + '&lat=' + lat + '&lng=' + lon + '&radius=10&limit=20').then(r => {
        const parsed = F.parseFuelPricesStations(r.json || { ok: false, error: r.error || ('HTTP ' + r.http) }, Date.now());
        if (parsed.ok) quotes.push(...parsed.stations);
      })));
      let weekly = null;
      const slug = F.WEEKLY_SLUG[country];
      if (slug) jobs.push(watch(fetchJsonSoft('https://www.fuel-prices.eu/' + slug + '/?format=json').then(r => { weekly = F.parseWeeklyAverage(r.json); })));
      await Promise.all(jobs);
      if (seq !== fuelSeq) return;
      const matched = F.matchPrices(stations, quotes, 0.35);
      LS.set('fuelCache', { v: 2, ts: Date.now(), loc, stations: matched });
      const priced = matched.filter(s => s.quote).length;
      const bits = [matched.length + ' nächste Tankstellen im Umkreis von 10 km.'];
      if (priced) bits.push(priced + ' mit Kassenpreis.');
      else bits.push('Kein Kassenpreis zugeordnet.');
      if (nakoInfo) bits.push(nakoInfo);
      if (warnings.length) bits.push(warnings.join(' '));
      renderFuelMap(loc, matched);
      renderFuel(matched, bits.map(esc).join(' ') + (keyHint(country) ? ' ' + keyHint(country) : '') + (weeklyHtml(weekly) ? '<br>' + weeklyHtml(weekly) : ''));
    } catch (e) {
      if (seq !== fuelSeq) return;
      showFuelFail(loc, e.message || 'Suche fehlgeschlagen');
    }
  }

  function savedFuelPlace() {
    const saved = LS.get('fuelPos', null);
    return saved && Number.isFinite(Number(saved.lat)) && Number.isFinite(Number(saved.lon)) ? saved : null;
  }
  function openFuelTab() {
    const saved = savedFuelPlace();
    $('#fuelSuggest').innerHTML = '';
    if (saved) {
      showFuelWhere(saved);
      const field = $('#fuelPlace');
      if (field) field.value = F.shortPlace(saved) || saved.query || '';
      const hint = $('#fuelHint');
      if (hint) hint.classList.add('hidden');
      loadFuelAt(saved, ++fuelSeq);
      return;
    }
    showFuelWhere(null);
    useDeviceLocation(false);
  }
  function useDeviceLocation(fromButton) {
    const seq = ++fuelSeq;
    const hadPlace = !!savedFuelPlace();
    $('#fuelSuggest').innerHTML = '';
    if (!hadPlace) $('#fuelInfo').textContent = 'Standort wird ermittelt…';
    // getCurrentPosition noch im Klick (vor dem ersten await) anstoßen, sonst zeigt iOS keinen Dialog.
    const posP = Promise.race([
      getPos({ timeout: 12000, maximumAge: fromButton ? 0 : 300000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Standort-Zeitüberschreitung')), 13500)),
    ]);
    posP.then(async (pos) => {
      if (seq !== fuelSeq) return;
      const loc = { lat: pos.lat, lon: pos.lon, label: '' };
      await countryFor(loc);
      if (seq !== fuelSeq) return;
      saveFuelPlace(loc);
      await loadFuelAt(loc, seq);
    }).catch(() => {
      if (seq !== fuelSeq) return;
      if (hadPlace) return;
      $('#fuelInfo').textContent = '';
      $('#fuelList').innerHTML = '';
      $('#fuelCard').classList.add('hidden');
      const hint = $('#fuelHint');
      if (hint) {
        hint.textContent = 'Ort oder PLZ eingeben – die App merkt sich den Ort.';
        hint.classList.remove('hidden');
      }
    });
  }
  async function geocodeFuel(query) {
    const bias = LS.get('fuelPos', null);
    const tiers = [
      { countrycodes: F.GEO_PRIMARY, bias },
      { countrycodes: F.GEO_FALLBACK, bias },
      { bias },
    ];
    for (let i = 0; i < tiers.length; i++) {
      const arr = await nominatimGet(F.nominatimSearchUrl(query, tiers[i]));
      const places = F.parseNominatimSearch(arr);
      if (places.length) return places;
    }
    return [];
  }
  async function searchFuelPlace(q, autoPick) {
    const query = (q != null ? q : $('#fuelPlace').value).trim();
    if (query.length < 2) { $('#fuelSuggest').innerHTML = ''; return; }
    const seq = ++fuelSeq;
    $('#fuelInfo').textContent = 'Ort wird gesucht…';
    try {
      const places = await geocodeFuel(query);
      if (seq !== fuelSeq) return;
      if (!places.length) {
        $('#fuelSuggest').innerHTML = '<li class="small">Kein Ort gefunden.</li>';
        $('#fuelInfo').textContent = 'Kein Ort gefunden. Andere Schreibweise versuchen.';
        return;
      }
      const use = (p) => {
        $('#fuelSuggest').innerHTML = '';
        const loc = {
          lat: p.lat, lon: p.lon, label: p.label || '', country: p.country || '',
          town: p.town || '', postcode: p.postcode || '', query,
        };
        saveFuelPlace(loc);
        $('#fuelPlace').value = F.shortPlace(loc) || query;
        loadFuelAt(loc, ++fuelSeq);
      };
      const best = F.bestPlace(places, LS.get('fuelPos', null));
      if (autoPick || places.length === 1) { use(best); return; }
      const ordered = [best].concat(places.filter(p => p !== best));
      $('#fuelSuggest').innerHTML = ordered.map((p, i) => `<li data-i="${i}">${esc(F.shortPlace(p) || p.label)}</li>`).join('');
      $('#fuelSuggest').querySelectorAll('li').forEach(li => li.addEventListener('click', () => use(ordered[Number(li.dataset.i)])));
      $('#fuelInfo').textContent = 'Mehrere Treffer – einen antippen oder Suchen für den besten Treffer.';
    } catch (e) {
      if (seq !== fuelSeq) return;
      $('#fuelInfo').innerHTML = esc(e.message || 'Ortssuche fehlgeschlagen') + '<br><button type="button" id="btnFuelRetry" class="secondary">Erneut versuchen</button>';
      const btn = $('#btnFuelRetry');
      if (btn) btn.addEventListener('click', () => searchFuelPlace(query, true));
    }
  }
  $('#btnFuel').addEventListener('click', () => useDeviceLocation(true));
  $('#btnFuelSearch').addEventListener('click', () => searchFuelPlace(null, true));
  $('#fuelPlace').addEventListener('input', () => {
    clearTimeout(fuelGeoTimer);
    const q = $('#fuelPlace').value.trim();
    if (q.length < 2) { $('#fuelSuggest').innerHTML = ''; return; }
    fuelGeoTimer = setTimeout(() => searchFuelPlace(q), 800);
  });
  $('#fuelPlace').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(fuelGeoTimer); searchFuelPlace(null, true); }
  });
  showLastFuel();

  // ---------------- Kassenbon ----------------
  async function prepReceiptImage(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const maxW = 1600, k = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const cx = c.getContext('2d'); cx.filter = 'grayscale(1) contrast(1.4)'; cx.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  async function handleReceipt(file) {
    if (!file) return;
    const st = $('#receiptStatus');
    $('#receiptImg').src = URL.createObjectURL(file); $('#receiptImg').classList.remove('hidden');
    $('#receiptForm').classList.add('hidden');
    st.textContent = 'Texterkennung läuft (ungarisch)… das kann 10–30 Sekunden dauern.';
    try {
      const c = await prepReceiptImage(file);
      const w = await getTextWorker();
      await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
      const { data } = await w.recognize(c);
      await w.setParameters({ tessedit_pageseg_mode: '3' });
      const r = P.parseReceipt(data.text);
      $('#rcRaw').textContent = data.text;
      const fixed = LS.get('fixedMarket', '');
      $('#rcMarket').value = fixed || r.market || state.market || '';
      if (!$('#rcMarket').value) detectMarket().then(m => { if (!$('#rcMarket').value) $('#rcMarket').value = m; });
      const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      $('#rcDate').value = d.toISOString().slice(0, 16);
      $('#rcTable tbody').innerHTML = '';
      r.items.forEach(it => addRcRow(it.name, it.huf));
      if (!r.items.length) addRcRow('', '');
      const sum = r.items.reduce((a, b) => a + b.huf, 0);
      $('#rcTotal').textContent = `${r.items.length} Positionen erkannt, Summe ${P.formatHuf(sum)}` + (r.total ? ` · Bon-Summe laut Beleg ${P.formatHuf(r.total)} (${P.formatEur(hufToEur(r.total))})` : '') + '. Bitte prüfen und korrigieren.';
      $('#receiptForm').classList.remove('hidden');
      st.textContent = '';
    } catch (e) { st.textContent = 'Fehler bei der Texterkennung: ' + e.message; }
  }
  function addRcRow(name, huf) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" checked></td><td><input class="n" list="articleList"></td><td><input class="h" type="number" inputmode="numeric"></td><td class="e"></td>`;
    tr.querySelector('.n').value = name; tr.querySelector('.h').value = huf;
    const upd = () => { const v = parseInt(tr.querySelector('.h').value, 10); tr.querySelector('.e').textContent = v > 0 ? P.formatEur(hufToEur(v)) : ''; };
    tr.querySelector('.h').addEventListener('input', upd); upd();
    $('#rcTable tbody').appendChild(tr);
  }
  $('#rcAdd').addEventListener('click', () => addRcRow('', ''));
  $('#receiptCam').addEventListener('change', e => handleReceipt(e.target.files[0]));
  $('#receiptFile').addEventListener('change', e => handleReceipt(e.target.files[0]));
  $('#rcSave').addEventListener('click', async () => {
    const market = $('#rcMarket').value.trim();
    const ts = $('#rcDate').value ? new Date($('#rcDate').value).getTime() : Date.now();
    const recs = [...$('#rcTable tbody').querySelectorAll('tr')].filter(tr => tr.querySelector('input[type=checkbox]').checked)
      .map(tr => ({ name: tr.querySelector('.n').value.trim(), huf: parseInt(tr.querySelector('.h').value, 10) }))
      .filter(r => r.name && r.huf > 0)
      .map((r, i) => ({ ...r, key: P.normName(r.name), eurPerHuf: state.eurPerHuf, market, ts: ts + i, src: 'receipt' }));
    if (!recs.length) { toast('Nichts zum Speichern ausgewählt'); return; }
    await DB.addMany(recs); await loadScans();
    toast(`${recs.length} Preise gespeichert`);
    $('#receiptForm').classList.add('hidden'); $('#receiptImg').classList.add('hidden');
    $('#receiptCam').value = ''; $('#receiptFile').value = '';
  });

  // ---------------- Einstellungen ----------------
  const setDlg = $('#setDlg');
  $('#btnSettings').addEventListener('click', () => {
    $('#setMarket').value = LS.get('fixedMarket', '');
    $('#setRate').value = LS.get('manualRate', '');
    $('#setFuelKey').value = LS.get('fuelKey', '');
    $('#setTankerKey').value = LS.get('tankerKey', '');
    $('#setMapsApp').value = mapsPref();
    $('#setOcrText').checked = LS.get('ocrText', false);
    setDlg.showModal();
  });
  setDlg.addEventListener('close', () => {
    LS.set('fixedMarket', $('#setMarket').value.trim());
    LS.set('manualRate', $('#setRate').value.trim());
    LS.set('fuelKey', $('#setFuelKey').value.trim());
    LS.set('tankerKey', $('#setTankerKey').value.trim());
    LS.set('mapsApp', $('#setMapsApp').value === 'google' ? 'google' : 'apple');
    LS.set('ocrText', $('#setOcrText').checked);
    renderRate(); refreshEurs(); detectMarket(true);
    if ($('#view-fuel').classList.contains('active')) {
      const saved = LS.get('fuelPos', null);
      if (saved && Number.isFinite(saved.lat)) { const seq = ++fuelSeq; loadFuelAt(saved, seq); }
    }
  });
  $('#btnWipe').addEventListener('click', async () => {
    if (!confirm('Wirklich den gesamten Preisverlauf löschen?')) return;
    await DB.clear(); await loadScans(); setDlg.close(); toast('Verlauf gelöscht');
  });

  // ---------------- Einrichtungs-Link ----------------
  function isStandaloneApp() {
    return window.ForintSetup.isStandalone(navigator, (q) => window.matchMedia(q));
  }
  function importSetupFromHash() {
    const parsed = window.ForintSetup.parseHash(location.hash);
    if (!parsed) return;
    if (parsed.nak) LS.set('fuelKey', parsed.nak);
    if (parsed.tk) LS.set('tankerKey', parsed.tk);
    if (parsed.map) LS.set('mapsApp', parsed.map);
    if (isStandaloneApp()) {
      history.replaceState(null, '', location.pathname + location.search);
      toast('Schlüssel gespeichert – Tankpreise sind jetzt aktiv.', 4500);
    } else {
      toast('Schlüssel gespeichert – Tankpreise sind jetzt aktiv.', 4500);
      const hint = $('#setupHint');
      if (hint) hint.classList.remove('hidden');
    }
  }
  $('#btnSetupLink').addEventListener('click', async (ev) => {
    ev.preventDefault();
    const nak = $('#setFuelKey').value.trim();
    const tk = $('#setTankerKey').value.trim();
    const map = $('#setMapsApp').value === 'google' ? 'google' : ($('#setMapsApp').value === 'apple' ? 'apple' : '');
    if (!nak && !tk) { toast('Zuerst einen Schlüssel eintragen.'); return; }
    const url = window.ForintSetup.buildLink(new URL('./', location.href).href, { nak, tk, map });
    try {
      if (navigator.share) await navigator.share({ title: 'Forint-Scanner', text: 'Einrichtung der Tankpreise', url });
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        toast('Link kopiert');
      } else toast('Teilen nicht möglich');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        toast('Link kopiert');
      } catch (e2) { toast('Teilen nicht möglich'); }
    }
  });

  // ---------------- Start ----------------
  importSetupFromHash();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  window.addEventListener('online', loadRate);
  loadRate();
  loadScans();
  if (LS.get('camOk', false)) startCamera();
  window.__app = { state, P };
})();
