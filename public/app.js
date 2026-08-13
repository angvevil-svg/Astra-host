// ---------- Mobile-friendly error reporting (no devtools needed) ----------
window.addEventListener('error', (e) => {
  alert('JS error: ' + e.message + '\n(' + e.filename + ':' + e.lineno + ')');
});
window.addEventListener('unhandledrejection', (e) => {
  alert('Unhandled error: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

const state = {
  bots: [],
  activeId: null,
  logSource: null
};

const el = {
  botlist: document.getElementById('botlist'),
  emptyState: document.getElementById('emptyState'),
  detail: document.getElementById('detail'),
  detailName: document.getElementById('detailName'),
  detailMeta: document.getElementById('detailMeta'),
  logs: document.getElementById('logs'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnRestart: document.getElementById('btnRestart'),
  btnInstall: document.getElementById('btnInstall'),
  btnEnv: document.getElementById('btnEnv'),
  btnDelete: document.getElementById('btnDelete'),
  uploadModal: document.getElementById('uploadModal'),
  openUpload: document.getElementById('openUpload'),
  cancelUpload: document.getElementById('cancelUpload'),
  uploadForm: document.getElementById('uploadForm'),
  fileDrop: document.getElementById('fileDrop'),
  fileLabel: document.getElementById('fileLabel'),
  envModal: document.getElementById('envModal'),
  envText: document.getElementById('envText'),
  cancelEnv: document.getElementById('cancelEnv'),
  saveEnv: document.getElementById('saveEnv')
};

// ---------- Fetch + render bot list ----------
async function loadBots() {
  const res = await fetch('/api/bots');
  state.bots = await res.json();
  renderList();
  if (state.activeId) {
    const stillExists = state.bots.find((b) => b.id === state.activeId);
    if (stillExists) renderDetailHeader(stillExists);
    else closeDetail();
  }
}

function renderList() {
  el.botlist.querySelectorAll('.bot-card').forEach((n) => n.remove());
  el.emptyState.hidden = state.bots.length > 0;

  for (const bot of state.bots) {
    const card = document.createElement('div');
    card.className = 'bot-card' + (bot.id === state.activeId ? ' active' : '');
    card.innerHTML = `
      <div class="bot-card__top">
        <span class="bot-card__name">${escapeHtml(bot.name)}</span>
        <span class="status-dot status-dot--${bot.status}"></span>
      </div>
      <div class="bot-card__meta">${bot.status}${bot.status === 'running' ? ' · ' + formatUptime(bot.uptimeSeconds) : ''}</div>
    `;
    card.addEventListener('click', () => openDetail(bot.id));
    el.botlist.appendChild(card);
  }
}

function formatUptime(sec) {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Detail panel ----------
function openDetail(id) {
  state.activeId = id;
  el.detail.hidden = false;
  renderList();
  const bot = state.bots.find((b) => b.id === id);
  if (bot) renderDetailHeader(bot);
  attachLogStream(id);
}

function closeDetail() {
  state.activeId = null;
  el.detail.hidden = true;
  if (state.logSource) state.logSource.close();
}

function renderDetailHeader(bot) {
  el.detailName.textContent = bot.name;
  el.detailMeta.textContent = `${bot.entryFile} · ${bot.status}`;
  el.btnStart.disabled = bot.status === 'running';
  el.btnStop.disabled = bot.status !== 'running';
}

function attachLogStream(id) {
  if (state.logSource) state.logSource.close();
  el.logs.innerHTML = '';

  const src = new EventSource(`/api/bots/${id}/logs/stream`);
  src.onmessage = (e) => {
    const entry = JSON.parse(e.data);
    appendLogLine(entry);
  };
  src.addEventListener('status', () => loadBots());
  state.logSource = src;
}

function appendLogLine(entry) {
  const line = document.createElement('div');
  line.className = `log-line log-line--${entry.stream}`;
  const time = new Date(entry.t).toLocaleTimeString();
  line.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(entry.line)}`;
  el.logs.appendChild(line);
  el.logs.scrollTop = el.logs.scrollHeight;
}

// ---------- Controls ----------
el.btnStart.addEventListener('click', async () => {
  await fetch(`/api/bots/${state.activeId}/start`, { method: 'POST' });
  loadBots();
});
el.btnStop.addEventListener('click', async () => {
  await fetch(`/api/bots/${state.activeId}/stop`, { method: 'POST' });
  loadBots();
});
el.btnRestart.addEventListener('click', async () => {
  await fetch(`/api/bots/${state.activeId}/restart`, { method: 'POST' });
  loadBots();
});
el.btnInstall.addEventListener('click', async () => {
  await fetch(`/api/bots/${state.activeId}/install`, { method: 'POST' });
});
el.btnDelete.addEventListener('click', async () => {
  if (!confirm('Delete this bot and all its files? This cannot be undone.')) return;
  await fetch(`/api/bots/${state.activeId}`, { method: 'DELETE' });
  closeDetail();
  loadBots();
});

// ---------- Upload modal ----------
el.openUpload.addEventListener('click', () => (el.uploadModal.hidden = false));
el.cancelUpload.addEventListener('click', () => (el.uploadModal.hidden = true));
el.fileDrop.querySelector('input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  el.fileLabel.textContent = f ? f.name : 'Choose a .zip file…';
});

el.uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(el.uploadForm);
  const res = await fetch('/api/bots', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Upload failed.');
    return;
  }
  el.uploadModal.hidden = true;
  el.uploadForm.reset();
  el.fileLabel.textContent = 'Choose a .zip file…';
  await loadBots();
  openDetail(data.id);
});

// ---------- Env modal ----------
el.btnEnv.addEventListener('click', () => {
  el.envText.value = '';
  el.envModal.hidden = false;
});
el.cancelEnv.addEventListener('click', () => (el.envModal.hidden = true));
el.saveEnv.addEventListener('click', async () => {
  if (!state.activeId) {
    alert('No bot selected — close this and click a bot in the sidebar first.');
    return;
  }

  const lines = el.envText.value.split('\n').map((l) => l.trim()).filter(Boolean);
  const env = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  el.saveEnv.disabled = true;
  el.saveEnv.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/bots/${state.activeId}/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    el.envModal.hidden = true;
  } catch (err) {
    alert('Could not save environment variables: ' + err.message);
    console.error(err);
  } finally {
    el.saveEnv.disabled = false;
    el.saveEnv.textContent = 'Save';
  }
});

// ---------- Poll for status/uptime updates ----------
setInterval(loadBots, 5000);
loadBots();
