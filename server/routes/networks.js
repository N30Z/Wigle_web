'use strict';

const express = require('express');
const { getDataset, getLocations, removeDataset } = require('../datasetStore');
const { triangulate } = require('../triangulate');

const router = express.Router();

function requireDataset(req, res, next) {
  const ds = getDataset(req.params.datasetId);
  if (!ds) {
    res.status(404).json({ error: 'Datensatz nicht gefunden (evtl. abgelaufen). Bitte erneut hochladen.' });
    return;
  }
  req.dataset = ds;
  next();
}

// GET /api/datasets/:datasetId/networks?ssid=&encryption=&band=&minPoints=&from=&to=
router.get('/api/datasets/:datasetId/networks', requireDataset, (req, res) => {
  const { ssid, encryption, band, minPoints, from, to } = req.query;
  let list = req.dataset.networks;

  if (ssid) {
    const needle = ssid.toLowerCase();
    list = list.filter((n) => n.ssid.toLowerCase().includes(needle));
  }
  if (encryption) {
    const wanted = new Set(String(encryption).split(','));
    list = list.filter((n) => wanted.has(n.encryption));
  }
  if (band) {
    const wanted = new Set(String(band).split(','));
    list = list.filter((n) => wanted.has(n.band));
  }
  if (minPoints) {
    const min = Number(minPoints);
    list = list.filter((n) => n.pointCount >= min);
  }
  if (from) {
    const t = Number(from);
    list = list.filter((n) => n.lastSeen === null || n.lastSeen >= t);
  }
  if (to) {
    const t = Number(to);
    list = list.filter((n) => n.firstSeen === null || n.firstSeen <= t);
  }

  res.json({ total: list.length, networks: list });
});

router.get('/api/datasets/:datasetId/networks/:bssid/locations', requireDataset, (req, res) => {
  const points = getLocations(req.dataset.id, req.params.bssid);
  if (points === null) {
    res.status(404).json({ error: 'Netz nicht gefunden.' });
    return;
  }
  res.json({ points });
});

router.get('/api/datasets/:datasetId/networks/:bssid/triangulate', requireDataset, (req, res) => {
  const network = req.dataset.networksByBssid.get(req.params.bssid);
  if (!network) {
    res.status(404).json({ error: 'Netz nicht gefunden.' });
    return;
  }
  const points = getLocations(req.dataset.id, req.params.bssid);
  const result = triangulate(points);
  if (!result) {
    res.status(422).json({ error: 'Keine gueltigen Standortdaten fuer dieses Netz vorhanden.' });
    return;
  }
  res.json({ bssid: req.params.bssid, ssid: network.ssid, ...result });
});

router.delete('/api/datasets/:datasetId', requireDataset, (req, res) => {
  removeDataset(req.dataset.id);
  res.json({ ok: true });
});

module.exports = router;
