# Forint → Euro Scanner (PWA, v1)

Statische Web-App ohne Backend. Alle Daten bleiben lokal (IndexedDB/localStorage).

- `index.html`, `css/`, `js/app.js` (Logik), `js/parse.js` (Preis-/Bon-Parser), `js/fuel.js` (Tankstellen/Preise), `js/db.js`
- `vendor/leaflet/` Karte im Tanken-Tab (lokal, OSM-Kacheln)
- `sw.js` Service Worker (offline, cache-first). **Bei jeder Änderung `VERSION` in sw.js erhöhen**, sonst sieht das iPhone die alte Version.
- `vendor/tesseract/` Tesseract.js 5.1.1 + Sprachdaten eng/hun (lokal, ~13 MB, werden beim ersten Start gecacht)
- Tests: `node test/parse.test.js` und `node test/fuel.test.js`

Datenquellen (kostenlos, ohne Schlüssel): Frankfurter API (EZB-Referenzkurs), Fallback open.er-api.com,
OpenStreetMap Overpass (Tankstellen, Märkte), Nominatim (Adresse und Ortssuche).
Spritpreise je Tankstelle: Tankerkönig (Deutschland, kostenloser Schlüssel auf https://creativecommons.tankerkoenig.de/),
nakordoni.eu Explorer (u. a. Ungarn, kostenlos auf https://nakordoni.eu/en/developers),
fuel-prices.eu wo echte Kassenpreise ohne Schlüssel liegen (nicht Ungarn, nicht Deutschland).
Landesdurchschnitt (kein Kassenpreis): EU Weekly Oil Bulletin über fuel-prices.eu.

Kamera braucht https → z. B. GitHub Pages hosten, dann in Safari öffnen › Teilen › „Zum Home-Bildschirm“.
