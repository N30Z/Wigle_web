'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const app = require('../server/index');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-wigle.sqlite');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, ...options },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(raw.toString('utf8'));
          } catch (e) {
            // non-json response
          }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartUpload(server, filePath) {
  const boundary = '----wigletestboundary';
  const fileData = fs.readFileSync(filePath);
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="database"; filename="sample-wigle.sqlite"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([pre, fileData, post]);
  return request(
    server,
    {
      method: 'POST',
      path: '/api/upload',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    },
    body
  );
}

test('upload + list + locations + triangulate end-to-end against real fixture', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const uploadRes = await multipartUpload(server, FIXTURE);
  assert.equal(uploadRes.status, 200, JSON.stringify(uploadRes.json));
  assert.equal(uploadRes.json.networkCount, 845);
  assert.ok(uploadRes.json.bounds);
  const { datasetId } = uploadRes.json;

  const listRes = await request(server, { method: 'GET', path: `/api/datasets/${datasetId}/networks` });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.json.total, 845);

  const filteredRes = await request(server, {
    method: 'GET',
    path: `/api/datasets/${datasetId}/networks?ssid=FRITZ`,
  });
  assert.ok(filteredRes.json.total > 0);
  assert.ok(filteredRes.json.networks.every((n) => n.ssid.toLowerCase().includes('fritz')));

  // known-heavy bssid from fixture inspection: 3a:2a:8b:e4:ba:49 (126 points)
  const bssid = '3a:2a:8b:e4:ba:49';
  const locRes = await request(server, {
    method: 'GET',
    path: `/api/datasets/${datasetId}/networks/${encodeURIComponent(bssid)}/locations`,
  });
  assert.equal(locRes.status, 200);
  assert.equal(locRes.json.points.length, 126);

  const triRes = await request(server, {
    method: 'GET',
    path: `/api/datasets/${datasetId}/networks/${encodeURIComponent(bssid)}/triangulate`,
  });
  assert.equal(triRes.status, 200);
  assert.ok(['centroid', 'multilateration'].includes(triRes.json.method));
  assert.ok(Number.isFinite(triRes.json.lat));
  assert.ok(Number.isFinite(triRes.json.lon));

  const delRes = await request(server, { method: 'DELETE', path: `/api/datasets/${datasetId}` });
  assert.equal(delRes.status, 200);
});

test('rejects non-sqlite upload', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const boundary = '----wigletestboundary2';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="database"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`),
  ]);
  const res = await request(
    server,
    {
      method: 'POST',
      path: '/api/upload',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    },
    body
  );
  assert.equal(res.status, 400);
});
