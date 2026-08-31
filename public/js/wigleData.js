(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WigleData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Reine, IO-freie Hilfsfunktionen rund um das WiGLE-SQLite-Schema
   * (Tabellen `network` / `location`). Laufen identisch im Browser
   * (nach Extraktion via sql.js) und unter Node (Tests).
   */

  const REQUIRED_TABLES = ['network', 'location'];

  function assertWigleSchema(tableNames) {
    const have = new Set(tableNames);
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (missing.length) {
      throw new Error(
        'Keine gueltige WiGLE-SQLite-Datenbank: fehlende Tabelle(n) ' + missing.join(', ')
      );
    }
  }

  function frequencyToBand(freqMhz) {
    if (!freqMhz || Number.isNaN(freqMhz)) return 'unknown';
    if (freqMhz >= 2400 && freqMhz < 2500) return '2.4GHz';
    if (freqMhz >= 4900 && freqMhz < 5900) return '5GHz';
    if (freqMhz >= 5925 && freqMhz < 7125) return '6GHz';
    return 'unknown';
  }

  function classifyEncryption(capabilities) {
    const c = (capabilities || '').toUpperCase();
    if (c.includes('SAE') || c.includes('WPA3')) return 'WPA3';
    if (c.includes('WPA2')) return 'WPA2';
    if (c.includes('WPA')) return 'WPA';
    if (c.includes('WEP')) return 'WEP';
    if (c.includes('ESS') && !c.includes('WPA') && !c.includes('WEP')) return 'Offen';
    return 'Unbekannt';
  }

  /** Gruppiert Location-Rows nach bssid -> Array. */
  function indexLocationsByBssid(locations) {
    const map = new Map();
    for (const loc of locations) {
      let arr = map.get(loc.bssid);
      if (!arr) {
        arr = [];
        map.set(loc.bssid, arr);
      }
      arr.push(loc);
    }
    return map;
  }

  /**
   * Baut die Netz-Uebersicht (wie sie Tabelle/Karte brauchen) aus den
   * rohen `network`-Rows plus den zugehoerigen Location-Punkten.
   * `locationsByBssid` optional vorgefiltert (z.B. per Zeitfenster) --
   * pointCount/firstSeen/lastSeen beziehen sich dann auf diese Teilmenge.
   */
  function buildNetworks(networkRows, locationsByBssid) {
    return networkRows.map((row) => {
      const points = locationsByBssid.get(row.bssid) || [];
      let firstSeen = null;
      let lastSeen = null;
      for (const p of points) {
        if (firstSeen === null || p.time < firstSeen) firstSeen = p.time;
        if (lastSeen === null || p.time > lastSeen) lastSeen = p.time;
      }
      return {
        bssid: row.bssid,
        ssid: row.ssid && row.ssid.length ? row.ssid : '(versteckt/leer)',
        frequency: row.frequency,
        band: frequencyToBand(row.frequency),
        capabilities: row.capabilities,
        encryption: classifyEncryption(row.capabilities),
        type: row.type,
        lastTime: row.lasttime,
        bestLevel: row.bestlevel,
        bestLat: row.bestlat,
        bestLon: row.bestlon,
        pointCount: points.length,
        firstSeen,
        lastSeen,
      };
    });
  }

  function computeBounds(networks) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const n of networks) {
      if (n.bestLat && n.bestLon && (n.bestLat !== 0 || n.bestLon !== 0)) {
        minLat = Math.min(minLat, n.bestLat);
        maxLat = Math.max(maxLat, n.bestLat);
        minLon = Math.min(minLon, n.bestLon);
        maxLon = Math.max(maxLon, n.bestLon);
      }
    }
    return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
  }

  function filterNetworks(networks, filters) {
    filters = filters || {};
    let list = networks;
    if (filters.ssid) {
      const needle = filters.ssid.toLowerCase();
      list = list.filter((n) => n.ssid.toLowerCase().includes(needle));
    }
    if (filters.encryption && filters.encryption.length) {
      const wanted = new Set(filters.encryption);
      list = list.filter((n) => wanted.has(n.encryption));
    }
    if (filters.band && filters.band.length) {
      const wanted = new Set(filters.band);
      list = list.filter((n) => wanted.has(n.band));
    }
    if (filters.minPoints) {
      list = list.filter((n) => n.pointCount >= filters.minPoints);
    }
    return list;
  }

  function filterLocationsByTime(locations, fromMs, toMs) {
    if (fromMs == null && toMs == null) return locations;
    return locations.filter((p) => {
      if (fromMs != null && p.time < fromMs) return false;
      if (toMs != null && p.time > toMs) return false;
      return true;
    });
  }

  function computeTimeRange(locations) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of locations) {
      if (p.time < min) min = p.time;
      if (p.time > max) max = p.time;
    }
    return Number.isFinite(min) ? { min, max } : null;
  }

  return {
    assertWigleSchema,
    frequencyToBand,
    classifyEncryption,
    indexLocationsByBssid,
    buildNetworks,
    computeBounds,
    filterNetworks,
    filterLocationsByTime,
    computeTimeRange,
  };
});
