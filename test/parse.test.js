'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const WigleData = require('../public/js/wigleData');
const { triangulate } = require('../public/js/triangulate');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-wigle.sqlite');

function execToObjects(db, sql) {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => (obj[col] = row[i]));
    return obj;
  });
}

// Spiegelt public/js/db.js#parseWigleFile, aber ohne Browser/CDN-Abhaengigkeit,
// um denselben Extraktionspfad end-to-end gegen die echte Beispiel-DB zu testen.
async function parseWigleFileNode(filePath) {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(filePath);
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    const tableNames = execToObjects(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    WigleData.assertWigleSchema(tableNames);
    const networkRows = execToObjects(
      db,
      `SELECT bssid, ssid, frequency, capabilities, lasttime, lastlat, lastlon,
              type, bestlevel, bestlat, bestlon
       FROM network`
    );
    const locations = execToObjects(
      db,
      `SELECT _id AS id, bssid, level, lat, lon, altitude, accuracy, time
       FROM location`
    );
    return { networkRows, locations };
  } finally {
    db.close();
  }
}

test('parses the real WiGLE fixture and reproduces known counts', async () => {
  const { networkRows, locations } = await parseWigleFileNode(FIXTURE);
  assert.equal(networkRows.length, 845);
  assert.equal(locations.length, 1503);

  const byBssid = WigleData.indexLocationsByBssid(locations);
  const networks = WigleData.buildNetworks(networkRows, byBssid);
  assert.equal(networks.length, 845);

  const bounds = WigleData.computeBounds(networks);
  assert.ok(bounds);
  assert.ok(bounds.minLat < bounds.maxLat);

  const fritzNets = WigleData.filterNetworks(networks, { ssid: 'fritz' });
  assert.ok(fritzNets.length > 0);
  assert.ok(fritzNets.every((n) => n.ssid.toLowerCase().includes('fritz')));

  // bekannt aus Fixture-Inspektion: dieser BSSID hat 126 Messpunkte
  const heavy = byBssid.get('3a:2a:8b:e4:ba:49');
  assert.equal(heavy.length, 126);

  const result = triangulate(heavy);
  assert.ok(['centroid', 'multilateration'].includes(result.method));
  assert.ok(Number.isFinite(result.lat) && Number.isFinite(result.lon));

  const timeRange = WigleData.computeTimeRange(locations);
  assert.ok(timeRange.min <= timeRange.max);

  const timeFiltered = WigleData.filterLocationsByTime(locations, timeRange.min, timeRange.min);
  assert.ok(timeFiltered.length <= locations.length);
});

test('rejects a file without the wigle schema', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE foo (id INTEGER)');
  const bytes = db.export();
  db.close();

  const tmpFile = path.join(__dirname, '..', 'tmp-not-wigle.sqlite');
  fs.writeFileSync(tmpFile, Buffer.from(bytes));
  try {
    await assert.rejects(() => parseWigleFileNode(tmpFile));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
