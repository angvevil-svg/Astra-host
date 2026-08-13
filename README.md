# 🌙 Astra Host — single-user bot dashboard

A small self-hosted control panel for running your own Node.js bots (like Astra,
your Club Astra bot) on a VPS. Upload a zipped project, start/stop/restart it,
watch live logs, and edit its environment variables — all from a browser.

## What it does

- **Upload** a `.zip` of any Node.js bot project
- **Start / Stop / Restart** it as a managed child process
- **Live logs** streamed to the browser in real time (stdout, stderr, system events)
- **Install dependencies** (`npm install`) for a bot straight from the dashboard
- **Environment variables** per bot, stored server-side and injected at start
- **Delete** a bot and its files entirely

This is a control panel for processes *you* run — it does not sandbox or isolate
bots from each other or from the host. Don't expose it to the public internet
without adding authentication (see below) since anyone who can reach it can
run arbitrary Node.js code on your server.

## Setup

```bash
cd astra-host
npm install
npm start
```

Open `http://localhost:4000` (or `http://your-vps-ip:4000` if hosted remotely).

## Using it

1. Click **+ Add bot**, give it a name, confirm the entry file (usually `index.js`),
   and upload a `.zip` of the bot's project folder (the same folder you'd run
   `npm install` in — include `package.json`, but `node_modules` isn't required
   since you can install it from the dashboard).
2. Click the bot in the sidebar, then **Install deps** if it has a `package.json`.
3. Click **Environment** and paste in `.env`-style values, e.g.:
   ```
   DISCORD_TOKEN=your_token
   CLIENT_ID=your_client_id
   ```
4. Click **▶ Start**. Logs stream live below.

## Running the dashboard itself 24/7

Same idea as any Node app — use PM2 so the dashboard survives reboots and crashes:

```bash
npm install -g pm2
pm2 start server.js --name astra-host
pm2 save
pm2 startup
```

## Securing it (important before exposing this to the internet)

This build has **no login** — it's meant for `localhost` or an SSH tunnel
(`ssh -L 4000:localhost:4000 user@your-vps`). If you want it reachable directly,
put it behind a reverse proxy (nginx/Caddy) with HTTP basic auth, or ask me to
add a simple password-gate to `server.js`.

## How it works

- `server.js` — Express app: REST endpoints for CRUD + control, plus a
  Server-Sent-Events route for live logs.
- `processManager.js` — spawns each bot as `node <entryFile>` inside its own
  folder under `bots/<id>/`, keeps a rolling 500-line log buffer, and reports
  status (`running` / `stopped` / `crashed`).
- `store.js` — bot metadata (name, entry file, env vars) persisted to
  `data/bots.json`.
- `public/` — the dashboard UI (plain HTML/CSS/JS, no build step).

Each uploaded bot lives entirely in its own `bots/<id>/` folder, so multiple
bots don't share `node_modules` or environment variables.
