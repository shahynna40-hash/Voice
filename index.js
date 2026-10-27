
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ==============================
// Silfer Voice - Configuration
// ==============================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "";

if (!TOKEN || !CLIENT_ID) {
  console.error("خطأ: أضف TOKEN و CLIENT_ID في متغيرات البيئة.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ==============================
// Persistent JSON storage
// ==============================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "voice.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "{}");
}

let db = {};

try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  console.error("تعذر قراءة voice.json، سيتم استخدام إعدادات جديدة.");
  db = {};
}

function saveDB() {
  const tempFile = DATA_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function getConfig(guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      lobbyId: null,
      panelChannelId: null,
      panelMessageId: null,
      rooms: {}
    };
    saveDB();
  }

  if (!db[guildId].rooms) {
    db[guildId].rooms = {};
  }

  return db[guildId];
}

// ==============================
// Embeds and helpers
// ==============================

function makeEmbed(title, description, color = 0x7C3AED) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Silfer Voice" })
    .setTimestamp();
}

function errorText(text) {
  return {
    content: `❌ ${text}`,
    flags: MessageFlags.Ephemeral
  };
}

function successText(text) {
  return {
    content: `✅ ${text}`,
    flags: MessageFlags.Ephemeral
  };
}

function getRoomConfig(guildId, channelId) {
  return getConfig(guildId).rooms[channelId] || null;
}

function isOwnerOrAdmin(interaction, room) {
  return (
    room.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

function makePanel() {
  const embed = makeEmbed(
    "🎙️ Silfer Voice | لوحة التحكم",
    [
      "مرحبًا بك في نظام الغرف الصوتية المؤقتة.",
      "",
      "🎨 **تعديل الاسم:** تغيير اسم غرفتك.",
      "👥 **حد الأعضاء:** تحديد عدد الأشخاص.",
      "🔒 **قفل / فتح:** التحكم في دخول الآخرين.",
      "🙈 **إخفاء / إظهار:** التحكم في ظهور الغرفة.",
      "👢 **طرد عضو:** إخراج عضو من غرفتك.",
      "👑 **نقل الملكية:** إعطاء التحكم لشخص آخر.",
      "",
      "ادخل روم الانتظار لإنشاء غرفتك أولًا.",
      "يجب أن تكون مالك الغرفة لاستخدام الأزرار."
    ].join("\n")
  );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sv_rename")
      .setLabel("تغيير الاسم")
      .setEmoji("🎨")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("sv_limit")
      .setLabel("حد الأعضاء")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("sv_lock")
      .setLabel("قفل / فتح")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("sv_hide")
      .setLabel("إخفاء / إظهار")
      .setEmoji("🙈")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sv_kick")
      .setLabel("طرد عضو")
      .setEmoji("👢")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("sv_transfer")
      .setLabel("نقل الملكية")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row1, row2]
  };
}

// ==============================
// Slash commands
// ==============================

const commands = [
  new SlashCommandBuilder()
    .setName("voice-lobby")
    .setDescription("تحديد روم الانتظار لإنشاء الغرف المؤقتة")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("الروم الصوتي الذي ينشئ الغرف")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voice-panel")
    .setDescription("إرسال لوحة إعدادات الفويس في روم نصي")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("الروم النصي الذي تظهر فيه اللوحة")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voice-status")
    .setDescription("عرض إعدادات Silfer Voice")
].map(command =>
  command.setDefaultMemberPermissions(
    PermissionsBitField.Flags.Administrator
  ).toJSON()
);

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("تم تسجيل الأوامر في السيرفر المحدد.");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("تم تسجيل الأوامر العامة.");
  }
}

// ==============================
// Bot startup
// ==============================

