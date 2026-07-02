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

| Layer     | Choice                                                       |
| --------- | ------------------------------------------------------------ |
| Hosting   | **Vercel** (static client + serverless API in `/api`)        |
| Backend   | Node.js + Express (runs as a Vercel Serverless Function)     |
| Data      | **Vercel KV / Upstash Redis** (JSON-file fallback for local dev) |
| Gmail     | `googleapis` (OAuth 2.0, `gmail.readonly`)                   |
| Frontend  | React + Vite (custom CSS design system)                      |
| Auto-sync | Vercel Cron + in-browser background refresh                  |

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

## Deploy to Vercel

This project is built for Vercel. `vercel.json` tells Vercel to build the Vite
client, serve it as static files, and run the Express API as a Serverless
Function at `api/index.js` (all `/api/*` requests are rewritten to it).

### 1. Create the storage (required)

Vercel's filesystem is ephemeral, so data must live in an external store. Add a
free Redis database — it takes ~1 minute:

1. In your Vercel **Project → Storage → Create Database**, choose **Upstash for
   Redis** (from the Marketplace) and connect it to the project.
2. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (and/or
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) as environment
   variables automatically. The app auto-detects them — no code changes needed.

> If no Redis is configured, the app still runs but stores data in the ephemeral
> `/tmp` filesystem, which resets on cold starts (fine for a quick demo only).

### 2. Add the Google OAuth env vars

In **Project → Settings → Environment Variables** add:

| Variable               | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | your OAuth client id                                             |
| `GOOGLE_CLIENT_SECRET` | your OAuth client secret                                         |
| `GOOGLE_REDIRECT_URI`  | `https://<your-project>.vercel.app/api/auth/google/callback`     |

Then add that **exact** redirect URI to your Google Cloud OAuth client (see the
"Connecting Gmail" section above).

### 3. Deploy & connect

Push to GitHub and import the repo into Vercel (or run `vercel`). After it
deploys, open the app and click **Connect Gmail**.

### How auto-updating works on Vercel

Serverless functions can't run a persistent background timer, so the app keeps
statuses fresh two ways:

- **Vercel Cron** hits `GET /api/cron/sync` on a schedule (configured in
  `vercel.json`; Hobby plans allow a daily cron, Pro allows more frequent —
  just edit the `schedule`).
- **In-browser refresh** — while the dashboard tab is open and connected, it
  triggers a sync every few minutes so new emails move jobs to their new status
  automatically. The **Sync now** button forces an immediate refresh any time.

> **Function duration:** the very first sync of a large inbox can be slow.
> `vercel.json` sets `maxDuration` to 60s; if an initial sync times out, just
> click **Sync now** again — already-imported emails are skipped, so it resumes.

## AI classification (recommended)

By default the app uses a built-in **keyword classifier**. For much higher
accuracy, add an OpenAI-compatible API key and it will use an **LLM** to read
each email and determine its stage, company, and role.

1. In Vercel → **Project → Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` — your key (from platform.openai.com or any OpenAI-
     compatible provider).
   - *(optional)* `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_BASE_URL`.
2. **Redeploy.**
3. The header shows **"✨ AI classifier"** when it's active (vs. "Keyword
   classifier").

To re-classify emails you already imported with the old classifier, click
**Clear data**, then **Sync now** (repeat until it reports it's finished — the
AI processes a batch per sync to stay within serverless time limits). Your
Gmail connection is preserved when you clear data.

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

| Variable                                    | Default                                          | Description                                                     |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`                          | —                                                | Google OAuth client ID.                                         |
| `GOOGLE_CLIENT_SECRET`                      | —                                                | Google OAuth client secret.                                     |
| `GOOGLE_REDIRECT_URI`                       | `http://localhost:4000/api/auth/google/callback` | Must match the URI registered in Google Cloud.                  |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`     | — (set by Vercel KV)                             | Durable Redis storage. Injected by the Upstash/Vercel KV integration. |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN`      | —                                                | Alternative Redis credentials (standalone Upstash).             |
| `OPENAI_API_KEY`                            | —                                                | Enables the AI classifier. Unset = keyword classifier.          |
| `OPENAI_MODEL` / `OPENAI_BASE_URL`          | `gpt-4o-mini` / OpenAI                           | AI model and (optional) OpenAI-compatible endpoint.             |
| `SYNC_LOOKBACK_DAYS`                        | `365`                                            | How far back to search Gmail.                                   |
| `SYNC_MAX_PER_RUN`                          | `40` (AI) / `250`                                | New emails fully processed per sync run.                        |
| `SYNC_INTERVAL_MINUTES`                     | `10`                                             | In-process poll interval (used only when running as a persistent server, not on Vercel). |
| `DATA_DIR`                                  | `./data`                                         | JSON-store path when Redis isn't configured (local dev only).   |
| `PORT`                                      | `4000`                                           | Port for the standalone server (`npm start`).                   |

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
