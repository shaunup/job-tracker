# Job Tracker

A self-hosted dashboard that automatically tracks every job you've applied to by
reading your **Gmail**. It scans your inbox for recruiting emails, groups them by
company/role, and classifies each application into one of five stages:

> **Applied → Assessment → Interview → Offer** &nbsp;·&nbsp; **Rejected**

When new mail arrives, a background sync re-classifies it and moves the job to
its new status automatically — so the board is always up to date.

![statuses](https://img.shields.io/badge/stages-applied%20%7C%20assessment%20%7C%20interview%20%7C%20offer%20%7C%20rejected-6366f1)

---

## Features

- **Gmail as the data source** — connect with Google OAuth 2.0 (read-only scope).
- **Automatic status detection** — a keyword/heuristic engine reads each email
  and decides whether it's an application receipt, an assessment invite, an
  interview request, an offer, or a rejection.
- **Live dashboard** — stat cards, per-stage filters, search, and a pipeline
  view for each application.
- **Email timeline** — click any job to see every email that shaped its status.
- **Auto-sync** — polls Gmail on an interval so new emails update job statuses
  with no manual work.
- **Demo mode** — explore the whole UI instantly with realistic sample data,
  no Google account required.

## Tech stack

| Layer     | Choice                                        |
| --------- | --------------------------------------------- |
| Backend   | Node.js + Express                             |
| Data      | Dependency-free JSON store (no native modules) |
| Gmail     | `googleapis` (OAuth 2.0, `gmail.readonly`)    |
| Frontend  | React + Vite (custom CSS design system)       |
| Deploy    | Vercel (serverless) **or** Render/Railway/Fly (persistent) |

---

## Quick start

```bash
# 1. Install dependencies (also installs the client)
npm install

# 2. Configure (optional for demo mode, required for Gmail)
cp .env.example .env
#    ...fill in your Google OAuth credentials (see below)

# 3a. Development (hot-reload server + client)
npm run dev
#     server → http://localhost:4000   client → http://localhost:5173

# 3b. Production (build the client, serve everything from one port)
npm run build
npm start
#     app → http://localhost:4000
```

> **Just want to look around?** Start the app and click **"Explore with sample
> data"** on the dashboard — no Gmail setup needed.

---

## Connecting Gmail (Google OAuth setup)

To read your real inbox you need Google OAuth credentials. It's free and takes a
few minutes:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. **APIs & Services → Library →** enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen:**
   - User type **External**.
   - Add the scope `.../auth/gmail.readonly`.
   - Under **Test users**, add your own Gmail address (required while the app is
     in "testing").
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type **Web application**.
   - **Authorized redirect URI:** `http://localhost:4000/api/auth/google/callback`
     (must match `GOOGLE_REDIRECT_URI` in your `.env`).
5. Copy the **Client ID** and **Client secret** into `.env`:

   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
   ```

6. Restart the server, open the dashboard, and click **Connect Gmail**.

Your OAuth tokens are stored locally in `data/jobtracker.sqlite` and never leave
your machine. The scope is **read-only** — the app can never send or delete mail.

---

## Deploying

The app ships with config for both a serverless and a persistent host.

### Option A — Vercel (serverless)

`vercel.json` is included: it builds the Vite client, serves it as static files,
and runs the Express API as a serverless function (`api/index.js`). The `/api/*`
routes are rewritten to that function.

1. Import the repo into Vercel.
2. In **Project → Settings → Environment Variables**, add:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI = https://<your-project>.vercel.app/api/auth/google/callback`
3. Add that exact redirect URI to your Google Cloud OAuth client.
4. Redeploy, then click **Connect Gmail**.

A daily [Vercel Cron](https://vercel.com/docs/cron-jobs) hit to `/api/cron/sync`
refreshes statuses automatically (the **Sync now** button triggers it instantly
any time). On the Pro plan you can increase the cron frequency in `vercel.json`.

> **Serverless persistence caveat:** Vercel functions have an ephemeral, per-
> instance `/tmp` filesystem, so stored emails and your Gmail connection can
> reset on cold starts. This is fine for trying the app, but for durable,
> always-fresh tracking use a persistent host (below).

### Option B — Render / Railway / Fly (persistent, recommended for real use)

A `render.yaml` blueprint is included. A single long-lived process means the
built-in **auto-sync polling** (`SYNC_INTERVAL_MINUTES`) works continuously and,
with a mounted disk (`DATA_DIR`), your data persists across restarts.

1. Push to GitHub → in Render pick **New + → Blueprint** and select the repo.
2. Provide the `GOOGLE_*` env vars and set `GOOGLE_REDIRECT_URI` to
   `https://<service>.onrender.com/api/auth/google/callback`.
3. Add that redirect URI to your Google Cloud OAuth client, then **Connect Gmail**.

The same setup works on Railway, Fly.io, a VPS, or Docker — anywhere you can run
`npm start` as a persistent process.

## How status detection works

Each email is passed through [`server/classifier.js`](server/classifier.js),
which scores it against weighted phrase patterns for every stage, e.g.:

| Stage        | Example signals                                                    |
| ------------ | ------------------------------------------------------------------ |
| `applied`    | "thank you for applying", "we received your application"           |
| `assessment` | "coding challenge", "online assessment", "HackerRank", "take-home" |
| `interview`  | "schedule an interview", "phone screen", "availability", Calendly  |
| `offer`      | "pleased to extend an offer", "offer letter", "welcome aboard"     |
| `rejected`   | "unfortunately", "not moving forward", "other candidates"          |

Emails are then grouped by **company + role** into a *job*. A job's current
status comes from its **most recent** status-bearing email, so a rejection after
an interview correctly shows as *Rejected*, and an offer shows as *Offer*.

You can tune the phrases/weights in `server/classifier.js` to fit the wording
recruiters use in your industry.

---

## Configuration reference

| Variable                | Default                                             | Description                                        |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `PORT`                  | `4000`                                               | Server port (also serves the built dashboard).     |
| `GOOGLE_CLIENT_ID`      | —                                                    | Google OAuth client ID.                            |
| `GOOGLE_CLIENT_SECRET`  | —                                                    | Google OAuth client secret.                        |
| `GOOGLE_REDIRECT_URI`   | `http://localhost:4000/api/auth/google/callback`     | Must match the URI registered in Google Cloud.     |
| `SYNC_INTERVAL_MINUTES` | `10`                                                 | How often to auto-poll Gmail (`0` disables it).    |
| `SYNC_LOOKBACK_DAYS`    | `365`                                                | How far back to search Gmail.                      |

---

## API endpoints

| Method | Path                          | Purpose                                  |
| ------ | ----------------------------- | ---------------------------------------- |
| GET    | `/api/status`                 | Connection + sync status and counts.     |
| GET    | `/api/auth/google`            | Begin the Google OAuth flow.             |
| GET    | `/api/auth/google/callback`   | OAuth redirect target.                   |
| POST   | `/api/auth/disconnect`        | Remove stored Gmail tokens.              |
| GET    | `/api/jobs`                   | All tracked jobs + per-status counts.    |
| GET    | `/api/jobs/:key/emails`       | Email timeline for one job.              |
| POST   | `/api/sync`                   | Trigger a Gmail sync now.                |
| GET    | `/api/cron/sync`              | Scheduled-sync target (Vercel Cron).     |
| POST   | `/api/demo`                   | Load sample data.                        |
| POST   | `/api/reset`                  | Clear all stored data.                   |

---

## Notes & limitations

- Status detection is heuristic. Recruiter wording varies, so review the board
  and tweak `server/classifier.js` if something is miscategorized.
- The app is designed for a single user (your own inbox).
- SQLite data lives in `data/` and is git-ignored.
