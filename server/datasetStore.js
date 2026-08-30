'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6h: uploaded copies are cleaned up after this

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * In-memory registry of imported datasets. Each dataset wraps a copy of the
 * uploaded sqlite file (opened read-only) plus a light-weight in-memory
 * index over the `network` table so filtering/sorting doesn't have to hit
 * sqlite for every request.
 */
const datasets = new Map();

const REQUIRED_TABLES = ['network', 'location'];

function assertWigleSchema(db) {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
  if (missing.length) {
    throw new Error(
      `Keine gueltige WiGLE-SQLite-Datenbank: fehlende Tabelle(n) ${missing.join(', ')}`
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

function loadDataset(filePath, originalName) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = 1');
  assertWigleSchema(db);

  const networkRows = db
    .prepare(
      `SELECT bssid, ssid, frequency, capabilities, lasttime, lastlat, lastlon,
              type, bestlevel, bestlat, bestlon
       FROM network`
    )
    .all();

  const countStmt = db.prepare(
    'SELECT COUNT(*) AS n, MIN(time) AS minTime, MAX(time) AS maxTime FROM location WHERE bssid = ?'
  );

  const networks = networkRows.map((row) => {
    const stats = countStmt.get(row.bssid);
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
      pointCount: stats.n || 0,
      firstSeen: stats.minTime || null,
      lastSeen: stats.maxTime || null,
    };
  });

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
  const bounds = Number.isFinite(minLat)
    ? { minLat, maxLat, minLon, maxLon }
    : null;

  const id = crypto.randomUUID();
  datasets.set(id, {
    id,
    db,
    filePath,
    originalName,
    createdAt: Date.now(),
    networks,
    networksByBssid: new Map(networks.map((n) => [n.bssid, n])),
    bounds,
  });
  return id;
}

function getDataset(id) {
  const ds = datasets.get(id);
  if (!ds) return null;
  ds.lastAccess = Date.now();
  return ds;
}

function getLocations(id, bssid) {
  const ds = getDataset(id);
  if (!ds) return null;
  return ds.db
    .prepare(
      `SELECT _id AS id, level, lat, lon, altitude, accuracy, time
       FROM location WHERE bssid = ? ORDER BY time ASC`
    )
    .all(bssid);
}

function removeDataset(id) {
  const ds = datasets.get(id);
  if (!ds) return;
  try {
    ds.db.close();
  } catch (e) {
    // ignore
  }
  try {
    fs.unlinkSync(ds.filePath);
  } catch (e) {
    // ignore
  }
  datasets.delete(id);
}

// periodic cleanup of stale datasets/uploads
setInterval(() => {
  const now = Date.now();
  for (const [id, ds] of datasets) {
    const age = now - (ds.lastAccess || ds.createdAt);
    if (age > MAX_AGE_MS) removeDataset(id);
  }
}, 1000 * 60 * 15).unref();

module.exports = {
  UPLOAD_DIR,
  loadDataset,
  getDataset,
  getLocations,
  removeDataset,
};
