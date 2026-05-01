const { createClient } = require('@libsql/client');

const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

// ─── INIT TABLES ───────────────────────────────────────────────────────────────

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS warns (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    TEXT    NOT NULL,
      reason    TEXT    DEFAULT 'Aucune raison',
      date      TEXT,
      by        TEXT    DEFAULT 'Système'
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
    CREATE TABLE IF NOT EXISTS invites (
      inviterId TEXT NOT NULL,
      invitedId TEXT NOT NULL PRIMARY KEY,
      left      INTEGER DEFAULT 0
    );
  `);
  console.log('✅ Turso DB initialisée');
}

// ─── WARNS ─────────────────────────────────────────────────────────────────────

async function getWarns(userId) {
  const res = await db.execute({ sql: 'SELECT * FROM warns WHERE userId = ?', args: [userId] });
  return res.rows;
}

async function addWarn(userId, reason = 'Aucune raison', by = 'Système') {
  const date = new Date().toLocaleString('fr-FR');
  await db.execute({ sql: 'INSERT INTO warns (userId, reason, date, by) VALUES (?, ?, ?, ?)', args: [userId, reason, date, by] });
}

async function clearWarns(userId) {
  await db.execute({ sql: 'DELETE FROM warns WHERE userId = ?', args: [userId] });
}

async function getWarnCount(userId) {
  const res = await db.execute({ sql: 'SELECT COUNT(*) as count FROM warns WHERE userId = ?', args: [userId] });
  return Number(res.rows[0].count);
}

// ─── XP ────────────────────────────────────────────────────────────────────────

async function getXP(userId) {
  const res = await db.execute({ sql: 'SELECT * FROM xp WHERE userId = ?', args: [userId] });
  return res.rows[0] || { userId, xp: 0, level: 0 };
}

async function addXP(userId, amount) {
  await db.execute({
    sql: `INSERT INTO xp (userId, xp, level) VALUES (?, ?, 0)
          ON CONFLICT(userId) DO UPDATE SET xp = xp + ?`,
    args: [userId, amount, amount],
  });
  const res = await db.execute({ sql: 'SELECT * FROM xp WHERE userId = ?', args: [userId] });
  return res.rows[0];
}

async function setLevel(userId, level) {
  await db.execute({ sql: 'UPDATE xp SET level = ? WHERE userId = ?', args: [level, userId] });
}

async function getLeaderboard(limit = 10) {
  const res = await db.execute({ sql: 'SELECT * FROM xp ORDER BY xp DESC LIMIT ?', args: [limit] });
  return res.rows;
}

async function getRank(userId) {
  const res = await db.execute({ sql: 'SELECT userId FROM xp ORDER BY xp DESC', args: [] });
  const idx = res.rows.findIndex(r => r.userId === userId);
  return idx === -1 ? null : idx + 1;
}

// ─── TICKETS ───────────────────────────────────────────────────────────────────

async function createTicket(channelId, userId) {
  const createdAt = new Date().toLocaleString('fr-FR');
  await db.execute({ sql: 'INSERT INTO tickets (channelId, userId, status, createdAt) VALUES (?, ?, ?, ?)', args: [channelId, userId, 'open', createdAt] });
}

async function getTicket(channelId) {
  const res = await db.execute({ sql: 'SELECT * FROM tickets WHERE channelId = ?', args: [channelId] });
  return res.rows[0] || null;
}

async function getUserOpenTicket(userId) {
  const res = await db.execute({ sql: "SELECT * FROM tickets WHERE userId = ? AND status = 'open'", args: [userId] });
  return res.rows[0] || null;
}

async function closeTicketDB(channelId) {
  await db.execute({ sql: "UPDATE tickets SET status = 'closed' WHERE channelId = ?", args: [channelId] });
}

// ─── INVITES ───────────────────────────────────────────────────────────────────

async function addInvite(inviterId, invitedId) {
  await db.execute({ sql: 'INSERT OR IGNORE INTO invites (inviterId, invitedId, left) VALUES (?, ?, 0)', args: [inviterId, invitedId] });
}

async function removeInvitedMember(invitedId) {
  await db.execute({ sql: 'UPDATE invites SET left = 1 WHERE invitedId = ?', args: [invitedId] });
}

async function getInvites(inviterId) {
  const total = await db.execute({ sql: 'SELECT COUNT(*) as count FROM invites WHERE inviterId = ?', args: [inviterId] });
  const left  = await db.execute({ sql: 'SELECT COUNT(*) as count FROM invites WHERE inviterId = ? AND left = 1', args: [inviterId] });
  const t = Number(total.rows[0].count);
  const l = Number(left.rows[0].count);
  return { total: t, left: l, valid: t - l };
}

async function getInviteLeaderboard(limit = 10) {
  const res = await db.execute({
    sql: `SELECT inviterId,
            COUNT(*) as total,
            SUM(left) as left,
            COUNT(*) - SUM(left) as valid
          FROM invites
          GROUP BY inviterId
          ORDER BY valid DESC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows;
}

async function getInviteRank(inviterId) {
  const res = await db.execute({
    sql: `SELECT inviterId, COUNT(*) - SUM(left) as valid
          FROM invites GROUP BY inviterId ORDER BY valid DESC`,
    args: [],
  });
  const idx = res.rows.findIndex(r => r.inviterId === inviterId);
  return idx === -1 ? null : idx + 1;
}

// ───────────────────────────────────────────────────────────────────────────────

module.exports = {
  initDB,
  getWarns, addWarn, clearWarns, getWarnCount,
  getXP, addXP, setLevel, getLeaderboard, getRank,
  createTicket, getTicket, getUserOpenTicket, closeTicketDB,
  addInvite, removeInvitedMember, getInvites, getInviteLeaderboard, getInviteRank,
};