client.once("ready", async () => {
  console.log(`Silfer Voice يعمل باسم ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "Silfer Voice | Temporary Rooms" }],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (error) {
    console.error("تعذر تسجيل الأوامر:", error);
  }

  // Remove stale room records after a restart.
  for (const [guildId, config] of Object.entries(db)) {
    if (!config.rooms) continue;

    const guild = client.guilds.cache.get(guildId);

    for (const channelId of Object.keys(config.rooms)) {
      const channel = guild
        ? guild.channels.cache.get(channelId)
        : null;

      if (!channel || channel.type !== ChannelType.GuildVoice) {
        delete config.rooms[channelId];
      }
    }
  }

  saveDB();
});

// ==============================
// Slash command handler
// ==============================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guild) {
    return interaction.reply(errorText("استخدم الأمر داخل السيرفر."));
  }

  if (!interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  )) {
    return interaction.reply(errorText("هذا الأمر للإدارة فقط."));
  }

  const guild = interaction.guild;
  const config = getConfig(guild.id);

  if (interaction.commandName === "voice-lobby") {
    const lobby = interaction.options.getChannel("channel", true);

    config.lobbyId = lobby.id;
    saveDB();

    return interaction.reply(
      successText(`تم تعيين ${lobby} كروم انتظار للغرف المؤقتة.`)
    );
  }

  if (interaction.commandName === "voice-panel") {
    const channel = interaction.options.getChannel("channel", true);

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    try {
      const message = await channel.send(makePanel());

      config.panelChannelId = channel.id;
      config.panelMessageId = message.id;
      saveDB();

      return interaction.editReply(
        `تم إرسال لوحة Silfer Voice في ${channel}.`
      );
    } catch (error) {
      console.error("فشل إرسال لوحة التحكم:", error);
      return interaction.editReply(
        "تعذر إرسال اللوحة. تأكد أن البوت يستطيع رؤية الروم وإرسال الرسائل وتضمين الروابط."
      );
    }
  }

  if (interaction.commandName === "voice-status") {
    const lobby = config.lobbyId
      ? `<#${config.lobbyId}>`
      : "غير محدد";

    const panel = config.panelChannelId
      ? `<#${config.panelChannelId}>`
      : "غير محدد";

    const activeRooms = Object.keys(config.rooms).length;

    return interaction.reply({
      embeds: [
        makeEmbed(
          "📋 حالة Silfer Voice",
          `**روم الانتظار:** ${lobby}\n` +
          `**روم اللوحة:** ${panel}\n` +
          `**الغرف المسجلة:** ${activeRooms}`
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
});

// ==============================
// Create a temporary voice room
// ==============================

const creatingRooms = new Set();

client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild;
  const config = getConfig(guild.id);

  // Create a room when a member joins the configured lobby.
  if (
    newState.channelId &&
    newState.channelId === config.lobbyId &&
    oldState.channelId !== newState.channelId
  ) {
    const member = newState.member;
    if (!member || member.user.bot) return;

    const lockKey = `${guild.id}:${member.id}`;

    if (creatingRooms.has(lockKey)) return;
    creatingRooms.add(lockKey);

    try {
      const botMember = guild.members.me;

      if (!botMember?.permissions.has(
        PermissionsBitField.Flags.ManageChannels
      )) {
        console.error("البوت يحتاج Manage Channels.");
        return;
      }

      const lobby = guild.channels.cache.get(config.lobbyId);
      if (!lobby) return;

      const channel = await guild.channels.create({
        name: `🎙️・${member.user.username}`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: lobby.parentId || undefined,
        userLimit: 0,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect
            ]
          },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.MoveMembers
            ]
          }
        ],
        reason: `Silfer Voice: غرفة مؤقتة لـ ${member.user.tag}`
      });

      config.rooms[channel.id] = {
        ownerId: member.id,
        locked: false,
        hidden: false
      };

      saveDB();

      // Move the member into their new room.
      await member.voice.setChannel(channel).catch(async error => {
        console.error("تعذر نقل العضو إلى غرفته:", error.message);
        await channel.delete().catch(() => {});
        delete config.rooms[channel.id];
        saveDB();
      });
    } catch (error) {
      console.error("خطأ إنشاء الغرفة:", error);
    } finally {
      creatingRooms.delete(lockKey);
    }

    return;
  }

  // Delete empty temporary rooms.
  if (
    oldState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    const oldChannel = oldState.guild.channels.cache.get(
      oldState.channelId
    );

    if (!oldChannel || oldChannel.type !== ChannelType.GuildVoice) {
      return;
    }

    const room = getRoomConfig(guild.id, oldChannel.id);

    if (room && oldChannel.members.size === 0) {
      try {
        await oldChannel.delete("Silfer Voice: الغرفة أصبحت فارغة");
      } catch (error) {
        console.error("تعذر حذف الغرفة الفارغة:", error.message);
      }

      delete config.rooms[oldChannel.id];
      saveDB();
    }
  }
});

