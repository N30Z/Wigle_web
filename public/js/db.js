'use strict';

/**
 * Laedt eine hochgeladene WiGLE-SQLite-Datei komplett im Browser via sql.js
 * (SQLite als WASM) und extrahiert die `network`- und `location`-Tabellen
 * in einfache JS-Arrays. Danach wird die sql.js-DB nicht mehr gebraucht --
 * alle Filterung/Sortierung/Triangulation laeuft rein auf den Arrays
 * (siehe shared/wigleData.js), ohne weitere SQL-Queries.
 */

const WigleDb = (function () {
  let sqlJsPromise = null;

  function loadSqlJs() {
    if (!sqlJsPromise) {
      sqlJsPromise = window.initSqlJs({
        locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
      });
    }
    return sqlJsPromise;
  }

  function execToObjects(db, sql) {
    const res = db.exec(sql);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * @param {ArrayBuffer} arrayBuffer Inhalt der hochgeladenen Datei
   * @returns {Promise<{networkRows: object[], locations: object[]}>}
   */
  async function parseWigleFile(arrayBuffer) {
    const SQL = await loadSqlJs();
    let db;
    try {
      db = new SQL.Database(new Uint8Array(arrayBuffer));
    } catch (e) {
      throw new Error('Datei ist keine gueltige SQLite-Datenbank (' + e.message + ').');
    }

    try {
      const tableNames = execToObjects(db, "SELECT name FROM sqlite_master WHERE type='table'").map(
        (r) => r.name
      );
      WigleData.assertWigleSchema(tableNames);

      const networkRows = execToObjects(
        db,
        `SELECT bssid, ssid, frequency, capabilities, lasttime, lastlat, lastlon,
                type, bestlevel, bestlat, bestlon
         FROM network`
      );

      const locationRows = execToObjects(
        db,
        `SELECT _id AS id, bssid, level, lat, lon, altitude, accuracy, time
         FROM location`
      );

      return { networkRows, locations: locationRows };
    } finally {
      db.close();
    }
  }

  return { parseWigleFile };
})();
