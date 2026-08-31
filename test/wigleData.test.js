'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WigleData = require('../public/js/wigleData');

test('classifyEncryption recognises common capability strings', () => {
  assert.equal(WigleData.classifyEncryption('[WPA2-PSK-CCMP-128][RSN-PSK+SAE-CCMP-128][ESS]'), 'WPA3');
  assert.equal(WigleData.classifyEncryption('[WPA2-PSK-CCMP-128][RSN-PSK-CCMP-128][ESS]'), 'WPA2');
  assert.equal(WigleData.classifyEncryption('[WPA-PSK-TKIP][ESS]'), 'WPA');
  assert.equal(WigleData.classifyEncryption('[WEP][ESS]'), 'WEP');
  assert.equal(WigleData.classifyEncryption('[ESS]'), 'Offen');
  assert.equal(WigleData.classifyEncryption(''), 'Unbekannt');
});

test('frequencyToBand maps common WiFi channels', () => {
  assert.equal(WigleData.frequencyToBand(2437), '2.4GHz');
  assert.equal(WigleData.frequencyToBand(5180), '5GHz');
  assert.equal(WigleData.frequencyToBand(5955), '6GHz');
  assert.equal(WigleData.frequencyToBand(0), 'unknown');
});

test('assertWigleSchema throws when required tables are missing', () => {
  assert.throws(() => WigleData.assertWigleSchema(['network']));
  assert.doesNotThrow(() => WigleData.assertWigleSchema(['network', 'location', 'route']));
});

test('buildNetworks aggregates point counts and time range per bssid', () => {
  const networkRows = [
    { bssid: 'aa:bb', ssid: 'Test', frequency: 2437, capabilities: '[ESS]', lasttime: 100, lastlat: 1, lastlon: 1, type: 'W', bestlevel: -50, bestlat: 1, bestlon: 1 },
    { bssid: 'cc:dd', ssid: '', frequency: 5180, capabilities: '[WPA2-PSK-CCMP][ESS]', lasttime: 200, lastlat: 2, lastlon: 2, type: 'W', bestlevel: -70, bestlat: 2, bestlon: 2 },
  ];
  const locations = [
    { bssid: 'aa:bb', time: 10, lat: 1, lon: 1, level: -50 },
    { bssid: 'aa:bb', time: 30, lat: 1.001, lon: 1, level: -55 },
  ];
  const byBssid = WigleData.indexLocationsByBssid(locations);
  const networks = WigleData.buildNetworks(networkRows, byBssid);

  const aabb = networks.find((n) => n.bssid === 'aa:bb');
  assert.equal(aabb.pointCount, 2);
  assert.equal(aabb.firstSeen, 10);
  assert.equal(aabb.lastSeen, 30);
  assert.equal(aabb.encryption, 'Offen');

  const ccdd = networks.find((n) => n.bssid === 'cc:dd');
  assert.equal(ccdd.pointCount, 0);
  assert.equal(ccdd.ssid, '(versteckt/leer)');
  assert.equal(ccdd.encryption, 'WPA2');
});

test('filterNetworks applies ssid/encryption/band/minPoints filters', () => {
  const networks = [
    { bssid: '1', ssid: 'FRITZ!Box', encryption: 'WPA2', band: '2.4GHz', pointCount: 5 },
    { bssid: '2', ssid: 'Vodafone', encryption: 'WPA3', band: '5GHz', pointCount: 1 },
  ];
  assert.equal(WigleData.filterNetworks(networks, { ssid: 'fritz' }).length, 1);
  assert.equal(WigleData.filterNetworks(networks, { encryption: ['WPA3'] }).length, 1);
  assert.equal(WigleData.filterNetworks(networks, { band: ['5GHz'] })[0].bssid, '2');
  assert.equal(WigleData.filterNetworks(networks, { minPoints: 3 }).length, 1);
});

test('filterLocationsByTime keeps points within [from, to]', () => {
  const locations = [{ time: 10 }, { time: 20 }, { time: 30 }];
  const filtered = WigleData.filterLocationsByTime(locations, 15, 25);
  assert.deepEqual(filtered.map((p) => p.time), [20]);
});

test('computeTimeRange finds min/max time across points', () => {
  const range = WigleData.computeTimeRange([{ time: 30 }, { time: 5 }, { time: 15 }]);
  assert.deepEqual(range, { min: 5, max: 30 });
  assert.equal(WigleData.computeTimeRange([]), null);
});
