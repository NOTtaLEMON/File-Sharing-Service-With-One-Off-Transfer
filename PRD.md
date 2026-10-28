# PRD: FileShare (PS2 File-Sharing Service, one-off transfer variant)

## 1. Problem
Users need to send a file to someone else through a link that expires or can be revoked. Nothing uploaded may harm the service or the people who open the link.

## 2. Users and scope
| Role | Can do |
|---|---|
| **Owner** (registered, logged in) | Register, log in, upload files, create share links with an expiry, see download counts, revoke a link, delete a file |
| **Recipient** (no account) | Open a share link, see a download page, download the file, see a clear message if the link is expired, revoked or unknown |

**Out of scope:** password-protected links, in-browser previews, folders, email delivery, virus-scanning service, resumable uploads, admin panel, password reset, social login.

## 3. File rules
| Rule | Value | Enforced by |
|---|---|---|
| Max file size | 10 MB | Server, while the upload streams (also a quick client check) |
| Per-user quota | 50 MB total | Server, inside a database transaction |
| Allowed types | pdf, png, jpg/jpeg, txt, zip, docx | Server: extension allowlist and a check of the file's real first bytes |
| Link expiry | 30 seconds, 5 minutes, 1 hour, 1 day or 7 days; owner can also expire a link early | Server, checked on every request |
| Upload rate | 20 per minute per IP | Server (`express-rate-limit`) |
| Login/register rate | 30 per 15 minutes per IP | Server |
| Password | 8 to 100 characters | Server |

## 4. Functional requirements
1. **Accounts:** register, log in, log out. Passwords are hashed with bcrypt. A session is a JWT in an httpOnly, SameSite=Strict cookie.
2. **Upload:** a logged-in owner uploads one file. The server rejects wrong types, disguised files, oversized files and uploads that exceed the quota, each with a clear message.
3. **Dashboard:** lists the owner's files with size, date, links, link status (active, expired, revoked) and download count. Shows storage used against the quota.
4. **Share link:** the owner picks an expiry and gets a URL once. The raw token is never stored.
5. **Recipient page:** `/s/<token>` shows file name and size with a Download button, or a specific message for expired, revoked and not-found links.
6. **Download:** streams the file as an attachment and increments the link's download count.
7. **Revoke or expire now:** the owner turns a link off immediately. A revoked link shows "revoked"; a link expired early shows "expired".
8. **Delete:** the owner deletes a file. Its record, its links and the file on disk are removed.

## 5. Architecture
```
Browser (static HTML/JS)  --HTTP-->  Express server  -->  SQLite  (data/app.db)
                                          |
                                          +-->  Disk folder  (data/uploads/<uuid>)
```
- **Stack:** Node.js, Express, SQLite via `better-sqlite3`, plain HTML/CSS/JS frontend, Docker for deployment.
- **Why:** one process and one file database means no external services to set up, so anyone on the team can run it with `npm install && npm start`.

### Upload flow
Logged-in request -> early quota check -> stream to disk under a random UUID name with a 10 MB cap -> check extension and real file bytes -> quota check and database insert in one transaction -> respond. Any failure deletes the stored file.

### Share and download flow
Owner creates a link -> server makes a random 32-byte token, stores only its SHA-256 hash with the expiry -> owner receives the URL once -> recipient opens `/s/<token>` -> server hashes the token, checks existence, revoked status and expiry -> serves the download page or an error message -> download streams the file and counts it.

## 6. Data model
```
users(id, email UNIQUE, password_hash, created_at)
files(id, owner_id, original_name, stored_name UNIQUE, mime, size, created_at)
links(id, file_id, token_hash UNIQUE, expires_at, revoked_at, download_count, created_at)
```
Files and metadata live under `DATA_DIR` (default `./data`). In deployment this must be a persistent volume so data survives a restart.

