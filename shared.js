// shared.js — état partagé entre bot et dashboard
const warns           = new Map();
const activeGiveaways = new Map();
const endedGiveaways  = new Map();
const notes           = new Map(); // userId → [{ text, date, author }]
const scheduled       = [];        // [{ id, channelId, content, embeds, date, timeout }]
const sseClients      = new Set(); // clients SSE connectés

const logs = { deleted: [], edited: [], roles: [] };
const stats = { bans: 0, kicks: 0, mutes: 0, commands: 0 };

const antiraid = {
  enabled:   false,
  threshold: 5,       // joins en...
  window:    10,      // ...secondes
  action:    'kick',  // 'kick' | 'ban' | 'lock'
  joinLog:   [],      // timestamps des joins récents
};

let _client = null;

function addLog(type, entry) {
  logs[type].unshift({ ...entry, timestamp: new Date().toISOString() });
  if (logs[type].length > 200) logs[type].pop();
  broadcast({ type: 'log', logType: type, entry: { ...entry, timestamp: new Date().toISOString() } });
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => { try { client(msg); } catch {} });
}

module.exports = {
  warns, activeGiveaways, endedGiveaways,
  notes, scheduled, sseClients,
  logs, stats, antiraid,
  addLog, broadcast,
  get client() { return _client; },
  setClient(c) { _client = c; },
};
