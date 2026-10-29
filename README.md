# Trade Bull — working pilot

A weekly INR performance journal with account registration, login/logout, private evidence, admin review and a database-driven leaderboard. HTML/CSS/vanilla JS frontend; Node.js 24 + built-in SQLite backend. No npm dependencies or Docker required.

## Run locally

Install Node.js **24.14 or newer within the 24.x release line**. From the repository directory:

```sh
npm test
npm start
```

Open **http://localhost:3000** (use this exact hostname for origin validation). The database is created automatically at `data/tradebull.sqlite`. Only `public/` assets explicitly listed by the server are served. Opening HTML files directly or using VS Code Live Server will not run the APIs.

1. Register a trader account and a separate reviewer account.
2. Promote the reviewer from a terminal on the server:
   ```sh
   npm run admin -- promote reviewer@example.com
   ```
3. Sign in as the trader and submit a completed Monday–Sunday week.
4. Sign in as the reviewer, open **Review**, inspect evidence and record approval/rejection.
5. Approved entries appear on the leaderboard. Rejected/pending entries stay private.

Administrators cannot review their own entries. All review decisions are retained. Re-reviewing an entry can revoke approval. One entry per account per week is enforced by a database constraint. User editing/resubmission is intentionally not implemented; corrections currently require operator assistance and must preserve review history.

## Ranking rules

INR only. Weeks use Asia/Kolkata (IST). Only completed weeks without deposits or withdrawals qualify. Net PnL includes all charges and the change in unrealised PnL; use total account equity consistently. Return = net PnL / starting equity × 100. Exact equal returns share a rank. Amounts are stored as integer paise. Percentage calculation uses floating-point arithmetic. No risk-adjusted score, live prices, broker integration or trade execution.

Published results are **reviewed, self-reported**, not independently broker-verified. The site has no fabricated sample results.

## Recovery

This pilot uses operator-assisted recovery, not email automation. Verify ownership through an established private support channel, then run:

```sh
npm run admin -- reset trader@example.com
```

The command prints a one-use link valid for 30 minutes. Share it privately; never paste it into an issue or application logs. Only its hash is stored in the database. Resetting a password invalidates all existing sessions. Set `APP_ORIGIN` when generating links for a deployed site. Email ownership verification and self-service recovery email delivery are **not implemented**.

## Deploy to a Node host

This backend cannot run on GitHub Pages or static S3 hosting alone. Use a Node.js host with one application instance and a persistent disk, behind an HTTPS reverse proxy. Run `npm start` under a process supervisor.

Environment variables:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Requires HTTPS origin and enables Secure cookies and HSTS |
| `APP_ORIGIN=https://your-real-domain.example` | Exact public origin, no trailing slash |
| `DB_PATH=/persistent/tradebull.sqlite` | Persistent database location; evidence is stored inside SQLite |
| `PORT=3000` | Backend port |
| `HOST=127.0.0.1` | Default loopback; set `0.0.0.0` only where the host/proxy requires it |

Configure the proxy to preserve the public Origin header, limit request bodies to 3 MB and enforce request timeouts. Forwarded IP headers are intentionally not trusted. When using a reverse proxy, the current per-address rate limit is shared across clients behind that proxy; configure trusted client addressing and edge limits before a larger launch.

Back up the database using SQLite's online backup facility, or stop the application cleanly before copying the database. Do not copy only the main file while WAL writes are active. Encrypt and restrict access to backups; rehearse restore before collecting real evidence. Do not use multiple instances or an ephemeral filesystem.

## Before public launch

- Configure the actual domain, HTTPS host, persistent storage, monitoring and backups.
- Replace the contact page's pilot notice with a verified private support address and recovery/deletion process.
- Agree on retention and backup deletion periods and update the privacy page accordingly.
- Add email verification and automated recovery through your selected provider.
- Add full image decoding/re-encoding and malware screening if accepting untrusted public uploads. Current checks enforce size, base64 and PNG/JPEG signatures only; files are downloaded privately as attachments with `nosniff`.
- Add storage quotas/retention, moderation pagination, abuse controls and operational alerts before scaling beyond a small invited pilot.
- Review account deletion/correction procedures, production configuration and security with the host operator.
- Run browser checks on desktop/mobile and test your real deployment's sign-in, submission, download and review flows.

There is no automatic public deployment, domain purchase, email delivery or cloud resource provisioning in this change. The repository does not contain any production credentials.

## Validation

`npm test` runs HTTP integration tests against a temporary on-disk database. It covers registration, login, exact-origin protection, invalid amounts/images/dates, duplicate weeks, private evidence authorization, admin authorization, approval/revocation, return calculations, audit history, recovery reuse prevention, session invalidation and static-path isolation, plus the IST week boundary and insecure production-origin rejection.

CI runs these tests on Node 24 for pushes and pull requests. Built-in SQLite APIs are used; see the [Node SQLite documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).
