'use strict';
/**
 * Pic-terest entry point: static assets, session, auth, API, SPA fallback.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { createAuthRouter } = require('./auth');
const { createApiRouter } = require('./api');
const { DATA_DIR } = require('./db');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const NODE_MODULES = path.join(ROOT, 'node_modules');

// PORT=0 (or anything unusable) falls back to 3000 so `npm start` always
// lands on a predictable address; set PORT explicitly to override.
const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
const HOST = process.env.HOST || '0.0.0.0';

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    session({
      secret: sessionSecret(),
      resave: false,
      saveUninitialized: false,
      name: 'picterest.sid',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));

  // Libraries vendored from node_modules so the app needs no CDN.
  const vendor = {
    '/vendor/jquery.js': path.join(NODE_MODULES, 'jquery', 'dist', 'jquery.min.js'),
    '/vendor/masonry.js': path.join(NODE_MODULES, 'masonry-layout', 'dist', 'masonry.pkgd.min.js'),
    '/vendor/imagesloaded.js': path.join(NODE_MODULES, 'imagesloaded', 'imagesloaded.pkgd.min.js'),
  };
  for (const [route, file] of Object.entries(vendor)) {
    app.get(route, (req, res) => {
      res.type('application/javascript');
      fs.createReadStream(file).pipe(res);
    });
  }

  app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }));

  app.use(createAuthRouter());
  app.use('/api', createApiRouter());

  // Unknown API routes stay JSON.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Anything else is the single-page app.
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC, 'index.html'));
  });

  // JSON body parse errors should not explode as HTML.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    console.error('[server]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const server = app.listen(PORT, HOST, () => {
    const { port } = server.address();
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`Pic-terest running at http://${shown}:${port}`);
  });
}

module.exports = { createApp };
