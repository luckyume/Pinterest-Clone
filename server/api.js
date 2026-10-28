'use strict';
/**
 * JSON API.
 *
 *   GET    /api/user             current session (or { status: "unauthenticated" })
 *   GET    /api/config           public client flags (dev-login mode, ...)
 *   GET    /api/users            everyone, with pic counts
 *   GET    /api/users/:id        one member
 *   GET    /api/pics             every image on the wall, newest first
 *   GET    /api/pics/:id         a user's wall (id = user) or a single image
 *   GET    /api/users/:id/pics   a user's wall
 *   POST   /api/pics             link an image          (auth)
 *   DELETE /api/pics/:id         unlink own image       (auth, owner)
 *
 * Linked urls are stored exactly as they were submitted: if an image cannot be
 * loaded the wall swaps it for the placeholder image client-side.
 */
const express = require('express');
const db = require('./db');
const { clientConfigured, publicUser, DEFAULT_DEV_USER } = require('./auth');

const MAX_URL_LENGTH = 2048;

function currentUser(req) {
  if (!req.session.userId) return null;
  const user = db.findUserById(req.session.userId);
  if (!user) {
    delete req.session.userId;
    return null;
  }
  return user;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ status: 'unauthenticated', error: 'Sign in required' });
  req.user = user;
  next();
}

function createApiRouter() {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({
      oauthConfigured: clientConfigured(),
      devLoginUsername: clientConfigured() ? null : DEFAULT_DEV_USER,
    });
  });

  router.get('/user', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.json({ status: 'unauthenticated' });
    res.json(publicUser(user));
  });

  router.get('/users', (req, res) => {
    res.json(db.listUsers());
  });

  router.get('/users/:id', (req, res) => {
    const user = db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'No such user' });
    const picCount = db.picsByOwner(user._id).length;
    res.json({ ...user, picCount });
  });

  router.get('/pics', (req, res) => {
    const ownerId = req.query.owner || req.query.user;
    if (ownerId) {
      const owner = db.findUserById(String(ownerId));
      if (!owner) return res.status(404).json({ error: 'No such user' });
      return res.json(db.picsByOwner(owner._id).map(db.withOwner));
    }
    res.json(db.listPics().map(db.withOwner));
  });

  router.get('/pics/:id', (req, res) => {
    const { id } = req.params;
    const owner = db.findUserById(id);
    if (owner) return res.json(db.picsByOwner(owner._id).map(db.withOwner));
    const pic = db.findPic(id);
    if (pic) return res.json(db.withOwner(pic));
    res.status(404).json({ error: 'Not found' });
  });

  router.get('/users/:id/pics', (req, res) => {
    const owner = db.findUserById(req.params.id);
    if (!owner) return res.status(404).json({ error: 'No such user' });
    res.json(db.picsByOwner(owner._id).map(db.withOwner));
  });

  router.post('/pics', requireAuth, (req, res) => {
    const body = req.body || {};
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'An image url is required' });
    if (url.length > MAX_URL_LENGTH) {
      return res.status(400).json({ error: 'That url is too long' });
    }

    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 240)
        : `a pic by @${req.user.github.username}`;

    const pic = db.createPic({ url, description, ownerId: req.user._id });
    res.status(201).json(db.withOwner(pic));
  });

  router.delete('/pics/:id', requireAuth, (req, res) => {
    const pic = db.findPic(req.params.id);
    if (!pic) return res.status(404).json({ error: 'Not found' });
    if (pic.ownerId !== req.user._id) {
      return res.status(403).json({ error: 'You can only delete your own images' });
    }
    db.deletePic(pic._id);
    res.json({ ok: true, _id: pic._id });
  });

  return router;
}

module.exports = { createApiRouter, currentUser };
