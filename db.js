const Database = require('better-sqlite3');
const db = new Database('./oxy.db');

// ─── TABLES ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS warns (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    userId  TEXT    NOT NULL,
    reason  TEXT    DEFAULT 'Aucune raison',
    date    TEXT,
    by      TEXT    DEFAULT 'Système'
  );

  CREATE TABLE IF NOT EXISTS xp (
    userId TEXT    PRIMARY KEY,
    xp     INTEGER DEFAULT 0,
    level  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channelId TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    status    TEXT DEFAULT 'open',
    createdAt TEXT
  );
`);

// ─── WARNS ─────────────────────────────────────────────────────────────────────

function getWarns(userId) {
  return db.prepare('SELECT * FROM warns WHERE userId = ?').all(userId);
}

function addWarn(userId, reason = 'Aucune raison', by = 'Système') {
  const date = new Date().toLocaleString('fr-FR');
  return db.prepare('INSERT INTO warns (userId, reason, date, by) VALUES (?, ?, ?, ?)').run(userId, reason, date, by);
}

function clearWarns(userId) {
  return db.prepare('DELETE FROM warns WHERE userId = ?').run(userId);
}

function getWarnCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM warns WHERE userId = ?').get(userId).count;
}

// ─── XP ────────────────────────────────────────────────────────────────────────

function getXP(userId) {
  return db.prepare('SELECT * FROM xp WHERE userId = ?').get(userId) || { userId, xp: 0, level: 0 };
}

function addXP(userId, amount) {
  db.prepare(`
    INSERT INTO xp (userId, xp, level) VALUES (?, ?, 0)
    ON CONFLICT(userId) DO UPDATE SET xp = xp + ?
  `).run(userId, amount, amount);
  return db.prepare('SELECT * FROM xp WHERE userId = ?').get(userId);
}

function setLevel(userId, level) {
  db.prepare('UPDATE xp SET level = ? WHERE userId = ?').run(level, userId);
}

function getLeaderboard(limit = 10) {
  return db.prepare('SELECT * FROM xp ORDER BY xp DESC LIMIT ?').all(limit);
}

function getRank(userId) {
  const rows = db.prepare('SELECT userId FROM xp ORDER BY xp DESC').all();
  const idx  = rows.findIndex(r => r.userId === userId);
  return idx === -1 ? null : idx + 1;
}

// ─── TICKETS ───────────────────────────────────────────────────────────────────

function createTicket(channelId, userId) {
  const createdAt = new Date().toLocaleString('fr-FR');
  db.prepare('INSERT INTO tickets (channelId, userId, status, createdAt) VALUES (?, ?, ?, ?)').run(channelId, userId, 'open', createdAt);
}

function getTicket(channelId) {
  return db.prepare('SELECT * FROM tickets WHERE channelId = ?').get(channelId);
}

function getUserOpenTicket(userId) {
  return db.prepare("SELECT * FROM tickets WHERE userId = ? AND status = 'open'").get(userId);
}

function closeTicketDB(channelId) {
  db.prepare("UPDATE tickets SET status = 'closed' WHERE channelId = ?").run(channelId);
}

// ───────────────────────────────────────────────────────────────────────────────

module.exports = {
  getWarns, addWarn, clearWarns, getWarnCount,
  getXP, addXP, setLevel, getLeaderboard, getRank,
  createTicket, getTicket, getUserOpenTicket, closeTicketDB,
};
