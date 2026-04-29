require('dotenv').config();
const shared = require('./shared');
const {
  Client, GatewayIntentBits, PermissionsBitField,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const OWNERS = [
  "1146346333721088080",
  "950839354438348800"
];

const ROLES = {
  fami: "1487768098592260136",
  tag:  "1492569134385467512"
};

shared.setClient(client);

const PREFIX         = "oxy";
const embedSessions  = new Map();
const LOG_CHANNEL_ID = "1493101729703657662";
const LIVE_CHANNEL_ID = "1496971161295388792";

// ─── AUTOMOD CONFIG ────────────────────────────────────────────────────────────

const AUTOMOD = {
  antiLink:        true,   // supprime liens scam/token/phishing
  antiSlur:        true,   // supprime insultes raciales
  antiSpam:        true,   // mute si spam (5 msgs / 5s)
  antiMassMention: true,   // supprime si 4+ mentions dans un message
  ghostPingAlert:  true,   // alerte si quelqu'un ping puis supprime
};

// ─── AUTOMOD DATA ──────────────────────────────────────────────────────────────

// Anti-spam : userId → { count, timer }
const spamTracker = new Map();

// Snipe : channelId → { author, content, timestamp }
const snipeData = new Map();

// Ghost ping : stock les messages avec mentions avant suppression
const mentionCache = new Map(); // messageId → { authorId, mentions[], channelId }

// ─── AUTOMOD REGEX ─────────────────────────────────────────────────────────────

// Liens de phishing / token grabbers / faux nitro
const SCAM_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.(?:gift|com\/(?:nitro|library|oauth2\/authorize\?.*client_id=(?!885738501885009026)))|free[\-_]?nitro|steamc0mmunity|steamcomunity|stearncomrnunity|discordnitro|discord-gift|grabify|iplogger|ipgrab|blasze|linkvertise|bit\.ly\/[a-z0-9]+|tinyurl\.com\/[a-z0-9]+|discord\.gift\/[a-z0-9]+)/gi;

// Slurs raciaux (n-word + bypasses courants)
const SLUR_REGEX = /n+[i1!|y\u00ef\u00cc\u00cd]+[g6q][g6q]+[ae3\u00e9]+r+s?|n[\W_]*i[\W_]*g[\W_]*g[\W_]*e[\W_]*r|n[\W_]*[\W_]*g[\W_]*g[\W_]*a/gi;

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function isOwner(id) {
  return OWNERS.includes(id);
}

function missingArg(message, text) {
  return message.reply(`❌ ${text}`);
}

async function getMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

function getLogChannel() {
  return client.channels.cache.get(LOG_CHANNEL_ID) || null;
}

function parseDuration(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return val * units[match[2]];
}

// ─── EMBED BUILDER ─────────────────────────────────────────────────────────────

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
  if (session.title) embed.setTitle(session.title);
  if (session.description) embed.setDescription(session.description);
  if (session.image) embed.setImage(session.image);
  if (session.thumbnail) embed.setThumbnail(session.thumbnail);
  if (session.footer) embed.setFooter({ text: session.footer });
  if (session.author) embed.setAuthor({ name: session.author });
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

// ─── READY ─────────────────────────────────────────────────────────────────────

