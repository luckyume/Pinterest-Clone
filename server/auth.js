'use strict';
/**
 * Sign in with GitHub.
 *
 * When GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are configured the app runs the
 * standard GitHub OAuth web flow:
 *
 *   GET /auth/github  -> github.com/login/oauth/authorize
 *   GET /auth/github/callback -> exchange code, fetch profile, open session
 *
 * Without credentials (local development, offline test runs) the same two
 * routes short-circuit into a local development login so the app stays usable;
 * the UI labels that mode explicitly.
 */
const express = require('express');
const db = require('./db');

const GITHUB = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  user: 'https://api.github.com/user',
};

const DEFAULT_DEV_USER = process.env.DEV_LOGIN_USERNAME || 'octocat';

function clientConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.headers.host}`;
}

function publicUser(user) {
  return { _id: user._id, github: user.github, createdAt: user.createdAt };
}

/** Local stand-in for GitHub's authorisation screen when OAuth isn't configured. */
function devLogin(req, res) {
  const username = String(req.query.username || DEFAULT_DEV_USER).trim() || DEFAULT_DEV_USER;
  const safeName = username.replace(/[^\w.-]/g, '').slice(0, 39) || DEFAULT_DEV_USER;
  let user = db.findUserByName(safeName);
  if (!user) {
    user = db.createUser({
      id: `dev-${safeName}`,
      username: safeName,
      displayName: safeName,
      imageUrl: `/images/avatars/avatar-0${(db.load().users.length % 4) + 1}.png`,
    });
  }
  req.session.userId = user._id;
  const dest = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  res.redirect(dest);
}

async function githubCallback(req, res) {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth callback (state mismatch).');
  }
  delete req.session.oauthState;

  try {
    const tokenRes = await fetch(GITHUB.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'pic-terest',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${baseUrl(req)}/auth/github/callback`,
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenBody.access_token) {
      console.error('[auth] token exchange failed:', tokenBody.error_description || tokenBody.error);
      return res.status(502).send('GitHub token exchange failed.');
    }

    const profileRes = await fetch(GITHUB.user, {
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pic-terest',
      },
    });
    if (!profileRes.ok) {
      console.error('[auth] profile fetch failed:', profileRes.status);
      return res.status(502).send('Could not read your GitHub profile.');
    }
    const profile = await profileRes.json();

    let user = db.findUserByGithubId(profile.id);
    const github = {
      id: String(profile.id),
      username: profile.login,
      displayName: profile.name || profile.login,
      imageUrl: profile.avatar_url || '/images/avatar-fallback.png',
    };
    if (user) {
      user.github = github;
      db.persist();
    } else {
      user = db.createUser(github);
    }

    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    console.error('[auth] oauth error:', err);
    res.status(502).send('GitHub sign-in failed.');
  }
}

function createAuthRouter() {
  const router = express.Router();

  router.get('/auth/github', (req, res) => {
    if (!clientConfigured()) return devLogin(req, res);
    const oauthState = db.objectId();
    req.session.oauthState = oauthState;
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: `${baseUrl(req)}/auth/github/callback`,
      scope: 'read:user',
      state: oauthState,
    });
    res.redirect(`${GITHUB.authorize}?${params}`);
  });

  router.get('/auth/github/callback', (req, res) => {
    if (!clientConfigured()) return devLogin(req, res);
    githubCallback(req, res).catch((err) => {
      console.error('[auth] unhandled:', err);
      res.status(502).send('GitHub sign-in failed.');
    });
  });

  router.get('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  return router;
}

module.exports = { createAuthRouter, clientConfigured, publicUser, DEFAULT_DEV_USER };
