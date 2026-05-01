require('dotenv').config();
const shared = require('./shared');
const db     = require('./db');
const {
  Client, GatewayIntentBits, PermissionsBitField,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  SlashCommandBuilder, REST, Routes, AuditLogEvent,
  ChannelType, AttachmentBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
});

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const OWNERS = [
  "1146346333721088080",
  "950839354438348800",
];

const ROLES = {
  fami: "1487768098592260136",
  tag:  "1492569134385467512",
};

shared.setClient(client);

const PREFIX          = "oxy";
const embedSessions   = new Map();
const LOG_CHANNEL_ID  = "1493101729703657662";
const LIVE_CHANNEL_ID = "1496971161295388792";
const TICKET_CATEGORY = "1498931758022791250";
const TICKET_LOG_CH   = "1499329165621461023";

// ─── XP CONFIG ─────────────────────────────────────────────────────────────────

const XP_COOLDOWN_MS = 60_000; // 1 minute entre chaque gain XP
const xpCooldown     = new Map(); // userId → timestamp dernier XP

// Rôles récompensés par niveau : { niveau: 'roleId' }
// Exemple : 5: "1234567890" pour donner un rôle au niveau 5
const XP_LEVEL_ROLES = {
  // 5:  "ROLE_ID",
  // 10: "ROLE_ID",
  // 20: "ROLE_ID",
};

// ─── ANTI-RAID CONFIG ──────────────────────────────────────────────────────────

const raidJoins     = []; // timestamps des derniers joins
const RAID_THRESHOLD = 5;      // 5 joins...
const RAID_WINDOW_MS = 10_000; // ...en 10 secondes → raid détecté
const ALT_MIN_DAYS   = 7;      // compte doit avoir au moins 7 jours
let   raidLocked     = false;

// ─── AUTOMOD CONFIG ────────────────────────────────────────────────────────────

const AUTOMOD = {
  antiLink:        true,
  antiSlur:        true,
  antiSpam:        true,
  antiMassMention: true,
  ghostPingAlert:  true,
  antiRaid:        true,
  antiAlt:         true,
};

// ─── INVITE TRACKING ──────────────────────────────────────────────────────────

const inviteCache = new Map(); // code → uses (snapshot au ready + màj live)


const spamTracker  = new Map(); // userId → { count, firstMsg }
const snipeData    = new Map(); // channelId → { author, content, timestamp }
const mentionCache = new Map(); // messageId → { authorId, mentions[], channelId }

// ─── AUTOMOD REGEX ─────────────────────────────────────────────────────────────

const SCAM_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.(?:gift|com\/(?:nitro|library|oauth2\/authorize\?.*client_id=(?!885738501885009026)))|free[\-_]?nitro|steamc0mmunity|steamcomunity|stearncomrnunity|discordnitro|discord-gift|grabify|iplogger|ipgrab|blasze|linkvertise|bit\.ly\/[a-z0-9]+|tinyurl\.com\/[a-z0-9]+|discord\.gift\/[a-z0-9]+)/gi;
const SLUR_REGEX      = /n+[i1!|y\u00ef\u00cc\u00cd]+[g6q][g6q]+[ae3\u00e9]+r+s?|n[\W_]*i[\W_]*g[\W_]*g[\W_]*e[\W_]*r|n[\W_]*[\W_]*g[\W_]*g[\W_]*a/gi;

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function isOwner(id)                   { return OWNERS.includes(id); }
function missingArg(message, text)     { return message.reply(`❌ ${text}`); }
async function getMember(guild, userId){ return guild.members.fetch(userId).catch(() => null); }
function getLogChannel()               { return client.channels.cache.get(LOG_CHANNEL_ID) || null; }

function parseDuration(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const val   = parseInt(match[1]);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return val * units[match[2]];
}

// XP nécessaire pour passer au niveau N
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

// ─── SLASH COMMANDS DÉFINITIONS ────────────────────────────────────────────────

const slashCommands = [
  new SlashCommandBuilder()
    .setName('ban').setDescription('Bannir un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du ban')),

  new SlashCommandBuilder()
    .setName('kick').setDescription('Kick un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre à kick').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du kick')),

  new SlashCommandBuilder()
    .setName('mute').setDescription('Mute un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre à mute').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Durée en minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),

  new SlashCommandBuilder()
    .setName('unmute').setDescription('Unmute un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre à unmute').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warn').setDescription('Avertir un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),

  new SlashCommandBuilder()
    .setName('warns').setDescription("Voir les warns d'un membre")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearwarn').setDescription("Supprimer les warns d'un membre")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear').setDescription('Supprimer des messages')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('rank').setDescription('Voir le rang XP')
    .addUserOption(o => o.setName('user').setDescription('Membre (optionnel)')),

  new SlashCommandBuilder()
    .setName('top').setDescription('Voir le classement XP du serveur'),

  new SlashCommandBuilder()
    .setName('userinfo').setDescription("Infos sur un membre")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ticket').setDescription('Envoyer le panel de tickets'),

  new SlashCommandBuilder()
    .setName('invite').setDescription('Voir les invitations')
    .addSubcommand(sub => sub.setName('stats').setDescription('Voir les invites d\'un membre').addUserOption(o => o.setName('user').setDescription('Membre (optionnel)')))
    .addSubcommand(sub => sub.setName('panel').setDescription('Classement top 10 invites')),
].map(cmd => cmd.toJSON());

// ─── EMBED BUILDER HELPERS ─────────────────────────────────────────────────────

function getEmbedSession(userId) {
  if (!embedSessions.has(userId)) {
    embedSessions.set(userId, {
      title: null, description: null, color: 0x5865F2,
      image: null, thumbnail: null, footer: null,
      author: null, channelId: null, ping: null,
    });
  }
  return embedSessions.get(userId);
}

function buildPreviewEmbed(session) {
  const embed = new EmbedBuilder().setColor(session.color || 0x5865F2);
  if (session.title)       embed.setTitle(session.title);
  if (session.description) embed.setDescription(session.description);
  if (session.image)       embed.setImage(session.image);
  if (session.thumbnail)   embed.setThumbnail(session.thumbnail);
  if (session.footer)      embed.setFooter({ text: session.footer });
  if (session.author)      embed.setAuthor({ name: session.author });
  if (!session.title && !session.description) embed.setDescription("*Prévisualisation — remplis les champs !*");
  return embed;
}

function buildControlButtons(session) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed_title").setLabel("✏️ Titre").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_description").setLabel("📝 Description").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_color").setLabel("🎨 Couleur").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_image").setLabel("🖼️ Image").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_thumbnail").setLabel("🔲 Thumbnail").setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("embed_footer").setLabel("📌 Footer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_author").setLabel("👤 Auteur").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_channel").setLabel(session.channelId ? "📢 Salon ✅" : "📢 Salon").setStyle(session.channelId ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_ping").setLabel(session.ping ? "🔔 Ping ✅" : "🔕 Ping").setStyle(session.ping ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("embed_send").setLabel("🚀 Envoyer").setStyle(ButtonStyle.Primary),
  );
  return [row1, row2];
}

// ─── READY + SLASH REGISTRATION ────────────────────────────────────────────────

client.on('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  // Cache des invites au démarrage
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      invites.forEach(inv => inviteCache.set(inv.code, inv.uses));
    } catch {}
  }

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands });
    }
    console.log(`✅ Slash commands enregistrées (${slashCommands.length} commandes)`);
  } catch (err) {
    console.error('[SLASH REGISTER]', err);
  }
});

// ─── INVITE EVENTS ─────────────────────────────────────────────────────────────

client.on('inviteCreate', invite => {
  inviteCache.set(invite.code, invite.uses ?? 0);
});

client.on('inviteDelete', invite => {
  inviteCache.delete(invite.code);
});

// ─── AUTO ROLE AU PING ─────────────────────────────────────────────────────────

const PING_CHANNEL_ID = "1482773693238214738";
const PING_TARGET_ID  = "1146346333721088080";
const PING_ROLE_ID    = "1487768098592260136";

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.id !== PING_CHANNEL_ID) return;
  if (!message.mentions.users.has(PING_TARGET_ID)) return;
  const member = message.member;
  if (!member || member.roles.cache.has(PING_ROLE_ID)) return;
  try {
    await member.roles.add(PING_ROLE_ID);
  } catch (err) {
    console.error('[AUTO-ROLE]', err);
  }
});

// ─── LOGS : MESSAGES ───────────────────────────────────────────────────────────

