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
        e => rej(new Error(e.code === 1 ? 'Standortfreigabe verweigert' : 'Standort nicht ermittelbar')),
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
  $('#btnFuel').addEventListener('click', loadFuel);
  function routeLinks(lat, lon, label) {
    const q = encodeURIComponent(label || 'Tankstelle');
    return `<a href="https://maps.apple.com/?daddr=${lat},${lon}&q=${q}&dirflg=d" target="_blank" rel="noopener">🍎 Apple Karten</a>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">🗺 Google Maps</a>`;
  }
  async function loadFuel() {
    const info = $('#fuelInfo'), list = $('#fuelList');
    info.textContent = 'Standort wird ermittelt…'; list.innerHTML = '';
    let pos;
    try { pos = await getPos({ maximumAge: 30000 }); } catch (e) { info.textContent = e.message + '. Bitte Standortfreigabe erlauben (iOS: Einstellungen › Datenschutz › Ortungsdienste › Safari-Websites).'; return; }
    const key = LS.get('fuelKey', '').trim();
    if (key) {
      info.textContent = 'Lade Spritpreise…';
      try {
        const j = await fetchJson(`https://nakordoni.eu/api/v2/data/fuel?mode=nearest&lat=${pos.lat}&lon=${pos.lon}&radius_km=10&limit=40&lang=de&key=${encodeURIComponent(key)}`);
        const sts = (j.data && (j.data.stations || j.data.data)) || [];
        if (sts.length) { renderFuelPriced(sts, pos); return; }
        info.textContent = 'Keine Preisdaten im Umkreis – zeige Tankstellen ohne Preise.';
      } catch (e) { info.textContent = 'Spritpreis-Dienst nicht erreichbar (' + e.message + ') – zeige Tankstellen ohne Preise.'; }
    } else info.textContent = 'Suche Tankstellen…';
    try {
      const j = await overpass(`[out:json][timeout:25];nwr(around:10000,${pos.lat},${pos.lon})[amenity=fuel];out center tags;`);
      const st = (j.elements || []).map(e => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).filter(s => s.lat)
        .map(s => ({ ...s, d: distKm(pos, s) })).sort((a, b) => a.d - b.d);
      LS.set('fuelCache', { ts: Date.now(), pos, st });
      renderFuelOsm(st, pos, key);
    } catch (e) {
      const c = LS.get('fuelCache', null);
      if (c) { renderFuelOsm(c.st, c.pos, key); info.textContent += ` (Offline: gespeicherte Liste vom ${fmtDate(c.ts)})`; }
      else {
        info.innerHTML = esc('Tankstellen konnten nicht geladen werden: ' + e.message) + '. Alternativ:';
        $('#fuelList').innerHTML = `<li><div class="acts">
          <a href="https://maps.apple.com/?q=Tankstelle&sll=${pos.lat},${pos.lon}&z=12" target="_blank" rel="noopener">🍎 Tankstellen in Apple Karten</a>
          <a href="https://www.google.com/maps/search/benzinkút/@${pos.lat},${pos.lon},12z" target="_blank" rel="noopener">🗺 Tankstellen in Google Maps</a>
          <a href="https://holtankoljak.hu/" target="_blank" rel="noopener">💶 Preise: holtankoljak.hu</a></div></li>`;
      }
    }
  }
  function renderFuelOsm(st, pos, key) {
    const info = $('#fuelInfo');
    info.innerHTML = `${st.length} Tankstellen im Umkreis von 10 km (Quelle: OpenStreetMap). ` +
      (key ? '' : 'Aktuelle Preise: <a href="https://holtankoljak.hu/" target="_blank" rel="noopener">holtankoljak.hu</a> · für Preise direkt in der App kostenlosen Schlüssel in ⚙︎ eintragen.');
    $('#fuelList').innerHTML = st.slice(0, 40).map(s => {
      const name = s.t.brand || s.t.name || s.t.operator || 'Tankstelle';
      const addr = [s.t['addr:street'] && (s.t['addr:street'] + ' ' + (s.t['addr:housenumber'] || '')), s.t['addr:city']].filter(Boolean).join(', ');
      const fuels = [s.t['fuel:diesel'] === 'yes' && 'Diesel', (s.t['fuel:octane_95'] === 'yes') && 'Benzin 95', s.t['fuel:lpg'] === 'yes' && 'LPG'].filter(Boolean).join(' · ');
      return `<li><div class="t"><span>⛽ ${esc(name)}${s.t.name && s.t.brand && s.t.name !== s.t.brand ? ' – ' + esc(s.t.name) : ''}</span><span>${s.d.toFixed(1).replace('.', ',')} km</span></div>
        <div class="m">${esc(addr)}${fuels ? ' · ' + esc(fuels) : ''}${s.t.opening_hours ? ' · ' + esc(s.t.opening_hours) : ''}</div>
        <div class="acts">${routeLinks(s.lat, s.lon, name)}</div></li>`;
    }).join('') || '<li class="small">Keine Tankstellen gefunden.</li>';
  }
  function renderFuelPriced(sts, pos) {
    const rows = sts.map(s => {
      const lat = parseFloat(s.lat ?? s.latitude ?? s.location?.lat), lon = parseFloat(s.lon ?? s.lng ?? s.longitude ?? s.location?.lon ?? s.location?.lng);
      const d = s.distance_km ?? (lat ? distKm(pos, { lat, lon }) : null);
      const pr = s.prices || {};
      const pick = (...ks) => { for (const k of ks) if (pr[k] && pr[k].price) return pr[k]; return null; };
      return { s, lat, lon, d, diesel: pick('diesel'), petrol: pick('petrol', 'e5', 'petrol95plus', 'e10') };
    }).sort((a, b) => (a.d ?? 99) - (b.d ?? 99));
    const fp = (p) => p ? `<b>${esc(Math.round(p.price))} ${esc(p.currency === 'HUF' || !p.currency ? 'Ft' : p.currency)}/l</b>${p.stale ? ' (alt)' : ''}` : '–';
    const cheapest = (k) => rows.filter(r => r[k]).sort((a, b) => a[k].price - b[k].price)[0];
    const cd = cheapest('diesel'), cp = cheapest('petrol');
    $('#fuelInfo').innerHTML = `${rows.length} Tankstellen mit Preisen (Quelle: nakordoni.eu). ` +
      (cp ? `Günstigstes Benzin: ${esc(cp.s.name || cp.s.brand || '')} ${fp(cp.petrol)}. ` : '') + (cd ? `Günstigster Diesel: ${esc(cd.s.name || cd.s.brand || '')} ${fp(cd.diesel)}.` : '');
    $('#fuelList').innerHTML = rows.map(r => {
      const name = [r.s.brand, r.s.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ') || 'Tankstelle';
      const eur = (p) => p && state.eurPerHuf && (!p.currency || p.currency === 'HUF') ? ` (${P.formatEur(p.price * state.eurPerHuf)})` : '';
      return `<li><div class="t"><span>⛽ ${esc(name)}</span><span>${r.d != null ? Number(r.d).toFixed(1).replace('.', ',') + ' km' : ''}</span></div>
        <div class="m">${esc(r.s.address || r.s.city || '')}</div>
        <div class="fuelprices"><span>Benzin 95: ${fp(r.petrol)}${esc(eur(r.petrol))}</span><span>Diesel: ${fp(r.diesel)}${esc(eur(r.diesel))}</span></div>
        <div class="acts">${r.lat ? routeLinks(r.lat, r.lon, name) : ''}</div></li>`;
    }).join('');
  }

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
    $('#setOcrText').checked = LS.get('ocrText', false);
    setDlg.showModal();
  });
  setDlg.addEventListener('close', () => {
    LS.set('fixedMarket', $('#setMarket').value.trim());
    LS.set('manualRate', $('#setRate').value.trim());
    LS.set('fuelKey', $('#setFuelKey').value.trim());
    LS.set('ocrText', $('#setOcrText').checked);
    renderRate(); refreshEurs(); detectMarket(true);
  });
  $('#btnWipe').addEventListener('click', async () => {
    if (!confirm('Wirklich den gesamten Preisverlauf löschen?')) return;
    await DB.clear(); await loadScans(); setDlg.close(); toast('Verlauf gelöscht');
  });

  // ---------------- Start ----------------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  window.addEventListener('online', loadRate);
  loadRate();
  loadScans();
  if (LS.get('camOk', false)) startCamera();
  window.__app = { state, P };
})();
