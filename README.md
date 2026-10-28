# File-Sharing-Service-With-One-Off-Transfer

FileShare lets a logged-in owner upload a file and send it to someone through a private link that expires or can be revoked. The recipient needs no account. See [PRD.md](PRD.md) for the full requirements.

## Run it locally

Needs Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000, register, upload a file, create a share link, and open the link in a private window.

Run the tests (12 tests: auth, upload rules, quota, links, expiry, revoke, ownership):

```bash
npm test
```

Run with Docker:

```bash
docker build -t fileshare .
docker run -p 3000:3000 -e JWT_SECRET=change-me -v fileshare-data:/data fileshare
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | dev-only value | **Required** when `NODE_ENV=production`; the server refuses to start without it |
| `DATA_DIR` | `./data` | Holds `app.db` (SQLite) and `uploads/`. Must be a persistent volume in production |
| `PORT` | `3000` | |
| `NODE_ENV` | unset | `production` turns on the `Secure` cookie flag and the secret check |

See [.env.example](.env.example).

## 1. Users and scope
- **Owner (logged in):** register, log in, upload, create share links with an expiry, see download counts, expire or revoke links early, delete files.
- **Recipient (no account):** open a link, see the file name and size, download it, or see why the link no longer works.
- **Out of scope:** password-protected links, previews, folders, email sending, virus scanning, resumable uploads, admin panel, password reset.

## 2. File rules
| Rule | Value |
|---|---|
| Max size | 10 MB per file |
| Quota | 50 MB per user |
| Types | pdf, docx, pptx, txt, zip, and images: png, jpg/jpeg, gif, webp, bmp, tif/tiff, ico, avif, heic/heif (SVG excluded on purpose, it can contain scripts) |
| Link expiry | 30 seconds, 5 minutes, 1 hour, 1 day or 7 days; the owner can also expire a link early with "Expire now" |
| Rate limits | uploads 20/min, link creation 30/min, public link views 60/min, login/register 30 per 15 min (per IP) |

All of these are enforced by the server. The browser repeats some checks only to show errors faster.

## 3. Architecture and flow

```
 Browser (public/*.html, *.js)
   |  JSON + multipart over HTTP, session cookie
   v
 Express server (server.js)
   |-- routes/auth.js     register, login, logout, /api/me
   |-- routes/files.js    upload, list, delete         (owner only)
   |-- routes/links.js    create link, revoke          (owner only)
   |-- routes/public.js   link info, download          (anyone with the token)
   |
   |-- SQLite  DATA_DIR/app.db       users, files, links
   '-- Disk    DATA_DIR/uploads/<uuid>   file bytes, random names, never served statically
```

**Upload:** logged in? -> quota not already full? -> stream to disk under a random name, cut off at 10 MB -> extension allowed and the real first bytes match it? -> quota re-checked and the row inserted in one transaction -> done. Any failure deletes the stored bytes.

**Share:** owner picks an expiry -> server makes a 32-byte random token -> stores only its SHA-256 hash -> returns the URL once.

**Download:** recipient opens `/s/<token>` -> page asks `/api/s/<token>` -> server hashes the token and checks it exists, is not revoked and is not expired -> shows a Download button or a clear message -> `/s/<token>/download` checks again, counts the download and sends the file as an attachment.

**Why this design:** one Node process with an embedded SQLite file means nothing extra to install or run, so anyone can clone and start it. Files stay on disk next to the database so a single persistent volume holds all state.

## 4. Persistence
Everything lives under `DATA_DIR`: the SQLite database and the uploaded bytes. Restarting the server keeps both. In Docker, mount a volume at `/data` (the run command above does). On a host without a persistent disk, every redeploy would wipe the data.

## 5. Unguessable links and access control
- Tokens are 32 bytes from `crypto.randomBytes` (2^256 possibilities), URL-safe base64.
- The database stores only `sha256(token)`, so a leaked database cannot be turned back into working links.
- Every public request re-checks revoked and expired status, including the download itself.
- Every owner request filters by `owner_id`, so another user's file or link returns 404, not 403, and does not reveal that it exists.

## 6. Malicious files
- Files are stored under random UUID names with no extension, outside the static folder: no path traversal, no direct execution or serving.
- The extension must be on the allowlist and the file's first bytes must match it, so `virus.exe` renamed to `photo.png` is rejected.
- Downloads are always sent as `application/octet-stream` with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a sandbox CSP, so the browser never renders an uploaded file (no stored XSS).
- File names are cleaned on upload and always inserted into pages as text, never HTML.
- `helmet` sets a strict Content-Security-Policy on every page.
- Zip files are stored, never extracted.

## 7. Abuse and limits
- Size is cut off while streaming, so a huge upload never fully lands.
- Quota check and insert share a transaction, so parallel uploads can't sneak past it.
- Rate limits on login, upload, link creation and public link views.
- Passwords are hashed with bcrypt; the session is a JWT in an `httpOnly`, `SameSite=Strict` cookie.
- An hourly cleanup removes upload leftovers with no database row and link rows expired or revoked over 7 days ago.

## Deploy

**Render:** New > Blueprint > choose this repo. [render.yaml](render.yaml) builds the Dockerfile, generates `JWT_SECRET` and attaches a 1 GB disk at `/data`. Persistent disks need a paid instance type on Render.

**Railway:** New project from this repo (it detects the Dockerfile), add a Volume mounted at `/data`, and set `JWT_SECRET` and `NODE_ENV=production`.

After deploying, check `https://<your-app>/api/health` returns `{"ok":true}`.

## Demo script (5 minutes)
1. Register `owner@test.com` and upload a PDF. The storage bar moves.
2. Try uploading a `.exe` renamed to `.png`: "File contents do not match its type".
3. Try an 11 MB file: "File too large".
4. Create a 1-hour link, copy it, open it in a private window, download. The download count goes to 1.
5. Revoke the link and refresh the private window: "This link was revoked". Create another link with 30 seconds expiry, wait, and see "This link has expired" (or press "Expire now").
6. Register a second user: they see none of the first user's files.
7. Restart the server: files, links and counts are still there.

## Project layout
```
server.js           app setup, routes, static files
config.js           limits and paths
db.js               SQLite schema
middleware/auth.js  session check
routes/             auth, files, links, public
lib/                validate (type checks), tokens, cleanup
public/             frontend pages, script and styles
test/               node:test suites
```

## Team
| Part | Owner | Scope |
|---|---|---|
| A | | accounts, upload, quota, validation, delete |
| B | | share links, revoke, public download |
| C | | frontend |
| D | | deployment, docs, testing |
