# WiGLE WiFi Map

Statische Weboberfläche zum Importieren einer **WiGLE WiFi Android**-Backup-
SQLite-Datenbank (`network`/`location`-Schema), Darstellung der gefundenen
Netze auf einer OpenStreetMap-Karte, tabellarischer Auflistung mit Filtern
und einer groben **Positionsschätzung (Triangulation) pro SSID/BSSID**.

Die App läuft **komplett im Browser** (SQLite wird per `sql.js`/WebAssembly
direkt clientseitig geparst) und ist daher als reine statische Seite über
**GitHub Pages** hostbar – die hochgeladene Datenbank verlässt nie den
Rechner der Nutzerin/des Nutzers.

## Features

- **Upload** einer `.sqlite`/`.db`-Datei direkt im Browser (per `sql.js`,
  kein Server, kein Datenversand)
- **Karte** (Leaflet + OpenStreetMap-Tiles) mit Marker-Clustering für alle
  Netze, Farbe nach Signalstärke
- Karte **zoomt automatisch** auf den Bereich der geladenen Daten
- **Heatmap-Layer** als Alternative zu Einzelpunkten (Dichte/Signalstärke
  aller Messungen)
- **Zeitschieberegler**: Messzeitraum eingrenzen – Tabelle, Karte und
  Heatmap aktualisieren sich live auf das gewählte Zeitfenster
- **Tabelle** aller Netze: SSID, Verschlüsselung, Frequenzband, Anzahl
  Messpunkte, bestes Signal – sortierbar per Klick auf die Spaltenköpfe
- **Filter**: SSID-Text, Verschlüsselungsart (Offen/WEP/WPA/WPA2/WPA3),
  Frequenzband (2.4/5/6 GHz), Mindestanzahl an Messpunkten, Zeitraum
- Klick auf ein Netz zeigt Details + alle Einzelmesspunkte auf der Karte
- **Mobile-taugliches Layout**: einklappbare Seitenleiste per Menü-Button,
  angepasste Bedienelemente für schmale Bildschirme
- **Triangulation** je Netz:
  - 1 Punkt → Position = dieser Punkt
  - mehrere Punkte ohne räumliche Streuung → signalgewichteter Mittelpunkt
  - ≥3 Punkte mit ausreichender Streuung → Multilateration (Gauss-Newton
    Least-Squares) auf Basis von aus RSSI geschätzten Entfernungen
    (Log-Distance-Path-Loss-Modell), inkl. geschätztem Genauigkeitsradius
  - **ab ≥4 räumlich verteilten Messpunkten läuft die Triangulation
    automatisch** beim Auswählen eines Netzes (siehe Begründung unten),
    darunter bleibt sie ein manueller Button-Klick

  **Hinweis:** WLAN-Signalstärke ist keine exakte Entfernungsmessung
  (Mehrwegeausbreitung, Wände, Antennenausrichtung). Das Ergebnis ist eine
  Schätzung, keine Vermessung – wird in der Oberfläche entsprechend
  kommuniziert.

### Warum automatische Triangulation erst ab 4 Punkten?

Die Multilateration braucht mathematisch mindestens 3 räumlich gestreute
Messpunkte (2 Unbekannte x/y, jeder Punkt liefert eine Gleichung). Bei genau
3 Punkten ist das Gleichungssystem exakt bestimmt – es gibt keine Redundanz,
um die Qualität des Ergebnisses einzuschätzen; jeder Fehler im
RSSI-Distanz-Modell (Mehrwegeausbreitung, Dämpfung) schlägt direkt auf die
Position durch, ohne dass das sichtbar wäre. Ab 4 Punkten ist das System
überbestimmt, die Ausgleichsrechnung liefert einen Residualfehler
(`accuracyM`), der tatsächlich etwas über die Verlässlichkeit aussagt. Das
ist der Punkt, ab dem eine automatische, unaufgeforderte Anzeige sinnvoll
ist. Mit weniger Punkten bleibt die Schätzung (Einzelpunkt/Centroid) über
den „Triangulieren“-Button weiterhin manuell abrufbar.