client.on('messageDelete', async message => {
  if (message.author?.bot) return;

  // Snipe
  if (message.content) {
    snipeData.set(message.channel.id, {
      author:    message.author?.tag || 'Inconnu',
      authorId:  message.author?.id,
      content:   message.content,
      timestamp: Date.now(),
    });
  }

  // Ghost ping
  if (AUTOMOD.ghostPingAlert && message.mentions?.users?.size > 0) {
    const pinged = [...message.mentions.users.values()].filter(u => !u.bot);
    if (pinged.length > 0) {
      const logCh = getLogChannel();
      if (logCh) {
        logCh.send({ embeds: [new EmbedBuilder()
          .setTitle('👻 Ghost Ping détecté !')
          .setColor(0xFF6B35)
          .addFields(
            { name: 'Auteur',   value: `<@${message.author?.id}> (${message.author?.tag})`, inline: true },
            { name: 'Salon',    value: `<#${message.channel.id}>`, inline: true },
            { name: 'Pingé(s)', value: pinged.map(u => `<@${u.id}>`).join(', ') },
            { name: 'Contenu',  value: message.content?.slice(0, 1024) || '*Non disponible*' }
          ).setTimestamp()
        ]}).catch(console.error);
      }
      message.channel.send({
        embeds: [new EmbedBuilder()
          .setDescription(`👻 **Ghost ping** ! <@${message.author?.id}> a pingé ${pinged.map(u => `<@${u.id}>`).join(', ')} puis a supprimé son message.`)
          .setColor(0xFF6B35)
        ]
      }).catch(console.error);
    }
  }

  shared.addLog('deleted', {
    author: message.author?.tag || 'Inconnu', authorId: message.author?.id,
    channel: message.channel?.name, channelId: message.channel?.id,
    content: message.content || '*Non disponible*',
  });

  const logChannel = getLogChannel();
  if (!logChannel) return;

  // Audit log : qui a supprimé ?
  let deletedBy = null;
  await new Promise(r => setTimeout(r, 1200));
  try {
    const auditLogs = await message.guild?.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 1 });
    const entry     = auditLogs?.entries?.first();
    if (entry && entry.target?.id === message.author?.id && (Date.now() - entry.createdTimestamp) < 5000) {
      deletedBy = `<@${entry.executor.id}> (${entry.executor.tag})`;
    }
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor(0xE24B4A)
    .addFields(
      { name: 'Auteur',  value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Inconnu', inline: true },
      { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
      { name: 'Contenu', value: message.content?.slice(0, 1024) || '*Message non disponible*' }
    )
    .setTimestamp();
  if (deletedBy) embed.addFields({ name: '🔍 Supprimé par', value: deletedBy, inline: true });
  logChannel.send({ embeds: [embed] }).catch(console.error);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  shared.addLog('edited', {
    author: oldMessage.author?.tag || 'Inconnu', authorId: oldMessage.author?.id,
    channel: oldMessage.channel?.name, channelId: oldMessage.channel?.id,
    before: oldMessage.content || '*Non disponible*',
    after: newMessage.content || '*Non disponible*', url: newMessage.url,
  });
  const logChannel = getLogChannel();
  if (!logChannel) return;
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .setColor(0xEF9F27)
    .setURL(newMessage.url)
    .addFields(
      { name: 'Auteur', value: `<@${oldMessage.author?.id}> (${oldMessage.author?.tag})`, inline: true },
      { name: 'Salon',  value: `<#${oldMessage.channel.id}>`, inline: true },
      { name: 'Avant',  value: oldMessage.content?.slice(0, 1024) || '*Non disponible*' },
      { name: 'Après',  value: newMessage.content?.slice(0, 1024) || '*Non disponible*' }
    ).setTimestamp()
  ]}).catch(console.error);
});

// ─── LOGS : RÔLES ──────────────────────────────────────────────────────────────

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannel = getLogChannel();
  if (!logChannel) return;
  const added   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  if (added.size === 0 && removed.size === 0) return;
  shared.addLog('roles', {
    member: newMember.user.tag, memberId: newMember.id,
    added: [...added.values()].map(r => r.name),
    removed: [...removed.values()].map(r => r.name),
  });
  const lines = [];
  added.forEach(r   => lines.push(`➕ **${r.name}** (<@&${r.id}>)`));
  removed.forEach(r => lines.push(`➖ **${r.name}** (<@&${r.id}>)`));
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('🎭 Changement de rôle')
    .setColor(added.size > 0 ? 0x57F287 : 0xE24B4A)
    .addFields(
      { name: 'Membre',       value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true },
      { name: 'Modification', value: lines.join('\n') }
    )
    .setThumbnail(newMember.user.displayAvatarURL({ size: 64 }))
    .setTimestamp()
  ]}).catch(console.error);
});

// ─── LOGS : JOINS / LEAVES ─────────────────────────────────────────────────────

client.on('guildMemberAdd', async member => {
  const logChannel   = getLogChannel();
  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const ageDays      = Math.floor(accountAgeMs / 86_400_000);
  const isAlt        = ageDays < ALT_MIN_DAYS;

  // ── ANTI-ALT ──────────────────────────────────────────────────────────────
  if (AUTOMOD.antiAlt && isAlt) {
    try {
      await member.send(`⚠️ Ton compte Discord est trop récent (${ageDays} jour${ageDays > 1 ? 's' : ''}) pour rejoindre ce serveur. Reviens dans ${ALT_MIN_DAYS - ageDays} jour(s).`).catch(() => {});
      await member.kick(`AutoMod Anti-Alt : compte trop récent (${ageDays}j)`);
      if (logChannel) logChannel.send({ embeds: [new EmbedBuilder()
        .setTitle('🚫 Anti-Alt — Kick automatique')
        .setColor(0xE24B4A)
        .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
        .addFields(
          { name: 'Membre',         value: `${member.user.tag} (${member.id})`, inline: true },
          { name: 'Âge du compte',  value: `${ageDays} jour(s)`,                inline: true },
          { name: 'Action',         value: 'Kick automatique (compte < 7 jours)' }
        ).setTimestamp()
      ]}).catch(console.error);
    } catch (err) { console.error('[ANTI-ALT]', err); }
    return;
  }

  // ── ANTI-RAID ─────────────────────────────────────────────────────────────
  if (AUTOMOD.antiRaid) {
    const now = Date.now();
    raidJoins.push(now);
    while (raidJoins.length > 0 && now - raidJoins[0] > RAID_WINDOW_MS) raidJoins.shift();

    if (!raidLocked && raidJoins.length >= RAID_THRESHOLD) {
      raidLocked = true;
      try {
        const channels = member.guild.channels.cache.filter(c => c.isTextBased() && !c.isThread());
        for (const ch of channels.values()) {
          await ch.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(() => {});
        }
        if (logChannel) {
          await logChannel.send({ embeds: [new EmbedBuilder()
            .setTitle('🚨 ANTI-RAID — Serveur verrouillé !')
            .setDescription(
              `**${raidJoins.length} joins** détectés en moins de **10 secondes**.\n` +
              `Tous les salons sont verrouillés automatiquement.\n\n` +
              `Tape \`oxy raid unlock\` pour déverrouiller.`
            )
            .setColor(0xFF0000)
            .setTimestamp()
          ]});
        }
      } catch (err) { console.error('[ANTI-RAID LOCK]', err); }

      // Auto-unlock après 5 minutes
      setTimeout(() => {
        raidLocked = false;
        raidJoins.length = 0;
      }, 5 * 60_000);
    }
  }

  // ── TRACKING INVITE ───────────────────────────────────────────────────────
  try {
    const newInvites = await member.guild.invites.fetch();
    const usedInvite = newInvites.find(inv => (inviteCache.get(inv.code) ?? 0) < inv.uses);
    if (usedInvite && usedInvite.inviter) {
      db.addInvite(usedInvite.inviter.id, member.id);
    }
    newInvites.forEach(inv => inviteCache.set(inv.code, inv.uses));
  } catch (err) { console.error('[INVITE TRACK]', err); }

  // ── LOG JOIN ──────────────────────────────────────────────────────────────
  if (!logChannel) return;
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('📥 Membre rejoint')
    .setColor(0x57F287)
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: 'Membre',         value: `<@${member.id}> (${member.user.tag})`, inline: true },
      { name: 'ID',             value: member.id,                               inline: true },
      { name: 'Compte créé le', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'Âge du compte',  value: isAlt ? `⚠️ **${ageDays} jours**` : `${ageDays} jours`, inline: true },
      { name: 'Total membres',  value: `${member.guild.memberCount}`, inline: true },
    )
    .setTimestamp()
  ]}).catch(console.error);
});

client.on('guildMemberRemove', async member => {
  // Décrémenter les invites si le membre quitte
  db.removeInvitedMember(member.id);

  const logChannel = getLogChannel();
  if (!logChannel) return;
  const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'Aucun';
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('📤 Membre parti')
    .setColor(0xE24B4A)
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: 'Membre',       value: `${member.user.tag}`,           inline: true },
      { name: 'ID',           value: member.id,                      inline: true },
      { name: 'Total membres',value: `${member.guild.memberCount}`,  inline: true },
      { name: 'Rôles',        value: roles.slice(0, 1024) }
    )
    .setTimestamp()
  ]}).catch(console.error);
});

// ─── LOGS : BANS / UNBANS ──────────────────────────────────────────────────────

client.on('guildBanAdd', async ban => {
  const logChannel = getLogChannel();
  if (!logChannel) return;
  await new Promise(r => setTimeout(r, 1000));
  let bannedBy = null;
  try {
    const logs  = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBan, limit: 1 });
    const entry = logs.entries.first();
    if (entry && entry.target?.id === ban.user.id && (Date.now() - entry.createdTimestamp) < 5000) {
      bannedBy = `<@${entry.executor.id}> (${entry.executor.tag})`;
    }
  } catch {}
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('🔨 Membre banni')
    .setColor(0xE24B4A)
    .addFields(
      { name: 'Membre', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      { name: 'Raison', value: ban.reason || 'Non précisée',        inline: true },
      ...(bannedBy ? [{ name: '🔍 Banni par', value: bannedBy, inline: true }] : [])
    )
    .setTimestamp()
  ]}).catch(console.error);
});

