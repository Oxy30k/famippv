require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions, // ← nécessaire pour les réactions giveaway
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

const PREFIX = "oxy";

const warns = new Map();

// Salon de logs (messages supprimés, modifiés, changements de rôles)
const LOG_CHANNEL_ID = "1493101729703657662";

// Stocke les giveaways actifs : messageId → { prize, requiredRoleId, channelId }
const activeGiveaways = new Map();

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

// Parse "30s" | "10m" | "2h" | "1d" → millisecondes
function parseDuration(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const val   = parseInt(match[1]);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return val * units[match[2]];
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

// ─── LOG — SUPPRESSION DE MESSAGES ────────────────────────────────────────────

client.on('messageDelete', async message => {
  if (message.author?.bot) return;
  const logChannel = getLogChannel();
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor(0xE24B4A)
    .addFields(
      { name: 'Auteur',  value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Inconnu', inline: true },
      { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
      { name: 'Contenu', value: message.content || '*Message non disponible (hors cache)*' }
    )
    .setTimestamp();

  logChannel.send({ embeds: [embed] }).catch(console.error);
});

// ─── LOG — MODIFICATION DE MESSAGES ───────────────────────────────────────────

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
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

// ─── LOG — CHANGEMENTS DE RÔLES ───────────────────────────────────────────────

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannel = getLogChannel();
  if (!logChannel) return;

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const added   = newRoles.filter(r => !oldRoles.has(r.id));
  const removed = oldRoles.filter(r => !newRoles.has(r.id));

  if (added.size === 0 && removed.size === 0) return;

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

  const gw = activeGiveaways.get(reaction.message.id);
  if (!gw || !gw.requiredRoleId) return;

  const guild  = reaction.message.guild;
  const member = await getMember(guild, user.id);
  const role   = guild.roles.cache.get(gw.requiredRoleId);

  if (!member || !member.roles.cache.has(gw.requiredRoleId)) {
    await reaction.users.remove(user.id).catch(() => {});

    // Prévient en DM, sinon message temporaire dans le salon
    try {
      await user.send(`❌ Tu n'as pas le rôle requis **${role?.name ?? 'Inconnu'}** pour participer au giveaway sur **${guild.name}**.`);
    } catch {
      const ch = guild.channels.cache.get(gw.channelId);
      if (ch) {
        const msg = await ch.send(`<@${user.id}> ❌ Tu n'as pas le rôle requis (**${role?.name ?? 'Inconnu'}**) pour participer à ce giveaway.`);
        setTimeout(() => msg.delete().catch(() => {}), 6000);
      }
    }
  }
});

// ─── COMMANDES ─────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const args = message.content.trim().split(/\s+/);
  if (args[0].toLowerCase() !== PREFIX) return;

  if (!isOwner(message.author.id)) {
    return message.reply("ftg");
  }

  const cmd    = args[1]?.toLowerCase();
  const userId = args[2];
  const reason = args.slice(3).join(" ") || "Aucune raison fournie";

  switch (cmd) {

    // ── BAN ──────────────────────────────────────────────────────────────────
    case "bl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers))
        return message.reply("❌ Je n'ai pas la permission de bannir.");
      try {
        await message.guild.members.ban(userId, { reason });
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
      if (!duration || duration < 1) return missingArg(message, "Donne une durée en minutes (ex: oxy mute 123456 10).");
      const muteReason = args.slice(4).join(" ") || "Aucune raison fournie";
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return message.reply("❌ Je n'ai pas la permission de mute.");
      const member = await getMember(message.guild, userId);
      if (!member) return message.reply("❌ Membre introuvable.");
      try {
        await member.timeout(duration * 60 * 1000, muteReason);
        message.reply(`🔇 <@${userId}> a été mute pendant **${duration} min**. | Raison : ${muteReason}`);
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
      const userWarns = warns.get(userId) || [];
      userWarns.push({ reason, date: new Date().toLocaleString("fr-FR") });
      warns.set(userId, userWarns);
      message.reply(`⚠️ <@${userId}> a reçu un warn (total : **${userWarns.length}**). | Raison : ${reason}`);
      break;
    }

    // ── WARNS LIST ───────────────────────────────────────────────────────────
    case "warns": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = warns.get(userId);
      if (!userWarns || userWarns.length === 0)
        return message.reply(`✅ <@${userId}> n'a aucun warn.`);
      const list = userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.date}*`).join("\n");
      message.reply(`📋 Warns de <@${userId}> (${userWarns.length}) :\n${list}`);
      break;
    }

    // ── CLEAR ────────────────────────────────────────────────────────────────
    case "clear": {
      const amount = parseInt(args[2]);
      if (!amount || amount < 1 || amount > 100)
        return missingArg(message, "Donne un nombre entre 1 et 100.");
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

    // ── ROLE ─────────────────────────────────────────────────────────────────
    case "role": {
      const roleName = args[2]?.toLowerCase();
      const targetId = args[3];
      if (!roleName || !ROLES[roleName])
        return missingArg(message, `Rôle invalide. Utilise \`fami\` ou \`tag\`.\nEx: \`oxy role fami 123456789\``);
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles))
        return message.reply("❌ Je n'ai pas la permission de gérer les rôles.");
      const member = await getMember(message.guild, targetId);
      if (!member) return message.reply("❌ Membre introuvable.");
      const role = message.guild.roles.cache.get(ROLES[roleName]);
      if (!role) return message.reply(`❌ Rôle \`${roleName}\` introuvable sur le serveur.`);
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

    // ── UNLOCK ────────────────────────────────────────────────────────────────
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

    // ── USERINFO ──────────────────────────────────────────────────────────────
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

        const embed = new EmbedBuilder()
          .setTitle(`👤 ${user.tag}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setColor(0x2b2d31)
          .addFields(
            { name: "ID",             value: user.id,                                               inline: true },
            { name: "Bot ?",          value: user.bot ? "Oui" : "Non",                             inline: true },
            { name: "Compte créé le", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,  inline: true },
          );
        if (member) embed.addFields(
          { name: "Pseudo serveur",     value: member.displayName,                                          inline: true },
          { name: "Rejoint le serveur", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,        inline: true },
          { name: "En timeout ?",       value: member.communicationDisabledUntil ? "Oui" : "Non",           inline: true },
          { name: `Rôles (${member.roles.cache.size - 1})`, value: roles.slice(0, 1024) }
        );
        message.reply({ embeds: [embed] });
      } catch (err) {
        console.error('[USERINFO]', err);
        message.reply(`❌ Utilisateur introuvable : \`${err.message}\``);
      }
      break;
    }

    // ── SERVERINFO ────────────────────────────────────────────────────────────
    case "serverinfo": {
      const guild = message.guild;
      await guild.fetch();
      const verifs = { 0: "Aucune", 1: "Faible", 2: "Moyenne", 3: "Élevée", 4: "Très élevée" };
      const embed = new EmbedBuilder()
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setColor(0x2b2d31)
        .addFields(
          { name: "ID",           value: guild.id,                                              inline: true },
          { name: "Propriétaire", value: `<@${guild.ownerId}>`,                                 inline: true },
          { name: "Créé le",      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,  inline: true },
          { name: "Membres",      value: `${guild.memberCount}`,                                inline: true },
          { name: "Salons",       value: `${guild.channels.cache.size}`,                        inline: true },
          { name: "Rôles",        value: `${guild.roles.cache.size}`,                           inline: true },
          { name: "Boosts",       value: `${guild.premiumSubscriptionCount} (niveau ${guild.premiumTier})`, inline: true },
          { name: "Vérification", value: verifs[guild.verificationLevel] ?? "Inconnue",         inline: true },
        );
      message.reply({ embeds: [embed] });
      break;
    }

    // ── GIVEAWAY ──────────────────────────────────────────────────────────────
    //
    //  Sans restriction : oxy gw <durée> <prix>
    //  Avec rôle requis : oxy gw <durée> <prix> --role <roleId>
    //
    //  Exemples :
    //    oxy gw 10m Nitro Classic
    //    oxy gw 1h Nitro Boost --role 1234567890123456789
    //
    case "gw": {
      const rawDuration = args[2];
      const ms = parseDuration(rawDuration);
      if (!ms) return missingArg(message, "Durée invalide. Formats : `30s` `10m` `2h` `1d`");

      // Cherche --role dans les args
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

      activeGiveaways.set(gwMsg.id, {
        prize,
        requiredRoleId,
        channelId: message.channel.id
      });

      message.delete().catch(() => {});

      setTimeout(async () => {
        activeGiveaways.delete(gwMsg.id);
        try {
          const fetched  = await gwMsg.fetch();
          const reaction = fetched.reactions.cache.get("🎉");

          if (!reaction) {
            return message.channel.send("❌ Impossible de récupérer les réactions du giveaway.");
          }

          const users  = await reaction.users.fetch();
          let eligible = users.filter(u => !u.bot);

          // Double vérif au tirage : filtre les mecs qui ont perdu le rôle entre-temps
          if (requiredRoleId) {
            const checks = await Promise.all(
              eligible.map(async u => {
                const m = await getMember(message.guild, u.id);
                return m?.roles.cache.has(requiredRoleId) ? u : null;
              })
            );
            const checkArr = [...eligible.values()];
            eligible = eligible.filter((_, i) => checks[i] !== null);
          }

          if (eligible.size === 0) {
            const noWinEmbed = new EmbedBuilder()
              .setTitle("😢 Giveaway terminé")
              .setDescription(`**Prix :** ${prize}\n\nPersonne d'éligible n'a participé.`)
              .setColor(0xE24B4A);
            await gwMsg.edit({ embeds: [noWinEmbed] });
            return message.channel.send({ embeds: [noWinEmbed] });
          }

          const winner = eligible.random();

          const endedEmbed = new EmbedBuilder()
            .setTitle("🎉  GIVEAWAY — TERMINÉ")
            .setDescription(
              `**Prix :** ${prize}\n\n` +
              `**Gagnant :** <@${winner.id}>\n\n` +
              `*Le giveaway est terminé.*`
            )
            .setColor(0x57F287)
            .setFooter({ text: `Lancé par ${message.author.tag}` })
            .setTimestamp();

          await gwMsg.edit({ embeds: [endedEmbed] });

          const winEmbed = new EmbedBuilder()
            .setTitle("🎊 Félicitations !")
            .setDescription(`<@${winner.id}> remporte **${prize}** !`)
            .setColor(0x57F287);

          message.channel.send({ content: `<@${winner.id}>`, embeds: [winEmbed] });

        } catch (err) {
          console.error('[GIVEAWAY]', err);
          message.channel.send(`❌ Erreur lors de la fin du giveaway : \`${err.message}\``);
        }
      }, ms);

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
          {
            name: "Modération",
            value: [
              "`oxy bl <id> [raison]` — Bannir",
              "`oxy unbl <id>` — Unban",
              "`oxy kick <id> [raison]` — Kick",
              "`oxy mute <id> <minutes> [raison]` — Mute",
              "`oxy unmute <id>` — Unmute",
              "`oxy warn <id> [raison]` — Avertir",
              "`oxy warns <id>` — Voir les warns",
              "`oxy clear <1-100>` — Supprimer des messages",
              "`oxy lock` — Verrouiller le salon",
              "`oxy unlock` — Déverrouiller le salon",
            ].join("\n")
          },
          { name: "Rôles", value: "`oxy role <fami|tag> <id>` — Donner/retirer un rôle" },
          {
            name: "Infos",
            value: [
              "`oxy userinfo <id>` — Infos d'un utilisateur",
              "`oxy serverinfo` — Infos du serveur",
            ].join("\n")
          },
          {
            name: "Giveaway",
            value: [
              "`oxy gw <durée> <prix>` — Giveaway ouvert à tous",
              "`oxy gw <durée> <prix> --role <roleId>` — Giveaway réservé à un rôle",
              "*Durées : `30s` `10m` `2h` `1d`*",
            ].join("\n")
          },
          {
            name: "Utilitaire",
            value: [
              "`oxy spam ping <1-50> <id>` — Spam ping",
              "`oxy dm <id> <message>` — Envoyer un DM",
              "`oxy owner` — Affiche les owners",
              "`oxy help` — Affiche cette aide",
            ].join("\n")
          }
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

// ── LOGIN ─────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
