const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const store = require('./store');

const BOTS_DIR = path.join(__dirname, 'bots');
const MAX_LOG_LINES = 500;

// id -> { proc, logs: [], startedAt, crashed, stoppedByUser }
const runtime = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(0);

function botDir(id) {
  return path.join(BOTS_DIR, id);
}

function pushLog(id, line, stream) {
  const rt = runtime.get(id);
  if (!rt) return;
  const entry = { t: Date.now(), stream: stream || 'stdout', line };
  rt.logs.push(entry);
  if (rt.logs.length > MAX_LOG_LINES) rt.logs.shift();
  bus.emit('log:' + id, entry);
}

function status(id) {
  const rt = runtime.get(id);
  if (!rt || !rt.proc) {
    return rt && rt.crashed ? 'crashed' : 'stopped';
  }
  return 'running';
}

function getLogs(id) {
  const rt = runtime.get(id);
  return rt ? rt.logs : [];
}

function start(id) {
  const bot = store.getBot(id);
  if (!bot) throw new Error('Bot not found');
  if (runtime.get(id) && runtime.get(id).proc) return; // already running

  const dir = botDir(id);
  const entry = bot.entryFile || 'index.js';
  const entryPath = path.join(dir, entry);
  if (!fs.existsSync(entryPath)) {
    throw new Error('Entry file "' + entry + '" not found in this bot\'s folder');
  }

  const env = Object.assign({}, process.env, bot.env || {});
  const proc = spawn(process.execPath, [entryPath], { cwd: dir, env: env });

  const prevLogs = runtime.get(id) ? runtime.get(id).logs : [];
  runtime.set(id, { proc: proc, logs: prevLogs, startedAt: Date.now(), crashed: false, stoppedByUser: false });
  pushLog(id, 'started (pid ' + proc.pid + ')', 'system');

  proc.stdout.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((l) => pushLog(id, l, 'stdout'));
  });
  proc.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((l) => pushLog(id, l, 'stderr'));
  });
  proc.on('exit', (code, signal) => {
    const rt = runtime.get(id);
    if (rt) {
      rt.proc = null;
      rt.crashed = code !== 0 && !rt.stoppedByUser;
    }
    pushLog(id, 'process exited (code ' + code + (signal ? ', signal ' + signal : '') + ')', 'system');
    bus.emit('status:' + id, status(id));
  });

  bus.emit('status:' + id, 'running');
}

function stop(id) {
  const rt = runtime.get(id);
  if (!rt || !rt.proc) return;
  rt.stoppedByUser = true;
  rt.proc.kill('SIGTERM');
  pushLog(id, 'stop requested', 'system');
}

function restart(id) {
  const rt = runtime.get(id);
  if (rt && rt.proc) {
    rt.stoppedByUser = true;
    rt.proc.once('exit', () => {
      rt.stoppedByUser = false;
      start(id);
    });
    rt.proc.kill('SIGTERM');
  } else {
    start(id);
  }
}

function uptimeSeconds(id) {
  const rt = runtime.get(id);
  if (!rt || !rt.proc || !rt.startedAt) return 0;
  return Math.floor((Date.now() - rt.startedAt) / 1000);
}

module.exports = { start, stop, restart, status, getLogs, uptimeSeconds, bus, botDir };
