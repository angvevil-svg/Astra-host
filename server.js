const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const store = require('./store');
const pm = require('./processManager');

const app = express();
const PORT = process.env.PORT || 4000;
const BOTS_DIR = path.join(__dirname, 'bots');
const UPLOAD_TMP = path.join(__dirname, 'data', 'tmp');

fs.mkdirSync(BOTS_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_TMP, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOAD_TMP, limits: { fileSize: 50 * 1024 * 1024 } });

function serialize(bot) {
  return {
    id: bot.id,
    name: bot.name,
    entryFile: bot.entryFile,
    autoStart: !!bot.autoStart,
    createdAt: bot.createdAt,
    status: pm.status(bot.id),
    uptimeSeconds: pm.uptimeSeconds(bot.id),
    envKeys: Object.keys(bot.env || {})
  };
}

// ---------- List bots ----------
app.get('/api/bots', (req, res) => {
  res.json(store.readAll().map(serialize));
});

// ---------- Upload a new bot (zip of a Node.js project) ----------
app.post('/api/bots', upload.single('bundle'), (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const entryFile = (req.body.entryFile || 'index.js').trim();
    if (!name) return res.status(400).json({ error: 'Bot name is required.' });
    if (!req.file) return res.status(400).json({ error: 'A .zip file is required.' });

    const id = crypto.randomBytes(6).toString('hex');
    const dest = pm.botDir(id);
    fs.mkdirSync(dest, { recursive: true });

    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(dest, true);
    fs.unlinkSync(req.file.path);

    // If the zip contained a single wrapping folder, flatten it
    const entries = fs.readdirSync(dest);
    if (entries.length === 1 && fs.statSync(path.join(dest, entries[0])).isDirectory()) {
      const inner = path.join(dest, entries[0]);
      for (const item of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, item), path.join(dest, item));
      }
      fs.rmdirSync(inner);
    }

    const bot = store.upsertBot({
      id,
      name,
      entryFile,
      env: {},
      autoStart: false,
      createdAt: Date.now()
    });

    res.status(201).json(serialize(bot));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Start / stop / restart ----------
app.post('/api/bots/:id/start', (req, res) => {
  try {
    pm.start(req.params.id);
    res.json({ status: pm.status(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bots/:id/stop', (req, res) => {
  pm.stop(req.params.id);
  res.json({ status: pm.status(req.params.id) });
});

app.post('/api/bots/:id/restart', (req, res) => {
  try {
    pm.restart(req.params.id);
    res.json({ status: 'restarting' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Run npm install inside a bot's folder ----------
app.post('/api/bots/:id/install', (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  const { spawn } = require('child_process');
  const dir = pm.botDir(bot.id);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    return res.status(400).json({ error: 'No package.json found in this bot.' });
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['install'], { cwd: dir });
  proc.stdout.on('data', (d) => pm.bus.emit('log:' + bot.id, { t: Date.now(), stream: 'system', line: d.toString().trim() }));
  proc.stderr.on('data', (d) => pm.bus.emit('log:' + bot.id, { t: Date.now(), stream: 'system', line: d.toString().trim() }));
  proc.on('exit', (code) => {
    pm.bus.emit('log:' + bot.id, { t: Date.now(), stream: 'system', line: 'npm install finished (code ' + code + ')' });
  });

  res.json({ started: true });
});

// ---------- Update environment variables ----------
app.put('/api/bots/:id/env', (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const env = req.body.env || {};
  store.upsertBot({ id: bot.id, env });
  res.json({ envKeys: Object.keys(env) });
});

// ---------- Delete a bot ----------
app.delete('/api/bots/:id', (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  pm.stop(bot.id);
  const dir = pm.botDir(bot.id);
  fs.rm(dir, { recursive: true, force: true }, () => {});
  store.removeBot(bot.id);
  res.json({ deleted: true });
});

// ---------- Live logs (Server-Sent Events) ----------
app.get('/api/bots/:id/logs/stream', (req, res) => {
  const id = req.params.id;
  const bot = store.getBot(id);
  if (!bot) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // replay recent history first
  for (const entry of pm.getLogs(id)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const onLog = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
  const onStatus = (s) => res.write(`event: status\ndata: ${JSON.stringify({ status: s })}\n\n`);

  pm.bus.on('log:' + id, onLog);
  pm.bus.on('status:' + id, onStatus);

  req.on('close', () => {
    pm.bus.off('log:' + id, onLog);
    pm.bus.off('status:' + id, onStatus);
  });
});

app.listen(PORT, () => {
  console.log(`🌙 Astra Host dashboard running at http://localhost:${PORT}`);
});