client.on('guildBanRemove', async ban => {
  const logChannel = getLogChannel();
  if (!logChannel) return;
  await new Promise(r => setTimeout(r, 1000));
  let unbannedBy = null;
  try {
    const logs  = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 1 });
    const entry = logs.entries.first();
    if (entry && entry.target?.id === ban.user.id && (Date.now() - entry.createdTimestamp) < 5000) {
      unbannedBy = `<@${entry.executor.id}> (${entry.executor.tag})`;
    }
  } catch {}
  logChannel.send({ embeds: [new EmbedBuilder()
    .setTitle('🔓 Membre unban')
    .setColor(0x57F287)
    .addFields(
      { name: 'Membre', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      ...(unbannedBy ? [{ name: '🔍 Unban par', value: unbannedBy, inline: true }] : [])
    )
    .setTimestamp()
  ]}).catch(console.error);
});

// ─── GIVEAWAY — VÉRIF RÔLE À LA RÉACTION ──────────────────────────────────────

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;
  const gw = shared.activeGiveaways.get(reaction.message.id);
  if (!gw || !gw.requiredRoleId) return;
  const guild  = reaction.message.guild;
  const member = await getMember(guild, user.id);
  const role   = guild.roles.cache.get(gw.requiredRoleId);
  if (!member || !member.roles.cache.has(gw.requiredRoleId)) {
    await reaction.users.remove(user.id).catch(() => {});
    try {
      await user.send(`❌ Tu n'as pas le rôle requis **${role?.name ?? 'Inconnu'}** pour participer au giveaway sur **${guild.name}**.`);
    } catch {
      const ch = guild.channels.cache.get(gw.channelId);
      if (ch) {
        const msg = await ch.send(`<@${user.id}> ❌ Tu n'as pas le rôle requis (**${role?.name ?? 'Inconnu'}**).`);
        setTimeout(() => msg.delete().catch(() => {}), 6000);
      }
    }
  }
});

// ─── AUTOMOD ───────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (isOwner(message.author.id)) return;

  const content = message.content;
  const member  = message.member;
  const logCh   = getLogChannel();

  // ── 1. ANTI-LIEN SCAM ─────────────────────────────────────────────────────
  if (AUTOMOD.antiLink && SCAM_LINK_REGEX.test(content)) {
    SCAM_LINK_REGEX.lastIndex = 0;
    await message.delete().catch(() => {});
    db.addWarn(message.author.id, '[AUTO] Lien scam/phishing détecté', 'AutoMod');
    try { await member?.timeout(30 * 60 * 1000, 'AutoMod : lien scam/phishing'); } catch {}
    message.channel.send({ embeds: [new EmbedBuilder()
      .setTitle('🚫 Lien scam supprimé')
      .setDescription(`<@${message.author.id}> a envoyé un lien suspect et a été mute **30 min**.`)
      .setColor(0xE24B4A).setTimestamp()
    ]}).then(m => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
    if (logCh) logCh.send({ embeds: [new EmbedBuilder()
      .setTitle('🔗 AutoMod — Lien scam').setColor(0xE24B4A)
      .addFields(
        { name: 'Auteur',  value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
        { name: 'Contenu', value: content.slice(0, 1024) },
        { name: 'Action',  value: 'Supprimé + Mute 30 min + Warn auto' }
      ).setTimestamp()
    ]}).catch(console.error);
    return;
  }

  // ── 2. ANTI-SLUR ──────────────────────────────────────────────────────────
  if (AUTOMOD.antiSlur && SLUR_REGEX.test(content)) {
    SLUR_REGEX.lastIndex = 0;
    await message.delete().catch(() => {});
    db.addWarn(message.author.id, '[AUTO] Slur racial détecté', 'AutoMod');
    const warnCount    = db.getWarnCount(message.author.id);
    const muteDuration = warnCount >= 3 ? 24 * 60 * 60 * 1000 : warnCount === 2 ? 60 * 60 * 1000 : 10 * 60 * 1000;
    const muteLabel    = warnCount >= 3 ? '24h' : warnCount === 2 ? '1h' : '10 min';
    try { await member?.timeout(muteDuration, 'AutoMod : slur racial'); } catch {}
    message.channel.send({ embeds: [new EmbedBuilder()
      .setTitle('🚫 Langage interdit')
      .setDescription(`<@${message.author.id}> a utilisé un terme interdit. Mute **${muteLabel}** (warn n°${warnCount}).`)
      .setColor(0xE24B4A).setTimestamp()
    ]}).then(m => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
    if (logCh) logCh.send({ embeds: [new EmbedBuilder()
      .setTitle('🤬 AutoMod — Slur racial').setColor(0xE24B4A)
      .addFields(
        { name: 'Auteur', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Salon',  value: `<#${message.channel.id}>`, inline: true },
        { name: 'Action', value: `Supprimé + Mute ${muteLabel} (warn n°${warnCount})` }
      ).setTimestamp()
    ]}).catch(console.error);
    return;
  }

  // ── 3. ANTI-SPAM ──────────────────────────────────────────────────────────
  if (AUTOMOD.antiSpam) {
    const uid  = message.author.id;
    const now  = Date.now();
    const data = spamTracker.get(uid) || { count: 0, firstMsg: now };
    if (now - data.firstMsg > 5000) {
      spamTracker.set(uid, { count: 1, firstMsg: now });
    } else {
      data.count++;
      spamTracker.set(uid, data);
      if (data.count >= 5) {
        spamTracker.delete(uid);
        try {
          await member?.timeout(10 * 60 * 1000, 'AutoMod : spam');
          const msgs     = await message.channel.messages.fetch({ limit: 15 });
          const toDelete = msgs.filter(m => m.author.id === uid).first(10);
          await message.channel.bulkDelete(toDelete, true).catch(() => {});
        } catch {}
        message.channel.send({ embeds: [new EmbedBuilder()
          .setDescription(`🛑 <@${message.author.id}> a été mute **10 min** pour spam.`)
          .setColor(0xE24B4A)
        ]}).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});
        if (logCh) logCh.send({ embeds: [new EmbedBuilder()
          .setTitle('💬 AutoMod — Spam').setColor(0xEF9F27)
          .addFields(
            { name: 'Auteur', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
            { name: 'Salon',  value: `<#${message.channel.id}>`, inline: true },
            { name: 'Action', value: 'Mute 10 min + suppression des derniers messages' }
          ).setTimestamp()
        ]}).catch(console.error);
        return;
      }
    }
  }

  // ── 4. ANTI-MASS MENTION ──────────────────────────────────────────────────
  if (AUTOMOD.antiMassMention) {
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (mentionCount >= 4) {
      await message.delete().catch(() => {});
      db.addWarn(message.author.id, `[AUTO] Mass mention (${mentionCount} mentions)`, 'AutoMod');
      try { await member?.timeout(5 * 60 * 1000, 'AutoMod : mass mention'); } catch {}
      message.channel.send({ embeds: [new EmbedBuilder()
        .setDescription(`📵 <@${message.author.id}> a été mute **5 min** pour mass-mention (${mentionCount} mentions).`)
        .setColor(0xE24B4A)
      ]}).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});
      if (logCh) logCh.send({ embeds: [new EmbedBuilder()
        .setTitle('📢 AutoMod — Mass Mention').setColor(0xEF9F27)
        .addFields(
          { name: 'Auteur',   value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
          { name: 'Salon',    value: `<#${message.channel.id}>`, inline: true },
          { name: 'Mentions', value: `${mentionCount}`, inline: true },
          { name: 'Action',   value: 'Supprimé + Mute 5 min + Warn auto' }
        ).setTimestamp()
      ]}).catch(console.error);
      return;
    }
  }
});

// ─── XP SYSTEM ─────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const userId = message.author.id;
  const now    = Date.now();

  // Cooldown XP : 1 message par minute max
  if (xpCooldown.has(userId) && now - xpCooldown.get(userId) < XP_COOLDOWN_MS) return;
  xpCooldown.set(userId, now);

  const xpGain   = Math.floor(Math.random() * 11) + 15; // 15-25 XP aléatoire
  const userData = db.addXP(userId, xpGain);

  // Vérification level up
  const nextLevelXP = xpForLevel(userData.level + 1);
  if (userData.xp >= nextLevelXP) {
    const newLevel = userData.level + 1;
    db.setLevel(userId, newLevel);

    message.channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🎉 Level Up !')
        .setDescription(`GG <@${userId}> ! Tu passes au niveau **${newLevel}** 🚀`)
        .setColor(0x5865F2)
        .setThumbnail(message.author.displayAvatarURL({ size: 64 }))
        .setTimestamp()
      ]
    }).then(m => setTimeout(() => m.delete().catch(() => {}), 10_000)).catch(() => {});

    // Rôle récompense si configuré
    if (XP_LEVEL_ROLES[newLevel]) {
      const levelRole = message.guild.roles.cache.get(XP_LEVEL_ROLES[newLevel]);
      if (levelRole && message.member) await message.member.roles.add(levelRole).catch(() => {});
    }
  }
});

