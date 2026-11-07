/* Reine Regeln für gespeicherte Kassenbons: Löschen betrifft nur einen Beleg. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForintReceipts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function applyDelete(receipts, scans, id, confirmed) {
    const list = receipts || [];
    const rows = scans || [];
    if (!confirmed) return { deleted: false, receipts: list.slice(), scans: rows.slice() };
    const rid = Number(id);
    return {
      deleted: true,
      receipts: list.filter(r => Number(r.id) !== rid),
      scans: rows.filter(s => Number(s.receiptId) !== rid),
    };
  }

  return { applyDelete };
});
