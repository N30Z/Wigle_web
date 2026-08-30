(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WigleTriangulate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Grobe Positionsschaetzung eines WLAN-Access-Points aus mehreren
   * Signalstaerke-Messungen (RSSI) an unterschiedlichen Standorten.
   *
   * WiFi-RSSI ist kein exaktes Entfernungsmass (Mehrwegeausbreitung,
   * Antennenausrichtung, Daempfung durch Waende, ...). Das Ergebnis ist
   * daher eine Schaetzung, keine echte Vermessung. Methode:
   *
   *  1. Reine RSSI-gewichtete Centroid-Berechnung als robuster Startwert
   *     (staerkeres Signal = naeher = hoeheres Gewicht).
   *  2. Bei >= 3 Messpunkten mit ausreichender geometrischer Streuung:
   *     Multilateration per Gauss-Newton-Least-Squares auf Basis von aus
   *     RSSI geschaetzten Distanzen (Log-Distance-Path-Loss-Modell),
   *     initialisiert mit dem Centroid.
   *
   * Alle Berechnungen erfolgen in einer lokalen, auf den Centroid
   * zentrierten equirektangulaeren Projektion (ausreichend genau fuer die
   * hier relevanten Entfernungen von wenigen hundert Metern).
   */

  const EARTH_RADIUS_M = 6371000;

  // Log-distance path loss model: RSSI(d) = txPower - 10*n*log10(d)
  const DEFAULT_TX_POWER = -40;
  const DEFAULT_PATH_LOSS_EXPONENT = 2.7;

  // Ab dieser Anzahl raeumlich gestreuter Messpunkte liefert Multilateration
  // ein ueberbestimmtes (statt exakt bestimmtes) System und damit eine
  // aussagekraeftige Genauigkeitsangabe -> ab hier macht automatische
  // Triangulation ohne Nutzeraktion Sinn.
  const AUTO_TRIANGULATE_MIN_POINTS = 4;

  function toLocalMeters(lat, lon, originLat, originLon) {
    const latRad = (originLat * Math.PI) / 180;
    const dLat = ((lat - originLat) * Math.PI) / 180;
    const dLon = ((lon - originLon) * Math.PI) / 180;
    const y = dLat * EARTH_RADIUS_M;
    const x = dLon * EARTH_RADIUS_M * Math.cos(latRad);
    return { x, y };
  }

  function fromLocalMeters(x, y, originLat, originLon) {
    const latRad = (originLat * Math.PI) / 180;
    const dLat = y / EARTH_RADIUS_M;
    const dLon = x / (EARTH_RADIUS_M * Math.cos(latRad));
    return {
      lat: originLat + (dLat * 180) / Math.PI,
      lon: originLon + (dLon * 180) / Math.PI,
    };
  }

  function rssiToDistance(rssi, txPower, n) {
    txPower = txPower === undefined ? DEFAULT_TX_POWER : txPower;
    n = n === undefined ? DEFAULT_PATH_LOSS_EXPONENT : n;
    return Math.pow(10, (txPower - rssi) / (10 * n));
  }

  function weightedCentroid(points) {
    let sumW = 0;
    let sumLat = 0;
    let sumLon = 0;
    for (const p of points) {
      const w = Math.pow(10, p.level / 10);
      sumW += w;
      sumLat += p.lat * w;
      sumLon += p.lon * w;
    }
    if (sumW === 0) {
      const n = points.length;
      return {
        lat: points.reduce((s, p) => s + p.lat, 0) / n,
        lon: points.reduce((s, p) => s + p.lon, 0) / n,
      };
    }
    return { lat: sumLat / sumW, lon: sumLon / sumW };
  }

  function hasGeometricSpread(points) {
    if (points.length < 3) return false;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    const spreadM = Math.max(
      (maxLat - minLat) * 111320,
      (maxLon - minLon) * 111320 * Math.cos((minLat * Math.PI) / 180)
    );
    return spreadM > 5;
  }

  function multilaterate(localPoints, distances, initial) {
    let x = initial.x;
    let y = initial.y;
    const maxIter = 50;
    for (let iter = 0; iter < maxIter; iter++) {
      let JTJ00 = 0;
      let JTJ01 = 0;
      let JTJ11 = 0;
      let JTr0 = 0;
      let JTr1 = 0;
      for (let i = 0; i < localPoints.length; i++) {
        const dx = x - localPoints[i].x;
        const dy = y - localPoints[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const residual = dist - distances[i];
        const j0 = dx / dist;
        const j1 = dy / dist;
        JTJ00 += j0 * j0;
        JTJ01 += j0 * j1;
        JTJ11 += j1 * j1;
        JTr0 += j0 * residual;
        JTr1 += j1 * residual;
      }
      const lambda = 1e-6;
      JTJ00 += lambda;
      JTJ11 += lambda;
      const det = JTJ00 * JTJ11 - JTJ01 * JTJ01;
      if (Math.abs(det) < 1e-9) break;
      const dxStep = (JTJ11 * JTr0 - JTJ01 * JTr1) / det;
      const dyStep = (JTJ00 * JTr1 - JTJ01 * JTr0) / det;
      x -= dxStep;
      y -= dyStep;
      if (Math.abs(dxStep) < 1e-3 && Math.abs(dyStep) < 1e-3) break;
    }
    return { x, y };
  }

  function rmse(localPoints, distances, pos) {
    let sum = 0;
    for (let i = 0; i < localPoints.length; i++) {
      const dx = pos.x - localPoints[i].x;
      const dy = pos.y - localPoints[i].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      sum += (d - distances[i]) ** 2;
    }
    return Math.sqrt(sum / localPoints.length);
  }

  /**
   * @param {{lat:number, lon:number, level:number}[]} points Messpunkte
   * @param {{txPower?:number, pathLossExponent?:number}} [options]
   * @returns {{method:'single'|'centroid'|'multilateration', lat:number, lon:number, accuracyM:number|null, pointsUsed:number}|null}
   */
  function triangulate(points, options) {
    options = options || {};
    const valid = points.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        !(p.lat === 0 && p.lon === 0)
    );
    if (valid.length === 0) return null;

    if (valid.length === 1) {
      return { method: 'single', lat: valid[0].lat, lon: valid[0].lon, accuracyM: null, pointsUsed: 1 };
    }

    const centroid = weightedCentroid(valid);

    if (!hasGeometricSpread(valid)) {
      return { method: 'centroid', lat: centroid.lat, lon: centroid.lon, accuracyM: null, pointsUsed: valid.length };
    }

    const txPower = options.txPower === undefined ? DEFAULT_TX_POWER : options.txPower;
    const n = options.pathLossExponent === undefined ? DEFAULT_PATH_LOSS_EXPONENT : options.pathLossExponent;

    const localPoints = valid.map((p) => toLocalMeters(p.lat, p.lon, centroid.lat, centroid.lon));
    const distances = valid.map((p) => rssiToDistance(p.level, txPower, n));

    const initial = toLocalMeters(centroid.lat, centroid.lon, centroid.lat, centroid.lon);
    const result = multilaterate(localPoints, distances, initial);
    const error = rmse(localPoints, distances, result);
    const geo = fromLocalMeters(result.x, result.y, centroid.lat, centroid.lon);

    return {
      method: 'multilateration',
      lat: geo.lat,
      lon: geo.lon,
      accuracyM: Number.isFinite(error) ? Math.round(error) : null,
      pointsUsed: valid.length,
    };
  }

  return {
    triangulate,
    rssiToDistance,
    weightedCentroid,
    hasGeometricSpread,
    DEFAULT_TX_POWER,
    DEFAULT_PATH_LOSS_EXPONENT,
    AUTO_TRIANGULATE_MIN_POINTS,
  };
});
