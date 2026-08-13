const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'bots.json');

function ensureFile() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(bots) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(bots, null, 2));
}

function getBot(id) {
  return readAll().find((b) => b.id === id) || null;
}

function upsertBot(bot) {
  const bots = readAll();
  const idx = bots.findIndex((b) => b.id === bot.id);
  if (idx === -1) bots.push(bot);
  else bots[idx] = { ...bots[idx], ...bot };
  writeAll(bots);
  return getBot(bot.id);
}

function removeBot(id) {
  const bots = readAll().filter((b) => b.id !== id);
  writeAll(bots);
}

module.exports = { readAll, getBot, upsertBot, removeBot };