// ==============================
// Room control button handler
// ==============================

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sv_")) return;

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply(errorText("استخدم اللوحة داخل السيرفر."));
  }

  const member = await guild.members.fetch(interaction.user.id)
    .catch(() => null);

  if (!member?.voice.channelId) {
    return interaction.reply(errorText("ادخل غرفتك الصوتية أولًا."));
  }

  const channel = member.voice.channel;
  const room = getRoomConfig(guild.id, channel.id);

  if (!room) {
    return interaction.reply(errorText("أنت لست في غرفة مؤقتة يديرها البوت."));
  }

  if (!isOwnerOrAdmin(interaction, room)) {
    return interaction.reply(errorText("هذه الغرفة ليست ملكك."));
  }

  if (interaction.customId === "sv_rename") {
    const modal = new ModalBuilder()
      .setCustomId(`sv_modal_rename:${channel.id}`)
      .setTitle("تغيير اسم الغرفة");

    const input = new TextInputBuilder()
      .setCustomId("room_name")
      .setLabel("اسم الغرفة الجديد")
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(90)
      .setRequired(true)
      .setPlaceholder("اكتب الاسم هنا");

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    return interaction.showModal(modal);
  }

  if (interaction.customId === "sv_limit") {
    const modal = new ModalBuilder()
      .setCustomId(`sv_modal_limit:${channel.id}`)
      .setTitle("تحديد عدد الأعضاء");

    const input = new TextInputBuilder()
      .setCustomId("room_limit")
      .setLabel("العدد من 0 إلى 99 (0 = بلا حد)")
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(2)
      .setRequired(true)
      .setPlaceholder("مثال: 10");

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    return interaction.showModal(modal);
  }

  if (interaction.customId === "sv_lock") {
    const locked = !room.locked;

    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { Connect: locked ? false : null }
      );

      // Keep the owner able to enter the room.
      await channel.permissionOverwrites.edit(room.ownerId, {
        ViewChannel: true,
        Connect: true
      });

      room.locked = locked;
      saveDB();

      return interaction.reply(
        successText(locked ? "تم قفل الغرفة." : "تم فتح الغرفة.")
      );
    } catch (error) {
      console.error(error);
      return interaction.reply(errorText("تعذر تغيير إعداد القفل."));
    }
  }

  if (interaction.customId === "sv_hide") {
    const hidden = !room.hidden;

    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { ViewChannel: hidden ? false : null }
      );

      await channel.permissionOverwrites.edit(room.ownerId, {
        ViewChannel: true,
        Connect: true
      });

      room.hidden = hidden;
      saveDB();

      return interaction.reply(
        successText(hidden ? "تم إخفاء الغرفة." : "تم إظهار الغرفة.")
      );
    } catch (error) {
      console.error(error);
      return interaction.reply(errorText("تعذر تغيير ظهور الغرفة."));
    }
  }

  if (
    interaction.customId === "sv_kick" ||
    interaction.customId === "sv_transfer"
  ) {
    const candidates = [...channel.members.values()].filter(
      m => m.id !== interaction.user.id && !m.user.bot
    );

    if (candidates.length === 0) {
      return interaction.reply(errorText("لا يوجد أعضاء آخرون في الغرفة."));
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(
        interaction.customId === "sv_kick"
          ? `sv_select_kick:${channel.id}`
          : `sv_select_transfer:${channel.id}`
      )
      .setPlaceholder(
        interaction.customId === "sv_kick"
          ? "اختر العضو الذي تريد طرده"
          : "اختر المالك الجديد"
      )
      .addOptions(
        candidates.slice(0, 25).map(m => ({
          label: m.user.username.slice(0, 100),
          description: `ID: ${m.id}`,
          value: m.id
        }))
      );

    return interaction.reply({
      content: interaction.customId === "sv_kick"
        ? "اختر عضوًا لطرده من الغرفة:"
        : "اختر العضو الذي ستنقل إليه الملكية:",
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral
    });
  }
});