// ─── COMMANDES PREFIX ──────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  const args = message.content.trim().split(/\s+/);
  if (args[0].toLowerCase() !== PREFIX) return;

  const cmd    = args[1]?.toLowerCase();
  const userId = args[2];
  const reason = args.slice(3).join(" ") || "Aucune raison fournie";

  // ── INFO : commande publique ──────────────────────────────────────────────
  if (cmd === "info") {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    return message.reply({ embeds: [new EmbedBuilder()
      .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL() })
      .setTitle("╔══════ OXY BOT ══════╗")
      .setDescription(
        "Un bot Discord **privé**, créé sur mesure pour le serveur de **oxy30k**.\n\n" +
        "**❯ Ce que je fais**\n" +
        "› 🔨 **Modération** — ban, kick, mute, warn, clear, nuke, slowmode, lock\n" +
        "› 🛡️ **AutoMod** — liens scam, slurs, spam, mass-mentions, ghost pings\n" +
        "› 🚨 **Anti-Raid** — détection + lock auto + anti-alt (comptes < 7 jours)\n" +
        "› 🎫 **Tickets** — support privé avec transcript auto\n" +
        "› 🏆 **Système XP** — levels, rang, classement\n" +
        "› 📜 **Logs complets** — audit log, joins/leaves, bans, rôles\n" +
        "› 🎉 **Giveaways** — avec durée, prix et rôle requis optionnel\n" +
        "› 🔴 **Notif TikTok Live** — annonce automatique\n" +
        "› 🎨 **Embed Builder** — interface interactive\n\n" +
        "**❯ Mes owners**\n" +
        `› <@1146346333721088080>\n› <@950839354438348800>\n\n` +
        "**❯ Infos**\n" +
        `› 🟢 Uptime : \`${h}h ${m}m ${s}s\`\n` +
        `› 📡 Ping : \`${client.ws.ping}ms\`\n` +
        `› 🏠 Serveurs : \`${client.guilds.cache.size}\``
      )
      .setColor(0x5865F2)
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "oxy bot • Privé & custom made" })
      .setTimestamp()
    ]});
  }

  // ── Rank : commande publique ──────────────────────────────────────────────
  if (cmd === "rank") {
    const targetId = args[2]?.replace(/[<@!>]/g, '') || message.author.id;
    try {
      const user       = await client.users.fetch(targetId);
      const xpData     = db.getXP(targetId);
      const rank       = db.getRank(targetId);
      const nextLvlXP  = xpForLevel(xpData.level + 1);
      const progress   = Math.min(Math.floor((xpData.xp / nextLvlXP) * 20), 20);
      const bar        = '█'.repeat(progress) + '░'.repeat(20 - progress);
      return message.reply({ embeds: [new EmbedBuilder()
        .setTitle(`🏆 Rang de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setColor(0x5865F2)
        .addFields(
          { name: 'Rang',        value: rank ? `#${rank}` : 'Non classé', inline: true },
          { name: 'Niveau',      value: `${xpData.level}`, inline: true },
          { name: 'XP',          value: `${xpData.xp} / ${nextLvlXP}`, inline: true },
          { name: 'Progression', value: `\`${bar}\`` }
        ).setTimestamp()
      ]});
    } catch { return message.reply("❌ Impossible de récupérer les données."); }
  }

  // ── Top : commande publique ───────────────────────────────────────────────
  if (cmd === "top") {
    const top = db.getLeaderboard(10);
    if (!top.length) return message.reply("❌ Aucune donnée XP pour l'instant.");
    const lines = await Promise.all(top.map(async (row, i) => {
      let tag = row.userId;
      try { const u = await client.users.fetch(row.userId); tag = u.tag; } catch {}
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} ${tag} — Niveau **${row.level}** | ${row.xp} XP`;
    }));
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle('🏆 Classement XP du serveur')
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setTimestamp()
    ]});
  }

  // ── Invite stats : commande publique ─────────────────────────────────────
  if (cmd === "invite" && args[2] !== "panel") {
    const targetId = args[2]?.replace(/[<@!>]/g, '') || message.author.id;
    try {
      const user      = await client.users.fetch(targetId);
      const invData   = db.getInvites(targetId);
      const rankInv   = db.getInviteRank(targetId);
      return message.reply({ embeds: [new EmbedBuilder()
        .setTitle(`📨 Invitations de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setColor(0x5865F2)
        .addFields(
          { name: 'Rang',              value: rankInv ? `#${rankInv}` : 'Non classé', inline: true },
          { name: '✅ Invites valides', value: `${invData.valid}`,                     inline: true },
          { name: '❌ Partis',         value: `${invData.left}`,                       inline: true },
        )
        .setFooter({ text: 'Seules les invites de membres toujours présents comptent' })
        .setTimestamp()
      ]});
    } catch { return message.reply("❌ Impossible de récupérer les données."); }
  }

  // ── Invite panel : commande publique ──────────────────────────────────────
  if (cmd === "invite" && args[2] === "panel") {
    const top = db.getInviteLeaderboard(10);
    if (!top.length) return message.reply("❌ Aucune donnée d'invitation pour l'instant.");
    const lines = await Promise.all(top.map(async (row, i) => {
      let tag = row.inviterId;
      try { const u = await client.users.fetch(row.inviterId); tag = u.tag; } catch {}
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} ${tag} — **${row.valid}** invite${row.valid > 1 ? 's' : ''} valide${row.valid > 1 ? 's' : ''}`;
    }));
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle('📨 Classement des invitations')
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Top 10 • Invites valides uniquement (membres toujours présents)' })
      .setTimestamp()
    ]});
  }

  if (!isOwner(message.author.id)) return message.reply("ftg");

  switch (cmd) {

    // ── BAN ──────────────────────────────────────────────────────────────────
    case "bl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers))
        return message.reply("❌ Je n'ai pas la permission de bannir.");
      try {
        await message.guild.members.ban(userId, { reason });
        shared.stats.bans++;
        shared.broadcast({ type: 'action', action: 'ban', userId, reason, by: message.author.tag });
        message.reply(`✅ <@${userId}> a été banni. | Raison : ${reason}`);
      } catch (err) { message.reply(`❌ Impossible de bannir : \`${err.message}\``); }
      break;
    }

    // ── KICK ─────────────────────────────────────────────────────────────────
    case "kick": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers))
        return message.reply("❌ Je n'ai pas la permission de kick.");
      const kickMember = await getMember(message.guild, userId);
      if (!kickMember) return message.reply("❌ Membre introuvable.");
      try {
        await kickMember.kick(reason);
        shared.stats.kicks++;
        shared.broadcast({ type: 'action', action: 'kick', userId, reason, by: message.author.tag });
        message.reply(`👢 <@${userId}> a été kick. | Raison : ${reason}`);
      } catch (err) { message.reply(`❌ Impossible de kick : \`${err.message}\``); }
      break;
    }

    // ── UNBAN ────────────────────────────────────────────────────────────────
    case "unbl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      try {
        await message.guild.members.unban(userId);
        message.reply(`🔓 <@${userId}> a été unban.`);
      } catch (err) { message.reply(`❌ Impossible d'unban : \`${err.message}\``); }
      break;
    }

    // ── MUTE ─────────────────────────────────────────────────────────────────
    case "mute": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const duration   = parseInt(args[3]);
      const muteReason = args.slice(4).join(" ") || "Aucune raison fournie";
      if (!duration || duration < 1) return missingArg(message, "Donne une durée en minutes.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply("❌ Je n'ai pas la permission de mute.");
      const muteMember = await getMember(message.guild, userId);
      if (!muteMember) return message.reply("❌ Membre introuvable.");
      try {
        await muteMember.timeout(duration * 60 * 1000, muteReason);
        shared.stats.mutes++;
        shared.broadcast({ type: 'action', action: 'mute', userId, duration, by: message.author.tag });
        message.reply(`🔇 <@${userId}> mute **${duration} min**. | Raison : ${muteReason}`);
      } catch (err) { message.reply(`❌ Impossible de mute : \`${err.message}\``); }
      break;
    }

    // ── UNMUTE ───────────────────────────────────────────────────────────────
    case "unmute": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const unmuteMember = await getMember(message.guild, userId);
      if (!unmuteMember) return message.reply("❌ Membre introuvable.");
      try {
        await unmuteMember.timeout(null);
        message.reply(`🔊 <@${userId}> a été unmute.`);
      } catch (err) { message.reply(`❌ Impossible d'unmute : \`${err.message}\``); }
      break;
    }

    // ── WARN ─────────────────────────────────────────────────────────────────
    case "warn": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      db.addWarn(userId, reason, message.author.tag);
      const total = db.getWarnCount(userId);
      message.reply(`⚠️ <@${userId}> warn (total : **${total}**). | Raison : ${reason}`);
      break;
    }

    // ── WARNS LIST ───────────────────────────────────────────────────────────
    case "warns": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = db.getWarns(userId);
      if (!userWarns.length) return message.reply(`✅ <@${userId}> n'a aucun warn.`);
      const list = userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.date}* — par ${w.by}`).join("\n");
      message.reply(`📋 Warns de <@${userId}> (${userWarns.length}) :\n${list}`);
      break;
    }

    // ── CLEARWARN ────────────────────────────────────────────────────────────
    case "clearwarn": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      db.clearWarns(userId);
      message.reply(`🧹 Warns de <@${userId}> réinitialisés.`);
      break;
    }

    // ── CLEAR ────────────────────────────────────────────────────────────────
    case "clear": {
      const amount = parseInt(args[2]);
      if (!amount || amount < 1 || amount > 100) return missingArg(message, "Donne un nombre entre 1 et 100.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageMessages))
        return message.reply("❌ Je n'ai pas la permission de supprimer des messages.");
      try {
        const deleted = await message.channel.bulkDelete(amount, true);
        const confirm = await message.channel.send(`🧹 ${deleted.size} messages supprimés.`);
        setTimeout(() => confirm.delete().catch(() => {}), 3000);
      } catch (err) { message.reply(`❌ Erreur clear : \`${err.message}\``); }
      break;
    }

    // ── PURGE USER ────────────────────────────────────────────────────────────
    case "purge": {
      const targetId = args[2];
      const amount   = parseInt(args[3]) || 20;
      if (!targetId) return missingArg(message, "Usage : `oxy purge <id> [nombre]`");
      if (amount < 1 || amount > 100) return missingArg(message, "Nombre entre 1 et 100.");
      try {
        const msgs     = await message.channel.messages.fetch({ limit: 100 });
        const toDelete = msgs.filter(m => m.author.id === targetId).first(amount);
        if (toDelete.length === 0) return message.reply("❌ Aucun message trouvé.");
        await message.channel.bulkDelete(toDelete, true);
        const confirm = await message.channel.send(`🧹 ${toDelete.length} messages de <@${targetId}> supprimés.`);
        setTimeout(() => confirm.delete().catch(() => {}), 4000);
        message.delete().catch(() => {});
      } catch (err) { message.reply(`❌ Erreur purge : \`${err.message}\``); }
      break;
    }

    // ── LOCK ─────────────────────────────────────────────────────────────────
    case "lock": {
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply("❌ Je n'ai pas la permission de gérer les salons.");
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        message.reply("🔒 Salon verrouillé.");
      } catch (err) { message.reply(`❌ Impossible de lock : \`${err.message}\``); }
      break;
    }

    // ── UNLOCK ───────────────────────────────────────────────────────────────
    case "unlock": {
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply("❌ Je n'ai pas la permission de gérer les salons.");
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        message.reply("🔓 Salon déverrouillé.");
      } catch (err) { message.reply(`❌ Impossible d'unlock : \`${err.message}\``); }
      break;
    }

    // ── SLOWMODE ─────────────────────────────────────────────────────────────
    case "slowmode": {
      const seconds = parseInt(args[2]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600)
        return missingArg(message, "Usage : `oxy slowmode <secondes>` (0 = désactivé, max 21600)");
      try {
        await message.channel.setRateLimitPerUser(seconds);
        message.reply(seconds === 0 ? "⏱️ Slowmode désactivé." : `⏱️ Slowmode activé : **${seconds}s** entre chaque message.`);
      } catch (err) { message.reply(`❌ Erreur slowmode : \`${err.message}\``); }
      break;
    }

    // ── SNIPE ─────────────────────────────────────────────────────────────────
    case "snipe": {
      const snipe = snipeData.get(message.channel.id);
      if (!snipe) return message.reply("❌ Rien à sniper dans ce salon.");
      const age = Math.floor((Date.now() - snipe.timestamp) / 1000);
      message.reply({ embeds: [new EmbedBuilder()
        .setTitle("🔍 Dernier message supprimé")
        .setDescription(snipe.content)
        .setColor(0x5865F2)
        .setFooter({ text: `Auteur : ${snipe.author} • Il y a ${age}s` })
        .setTimestamp(snipe.timestamp)
      ]});
      break;
    }

    // ── AUTOMOD TOGGLE ────────────────────────────────────────────────────────
    case "automod": {
      const modKey  = args[2]?.toLowerCase();
      const state   = args[3]?.toLowerCase();
      const modules = {
        antilink:    'antiLink',
        antislur:    'antiSlur',
        antispam:    'antiSpam',
        antimention: 'antiMassMention',
        ghostping:   'ghostPingAlert',
        antiraid:    'antiRaid',
        antialt:     'antiAlt',
      };
      if (!modKey || !modules[modKey])
        return message.reply(`❌ Modules : \`antilink\` \`antislur\` \`antispam\` \`antimention\` \`ghostping\` \`antiraid\` \`antialt\``);
      if (state === 'on')  AUTOMOD[modules[modKey]] = true;
      if (state === 'off') AUTOMOD[modules[modKey]] = false;
      const current = AUTOMOD[modules[modKey]];
      message.reply(`${current ? '✅' : '❌'} AutoMod **${modKey}** est maintenant **${current ? 'activé' : 'désactivé'}**.`);
      break;
    }

    // ── RAID UNLOCK ───────────────────────────────────────────────────────────
    case "raid": {
      if (args[2] !== "unlock") return message.reply("❌ Usage : `oxy raid unlock`");
      raidLocked = false;
      raidJoins.length = 0;
      const channels = message.guild.channels.cache.filter(c => c.isTextBased() && !c.isThread());
      for (const ch of channels.values()) {
        await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
      }
      message.reply("✅ Serveur déverrouillé. Anti-raid réinitialisé.");
      break;
    }

    // ── ROLE ─────────────────────────────────────────────────────────────────
    case "role": {
      const roleName = args[2]?.toLowerCase();
      const targetId = args[3];
      if (!roleName || !ROLES[roleName]) return missingArg(message, "Rôle invalide. Utilise `fami` ou `tag`.");
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles))
        return message.reply("❌ Je n'ai pas la permission de gérer les rôles.");
      const roleMember = await getMember(message.guild, targetId);
      if (!roleMember) return message.reply("❌ Membre introuvable.");
      const role = message.guild.roles.cache.get(ROLES[roleName]);
      if (!role) return message.reply(`❌ Rôle \`${roleName}\` introuvable.`);
      try {
        if (roleMember.roles.cache.has(role.id)) {
          await roleMember.roles.remove(role);
          message.reply(`➖ Rôle **${role.name}** retiré à <@${targetId}>.`);
        } else {
          await roleMember.roles.add(role);
          message.reply(`➕ Rôle **${role.name}** donné à <@${targetId}>.`);
        }
      } catch (err) { message.reply(`❌ Impossible de modifier le rôle : \`${err.message}\``); }
      break;
    }

    // ── SPAM PING ────────────────────────────────────────────────────────────
    case "spam": {
      if (args[2] !== "ping") return message.reply("❌ Usage : `oxy spam ping <nombre> <id>`");
      const amount   = parseInt(args[3]);
      const targetId = args[4];
      if (!amount || amount < 1 || amount > 50) return missingArg(message, "Nombre entre 1 et 50.");
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      for (let i = 0; i < amount; i++) await message.channel.send(`<@${targetId}>`);
      break;
    }

    // ── LIVE ─────────────────────────────────────────────────────────────────
    case "live": {
      try {
        const liveChannel = await client.channels.fetch(LIVE_CHANNEL_ID);
        await liveChannel.send({
          content: "@everyone",
          embeds: [new EmbedBuilder()
            .setTitle("🔴 oxy30k est en LIVE sur TikTok !")
            .setDescription("**@oxy30k** est en live maintenant !\n\n[👉 Rejoindre le live](https://www.tiktok.com/@oxy30k/live)\n\n*Viens faire un tour, ça sera cool 🔥*")
            .setColor(0xFE2C55)
            .setTimestamp()
            .setFooter({ text: "TikTok Live • oxy30k" })
          ]
        });
        message.reply(`✅ Notif live envoyée dans <#${LIVE_CHANNEL_ID}> !`);
      } catch (err) { message.reply(`❌ Erreur : \`${err.message}\``); }
      break;
    }

    // ── DM ───────────────────────────────────────────────────────────────────
    case "dm": {
      const targetId  = args[2];
      const dmMessage = args.slice(3).join(" ");
      if (!targetId)  return missingArg(message, "Donne un ID utilisateur.");
      if (!dmMessage) return missingArg(message, "Donne un message.");
      try {
        const user = await client.users.fetch(targetId);
        await user.send(dmMessage);
        message.reply(`✅ Message envoyé à <@${targetId}>.`);
      } catch (err) { message.reply(`❌ Impossible d'envoyer le DM : \`${err.message}\``); }
      break;
    }

    // ── DMALL ────────────────────────────────────────────────────────────────
    case "dmall": {
      const dmMessage = args.slice(2).join(" ");
      if (!dmMessage) return missingArg(message, "Donne un message.");
      const members = await message.guild.members.fetch();
      let success = 0, fail = 0;
      const status = await message.reply("📨 Envoi en cours...");
      for (const [, member] of members) {
        if (member.user.bot) continue;
        try { await member.send(dmMessage); success++; } catch { fail++; }
      }
      status.edit(`✅ DM envoyé à **${success}** membres. ❌ Échec : **${fail}**`);
      break;
    }

    // ── NUKE ─────────────────────────────────────────────────────────────────
    case "nuke": {
      const channel = message.channel;
      try {
        const newChannel = await channel.clone({
          name: channel.name, topic: channel.topic, nsfw: channel.nsfw,
          rateLimitPerUser: channel.rateLimitPerUser,
          permissionOverwrites: channel.permissionOverwrites.cache,
          position: channel.position, reason: "Nuke",
        });
        await channel.delete();
        newChannel.send("💣 Channel nuked.");
      } catch (err) { message.reply(`❌ Erreur nuke : \`${err.message}\``); }
      break;
    }

    // ── USERINFO ─────────────────────────────────────────────────────────────
    case "userinfo": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      try {
        const user    = await client.users.fetch(userId, { force: true });
        const member  = await getMember(message.guild, userId);
        const roles   = member
          ? member.roles.cache.filter(r => r.id !== message.guild.id)
              .sort((a, b) => b.position - a.position)
              .map(r => `<@&${r.id}>`).join(", ") || "Aucun"
          : "Non membre du serveur";
        const warnCount = db.getWarnCount(userId);
        const xpData    = db.getXP(userId);
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${user.tag}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setColor(0x2b2d31)
          .addFields(
            { name: "ID",             value: user.id,                                              inline: true },
            { name: "Bot ?",          value: user.bot ? "Oui" : "Non",                            inline: true },
            { name: "Warns",          value: `${warnCount}`,                                       inline: true },
            { name: "XP",             value: `${xpData.xp} XP | Niveau ${xpData.level}`,          inline: true },
            { name: "Compte créé le", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          );
        if (member) embed.addFields(
          { name: "Pseudo serveur",     value: member.displayName,                                         inline: true },
          { name: "Rejoint le serveur", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,       inline: true },
          { name: "En timeout ?",       value: member.communicationDisabledUntil ? "Oui" : "Non",          inline: true },
          { name: `Rôles (${member.roles.cache.size - 1})`, value: roles.slice(0, 1024) }
        );
        message.reply({ embeds: [embed] });
      } catch (err) { message.reply(`❌ Utilisateur introuvable : \`${err.message}\``); }
      break;
    }

    // ── SERVERINFO ───────────────────────────────────────────────────────────
    case "serverinfo": {
      const guild = message.guild;
      await guild.fetch();
      const verifs = { 0: "Aucune", 1: "Faible", 2: "Moyenne", 3: "Élevée", 4: "Très élevée" };
      message.reply({ embeds: [new EmbedBuilder()
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setColor(0x2b2d31)
        .addFields(
          { name: "ID",           value: guild.id,                                             inline: true },
          { name: "Propriétaire", value: `<@${guild.ownerId}>`,                                inline: true },
          { name: "Créé le",      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
          { name: "Membres",      value: `${guild.memberCount}`,                               inline: true },
          { name: "Salons",       value: `${guild.channels.cache.size}`,                       inline: true },
          { name: "Rôles",        value: `${guild.roles.cache.size}`,                          inline: true },
          { name: "Boosts",       value: `${guild.premiumSubscriptionCount} (niveau ${guild.premiumTier})`, inline: true },
          { name: "Vérification", value: verifs[guild.verificationLevel] ?? "Inconnue",        inline: true },
        ).setTimestamp()
      ]});
      break;
    }

    // ── TICKET PANEL ─────────────────────────────────────────────────────────
    case "ticket": {
      const panelEmbed = new EmbedBuilder()
        .setTitle("🎫 Support — Créer un ticket")
        .setDescription("Tu as besoin d'aide ou tu veux contacter l'équipe ?\nClique sur le bouton ci-dessous pour ouvrir un ticket privé.")
        .setColor(0x5865F2)
        .setFooter({ text: "oxy bot • Support" });
      await message.channel.send({
        embeds: [panelEmbed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_create").setLabel("📩 Créer un ticket").setStyle(ButtonStyle.Primary)
        )]
      });
      message.delete().catch(() => {});
      break;
    }

    // ── GIVEAWAY ─────────────────────────────────────────────────────────────
    case "gw": {
      const rawDuration = args[2];
      const ms = parseDuration(rawDuration);
      if (!ms) return missingArg(message, "Durée invalide. Formats : `30s` `10m` `2h` `1d`");

      let requiredRoleId = null;
      const roleFlagIdx  = args.indexOf("--role");
      let prizeArgs      = args.slice(3);
      if (roleFlagIdx !== -1) {
        requiredRoleId = args[roleFlagIdx + 1];
        prizeArgs      = args.slice(3, roleFlagIdx);
      }

      const prize = prizeArgs.join(" ");
      if (!prize) return missingArg(message, "Donne un prix. Ex: `oxy gw 10m Nitro`");

      let requiredRole = null;
      if (requiredRoleId) {
        requiredRole = message.guild.roles.cache.get(requiredRoleId);
        if (!requiredRole) return message.reply(`❌ Rôle introuvable : \`${requiredRoleId}\``);
      }

      const endsAt   = new Date(Date.now() + ms);
      const endsUnix = Math.floor(endsAt.getTime() / 1000);

      const gwMsg = await message.channel.send({
        embeds: [new EmbedBuilder()
          .setTitle("🎉  GIVEAWAY")
          .setDescription(
            `**Prix :** ${prize}\n\nRéagis avec 🎉 pour participer !` +
            (requiredRole ? `\n\n⚠️ Rôle requis : <@&${requiredRole.id}>` : '') +
            `\n\n**Fin :** <t:${endsUnix}:R> (<t:${endsUnix}:T>)`
          )
          .setColor(0x5865F2)
          .setFooter({ text: `Lancé par ${message.author.tag} • 1 gagnant` })
          .setTimestamp(endsAt)
        ]
      });
      await gwMsg.react("🎉");
      shared.activeGiveaways.set(gwMsg.id, { prize, requiredRoleId, channelId: message.channel.id, messageId: gwMsg.id, endsAt: endsAt.toISOString(), launchedBy: message.author.tag });
      message.delete().catch(() => {});

      setTimeout(async () => {
        shared.activeGiveaways.delete(gwMsg.id);
        try {
          const fetched  = await gwMsg.fetch();
          const reaction = fetched.reactions.cache.get("🎉");
          if (!reaction) return message.channel.send("❌ Impossible de récupérer les réactions.");
          const users  = await reaction.users.fetch();
          let eligible = users.filter(u => !u.bot);
          if (requiredRoleId) {
            const checks = await Promise.all([...eligible.values()].map(async u => {
              const m = await getMember(message.guild, u.id);
              return m?.roles.cache.has(requiredRoleId) ? u : null;
            }));
            eligible = eligible.filter((_, i) => checks[i] !== null);
          }
          if (eligible.size === 0) {
            const noWinEmbed = new EmbedBuilder().setTitle("😢 Giveaway terminé").setDescription(`**Prix :** ${prize}\n\nPersonne d'éligible.`).setColor(0xE24B4A);
            await gwMsg.edit({ embeds: [noWinEmbed] });
            shared.endedGiveaways?.set(gwMsg.id, { prize, winner: null });
            return message.channel.send({ embeds: [noWinEmbed] });
          }
          const winner = eligible.random();
          await gwMsg.edit({ embeds: [new EmbedBuilder().setTitle("🎉 GIVEAWAY — TERMINÉ").setDescription(`**Prix :** ${prize}\n\n**Gagnant :** <@${winner.id}>`).setColor(0x57F287).setFooter({ text: `Lancé par ${message.author.tag}` }).setTimestamp()] });
          message.channel.send({ content: `<@${winner.id}>`, embeds: [new EmbedBuilder().setTitle("🎊 Félicitations !").setDescription(`<@${winner.id}> remporte **${prize}** !`).setColor(0x57F287)] });
          shared.broadcast?.({ type: 'giveaway_end', prize, winner: winner.tag });
        } catch (err) { console.error('[GIVEAWAY]', err); }
      }, ms);
      break;
    }

    // ── EMBED BUILDER ─────────────────────────────────────────────────────────
    case "embed": {
      embedSessions.delete(message.author.id);
      const session = getEmbedSession(message.author.id);
      await message.reply({
        content: "🎨 **Embed Builder** — Clique sur les boutons pour personnaliser",
        embeds: [buildPreviewEmbed(session)],
        components: buildControlButtons(session),
      });
      break;
    }

    // ── OWNER ────────────────────────────────────────────────────────────────
    case "owner": {
      message.reply(`Mes owners sont <@1146346333721088080> et <@950839354438348800>`);
      break;
    }

    // ── HELP ─────────────────────────────────────────────────────────────────
    case "help": {
      message.reply({ embeds: [new EmbedBuilder()
        .setTitle("📋 Commandes disponibles")
        .setColor(0x2b2d31)
        .addFields(
          { name: "🔨 Modération", value: [
            "`oxy bl <id> [raison]` — Bannir",
            "`oxy unbl <id>` — Unban",
            "`oxy kick <id> [raison]` — Kick",
            "`oxy mute <id> <minutes> [raison]` — Mute",
            "`oxy unmute <id>` — Unmute",
            "`oxy warn <id> [raison]` — Avertir",
            "`oxy warns <id>` — Voir les warns",
            "`oxy clearwarn <id>` — Reset les warns",
            "`oxy clear <1-100>` — Supprimer des messages",
            "`oxy purge <id> [1-100]` — Supprimer msgs d'un user",
            "`oxy lock` — Verrouiller le salon",
            "`oxy unlock` — Déverrouiller le salon",
            "`oxy slowmode <secondes>` — Slowmode",
            "`oxy nuke` — 💣 Nuke le salon",
          ].join("\n")},
          { name: "🎭 Rôles & Membres", value: [
            "`oxy role <fami|tag> <id>` — Donner/retirer un rôle",
            "`oxy dmall <message>` — DM tous les membres",
          ].join("\n")},
          { name: "ℹ️ Infos", value: [
            "`oxy userinfo <id>` — Infos + warns + XP",
            "`oxy serverinfo` — Infos du serveur",
            "`oxy snipe` — Dernier msg supprimé",
          ].join("\n")},
          { name: "🏆 XP & Levels (public)", value: [
            "`oxy rank [@user]` — Voir son rang XP",
            "`oxy top` — Classement XP du serveur",
            "*XP gagné en parlant • cooldown 1 min*",
          ].join("\n")},
          { name: "🎫 Tickets", value: [
            "`oxy ticket` — Envoyer le panel de tickets",
            "*Les membres cliquent pour ouvrir un ticket privé*",
            "*Transcript automatique à la fermeture*",
          ].join("\n")},
          { name: "🛡️ AutoMod (automatique)", value: [
            "🔗 **Anti-lien scam** — Supprime + mute 30min + warn",
            "🤬 **Anti-slur** — Mute progressif (10min/1h/24h)",
            "💬 **Anti-spam** — Mute 10min si 5 msgs en 5s",
            "📢 **Anti-mass mention** — Supprime si 4+ mentions",
            "👻 **Ghost ping alert** — Alerte si ping puis delete",
            "🚨 **Anti-raid** — Lock auto si 5+ joins en 10s",
            "🚫 **Anti-alt** — Kick comptes < 7 jours",
            "",
            "`oxy automod <module> <on|off>` — Toggle un module",
            "*Modules : `antilink` `antislur` `antispam` `antimention` `ghostping` `antiraid` `antialt`*",
            "`oxy raid unlock` — Déverrouiller le serveur après raid",
          ].join("\n")},
          { name: "🎉 Giveaway", value: [
            "`oxy gw <durée> <prix>` — Giveaway ouvert à tous",
            "`oxy gw <durée> <prix> --role <roleId>` — Avec rôle requis",
            "*Durées : `30s` `10m` `2h` `1d`*",
          ].join("\n")},
          { name: "🔧 Utilitaire", value: [
            "`oxy live` — Notif live TikTok",
            "`oxy spam ping <1-50> <id>` — Spam ping",
            "`oxy dm <id> <message>` — DM privé",
            "`oxy embed` — Créer un embed interactif",
            "`oxy owner` — Affiche les owners",
            "`oxy info` — Infos publiques sur le bot",
          ].join("\n")},
          { name: "⚡ Slash Commands", value: [
            "`/ban` `/kick` `/mute` `/unmute` `/warn`",
            "`/warns` `/clearwarn` `/clear`",
            "`/rank` `/top` `/userinfo` `/ticket`",
          ].join("\n")},
        )
        .setFooter({ text: "oxy bot • Owners uniquement sauf info / rank / top" })
      ]});
      break;
    }

    default: {
      message.reply("❓ Commande inconnue. Tape `oxy help` pour voir la liste.");
    }
  }
});

