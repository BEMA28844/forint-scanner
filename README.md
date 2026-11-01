# Forint → Euro Scanner (PWA, v1)

Statische Web-App ohne Backend. Alle Daten bleiben lokal (IndexedDB/localStorage).

- `index.html`, `css/`, `js/app.js` (Logik), `js/parse.js` (Preis-/Bon-Parser), `js/db.js`
- `sw.js` Service Worker (offline, cache-first). **Bei jeder Änderung `VERSION` in sw.js erhöhen**, sonst sieht das iPhone die alte Version.
- `vendor/tesseract/` Tesseract.js 5.1.1 + Sprachdaten eng/hun (lokal, ~13 MB, werden beim ersten Start gecacht)
- Tests: `node test/parse.test.js`

Datenquellen (kostenlos, ohne Schlüssel): Frankfurter API (EZB-Referenzkurs), Fallback open.er-api.com,
OpenStreetMap Overpass (Tankstellen, Märkte), Nominatim (Adresse). Optional: nakordoni.eu Explorer-Schlüssel (kostenlos) für Spritpreise.

Kamera braucht https → z. B. GitHub Pages hosten, dann in Safari öffnen › Teilen › „Zum Home-Bildschirm“.
