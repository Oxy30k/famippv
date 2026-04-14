require('dotenv').config();
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
const embedSessions = new Map();

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
    console.error(err);
  }
});

// ─── COMMANDES ─────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/\s+/);
  if (args[0].toLowerCase() !== PREFIX) return;
  if (!isOwner(message.author.id)) return message.reply("ftg");

  const cmd = args[1]?.toLowerCase();
  const userId = args[2];
  const reason = args.slice(3).join(" ") || "Aucune raison fournie";

  switch (cmd) {

    case "bl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers))
        return message.reply("❌ Je n'ai pas la permission de bannir.");
      try {
        await message.guild.members.ban(userId, { reason });
        message.reply(`✅ <@${userId}> a été banni. | Raison : ${reason}`);
      } catch (err) {
        console.error(err);
        message.reply(`❌ Impossible de bannir : \`${err.message}\``);
      }
      break;
    }

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
        console.error(err);
        message.reply(`❌ Impossible de kick : \`${err.message}\``);
      }
      break;
    }

    case "unbl": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      try {
        await message.guild.members.unban(userId);
        message.reply(`🔓 <@${userId}> a été unban.`);
      } catch (err) {
        console.error(err);
        message.reply(`❌ Impossible d'unban : \`${err.message}\``);
      }
      break;
    }

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
        message.reply(`🔇 <@${userId}> mute **${duration} min**. | Raison : ${muteReason}`);
      } catch (err) {
        console.error(err);
        message.reply(`❌ Impossible de mute : \`${err.message}\``);
      }
      break;
    }

    case "unmute": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const member = await getMember(message.guild, userId);
      if (!member) return message.reply("❌ Membre introuvable.");
      try {
        await member.timeout(null);
        message.reply(`🔊 <@${userId}> a été unmute.`);
      } catch (err) {
        console.error(err);
        message.reply(`❌ Impossible d'unmute : \`${err.message}\``);
      }
      break;
    }

    case "warn": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = warns.get(userId) || [];
      userWarns.push({ reason, date: new Date().toLocaleString("fr-FR") });
      warns.set(userId, userWarns);
      message.reply(`⚠️ <@${userId}> warn (total : **${userWarns.length}**). | Raison : ${reason}`);
      break;
    }

    case "warns": {
      if (!userId) return missingArg(message, "Donne un ID utilisateur.");
      const userWarns = warns.get(userId);
      if (!userWarns || userWarns.length === 0) return message.reply(`✅ <@${userId}> n'a aucun warn.`);
      const list = userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.date}*`).join("\n");
      message.reply(`📋 Warns de <@${userId}> (${userWarns.length}) :\n${list}`);
      break;
    }

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
        console.error(err);
        message.reply(`❌ Erreur clear : \`${err.message}\``);
      }
      break;
    }

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
        console.error(err);
        message.reply(`❌ Impossible de modifier le rôle : \`${err.message}\``);
      }
      break;
    }

    case "spam": {
      if (args[2] !== "ping") return message.reply("❌ Usage : `oxy spam ping <nombre> <id>`");
      const amount = parseInt(args[3]);
      const targetId = args[4];
      if (!amount || amount < 1 || amount > 50) return missingArg(message, "Donne un nombre entre 1 et 50.");
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      for (let i = 0; i < amount; i++) await message.channel.send(`<@${targetId}>`);
      break;
    }

    case "dm": {
      const targetId = args[2];
      const dmMessage = args.slice(3).join(" ");
      if (!targetId) return missingArg(message, "Donne un ID utilisateur.");
      if (!dmMessage) return missingArg(message, "Donne un message à envoyer.");
      try {
        const user = await client.users.fetch(targetId);
        await user.send(dmMessage);
        message.reply(`✅ Message envoyé à <@${targetId}>.`);
      } catch (err) {
        console.error(err);
        message.reply(`❌ Impossible d'envoyer le DM : \`${err.message}\``);
      }
      break;
    }

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
        console.error(err);
        message.reply(`❌ Erreur nuke : \`${err.message}\``);
      }
      break;
    }

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

    case "owner": {
      message.reply(`Mes owners sont <@1146346333721088080> et <@950839354438348800>`);
      break;
    }

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
            "`oxy clear <1-100>` — Supprimer des messages",
            "`oxy nuke` — Nuke le salon",
          ].join("\n")},
          { name: "Rôles & Membres", value: [
            "`oxy role <fami|tag> <id>` — Donner/retirer un rôle",
            "`oxy dmall <message>` — DM tous les membres",
          ].join("\n")},
          { name: "Utilitaire", value: [
            "`oxy spam ping <1-50> <id>` — Spam ping",
            "`oxy dm <id> <message>` — Envoyer un DM",
            "`oxy embed` — Créer un embed interactif 🆕",
            "`oxy owner` — Affiche les owners",
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

// ─── INTERACTIONS ──────────────────────────────────────────────────────────────

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
        console.error(err);
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
      embed_title:       { id: "modal_title",       title: "Titre",        fieldId: "input_title",       label: "Titre de l'embed",        style: TextInputStyle.Short,     placeholder: "Ex: Annonce importante" },
      embed_description: { id: "modal_description", title: "Description",  fieldId: "input_description", label: "Description",             style: TextInputStyle.Paragraph, placeholder: "Texte principal..." },
      embed_color:       { id: "modal_color",        title: "Couleur",      fieldId: "input_color",       label: "Couleur hex (ex: FF0000)", style: TextInputStyle.Short,     placeholder: "5865F2" },
      embed_image:       { id: "modal_image",        title: "Image",        fieldId: "input_image",       label: "URL de l'image",          style: TextInputStyle.Short,     placeholder: "https://..." },
      embed_thumbnail:   { id: "modal_thumbnail",    title: "Thumbnail",    fieldId: "input_thumbnail",   label: "URL du thumbnail",        style: TextInputStyle.Short,     placeholder: "https://..." },
      embed_footer:      { id: "modal_footer",       title: "Footer",       fieldId: "input_footer",      label: "Texte du footer",         style: TextInputStyle.Short,     placeholder: "Ex: Bot de oxy" },
      embed_author:      { id: "modal_author",       title: "Auteur",       fieldId: "input_author",      label: "Nom de l'auteur",         style: TextInputStyle.Short,     placeholder: "Ex: oxy" },
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
      modal_title:       () => { session.title = interaction.fields.getTextInputValue("input_title") || null; },
      modal_description: () => { session.description = interaction.fields.getTextInputValue("input_description") || null; },
      modal_color:       () => { const hex = interaction.fields.getTextInputValue("input_color").replace("#", ""); session.color = parseInt(hex, 16) || 0x5865F2; },
      modal_image:       () => { session.image = interaction.fields.getTextInputValue("input_image") || null; },
      modal_thumbnail:   () => { session.thumbnail = interaction.fields.getTextInputValue("input_thumbnail") || null; },
      modal_footer:      () => { session.footer = interaction.fields.getTextInputValue("input_footer") || null; },
      modal_author:      () => { session.author = interaction.fields.getTextInputValue("input_author") || null; },
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
