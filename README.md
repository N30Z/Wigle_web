# WiGLE WiFi Map

Weboberfläche zum Importieren einer **WiGLE WiFi Android**-Backup-SQLite-Datenbank
(`network`/`location`-Schema), Darstellung der gefundenen Netze auf einer
OpenStreetMap-Karte, tabellarischer Auflistung mit Filtern sowie einer
groben **Positionsschätzung (Triangulation) pro SSID/BSSID** aus mehreren
Messpunkten.

## Features

- **Upload** einer `.sqlite`/`.db`-Datei direkt im Browser (kein Vorab-Export nötig)
- **Karte** (Leaflet + OpenStreetMap-Tiles) mit Marker-Clustering für alle Netze,
  Farbe nach Signalstärke
- Karte **zoomt automatisch** auf den Bereich der geladenen Daten
- **Tabelle** aller Netze: SSID, Verschlüsselung, Frequenzband, Anzahl Messpunkte,
  bestes Signal – sortierbar per Klick auf die Spaltenköpfe
- **Filter**: SSID-Text, Verschlüsselungsart (Offen/WEP/WPA/WPA2/WPA3), Frequenzband
  (2.4/5/6 GHz), Mindestanzahl an Messpunkten
- Klick auf ein Netz zeigt Details + alle Einzelmesspunkte auf der Karte
- **Triangulation** je Netz per Knopfdruck:
  - 1 Punkt → Position = dieser Punkt
  - mehrere Punkte ohne räumliche Streuung → signalgewichteter Mittelpunkt
  - ≥3 Punkte mit ausreichender Streuung → Multilateration (Gauss-Newton
    Least-Squares) auf Basis von aus RSSI geschätzten Entfernungen
    (Log-Distance-Path-Loss-Modell), inkl. geschätztem Genauigkeitsradius

  **Hinweis:** WLAN-Signalstärke ist keine exakte Entfernungsmessung
  (Mehrwegeausbreitung, Wände, Antennenausrichtung). Das Ergebnis ist eine
  Schätzung, keine Vermessung – wird in der Oberfläche entsprechend
  kommuniziert.

## Voraussetzungen

- Node.js ≥ 18

## Installation & Start

```bash
npm install
npm start
```

Anschließend im Browser <http://localhost:3000> öffnen und über den Button
„WiGLE-SQLite laden…“ eine Datenbankdatei auswählen.

Für Entwicklung mit Auto-Reload:

```bash
npm run dev
```

## Tests

```bash
npm test
```

Die Tests decken die Triangulations-Mathematik (inkl. Rückrechnung einer
synthetisch platzierten Position aus simulierten RSSI-Werten) sowie den
kompletten API-Flow (Upload → Filterliste → Messpunkte → Triangulation)
gegen eine echte Beispiel-Datenbank unter `test/fixtures/sample-wigle.sqlite`
ab.

## Architektur

```
server/
  index.js          Express-App, statisches Frontend + API-Routen
  datasetStore.js    Öffnet hochgeladene SQLite read-only, baut In-Memory-Index
                      über die network-Tabelle (Filter/Sortierung ohne
                      wiederholte SQL-Queries)
  triangulate.js     Positionsschätzung (Centroid / Multilateration)
  routes/
    upload.js         POST /api/upload (multer, Validierung, Größenlimit)
    networks.js        Netze auflisten/filtern, Messpunkte, Triangulation
public/
  index.html / css / js/app.js   Leaflet-Karte, Filter-UI, Tabelle
```

Jeder Upload wird als eigener **Datensatz** (In-Memory, mit eigener Kopie der
Datei unter `data/uploads/`) verwaltet; ungenutzte Datensätze werden nach
6 Stunden automatisch aufgeräumt. Es gibt aktuell keine Nutzer-Trennung/
Auth – für den lokalen bzw. Experimentier-Einsatz gedacht.

## Bekannte Grenzen / Ideen für später

- Kein persistenter Storage über einen Prozess-Neustart hinaus (Datensätze
  sind rein In-Memory + Temp-Datei)
- Triangulation nutzt ein pauschales Path-Loss-Modell (kein pro-Gerät-Tuning
  von Sendeleistung/Dämpfungsexponent über die UI – aktuell nur Serverseitig
  als Optionen vorbereitet)
- Kein Export der gefilterten/triangulierten Ergebnisse (z.B. als GeoJSON/CSV)
- Denkbare Erweiterung: Heatmap-Layer, Zeitschieberegler für Messzeiträume,
  Unterstützung für Bluetooth/Zellfunk-Daten aus derselben WiGLE-DB
