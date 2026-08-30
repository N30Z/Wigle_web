'use strict';

const path = require('path');
const express = require('express');

const uploadRouter = require('./routes/upload');
const networksRouter = require('./routes/networks');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(uploadRouter);
app.use(networksRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WiGLE Web laeuft auf http://localhost:${PORT}`);
  });
}

module.exports = app;