client.on('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// ── AUTO ROLE AU PING ────────────────────────────────────────────────────────

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

// ─── LOGS ──────────────────────────────────────────────────────────────────────

client.on('messageDelete', async message => {
  if (message.author?.bot) return;

  // ── SNIPE : stocke le dernier message supprimé par salon
  if (message.content) {
    snipeData.set(message.channel.id, {
      author:    message.author?.tag || 'Inconnu',
      authorId:  message.author?.id,
      content:   message.content,
      timestamp: Date.now(),
    });
  }

  // ── GHOST PING : détecte si le message supprimé contenait des mentions
  if (AUTOMOD.ghostPingAlert && message.mentions?.users?.size > 0 && !message.author?.bot) {
    const pinged = [...message.mentions.users.values()].filter(u => !u.bot);
    if (pinged.length > 0) {
      const logChannel = getLogChannel();
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setTitle('👻 Ghost Ping détecté !')
          .setColor(0xFF6B35)
          .addFields(
            { name: 'Auteur',     value: `<@${message.author?.id}> (${message.author?.tag})`, inline: true },
            { name: 'Salon',      value: `<#${message.channel.id}>`, inline: true },
            { name: 'Pingé(s)',   value: pinged.map(u => `<@${u.id}>`).join(', ') },
            { name: 'Contenu',    value: message.content?.slice(0, 1024) || '*Non disponible*' }
          )
          .setTimestamp();
        logChannel.send({ embeds: [embed] }).catch(console.error);
      }
      // Alerte aussi dans le salon d'origine
      message.channel.send({
        embeds: [new EmbedBuilder()
          .setDescription(`👻 **Ghost ping** détecté ! <@${message.author?.id}> a pingé ${pinged.map(u => `<@${u.id}>`).join(', ')} puis a supprimé son message.`)
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
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor(0xE24B4A)
    .addFields(
      { name: 'Auteur',  value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Inconnu', inline: true },
      { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
      { name: 'Contenu', value: message.content || '*Message non disponible*' }
    )
    .setTimestamp();
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
  const embed = new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .setColor(0xEF9F27)
    .setURL(newMessage.url)
    .addFields(
      { name: 'Auteur', value: `<@${oldMessage.author?.id}> (${oldMessage.author?.tag})`, inline: true },
      { name: 'Salon',  value: `<#${oldMessage.channel.id}>`, inline: true },
      { name: 'Avant',  value: oldMessage.content?.slice(0, 1024) || '*Non disponible*' },
      { name: 'Après',  value: newMessage.content?.slice(0, 1024) || '*Non disponible*' }
    )
    .setTimestamp();
  logChannel.send({ embeds: [embed] }).catch(console.error);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannel = getLogChannel();
  if (!logChannel) return;
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  const added   = newRoles.filter(r => !oldRoles.has(r.id));
  const removed = oldRoles.filter(r => !newRoles.has(r.id));
  if (added.size === 0 && removed.size === 0) return;
  shared.addLog('roles', {
    member: newMember.user.tag, memberId: newMember.id,
    added: [...added.values()].map(r => r.name),
    removed: [...removed.values()].map(r => r.name),
  });
  const lines = [];
  added.forEach(r   => lines.push(`➕ Rôle ajouté : **${r.name}** (<@&${r.id}>)`));
  removed.forEach(r => lines.push(`➖ Rôle retiré : **${r.name}** (<@&${r.id}>)`));
  const embed = new EmbedBuilder()
    .setTitle('🎭 Changement de rôle')
    .setColor(added.size > 0 ? 0x57F287 : 0xE24B4A)
    .addFields(
      { name: 'Membre',       value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true },
      { name: 'Modification', value: lines.join('\n') }
    )
    .setThumbnail(newMember.user.displayAvatarURL({ size: 64 }))
    .setTimestamp();
  logChannel.send({ embeds: [embed] }).catch(console.error);
});

// ─── GIVEAWAY — VÉRIF RÔLE À LA RÉACTION ─────────────────────────────────────

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
        const msg = await ch.send(`<@${user.id}> ❌ Tu n'as pas le rôle requis (**${role?.name ?? 'Inconnu'}**) pour participer.`);
        setTimeout(() => msg.delete().catch(() => {}), 6000);
      }
    }
  }
});

// ─── AUTOMOD ───────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (isOwner(message.author.id)) return; // les owners sont immunisés

  const content  = message.content;
  const member   = message.member;
  const logCh    = getLogChannel();

  // ── 1. ANTI-LIEN SCAM / TOKEN ──────────────────────────────────────────────
  if (AUTOMOD.antiLink && SCAM_LINK_REGEX.test(content)) {
    SCAM_LINK_REGEX.lastIndex = 0;
    await message.delete().catch(() => {});

    // Warn automatique
    const userWarns = shared.warns.get(message.author.id) || [];
    userWarns.push({ reason: '[AUTO] Lien scam/phishing détecté', date: new Date().toLocaleString("fr-FR") });
    shared.warns.set(message.author.id, userWarns);

    // Mute 30 min auto
    try {
      await member?.timeout(30 * 60 * 1000, 'AutoMod : lien scam/phishing');
    } catch {}

    const alertEmbed = new EmbedBuilder()
      .setTitle('🚫 Lien scam supprimé')
      .setDescription(`<@${message.author.id}> a envoyé un lien suspect et a été mute **30 min**.`)
      .setColor(0xE24B4A)
      .setTimestamp();

    message.channel.send({ embeds: [alertEmbed] })
      .then(m => setTimeout(() => m.delete().catch(() => {}), 8000))
      .catch(() => {});

    if (logCh) {
      logCh.send({ embeds: [new EmbedBuilder()
        .setTitle('🔗 AutoMod — Lien scam')
        .setColor(0xE24B4A)
        .addFields(
          { name: 'Auteur',  value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
          { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
          { name: 'Contenu', value: content.slice(0, 1024) },
          { name: 'Action',  value: 'Message supprimé + Mute 30 min + Warn automatique' }
        ).setTimestamp()
      ]}).catch(console.error);
    }
    return;
  }

  // ── 2. ANTI-SLUR (N-WORD + BYPASSES) ──────────────────────────────────────
  if (AUTOMOD.antiSlur && SLUR_REGEX.test(content)) {
    SLUR_REGEX.lastIndex = 0;
    await message.delete().catch(() => {});

    const userWarns = shared.warns.get(message.author.id) || [];
    userWarns.push({ reason: '[AUTO] Slur racial détecté', date: new Date().toLocaleString("fr-FR") });
    shared.warns.set(message.author.id, userWarns);

    // Mute progressif : 1er = 10 min, 2e = 1h, 3e+ = 24h
    const warnCount = userWarns.length;
    const muteDuration = warnCount >= 3 ? 24 * 60 * 60 * 1000 : warnCount === 2 ? 60 * 60 * 1000 : 10 * 60 * 1000;
    const muteLabel    = warnCount >= 3 ? '24h' : warnCount === 2 ? '1h' : '10 min';

    try {
      await member?.timeout(muteDuration, 'AutoMod : slur racial');
    } catch {}

    const alertEmbed = new EmbedBuilder()
      .setTitle('🚫 Langage interdit')
      .setDescription(`<@${message.author.id}> a utilisé un terme interdit. Mute **${muteLabel}** (warn n°${warnCount}).`)
      .setColor(0xE24B4A)
      .setTimestamp();

    message.channel.send({ embeds: [alertEmbed] })
      .then(m => setTimeout(() => m.delete().catch(() => {}), 8000))
      .catch(() => {});

    if (logCh) {
      logCh.send({ embeds: [new EmbedBuilder()
        .setTitle('🤬 AutoMod — Slur racial')
        .setColor(0xE24B4A)
        .addFields(
          { name: 'Auteur', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
          { name: 'Salon',  value: `<#${message.channel.id}>`, inline: true },
          { name: 'Action', value: `Supprimé + Mute ${muteLabel} (warn n°${warnCount})` }
        ).setTimestamp()
      ]}).catch(console.error);
    }
    return;
  }

  // ── 3. ANTI-SPAM ────────────────────────────────────────────────────────────
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
          // Supprime les 10 derniers messages du spammer
          const msgs = await message.channel.messages.fetch({ limit: 15 });
          const toDelete = msgs.filter(m => m.author.id === uid).first(10);
          await message.channel.bulkDelete(toDelete, true).catch(() => {});
        } catch {}

        message.channel.send({
          embeds: [new EmbedBuilder()
            .setDescription(`🛑 <@${message.author.id}> a été mute **10 min** pour spam.`)
            .setColor(0xE24B4A)
          ]
        }).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});

        if (logCh) {
          logCh.send({ embeds: [new EmbedBuilder()
            .setTitle('💬 AutoMod — Spam')
            .setColor(0xEF9F27)
            .addFields(
              { name: 'Auteur', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
              { name: 'Salon',  value: `<#${message.channel.id}>`, inline: true },
              { name: 'Action', value: 'Mute 10 min + suppression des derniers messages' }
            ).setTimestamp()
          ]}).catch(console.error);
        }
        return;
      }
    }
  }

  // ── 4. ANTI-MASS MENTION ────────────────────────────────────────────────────
  if (AUTOMOD.antiMassMention) {
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (mentionCount >= 4) {
      await message.delete().catch(() => {});

      const userWarns = shared.warns.get(message.author.id) || [];
      userWarns.push({ reason: `[AUTO] Mass mention (${mentionCount} mentions)`, date: new Date().toLocaleString("fr-FR") });
      shared.warns.set(message.author.id, userWarns);

      try {
        await member?.timeout(5 * 60 * 1000, 'AutoMod : mass mention');
      } catch {}

      message.channel.send({
        embeds: [new EmbedBuilder()
          .setDescription(`📵 <@${message.author.id}> a été mute **5 min** pour mass-mention (${mentionCount} mentions).`)
          .setColor(0xE24B4A)
        ]
      }).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});

      if (logCh) {
        logCh.send({ embeds: [new EmbedBuilder()
          .setTitle('📢 AutoMod — Mass Mention')
          .setColor(0xEF9F27)
          .addFields(
            { name: 'Auteur',   value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
            { name: 'Salon',    value: `<#${message.channel.id}>`, inline: true },
            { name: 'Mentions', value: `${mentionCount}`, inline: true },
            { name: 'Action',   value: 'Message supprimé + Mute 5 min + Warn automatique' }
          ).setTimestamp()
        ]}).catch(console.error);
      }
      return;
    }
  }
});