// ─── SLASH COMMANDS HANDLER ────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  // ── Dispatch : slash vs autres ─────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return handleComponents(interaction);

  const { commandName } = interaction;

  // /ban
  if (commandName === 'ban') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('raison') || 'Aucune raison';
    try {
      await interaction.guild.members.ban(user.id, { reason });
      interaction.reply(`✅ <@${user.id}> banni. | ${reason}`);
    } catch (err) { interaction.reply({ content: `❌ \`${err.message}\``, ephemeral: true }); }
  }

  // /kick
  else if (commandName === 'kick') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('raison') || 'Aucune raison';
    const member = await getMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    try {
      await member.kick(reason);
      interaction.reply(`👢 <@${user.id}> kick. | ${reason}`);
    } catch (err) { interaction.reply({ content: `❌ \`${err.message}\``, ephemeral: true }); }
  }

  // /mute
  else if (commandName === 'mute') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user    = interaction.options.getUser('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason  = interaction.options.getString('raison') || 'Aucune raison';
    const member  = await getMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    try {
      await member.timeout(minutes * 60 * 1000, reason);
      interaction.reply(`🔇 <@${user.id}> mute **${minutes} min**. | ${reason}`);
    } catch (err) { interaction.reply({ content: `❌ \`${err.message}\``, ephemeral: true }); }
  }

  // /unmute
  else if (commandName === 'unmute') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user   = interaction.options.getUser('user');
    const member = await getMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    try {
      await member.timeout(null);
      interaction.reply(`🔊 <@${user.id}> unmute.`);
    } catch (err) { interaction.reply({ content: `❌ \`${err.message}\``, ephemeral: true }); }
  }

  // /warn
  else if (commandName === 'warn') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('raison') || 'Aucune raison';
    db.addWarn(user.id, reason, interaction.user.tag);
    const total = db.getWarnCount(user.id);
    interaction.reply(`⚠️ <@${user.id}> warn (total : **${total}**). | ${reason}`);
  }

  // /warns
  else if (commandName === 'warns') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user  = interaction.options.getUser('user');
    const warns = db.getWarns(user.id);
    if (!warns.length) return interaction.reply({ content: `✅ <@${user.id}> n'a aucun warn.`, ephemeral: true });
    const list = warns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.date}* — par ${w.by}`).join("\n");
    interaction.reply({ content: `📋 Warns de <@${user.id}> (${warns.length}) :\n${list}`, ephemeral: true });
  }

  // /clearwarn
  else if (commandName === 'clearwarn') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user = interaction.options.getUser('user');
    db.clearWarns(user.id);
    interaction.reply(`🧹 Warns de <@${user.id}> réinitialisés.`);
  }

  // /clear
  else if (commandName === 'clear') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const amount = interaction.options.getInteger('nombre');
    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      interaction.reply({ content: `🧹 ${deleted.size} messages supprimés.`, ephemeral: true });
    } catch (err) { interaction.reply({ content: `❌ \`${err.message}\``, ephemeral: true }); }
  }

  // /rank
  else if (commandName === 'rank') {
    const user      = interaction.options.getUser('user') || interaction.user;
    const xpData    = db.getXP(user.id);
    const rank      = db.getRank(user.id);
    const nextLvlXP = xpForLevel(xpData.level + 1);
    const progress  = Math.min(Math.floor((xpData.xp / nextLvlXP) * 20), 20);
    const bar       = '█'.repeat(progress) + '░'.repeat(20 - progress);
    interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle(`🏆 Rang de ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .setColor(0x5865F2)
      .addFields(
        { name: 'Rang',        value: rank ? `#${rank}` : 'Non classé', inline: true },
        { name: 'Niveau',      value: `${xpData.level}`, inline: true },
        { name: 'XP',          value: `${xpData.xp} / ${nextLvlXP}`, inline: true },
        { name: 'Progression', value: `\`${bar}\`` }
      ).setTimestamp()
    ]});
  }

  // /top
  else if (commandName === 'top') {
    const top = db.getLeaderboard(10);
    if (!top.length) return interaction.reply({ content: "❌ Aucune donnée XP.", ephemeral: true });
    const lines = await Promise.all(top.map(async (row, i) => {
      let tag = row.userId;
      try { const u = await client.users.fetch(row.userId); tag = u.tag; } catch {}
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} ${tag} — Niveau **${row.level}** | ${row.xp} XP`;
    }));
    interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('🏆 Classement XP du serveur')
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setTimestamp()
    ]});
  }

  // /userinfo
  else if (commandName === 'userinfo') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    const user      = interaction.options.getUser('user');
    const member    = await getMember(interaction.guild, user.id);
    const xpData    = db.getXP(user.id);
    const warnCount = db.getWarnCount(user.id);
    const embed     = new EmbedBuilder()
      .setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(0x2b2d31)
      .addFields(
        { name: "ID",             value: user.id,                                              inline: true },
        { name: "Warns",          value: `${warnCount}`,                                       inline: true },
        { name: "XP",             value: `${xpData.xp} XP | Niv. ${xpData.level}`,            inline: true },
        { name: "Compte créé le", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
      );
    if (member) {
      const roles = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'Aucun';
      embed.addFields(
        { name: "Rejoint le", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
        { name: "Timeout ?",  value: member.communicationDisabledUntil ? "Oui" : "Non",    inline: true },
        { name: "Rôles",      value: roles.slice(0, 1024) }
      );
    }
    interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /ticket
  else if (commandName === 'ticket') {
    if (!isOwner(interaction.user.id)) return interaction.reply({ content: "ftg", ephemeral: true });
    await interaction.channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("🎫 Support — Créer un ticket")
        .setDescription("Tu as besoin d'aide ou tu veux contacter l'équipe ?\nClique sur le bouton ci-dessous pour ouvrir un ticket privé.")
        .setColor(0x5865F2)
        .setFooter({ text: "oxy bot • Support" })
      ],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_create").setLabel("📩 Créer un ticket").setStyle(ButtonStyle.Primary)
      )]
    });
    interaction.reply({ content: "✅ Panel envoyé !", ephemeral: true });
  }

  // /invite
  else if (commandName === 'invite') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'stats') {
      const user    = interaction.options.getUser('user') || interaction.user;
      const invData = db.getInvites(user.id);
      const rankInv = db.getInviteRank(user.id);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle(`📨 Invitations de ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setColor(0x5865F2)
        .addFields(
          { name: 'Rang',              value: rankInv ? `#${rankInv}` : 'Non classé', inline: true },
          { name: '✅ Invites valides', value: `${invData.valid}`,                     inline: true },
          { name: '❌ Partis',         value: `${invData.left}`,                       inline: true },
        )
        .setFooter({ text: 'Seules les invites de membres toujours présents comptent' })
        .setTimestamp()
      ]});
    }

    if (sub === 'panel') {
      const top = db.getInviteLeaderboard(10);
      if (!top.length) return interaction.reply({ content: "❌ Aucune donnée d'invitation pour l'instant.", ephemeral: true });
      const lines = await Promise.all(top.map(async (row, i) => {
        let tag = row.inviterId;
        try { const u = await client.users.fetch(row.inviterId); tag = u.tag; } catch {}
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${tag} — **${row.valid}** invite${row.valid > 1 ? 's' : ''} valide${row.valid > 1 ? 's' : ''}`;
      }));
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('📨 Classement des invitations')
        .setColor(0x5865F2)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Top 10 • Invites valides uniquement' })
        .setTimestamp()
      ]});
    }
  }
});

// ─── COMPOSANTS (boutons, menus, modals) ───────────────────────────────────────

async function handleComponents(interaction) {
  if (!interaction.isRepliable()) return;

  // ── TICKET CREATE ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_create") {
    const existing = db.getUserOpenTicket(interaction.user.id);
    if (existing) {
      return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert : <#${existing.channelId}>`, ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const ownerOverwrites = OWNERS
        .filter(id => interaction.guild.members.cache.has(id))
        .map(id => ({
          id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages,
          ],
        }));

      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ]
          },
          ...ownerOverwrites,
        ],
      });

      db.createTicket(ticketChannel.id, interaction.user.id);

      await ticketChannel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [new EmbedBuilder()
          .setTitle("🎫 Nouveau ticket")
          .setDescription(
            `Bienvenue <@${interaction.user.id}> !\n` +
            "Explique ton problème et un owner te répondra dès que possible.\n\n" +
            "Clique sur le bouton ci-dessous pour fermer le ticket quand c'est résolu."
          )
          .setColor(0x5865F2)
          .setFooter({ text: `Ticket de ${interaction.user.tag}` })
          .setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Fermer le ticket").setStyle(ButtonStyle.Danger)
        )]
      });

      await interaction.editReply({ content: `✅ Ton ticket a été créé : <#${ticketChannel.id}>` });
    } catch (err) {
      console.error('[TICKET CREATE]', err);
      await interaction.editReply({ content: `❌ Erreur : \`${err.message}\`` });
    }
    return;
  }

  // ── TICKET CLOSE ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    const ticketData = db.getTicket(interaction.channel.id);
    if (!ticketData) return interaction.reply({ content: "❌ Ce salon n'est pas un ticket.", ephemeral: true });

    await interaction.reply({ content: "🔒 Fermeture du ticket en cours..." });

    try {
      // Sauvegarde du transcript
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const sorted   = [...messages.values()].reverse();
      const transcript = sorted
        .map(m => `[${new Date(m.createdTimestamp).toLocaleString('fr-FR')}] ${m.author.tag}: ${m.content || '[embed/attachment]'}`)
        .join('\n');

      const logChannel = client.channels.cache.get(TICKET_LOG_CH);
      if (logChannel) {
        const buffer = Buffer.from(transcript, 'utf-8');
        const attach = new AttachmentBuilder(buffer, { name: `ticket-${ticketData.userId}-${Date.now()}.txt` });
        await logChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle('🎫 Ticket fermé')
            .setColor(0xE24B4A)
            .addFields(
              { name: 'Ouvert par', value: `<@${ticketData.userId}>`, inline: true },
              { name: 'Fermé par',  value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Salon',      value: interaction.channel.name, inline: true },
              { name: 'Créé le',    value: ticketData.createdAt, inline: true }
            )
            .setTimestamp()
          ],
          files: [attach]
        });
      }

      db.closeTicketDB(interaction.channel.id);
      await new Promise(r => setTimeout(r, 3000));
      await interaction.channel.delete();
    } catch (err) {
      console.error('[TICKET CLOSE]', err);
    }
    return;
  }

  // ── EMBED BUILDER (owners seulement) ──────────────────────────────────────
  if (!isOwner(interaction.user.id)) {
    return interaction.reply({ content: "ftg", ephemeral: true });
  }

  const userId  = interaction.user.id;
  const session = getEmbedSession(userId);

  if (interaction.isButton()) {
    if (interaction.customId === "embed_ping") {
      session.ping = session.ping ? null : true;
      embedSessions.set(userId, session);
      return interaction.update({ embeds: [buildPreviewEmbed(session)], components: buildControlButtons(session) });
    }

    if (interaction.customId === "embed_send") {
      if (!session.channelId) return interaction.reply({ content: "❌ Choisis d'abord un **salon** avec 📢", ephemeral: true });
      if (!session.title && !session.description) return interaction.reply({ content: "❌ Ajoute au moins un **titre** ou une **description**", ephemeral: true });
      try {
        const channel = await client.channels.fetch(session.channelId);
        const content = session.ping ? `<@&${session.ping}>` : undefined;
        await channel.send({ content, embeds: [buildPreviewEmbed(session)] });
        embedSessions.delete(userId);
        return interaction.update({ content: `✅ Embed envoyé dans <#${session.channelId}> !`, embeds: [], components: [] });
      } catch (err) {
        return interaction.reply({ content: `❌ Erreur : \`${err.message}\``, ephemeral: true });
      }
    }

    if (interaction.customId === "embed_channel") {
      const channels = interaction.guild.channels.cache
        .filter(c => c.isTextBased() && !c.isThread())
        .first(25);
      const select = new StringSelectMenuBuilder()
        .setCustomId("embed_channel_select")
        .setPlaceholder("Choisis un salon...")
        .addOptions(channels.map(c =>
          new StringSelectMenuOptionBuilder().setLabel(`#${c.name}`).setValue(c.id)
        ));
      return interaction.reply({ content: "📢 Choisis le salon :", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    const modalMap = {
      embed_title:       { id: "modal_title",       title: "Titre",       fieldId: "input_title",       label: "Titre de l'embed",        style: TextInputStyle.Short,     placeholder: "Ex: Annonce importante" },
      embed_description: { id: "modal_description", title: "Description", fieldId: "input_description", label: "Description",             style: TextInputStyle.Paragraph, placeholder: "Texte principal..." },
      embed_color:       { id: "modal_color",        title: "Couleur",     fieldId: "input_color",       label: "Couleur hex (ex: FF0000)", style: TextInputStyle.Short,     placeholder: "5865F2" },
      embed_image:       { id: "modal_image",        title: "Image",       fieldId: "input_image",       label: "URL de l'image",          style: TextInputStyle.Short,     placeholder: "https://..." },
      embed_thumbnail:   { id: "modal_thumbnail",    title: "Thumbnail",   fieldId: "input_thumbnail",   label: "URL du thumbnail",        style: TextInputStyle.Short,     placeholder: "https://..." },
      embed_footer:      { id: "modal_footer",       title: "Footer",      fieldId: "input_footer",      label: "Texte du footer",         style: TextInputStyle.Short,     placeholder: "Ex: Bot de oxy" },
      embed_author:      { id: "modal_author",       title: "Auteur",      fieldId: "input_author",      label: "Nom de l'auteur",         style: TextInputStyle.Short,     placeholder: "Ex: oxy" },
    };
    const m = modalMap[interaction.customId];
    if (!m) return;
    const modal = new ModalBuilder().setCustomId(m.id).setTitle(m.title);
    const input = new TextInputBuilder()
      .setCustomId(m.fieldId).setLabel(m.label).setStyle(m.style)
      .setPlaceholder(m.placeholder).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "embed_channel_select") {
    session.channelId = interaction.values[0];
    embedSessions.set(userId, session);
    return interaction.update({ content: `✅ Salon <#${session.channelId}> sélectionné !`, components: [] });
  }

  if (interaction.isModalSubmit()) {
    const fieldMap = {
      modal_title:       () => { session.title       = interaction.fields.getTextInputValue("input_title")       || null; },
      modal_description: () => { session.description = interaction.fields.getTextInputValue("input_description") || null; },
      modal_color:       () => { const hex = interaction.fields.getTextInputValue("input_color").replace("#", ""); session.color = parseInt(hex, 16) || 0x5865F2; },
      modal_image:       () => { session.image       = interaction.fields.getTextInputValue("input_image")       || null; },
      modal_thumbnail:   () => { session.thumbnail   = interaction.fields.getTextInputValue("input_thumbnail")   || null; },
      modal_footer:      () => { session.footer      = interaction.fields.getTextInputValue("input_footer")      || null; },
      modal_author:      () => { session.author      = interaction.fields.getTextInputValue("input_author")      || null; },
    };
    if (fieldMap[interaction.customId]) {
      fieldMap[interaction.customId]();
      embedSessions.set(userId, session);
    }
    return interaction.update({ embeds: [buildPreviewEmbed(session)], components: buildControlButtons(session) });
  }
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
