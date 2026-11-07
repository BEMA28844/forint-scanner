/* IndexedDB: Preis-Scans und komplette Kassenbons. Bestehende Scans bleiben erhalten. */
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('forint-scanner', 2);
      r.onupgradeneeded = (e) => {
        const db = r.result;
        const tx = e.target.transaction;
        if (!db.objectStoreNames.contains('scans')) {
          const s = db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
          s.createIndex('ts', 'ts');
          s.createIndex('key', 'key');
          s.createIndex('receiptId', 'receiptId');
        } else if (!tx.objectStore('scans').indexNames.contains('receiptId')) {
          tx.objectStore('scans').createIndex('receiptId', 'receiptId');
        }
        if (!db.objectStoreNames.contains('receipts')) {
          const rec = db.createObjectStore('receipts', { keyPath: 'id', autoIncrement: true });
          rec.createIndex('ts', 'ts');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction('scans', mode);
      const out = fn(t.objectStore('scans'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    }));
  }
  return {
    add: (rec) => tx('readwrite', s => s.add(rec)),
    addMany: (recs) => tx('readwrite', s => { recs.forEach(r => s.add(r)); }),
    del: (id) => tx('readwrite', s => s.delete(id)),
    clear: () => open().then(db => new Promise((res, rej) => {
      const names = ['scans'].concat(db.objectStoreNames.contains('receipts') ? ['receipts'] : []);
      const t = db.transaction(names, 'readwrite');
      names.forEach(n => t.objectStore(n).clear());
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    })),
    all: () => tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.ts - x.ts)),
    receipts: () => open().then(db => new Promise((res, rej) => {
      if (!db.objectStoreNames.contains('receipts')) { res([]); return; }
      const t = db.transaction('receipts', 'readonly');
      const out = t.objectStore('receipts').getAll();
      t.oncomplete = () => res((out.result || []).sort((a, b) => b.ts - a.ts));
      t.onerror = () => rej(t.error);
    })),
    saveReceipt: (rec) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction(['receipts', 'scans'], 'readwrite');
      const req = t.objectStore('receipts').add({
        market: rec.market || '', ts: rec.ts || Date.now(), total: rec.total || 0,
        items: rec.items || [],
      });
      req.onsuccess = () => {
        const id = req.result;
        (rec.items || []).forEach((item, i) => t.objectStore('scans').add({
          name: item.name, key: item.key, huf: item.huf, eurPerHuf: item.eurPerHuf,
          market: rec.market || '', ts: (rec.ts || Date.now()) + i, src: 'receipt',
          receiptId: id, hu: item.hu || '',
        }));
        t._id = id;
      };
      t.oncomplete = () => res(t._id);
      t.onerror = () => rej(t.error);
    })),
    deleteReceipt: (id) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction(['receipts', 'scans'], 'readwrite');
      t.objectStore('receipts').delete(Number(id));
      const idx = t.objectStore('scans').index('receiptId');
      const req = idx.getAll(Number(id));
      req.onsuccess = () => (req.result || []).forEach(s => t.objectStore('scans').delete(s.id));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    })),
  };
})();