// ─── COMMANDES ─────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  const args = message.content.trim().split(/\s+/);
  if (args[0].toLowerCase() !== PREFIX) return;

  const cmd    = args[1]?.toLowerCase();
  const userId = args[2];
  const reason = args.slice(3).join(" ") || "Aucune raison fournie";

  // ── INFO : commande publique (pas besoin d'être owner) ──────────────────────
  if (cmd === "info") {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    const uptimeStr = `${h}h ${m}m ${s}s`;

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${client.user.username}`, iconURL: client.user.displayAvatarURL() })
      .setTitle("╔══════ OXY BOT ══════╗")
      .setDescription(
        "Un bot Discord **privé**, créé sur mesure pour le serveur de **oxy30k**.\n" +
        "Il tourne 24/7 et gère tout ce qui se passe ici — modération, sécurité, annonces.\n\n" +

        "**❯ Ce que je fais**\n" +
        "› 🔨 **Modération complète** — ban, kick, mute, warn, clear, nuke, slowmode, lock\n" +
        "› 🛡️ **AutoMod** — je supprime automatiquement les liens scam/phishing, les insultes raciales, " +
        "le spam, les mass-mentions et je détecte les ghost pings\n" +
        "› 👻 **Ghost Ping** — si quelqu'un ping puis supprime, tout le monde le sait\n" +
        "› 🔍 **Snipe** — le dernier message supprimé dans un salon peut être retrouvé\n" +
        "› 🎉 **Giveaways** — avec durée, prix et rôle requis optionnel\n" +
        "› 📜 **Logs complets** — chaque message supprimé/modifié, changement de rôle, action de modération est tracé\n" +
        "› 🔴 **Notif TikTok Live** — annonce automatique quand oxy30k part en live\n" +
        "› 🎨 **Embed Builder** — création d'embeds personnalisés avec interface interactive\n\n" +

        "**❯ Mes owners**\n" +
        `› <@1146346333721088080>\n` +
        `› <@950839354438348800>\n\n` +

        "**❯ Infos**\n" +
        `› 🟢 En ligne depuis : \`${uptimeStr}\`\n` +
        `› 📡 Ping : \`${client.ws.ping}ms\`\n` +
        `› 🏠 Serveurs : \`${client.guilds.cache.size}\``
      )
      .setColor(0x5865F2)
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "oxy bot • Privé & custom made" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── Toutes les autres commandes : owners uniquement ─────────────────────────
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
      } catch (err) {
        console.error('[BAN]', err);
        message.reply(`❌ Impossible de bannir : \`${err.message}\``);
      }
      break;
    }

    // ── KICK ─────────────────────────────────────────────────────────────────
    case "kick": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers))
        return message.reply("❌ Je n'ai pas la permission de kick.");
      const member = await getMember(message.guild, userId);
      if (!member) return message.reply("❌ Membre introuvable.");
      try {
        await member.kick(reason);
        shared.stats.kicks++;
        shared.broadcast({ type: 'action', action: 'kick', userId, reason, by: message.author.tag });
        message.reply(`👢 <@${userId}> a été kick. | Raison : ${reason}`);
      } catch (err) {
        console.error('[KICK]', err);
        message.reply(`❌ Impossible de kick : \`${err.message}\``);
      }
      break;
    }

    // ── UNBAN ────────────────────────────────────────────────────────────────
    case "unbl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      try {
        await message.guild.members.unban(userId);
        message.reply(`🔓 <@${userId}> a été unban.`);
      } catch (err) {
        console.error('[UNBAN]', err);
        message.reply(`❌ Impossible d'unban : \`${err.message}\``);
      }
      break;
    }

    // ── MUTE ─────────────────────────────────────────────────────────────────
    case "mute": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const duration = parseInt(args[3]);
      if (!duration || duration < 1) return missingArg(message, "Donne une durée en minutes.");
      const muteReason = args.slice(4).join(" ") || "Aucune raison fournie";
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply("❌ Je n'ai pas la permission de mute.");
      const member = await getMember(message.guild, userId);
      if (!member) return message.reply("❌ Membre introuvable.");
      try {
        await member.timeout(duration * 60 * 1000, muteReason);
        shared.stats.mutes++;
        shared.broadcast({ type: 'action', action: 'mute', userId, duration, by: message.author.tag });
        message.reply(`🔇 <@${userId}> mute **${duration} min**. | Raison : ${muteReason}`);
      } catch (err) {
        console.error('[MUTE]', err);
        message.reply(`❌ Impossible de mute : \`${err.message}\``);
      }
      break;
    }

    // ── UNMUTE ───────────────────────────────────────────────────────────────
    case "unmute": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const member = await getMember(message.guild, userId);
      if (!member) return message.reply("❌ Membre introuvable.");
      try {
        await member.timeout(null);
        message.reply(`🔊 <@${userId}> a été unmute.`);
      } catch (err) {
        console.error('[UNMUTE]', err);
        message.reply(`❌ Impossible d'unmute : \`${err.message}\``);
      }
      break;
    }

    // ── WARN ─────────────────────────────────────────────────────────────────
    case "warn": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = shared.warns.get(userId) || [];
      userWarns.push({ reason, date: new Date().toLocaleString("fr-FR") });
      shared.warns.set(userId, userWarns);
      message.reply(`⚠️ <@${userId}> warn (total : **${userWarns.length}**). | Raison : ${reason}`);
      break;
    }

    // ── WARNS LIST ───────────────────────────────────────────────────────────
    case "warns": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = shared.warns.get(userId);
      if (!userWarns || userWarns.length === 0) return message.reply(`✅ <@${userId}> n'a aucun warn.`);
      const list = userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.date}*`).join("\n");
      message.reply(`📋 Warns de <@${userId}> (${userWarns.length}) :\n${list}`);
      break;
    }

    // ── CLEARWARN ────────────────────────────────────────────────────────────
    case "clearwarn": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      shared.warns.delete(userId);
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
      } catch (err) {
        console.error('[CLEAR]', err);
        message.reply(`❌ Erreur clear : \`${err.message}\``);
      }
      break;
    }

    // ── PURGE USER ────────────────────────────────────────────────────────────
    // Supprime X messages d'un utilisateur précis dans le salon
    case "purge": {
      const targetId = args[2];
      const amount   = parseInt(args[3]) || 20;
      if (!targetId) return missingArg(message, "Usage : `oxy purge <id> [nombre]`");
      if (amount < 1 || amount > 100) return missingArg(message, "Nombre entre 1 et 100.");
      try {
        const msgs    = await message.channel.messages.fetch({ limit: 100 });
        const toDelete = msgs.filter(m => m.author.id === targetId).first(amount);
        if (toDelete.length === 0) return message.reply("❌ Aucun message trouvé pour cet utilisateur.");
        await message.channel.bulkDelete(toDelete, true);
        const confirm = await message.channel.send(`🧹 ${toDelete.length} messages de <@${targetId}> supprimés.`);
        setTimeout(() => confirm.delete().catch(() => {}), 4000);
        message.delete().catch(() => {});
      } catch (err) {
        console.error('[PURGE]', err);
        message.reply(`❌ Erreur purge : \`${err.message}\``);
      }
      break;
    }

    // ── LOCK ─────────────────────────────────────────────────────────────────
    case "lock": {
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply("❌ Je n'ai pas la permission de gérer les salons.");
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        message.reply("🔒 Salon verrouillé.");
      } catch (err) {
        console.error('[LOCK]', err);
        message.reply(`❌ Impossible de lock : \`${err.message}\``);
      }
      break;
    }

    // ── UNLOCK ───────────────────────────────────────────────────────────────
    case "unlock": {
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels))
        return message.reply("❌ Je n'ai pas la permission de gérer les salons.");
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
        message.reply("🔓 Salon déverrouillé.");
      } catch (err) {
        console.error('[UNLOCK]', err);
        message.reply(`❌ Impossible d'unlock : \`${err.message}\``);
      }
      break;
    }

    // ── SLOWMODE ─────────────────────────────────────────────────────────────
    // Active/désactive un slowmode sur le salon
    case "slowmode": {
      const seconds = parseInt(args[2]);
      if (isNaN(seconds) || seconds < 0 || seconds > 21600)
        return missingArg(message, "Usage : `oxy slowmode <secondes>` (0 pour désactiver, max 21600)");
      try {
        await message.channel.setRateLimitPerUser(seconds);
        message.reply(seconds === 0
          ? "⏱️ Slowmode désactivé."
          : `⏱️ Slowmode activé : **${seconds}s** entre chaque message.`
        );
      } catch (err) {
        message.reply(`❌ Erreur slowmode : \`${err.message}\``);
      }
      break;
    }

    // ── SNIPE ─────────────────────────────────────────────────────────────────
    // Affiche le dernier message supprimé dans le salon
    case "snipe": {
      const snipe = snipeData.get(message.channel.id);
      if (!snipe) return message.reply("❌ Rien à sniper dans ce salon.");
      const age = Math.floor((Date.now() - snipe.timestamp) / 1000);
      const embed = new EmbedBuilder()
        .setTitle("🔍 Dernier message supprimé")
        .setDescription(snipe.content)
        .setColor(0x5865F2)
        .setFooter({ text: `Auteur : ${snipe.author} • Il y a ${age}s` })
        .setTimestamp(snipe.timestamp);
      message.reply({ embeds: [embed] });
      break;
    }

    // ── AUTOMOD TOGGLE ────────────────────────────────────────────────────────
    // Active/désactive un module automod à chaud
    case "automod": {
      const module = args[2]?.toLowerCase();
      const state  = args[3]?.toLowerCase();
      const modules = {
        antilink:        'antiLink',
        antislur:        'antiSlur',
        antispam:        'antiSpam',
        antimention:     'antiMassMention',
        ghostping:       'ghostPingAlert',
      };
      if (!module || !modules[module])
        return message.reply(`❌ Modules : \`antilink\` \`antislur\` \`antispam\` \`antimention\` \`ghostping\``);
      if (state === 'on')  AUTOMOD[modules[module]] = true;
      if (state === 'off') AUTOMOD[modules[module]] = false;
      const current = AUTOMOD[modules[module]];
      message.reply(`${current ? '✅' : '❌'} AutoMod **${module}** est maintenant **${current ? 'activé' : 'désactivé'}**.`);
      break;
    }

    // ── ROLE ─────────────────────────────────────────────────────────────────
    case "role": {
      const roleName = args[2]?.toLowerCase();
      const targetId = args[3];
      if (!roleName || !ROLES[roleName]) return missingArg(message, `Rôle invalide. Utilise \`fami\` ou \`tag\`.`);
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles))
        return message.reply("❌ Je n'ai pas la permission de gérer les rôles.");
      const member = await getMember(message.guild, targetId);
      if (!member) return message.reply("❌ Membre introuvable.");
      const role = message.guild.roles.cache.get(ROLES[roleName]);
      if (!role) return message.reply(`❌ Rôle \`${roleName}\` introuvable.`);
      try {
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
          message.reply(`➖ Rôle **${role.name}** retiré à <@${targetId}>.`);
        } else {
          await member.roles.add(role);
          message.reply(`➕ Rôle **${role.name}** donné à <@${targetId}>.`);
        }
      } catch (err) {
        console.error('[ROLE]', err);
        message.reply(`❌ Impossible de modifier le rôle : \`${err.message}\``);
      }
      break;
    }

    // ── SPAM PING ────────────────────────────────────────────────────────────
    case "spam": {
      if (args[2] !== "ping") return message.reply("❌ Usage : `oxy spam ping <nombre> <id>`");
      const amount   = parseInt(args[3]);
      const targetId = args[4];
      if (!amount || amount < 1 || amount > 50) return missingArg(message, "Donne un nombre entre 1 et 50.");
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      for (let i = 0; i < amount; i++) await message.channel.send(`<@${targetId}>`);
      break;
    }

    // ── LIVE ─────────────────────────────────────────────────────────────────
    case "live": {
      try {
        const liveChannel = await client.channels.fetch(LIVE_CHANNEL_ID);
        const embed = new EmbedBuilder()
          .setTitle("🔴 oxy30k est en LIVE sur TikTok !")
          .setDescription(
            "**@oxy30k** est en live maintenant !\n\n" +
            "[👉 Rejoindre le live](https://www.tiktok.com/@oxy30k/live)\n\n" +
            "*Viens faire un tour, ça sera cool 🔥*"
          )
          .setColor(0xFE2C55)
          .setTimestamp()
          .setFooter({ text: "TikTok Live • oxy30k" });
        await liveChannel.send({ content: "@everyone", embeds: [embed] });
        message.reply(`✅ Notif live envoyée dans <#${LIVE_CHANNEL_ID}> !`);
      } catch (err) {
        console.error('[LIVE]', err);
        message.reply(`❌ Erreur : \`${err.message}\``);
      }
      break;
    }

    // ── DM ───────────────────────────────────────────────────────────────────
    case "dm": {
      const targetId  = args[2];
      const dmMessage = args.slice(3).join(" ");
      if (!targetId)  return missingArg(message, "Donne un ID utilisateur.");
      if (!dmMessage) return missingArg(message, "Donne un message à envoyer.");
      try {
        const user = await client.users.fetch(targetId);
        await user.send(dmMessage);
        message.reply(`✅ Message envoyé à <@${targetId}>.`);
      } catch (err) {
        console.error('[DM]', err);
        message.reply(`❌ Impossible d'envoyer le DM : \`${err.message}\``);
      }
      break;
    }

    // ── DMALL ────────────────────────────────────────────────────────────────
    case "dmall": {
      const dmMessage = args.slice(2).join(" ");
      if (!dmMessage) return missingArg(message, "Donne un message à envoyer.");
      const members = await message.guild.members.fetch();
      let success = 0, fail = 0;
      const status = await message.reply("📨 Envoi en cours...");
      for (const [, member] of members) {
        if (member.user.bot) continue;
        try { await member.send(dmMessage); success++; }
        catch { fail++; }
      }
      status.edit(`✅ DM envoyé à **${success}** membres. ❌ Échec : **${fail}**`);
      break;
    }

    // ── NUKE ─────────────────────────────────────────────────────────────────
    case "nuke": {
      const channel = message.channel;
      try {
        const newChannel = await channel.clone({
          name: channel.name,
          topic: channel.topic,
          nsfw: channel.nsfw,
          rateLimitPerUser: channel.rateLimitPerUser,
          permissionOverwrites: channel.permissionOverwrites.cache,
          position: channel.position,
          reason: "Nuke"
        });
        await channel.delete();
        newChannel.send("💣 Channel nuked.");
      } catch (err) {
        console.error('[NUKE]', err);
        message.reply(`❌ Erreur nuke : \`${err.message}\``);
      }
      break;
    }

    // ── USERINFO ─────────────────────────────────────────────────────────────
    case "userinfo": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      try {
        const user   = await client.users.fetch(userId, { force: true });
        const member = await getMember(message.guild, userId);
        const roles  = member
          ? member.roles.cache.filter(r => r.id !== message.guild.id)
              .sort((a, b) => b.position - a.position)
              .map(r => `<@&${r.id}>`).join(", ") || "Aucun"
          : "Non membre du serveur";
        const userWarnCount = (shared.warns.get(userId) || []).length;
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${user.tag}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setColor(0x2b2d31)
          .addFields(
            { name: "ID",             value: user.id,                                              inline: true },
            { name: "Bot ?",          value: user.bot ? "Oui" : "Non",                            inline: true },
            { name: "Warns",          value: `${userWarnCount}`,                                   inline: true },
            { name: "Compte créé le", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          );
        if (member) embed.addFields(
          { name: "Pseudo serveur",     value: member.displayName,                                         inline: true },
          { name: "Rejoint le serveur", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,       inline: true },
          { name: "En timeout ?",       value: member.communicationDisabledUntil ? "Oui" : "Non",          inline: true },
          { name: `Rôles (${member.roles.cache.size - 1})`, value: roles.slice(0, 1024) }
        );
        message.reply({ embeds: [embed] });
      } catch (err) {
        console.error('[USERINFO]', err);
        message.reply(`❌ Utilisateur introuvable : \`${err.message}\``);
      }
      break;
    }

    // ── SERVERINFO ───────────────────────────────────────────────────────────
    case "serverinfo": {
      const guild = message.guild;
      await guild.fetch();
      const verifs = { 0: "Aucune", 1: "Faible", 2: "Moyenne", 3: "Élevée", 4: "Très élevée" };
      const embed = new EmbedBuilder()
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
        );
      message.reply({ embeds: [embed] });
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
      if (!prize) return missingArg(message, "Donne un prix. Ex: `oxy gw 10m Nitro` ou `oxy gw 10m Nitro --role 123456789`");

      let requiredRole = null;
      if (requiredRoleId) {
        requiredRole = message.guild.roles.cache.get(requiredRoleId);
        if (!requiredRole) return message.reply(`❌ Rôle introuvable : \`${requiredRoleId}\``);
      }

      const endsAt   = new Date(Date.now() + ms);
      const endsUnix = Math.floor(endsAt.getTime() / 1000);

      const gwEmbed = new EmbedBuilder()
        .setTitle("🎉  GIVEAWAY")
        .setDescription(
          `**Prix :** ${prize}\n\n` +
          `Réagis avec 🎉 pour participer !` +
          (requiredRole ? `\n\n⚠️ Rôle requis : <@&${requiredRole.id}>` : '') +
          `\n\n**Fin :** <t:${endsUnix}:R> (<t:${endsUnix}:T>)`
        )
        .setColor(0x5865F2)
        .setFooter({ text: `Lancé par ${message.author.tag} • 1 gagnant` })
        .setTimestamp(endsAt);

      const gwMsg = await message.channel.send({ embeds: [gwEmbed] });
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
            const checks = await Promise.all([...eligible.values()].map(async u => { const m = await getMember(message.guild, u.id); return m?.roles.cache.has(requiredRoleId) ? u : null; }));
            eligible = eligible.filter((_, i) => checks[i] !== null);
          }
          if (eligible.size === 0) {
            const noWinEmbed = new EmbedBuilder().setTitle("😢 Giveaway terminé").setDescription(`**Prix :** ${prize}\n\nPersonne d'éligible n'a participé.`).setColor(0xE24B4A);
            await gwMsg.edit({ embeds: [noWinEmbed] });
            shared.endedGiveaways.set(gwMsg.id, { prize, requiredRoleId, channelId: message.channel.id, messageId: gwMsg.id, winner: null, winnerTag: null, eligible: 0 });
            return message.channel.send({ embeds: [noWinEmbed] });
          }
          const winner = eligible.random();
          await gwMsg.edit({ embeds: [new EmbedBuilder().setTitle("🎉 GIVEAWAY — TERMINÉ").setDescription(`**Prix :** ${prize}\n\n**Gagnant :** <@${winner.id}>`).setColor(0x57F287).setFooter({ text: `Lancé par ${message.author.tag}` }).setTimestamp()] });
          message.channel.send({ content: `<@${winner.id}>`, embeds: [new EmbedBuilder().setTitle("🎊 Félicitations !").setDescription(`<@${winner.id}> remporte **${prize}** !`).setColor(0x57F287)] });
          shared.endedGiveaways.set(gwMsg.id, { prize, requiredRoleId, channelId: message.channel.id, messageId: gwMsg.id, winner: winner.id, winnerTag: winner.tag, eligible: eligible.size });
          shared.broadcast({ type: 'giveaway_end', prize, winner: winner.tag });
        } catch (err) { console.error('[GIVEAWAY]', err); message.channel.send(`❌ Erreur giveaway : \`${err.message}\``); }
      }, ms);
      break;
    }

    // ── EMBED BUILDER ─────────────────────────────────────────────────────────
    case "embed": {
      embedSessions.delete(message.author.id);
      const session = getEmbedSession(message.author.id);
      const preview = buildPreviewEmbed(session);
      const rows = buildControlButtons(session);
      await message.reply({
        content: "🎨 **Embed Builder** — Clique sur les boutons pour personnaliser",
        embeds: [preview],
        components: rows,
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
      const embed = new EmbedBuilder()
        .setTitle("Commandes disponibles")
        .setColor(0x2b2d31)
        .addFields(
          { name: "Modération", value: [
            "`oxy bl <id> [raison]` — Bannir",
            "`oxy unbl <id>` — Unbannir",
            "`oxy kick <id> [raison]` — Kick",
            "`oxy mute <id> <minutes> [raison]` — Mute",
            "`oxy unmute <id>` — Unmute",
            "`oxy warn <id> [raison]` — Avertir",
            "`oxy warns <id>` — Voir les warns",
            "`oxy clearwarn <id>` — Reset les warns 🆕",
            "`oxy clear <1-100>` — Supprimer des messages",
            "`oxy purge <id> [1-100]` — Supprimer msgs d'un user 🆕",
            "`oxy lock` — Verrouiller le salon",
            "`oxy unlock` — Déverrouiller le salon",
            "`oxy slowmode <secondes>` — Slowmode 🆕",
            "`oxy nuke` — 💣 Nuke le salon",
          ].join("\n")},
          { name: "Rôles & Membres", value: [
            "`oxy role <fami|tag> <id>` — Donner/retirer un rôle",
            "`oxy dmall <message>` — DM tous les membres",
          ].join("\n")},
          { name: "Infos", value: [
            "`oxy userinfo <id>` — Infos + warns d'un utilisateur 🆕",
            "`oxy serverinfo` — Infos du serveur",
            "`oxy snipe` — Voir le dernier msg supprimé 🆕",
          ].join("\n")},
          { name: "AutoMod (automatique)", value: [
            "🔗 **Anti-lien scam** — Supprime + mute 30min 🆕",
            "🤬 **Anti-slur** — Mute progressif (10min/1h/24h) 🆕",
            "💬 **Anti-spam** — Mute 10min si 5 msgs en 5s 🆕",
            "📢 **Anti-mass mention** — Supprime si 4+ mentions 🆕",
            "👻 **Ghost ping alert** — Alerte si ping puis delete 🆕",
            "",
            "`oxy automod <module> <on|off>` — Toggle un module",
            "*Modules : `antilink` `antislur` `antispam` `antimention` `ghostping`*",
          ].join("\n")},
          { name: "Giveaway", value: [
            "`oxy gw <durée> <prix>` — Giveaway ouvert à tous",
            "`oxy gw <durée> <prix> --role <roleId>` — Giveaway avec rôle requis",
            "*Durées : `30s` `10m` `2h` `1d`*",
          ].join("\n")},
          { name: "Utilitaire", value: [
            "`oxy live` — Envoyer la notif live TikTok",
            "`oxy spam ping <1-50> <id>` — Spam ping",
            "`oxy dm <id> <message>` — Envoyer un DM",
            "`oxy embed` — Créer un embed interactif",
            "`oxy owner` — Affiche les owners",
            "`oxy info` — Infos publiques sur le bot 🆕",
            "`oxy help` — Cette aide",
          ].join("\n")},
        )
        .setFooter({ text: "Bot de oxy • Owners uniquement" });
      message.reply({ embeds: [embed] });
      break;
    }

    default: {
      message.reply("❓ Commande inconnue. Tape `oxy help` pour voir la liste.");
    }
  }
});

// ─── INTERACTIONS (embed builder) ──────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  if (!isOwner(interaction.user.id)) {
    if (interaction.isRepliable()) return interaction.reply({ content: "ftg", ephemeral: true });
    return;
  }

  const userId = interaction.user.id;
  const session = getEmbedSession(userId);

  // ── BOUTONS ──
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
        console.error('[EMBED SEND]', err);
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

  // ── SELECT MENU ──
  if (interaction.isStringSelectMenu() && interaction.customId === "embed_channel_select") {
    session.channelId = interaction.values[0];
    embedSessions.set(userId, session);
    return interaction.update({ content: `✅ Salon <#${session.channelId}> sélectionné !`, components: [] });
  }

  // ── MODALS ──
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
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
