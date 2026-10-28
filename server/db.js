'use strict';
/**
 * Tiny JSON document store with deterministic seed data.
 *
 * Everything lives in data/db.json so the app runs anywhere with no database
 * installed. Writes are atomic (tmp file + rename).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/** 24-char hex id, shaped like the ObjectIds the original demo used. */
function objectId() {
  return crypto.randomBytes(12).toString('hex');
}

function seed() {
  const users = [
    {
      _id: objectId(),
      github: {
        id: '100001',
        username: 'lena-lens',
        displayName: 'Lena Vogt',
        imageUrl: '/images/avatars/avatar-01.png',
      },
      createdAt: new Date('2025-11-04T09:12:00.000Z').toISOString(),
    },
    {
      _id: objectId(),
      github: {
        id: '100002',
        username: 'pablo-pixels',
        displayName: 'Pablo Ruiz',
        imageUrl: '/images/avatars/avatar-02.png',
      },
      createdAt: new Date('2025-11-19T17:40:00.000Z').toISOString(),
    },
    {
      _id: objectId(),
      github: {
        id: '100003',
        username: 'mori-moss',
        displayName: 'Mori Ito',
        imageUrl: '/images/avatars/avatar-03.png',
      },
      createdAt: new Date('2026-01-08T07:05:00.000Z').toISOString(),
    },
  ];

  const pics = [
    ['lena-lens', '/images/samples/sample-01.png', 'Golden hour over the canyon'],
    ['lena-lens', '/images/samples/sample-04.png', 'Ferns after the rain'],
    ['lena-lens', '/images/samples/sample-07.png', 'Neon alley, 2am'],
    ['pablo-pixels', '/images/samples/sample-02.png', 'Pool water study'],
    ['pablo-pixels', '/images/samples/sample-05.png', 'Harbour at blue hour'],
    ['pablo-pixels', '/images/samples/sample-09.png', 'Desert motel sign'],
    ['mori-moss', '/images/samples/sample-03.png', 'Rooftop sunset, Lisbon'],
    ['mori-moss', '/images/samples/sample-06.png', 'Coral skies, no filter'],
    ['mori-moss', '/images/samples/sample-08.png', 'Night drive playlist cover'],
  ].map(([owner, url, description], i) => {
    const ownerUser = users.find((u) => u.github.username === owner);
    return {
      _id: objectId(),
      url,
      description,
      ownerId: ownerUser._id,
      date: new Date(Date.UTC(2026, 0, 10 + i, 11, 30)).toISOString(),
    };
  });

  return { users, pics, version: 1 };
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.pics)) {
      cache = parsed;
      return cache;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[db] could not read ${DB_FILE} (${err.message}); reseeding`);
    }
  }
  cache = seed();
  persist();
  return cache;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ------------------------------------------------------------------- users

function findUserByGithubId(githubId) {
  return load().users.find((u) => u.github.id === String(githubId)) || null;
}

function findUserByName(username) {
  const needle = String(username || '').toLowerCase();
  return load().users.find((u) => u.github.username.toLowerCase() === needle) || null;
}

function findUserById(id) {
  return load().users.find((u) => u._id === id) || null;
}

function createUser({ id, username, displayName, imageUrl }) {
  const user = {
    _id: objectId(),
    github: {
      id: String(id),
      username,
      displayName: displayName || username,
      imageUrl: imageUrl || '/images/avatar-fallback.png',
    },
    createdAt: new Date().toISOString(),
  };
  load().users.push(user);
  persist();
  return user;
}

function listUsers() {
  const pics = load().pics;
  return load().users.map((user) => ({
    ...user,
    picCount: pics.filter((p) => p.ownerId === user._id).length,
  }));
}

// -------------------------------------------------------------------- pics

function listPics() {
  return load().pics.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
}

function picsByOwner(ownerId) {
  return load()
    .pics.filter((p) => p.ownerId === ownerId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function findPic(id) {
  return load().pics.find((p) => p._id === id) || null;
}

function createPic({ url, description, ownerId }) {
  const pic = {
    _id: objectId(),
    url,
    description: description || '',
    ownerId,
    date: new Date().toISOString(),
  };
  load().pics.push(pic);
  persist();
  return pic;
}

function deletePic(id) {
  const db = load();
  const index = db.pics.findIndex((p) => p._id === id);
  if (index === -1) return null;
  const [pic] = db.pics.splice(index, 1);
  persist();
  return pic;
}

/** Denormalise a pic the way the original API did: owner inline. */
function withOwner(pic) {
  const owner = findUserById(pic.ownerId);
  return {
    _id: pic._id,
    url: pic.url,
    description: pic.description,
    date: pic.date,
    ownerId: owner
      ? { _id: owner._id, github: owner.github }
      : { _id: pic.ownerId, github: { username: 'unknown', imageUrl: '/images/avatar-fallback.png' } },
  };
}

module.exports = {
  DATA_DIR,
  objectId,
  load,
  persist,
  findUserByGithubId,
  findUserByName,
  findUserById,
  createUser,
  listUsers,
  listPics,
  picsByOwner,
  findPic,
  createPic,
  deletePic,
  withOwner,
};