## 7. Security requirements
| Threat | Mitigation |
|---|---|
| Guessable links | 32 random bytes (256 bits), base64url; only the hash is stored |
| Malicious or disguised file | Extension allowlist, magic-byte check, stored MIME is ours not the client's, no archive extraction |
| Stored XSS via file or name | Always `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; names are cleaned and inserted as text, never HTML; strict CSP via `helmet` |
| Path traversal | Files saved under random names; original name never used as a path; uploads folder is not served statically |
| Accessing others' files (IDOR) | Every owner query includes `owner_id`; another user's file or link returns 404 |
| Limit bypass | Size, quota and expiry are enforced on the server; client checks are only for convenience |
| Brute force | Rate limits on login, register and upload; same error for unknown email and wrong password |
| Cross-site request abuse | SameSite=Strict cookie; JSON-only auth endpoints |
| Leftover files | Orphan sweep at startup and hourly; expired-link cleanup (see open items) |

## 8. UX requirements
- Clear messages for: wrong type, too large, quota full, expired link, revoked link, unknown link, not logged in.
- Upload progress bar, drag and drop, keyboard-accessible controls with visible focus, responsive down to phone width, reduced-motion support.
- Visual style: Playful Geometric (warm paper, outlined shapes, hard offset shadows).

## 9. Team split
| Person | Owns |
|---|---|
| A | Accounts, upload, quota, validation, delete, persistence (`routes/auth.js`, `routes/files.js`, `lib/`, `db.js`) |
| B | Share links, token hashing, revoke, public download, download counter, safe headers, expiry cleanup (`routes/links.js`, `routes/public.js`) |
| C | Frontend (`public/`) |
| D | Deployment, README, scope and file-rules docs, architecture diagram, demo script, final end-to-end test |

A and C are the same person on this team.

## 10. API contract
```
POST   /api/auth/register | /login | /logout
GET    /api/me                       -> {email, used_bytes, quota_bytes}
POST   /api/files          (multipart, field "file")
GET    /api/files                    -> files with links and download counts
DELETE /api/files/:id
POST   /api/files/:id/links          {expires_in: 30|300|3600|86400|604800} -> {id, url, expires_at}
POST   /api/links/:id/revoke         -> {ok:true}
POST   /api/links/:id/expire         -> {ok:true}   (ends the link now; recipient sees "expired")
GET    /api/s/:token                 -> {status:'ok', name, size} | {status:'expired'|'revoked'|'not_found'}
GET    /s/:token                     (recipient page)
GET    /s/:token/download            (file as attachment)
```

## 11. Status
| Area | Status |
|---|---|
| Accounts, upload, quota, validation, delete, dashboard, recipient page UI | Implemented and tested |
| Share links, revoke, public download, download counter | Implemented and tested (`routes/links.js`, `routes/public.js`, `lib/tokens.js`) |
| Cleanup | Orphaned uploads and links expired/revoked over 7 days ago are removed hourly; files stay until the owner deletes them |
| Deployment config, README, architecture diagram, demo script | Done (`Dockerfile`, `render.yaml`, `README.md`); not yet deployed to a host |
| Automated tests | 10 `node:test` tests pass |
| End-to-end flow | Checked in a browser: upload, share, download, count, revoke, restart persistence |

## 12. Success criteria (maps to the 10 evaluation questions)
1. Roles and out-of-scope list: sections 2 and 9.
2. File rules: section 3.
3. Architecture and flow with reasons: section 5.
4. Persistence across restart: section 6 (SQLite file and uploads on a persistent volume).
5. Unguessable links and access enforcement: sections 5 and 7.
6. End-to-end flow works: upload, share, download, revoke (section 11).
7. Malicious file cannot hurt service or users: section 7.
8. Limits enforced by the server: section 3.
9. No access to what isn't yours: section 7.
10. Deployed and runnable by others: part D (Docker, README, `npm test`).

## 13. Open items and risks
- `JWT_SECRET` must be set in production; the app refuses to start without it.
- Persistent storage must be mounted at `DATA_DIR` on the host, or data is lost on redeploy.
- The magic-byte check confirms a file looks like its type but is not a malware scan; this is a stated limitation.
- Cookie-based sessions rely on SameSite=Strict; a dedicated CSRF token is not implemented.