## Hosting (GitHub Pages)

Der Ordner `public/` ist die komplette, eigenständige Website (kein
Build-Step nötig). `.github/workflows/deploy-pages.yml` deployt ihn bei
jedem Push auf `main` automatisch nach GitHub Pages (Tests laufen vorher als
Gate). Einmalig einzurichten:

1. Repository-Einstellungen → **Pages** → Source: **GitHub Actions**
2. Push auf `main` → der Workflow „Deploy to GitHub Pages“ baut & deployt

Die Seite ist danach unter `https://<user>.github.io/<repo>/` erreichbar.

## Lokale Vorschau

```bash
npm run serve
```

Öffnet einen minimalen statischen Server unter <http://localhost:8080>
(ohne Abhängigkeiten). Alternativ reicht auch jeder andere statische Server
(`npx serve public`, VS-Code Live Server, …) – ein Doppelklick auf
`index.html` (`file://`) funktioniert **nicht**, da `sql.js`/WASM einen
HTTP-Kontext braucht.

## Tests

```bash
npm install
npm test
```

Reine Node-Tests (`node --test`), keine Browser-Automatisierung nötig:

- `test/triangulate.test.js` – Triangulations-Mathematik, inkl.
  Rückrechnung einer synthetisch platzierten Position aus simulierten
  RSSI-Werten
- `test/wigleData.test.js` – Verschlüsselungs-Klassifizierung,
  Frequenzband-Zuordnung, Filter- und Zeitfenster-Logik
- `test/parse.test.js` – kompletter Parsing-Pfad (wie im Browser) via
  `sql.js` gegen eine echte WiGLE-Beispieldatenbank
  (`test/fixtures/sample-wigle.sqlite`, 845 Netze / 1503 Messpunkte)

## Architektur

```
public/                 komplette statische Website (= Pages-Deploy)
  index.html
  css/style.css
  js/
    triangulate.js        Positionsschätzung (Centroid / Multilateration) -- UMD, auch von Node-Tests genutzt
    wigleData.js           Schema-Validierung, Verschlüsselung/Band, Filter, Zeitfenster -- UMD, auch von Node-Tests genutzt
    db.js                  laedt sql.js, parst hochgeladene Datei zu einfachen JS-Arrays
    app.js                 UI: Karte, Tabelle, Filter, Zeitslider, Heatmap, Triangulation
test/
  fixtures/sample-wigle.sqlite   echte Beispiel-DB fuer Tests
  *.test.js
tools/
  serve.js                 minimaler lokaler Static-Server fuer Vorschau
  smoke-test.js             optionaler Playwright-Smoketest (nicht Teil von npm test)
.github/workflows/deploy-pages.yml   Tests + GitHub-Pages-Deploy bei Push auf main
```

Nach dem Einlesen wird die sql.js-Datenbank verworfen; Filterung, Sortierung,
Zeitfenster und Triangulation laufen anschließend rein auf den extrahierten
JS-Arrays im Speicher des Browsers – es gibt keinerlei Server-Roundtrip und
keine Persistenz über einen Tab-Reload hinaus.

## Bekannte Grenzen / Ideen für später

- Keine Persistenz über einen Seiten-Reload hinaus (bewusst: Datei bleibt
  nur im Speicher des Tabs)
- Triangulation nutzt ein pauschales Path-Loss-Modell (kein Tuning von
  Sendeleistung/Dämpfungsexponent über die UI)
- Kein Export der gefilterten/triangulierten Ergebnisse (z.B. als
  GeoJSON/CSV)
- Denkbare Erweiterung: Unterstützung für Bluetooth/Zellfunk-Daten aus
  derselben WiGLE-DB, Export-Funktion, Speichern mehrerer Uploads
  nebeneinander zum Vergleich
