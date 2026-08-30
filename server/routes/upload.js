'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { UPLOAD_DIR, loadDataset } = require('../datasetStore');

const router = express.Router();

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.sqlite`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.sqlite', '.db', '.sqlite3'].includes(ext)) {
      cb(new Error('Bitte eine .sqlite/.db-Datei hochladen.'));
      return;
    }
    cb(null, true);
  },
});

router.post('/api/upload', (req, res) => {
  upload.single('database')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei erhalten.' });
      return;
    }
    try {
      const datasetId = loadDataset(req.file.path, req.file.originalname);
      const { getDataset } = require('../datasetStore');
      const ds = getDataset(datasetId);
      res.json({
        datasetId,
        networkCount: ds.networks.length,
        bounds: ds.bounds,
        fileName: ds.originalName,
      });
    } catch (e) {
      const fs = require('fs');
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        // ignore
      }
      res.status(400).json({ error: e.message });
    }
  });
});

module.exports = router;
