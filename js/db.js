/* Minimaler IndexedDB-Speicher für Scans */
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('forint-scanner', 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
        s.createIndex('key', 'key');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('scans', mode);
      const out = fn(t.objectStore('scans'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    add: (rec) => tx('readwrite', s => s.add(rec)),
    addMany: (recs) => tx('readwrite', s => { recs.forEach(r => s.add(r)); }),
    del: (id) => tx('readwrite', s => s.delete(id)),
    clear: () => tx('readwrite', s => s.clear()),
    all: () => tx('readonly', s => s.getAll()).then(a => a.sort((x, y) => y.ts - x.ts)),
  };
})();
