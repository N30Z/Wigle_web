'use strict';

/**
 * Manueller Browser-Smoketest (nicht Teil von `npm test`): laedt die App
 * per echtem Chromium, laedt sql.js von cdnjs, importiert die Fixture-DB
 * und prueft, dass Tabelle/Karte/Zeitslider/Triangulation tatsaechlich
 * funktionieren. Nuetzlich um CDN/WASM-Probleme fruehzeitig zu erkennen.
 *
 * Aufruf: node tools/smoke-test.js
 */

const path = require('path');
const { chromium } = require('playwright');

const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'sample-wigle.sqlite');
const URL = process.env.SMOKE_URL || 'http://localhost:8080/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });

  const fileInput = await page.$('#file-input');
  await fileInput.setInputFiles(FIXTURE);

  await page.waitForFunction(
    () => document.getElementById('network-count').textContent.includes('845'),
    { timeout: 15000 }
  );

  const status = await page.textContent('#upload-status');
  console.log('Upload-Status:', status);

  const rowCount = await page.$$eval('#network-table-body tr', (rows) => rows.length);
  console.log('Tabellenzeilen:', rowCount);
  if (rowCount === 0) throw new Error('Netz-Tabelle ist leer');

  // Zeitslider sollte gerendert sein
  const sliderVisible = await page.$eval('#time-slider', (el) => el.style.display !== 'none');
  console.log('Zeitslider sichtbar:', sliderVisible);
  if (!sliderVisible) throw new Error('Zeitslider nicht sichtbar');

  // Netz mit vielen Punkten auswaehlen -> automatische Triangulation
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#network-table-body tr'));
    const row = rows.find((r) => r.dataset.bssid === '3a:2a:8b:e4:ba:49');
    if (!row) throw new Error('Erwartete BSSID nicht in Tabelle gefunden');
    row.click();
  });

  await page.waitForSelector('#tri-result .detail-row', { timeout: 10000 });
  const triHtml = await page.textContent('#tri-result');
  console.log('Triangulation-Ergebnis:', triHtml.replace(/\s+/g, ' ').trim());
  if (!triHtml.includes('automatisch')) throw new Error('Automatische Triangulation wurde nicht ausgeloest');

  // Heatmap-Toggle
  await page.check('#filter-heatmap');
  await page.waitForTimeout(500);
  const hasHeatCanvas = await page.$eval('#map', (el) => !!el.querySelector('canvas'));
  console.log('Heatmap-Canvas vorhanden:', hasHeatCanvas);
  if (!hasHeatCanvas) throw new Error('Heatmap-Layer wurde nicht gerendert');

  // Mobile Ansicht: Sidebar-Toggle sichtbar & funktioniert
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(200);
  const toggleVisible = await page.isVisible('#sidebar-toggle');
  console.log('Mobile Sidebar-Toggle sichtbar:', toggleVisible);
  if (!toggleVisible) throw new Error('Sidebar-Toggle im Mobile-Layout nicht sichtbar');

  await browser.close();

  if (errors.length) {
    console.error('Console/Page-Fehler aufgetreten:\n' + errors.join('\n'));
    process.exit(1);
  }

  console.log('\nSmoke-Test erfolgreich.');
})().catch((err) => {
  console.error('Smoke-Test fehlgeschlagen:', err);
  process.exit(1);
});