// ==============================
// Modal submit handler
// ==============================

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;

  const parts = interaction.customId.split(":");
  const action = parts[0];
  const channelId = parts[1];

  if (action !== "sv_modal_rename" && action !== "sv_modal_limit") return;

  const guild = interaction.guild;
  const channel = guild?.channels.cache.get(channelId);

  if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
    return interaction.reply(errorText("الغرفة غير موجودة."));
  }

  const room = getRoomConfig(guild.id, channel.id);

  if (!room || !isOwnerOrAdmin(interaction, room)) {
    return interaction.reply(errorText("ليس لديك صلاحية تعديل هذه الغرفة."));
  }

  try {
    if (action === "sv_modal_rename") {
      const name = interaction.fields.getTextInputValue("room_name").trim();

      if (!name) {
        return interaction.reply(errorText("اكتب اسمًا صحيحًا."));
      }

      await channel.setName(name);
      return interaction.reply(successText("تم تغيير اسم الغرفة."));
    }

    const raw = interaction.fields.getTextInputValue("room_limit").trim();

    if (!/^\d{1,2}$/.test(raw)) {
      return interaction.reply(errorText("أدخل رقمًا من 0 إلى 99."));
    }

    const limit = Number(raw);

    if (limit < 0 || limit > 99) {
      return interaction.reply(errorText("الحد يجب أن يكون من 0 إلى 99."));
    }

    await channel.setUserLimit(limit);

    return interaction.reply(
      successText(limit === 0
        ? "تم إزالة حد الأعضاء."
        : `تم تحديد الحد الأقصى بـ ${limit} أعضاء.`)
    );
  } catch (error) {
    console.error("خطأ تعديل الغرفة:", error);
    return interaction.reply(errorText("تعذر تعديل الغرفة. تحقق من صلاحيات البوت."));
  }
});

// ==============================
// Kick / transfer select menus
// ==============================

client.on("interactionCreate", async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith("sv_select_")) return;

  const guild = interaction.guild;
  const parts = interaction.customId.split(":");
  const action = parts[0];
  const channelId = parts[1];

  const channel = guild?.channels.cache.get(channelId);

  if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
    return interaction.reply(errorText("الغرفة غير موجودة."));
  }

  const room = getRoomConfig(guild.id, channel.id);

  if (!room || !isOwnerOrAdmin(interaction, room)) {
    return interaction.reply(errorText("ليس لديك صلاحية إدارة هذه الغرفة."));
  }

  const targetId = interaction.values[0];
  const target = await guild.members.fetch(targetId).catch(() => null);

  if (!target || target.voice.channelId !== channel.id) {
    return interaction.reply(errorText("العضو لم يعد موجودًا في الغرفة."));
  }

  try {
    if (action === "sv_select_kick") {
      await target.voice.disconnect("Silfer Voice: طرد من الغرفة");
      return interaction.update({
        content: `تم طرد ${target.user.tag} من الغرفة.`,
        components: [],
        embeds: []
      });
    }

    if (action === "sv_select_transfer") {
      const oldOwner = room.ownerId;

      await channel.permissionOverwrites.edit(target.id, {
        ViewChannel: true,
        Connect: true,
        ManageChannels: true,
        MoveMembers: true
      });

      room.ownerId = target.id;
      saveDB();

      // Remove the old owner's extra permissions unless they are an admin.
      const oldMember = await guild.members.fetch(oldOwner).catch(() => null);

      if (oldMember && !oldMember.permissions.has(
        PermissionsBitField.Flags.Administrator
      )) {
        await channel.permissionOverwrites.edit(oldOwner, {
          ManageChannels: null,
          MoveMembers: null
        }).catch(() => {});
      }

      return interaction.update({
        content: `تم نقل ملكية الغرفة إلى ${target}.`,
        components: [],
        embeds: []
      });
    }
  } catch (error) {
    console.error("خطأ في إدارة الأعضاء:", error);

    return interaction.update({
      content: "تعذر تنفيذ العملية. تحقق من صلاحيات البوت.",
      components: [],
      embeds: []
    });
  }
});

// ==============================
// Error handling
// ==============================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

client.login(TOKEN);
