# Pic-terest

A Pinterest-style wall of linked images: sign in with GitHub, paste an image
url, and it drops into a masonry grid. Broken links are swapped for a
placeholder, and anyone can browse anyone's wall without signing in.

Built with Express, a JSON file store, jQuery, and Masonry.js — no CDN, no
database, no build step.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

`npm run generate` re-creates the bundled placeholder, avatar and sample images.
`npm run dev` restarts the server on file changes.

Environment variables (all optional — see [.env.example](.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (`0` or an unusable value falls back to `3000`) |
| `HOST` | `0.0.0.0` | Bind address |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | unset | Real GitHub OAuth app credentials |
| `BASE_URL` | request origin | Public origin used for the OAuth `redirect_uri` |
| `DEV_LOGIN_USERNAME` | `octocat` | User created by the local development login |
| `SESSION_SECRET` | generated once, stored in `data/` | Session signing key |

### Sign in with GitHub

With `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` set, **Login with GitHub**
runs the standard OAuth web flow:

```
GET /auth/github         -> github.com/login/oauth/authorize
GET /auth/github/callback -> code exchange, profile fetch, session cookie
GET /logout              -> session destroyed
```

Create an OAuth app with callback URL `http://localhost:3000/auth/github/callback`
(or set `BASE_URL` to your public origin).

Without credentials the same two routes fall back to a **local development
login** so the app stays usable offline and in tests: `GET /auth/github` opens a
session for `DEV_LOGIN_USERNAME` (or `?username=anything`, creating the account
on first use). The header shows a "Dev mode" banner whenever that fallback is
active, so it is never mistaken for the real flow.

## User stories

| Story | Where it lives |
| --- | --- |
| Unauthenticated users can log in with GitHub | `Login with GitHub` in the header → [server/auth.js](server/auth.js) |
| Authenticated users can link images | `Add` form in the header → `POST /api/pics` → new card at the top of the wall |
| Authenticated users can delete their images | `✕` button on their own cards → `DELETE /api/pics/:id` (owner-only, 403 otherwise) |
| Authenticated users see a masonry wall of their images | **My Pics** → `/my`, laid out by Masonry.js |
| Unauthenticated users can browse other users' walls | `/` (everything), `Members` → `/users`, and any `@username` avatar → `/u/:id` |
| Broken images are replaced by a placeholder | jQuery `error` handler in [public/js/app.js](public/js/app.js) swaps `src` for `/images/placeholder.png`, keeping `data-original-src` |

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/user` | Session user, or `{ "status": "unauthenticated" }` |
| `GET` | `/api/config` | `{ oauthConfigured, devLoginUsername }` |
| `GET` | `/api/users` | Members with `picCount` |
| `GET` | `/api/users/:id` | One member |
| `GET` | `/api/pics` | Every image, newest first (`?owner=<userId>` to filter) |
| `GET` | `/api/pics/:id` | A user's wall when `id` is a user, otherwise one image |
| `GET` | `/api/users/:id/pics` | A user's wall |
| `POST` | `/api/pics` | `{ url, description }`, signed in only |
| `DELETE` | `/api/pics/:id` | Owner only |

An image record looks like:

```json
{
  "_id": "690c1f…",
  "url": "https://example.com/photo.jpg",
  "description": "Golden hour over the canyon",
  "date": "2026-10-28T03:00:54.395Z",
  "ownerId": { "_id": "…", "github": { "id": "…", "username": "lena-lens", "…": "…" } }
}
```

Urls are stored exactly as submitted — nothing is fetched server-side. If the
browser cannot load an image, the client replaces it with the placeholder.

## Data

Everything lives in `data/db.json` (created and seeded on first run). Delete
that file to reset the demo content; `data/` is git-ignored.

## Layout notes

Cards are fixed-width columns (150 / 200 / 240 px by breakpoint) with a 24 px
gutter passed to Masonry; the grid re-lays out on window resize and whenever an
image finishes loading (`imagesLoaded`).
