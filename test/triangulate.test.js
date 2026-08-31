'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { triangulate, rssiToDistance } = require('../public/js/triangulate');

test('single point returns that point verbatim', () => {
  const result = triangulate([{ lat: 53.71, lon: 10.51, level: -60 }]);
  assert.equal(result.method, 'single');
  assert.equal(result.lat, 53.71);
  assert.equal(result.lon, 10.51);
});

test('no valid points returns null', () => {
  assert.equal(triangulate([]), null);
  assert.equal(triangulate([{ lat: 0, lon: 0, level: -60 }]), null);
});

test('points clustered together fall back to centroid', () => {
  const points = [
    { lat: 53.71000, lon: 10.51000, level: -50 },
    { lat: 53.71000, lon: 10.51000, level: -55 },
  ];
  const result = triangulate(points);
  assert.equal(result.method, 'centroid');
  assert.ok(Math.abs(result.lat - 53.71) < 1e-4);
});

test('multilateration recovers a known AP position from synthetic RSSI', () => {
  // Simulierter AP an einem bekannten Punkt; vier Messpunkte drumherum mit
  // RSSI, das exakt aus dem Path-Loss-Modell abgeleitet wurde (0 Rauschen).
  const apLat = 53.7118;
  const apLon = 10.5148;
  const txPower = -40;
  const n = 2.7;

  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((apLat * Math.PI) / 180);

  const offsets = [
    [20, 0],
    [-20, 15],
    [0, -25],
    [15, 20],
  ];

  const points = offsets.map(([dx, dy]) => {
    const lat = apLat + dy / metersPerDegLat;
    const lon = apLon + dx / metersPerDegLon;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const level = txPower - 10 * n * Math.log10(dist);
    return { lat, lon, level };
  });

  const result = triangulate(points, { txPower, pathLossExponent: n });
  assert.equal(result.method, 'multilateration');

  const dLat = (result.lat - apLat) * metersPerDegLat;
  const dLon = (result.lon - apLon) * metersPerDegLon;
  const errorM = Math.sqrt(dLat * dLat + dLon * dLon);
  assert.ok(errorM < 5, `Erwartete Abweichung < 5m, war ${errorM}m`);
  assert.ok(result.accuracyM < 5);
});

test('rssiToDistance decreases distance for stronger signal', () => {
  const near = rssiToDistance(-40);
  const far = rssiToDistance(-80);
  assert.ok(near < far);
});
