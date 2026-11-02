/* Einrichtungs-Link: Schlüssel nur im URL-Fragment, nie in der Query (die würde der Server sehen). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForintSetup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseHash(hash) {
    const raw = String(hash || '').replace(/^#/, '').trim();
    if (!raw || raw.indexOf('nak=') === -1 && raw.indexOf('tk=') === -1 && raw.indexOf('map=') === -1) return null;
    const params = new URLSearchParams(raw);
    const nak = (params.get('nak') || '').trim();
    const tk = (params.get('tk') || '').trim();
    const mapRaw = (params.get('map') || '').trim().toLowerCase();
    const map = mapRaw === 'google' || mapRaw === 'apple' ? mapRaw : '';
    if (!nak && !tk && !map) return null;
    const out = {};
    if (nak) out.nak = nak;
    if (tk) out.tk = tk;
    if (map) out.map = map;
    return out;
  }

  function buildLink(pageUrl, values) {
    const base = String(pageUrl || '').split('#')[0].split('?')[0];
    const params = new URLSearchParams();
    const v = values || {};
    if (v.nak) params.set('nak', v.nak);
    if (v.tk) params.set('tk', v.tk);
    if (v.map === 'google' || v.map === 'apple') params.set('map', v.map);
    const fragment = params.toString();
    return fragment ? base + '#' + fragment : base;
  }

  function isStandalone(nav, matchMediaFn) {
    if (nav && nav.standalone === true) return true;
    if (typeof matchMediaFn !== 'function') return false;
    try {
      return matchMediaFn('(display-mode: standalone)').matches || matchMediaFn('(display-mode: fullscreen)').matches;
    } catch (e) { return false; }
  }

  return { parseHash, buildLink, isStandalone };
});
