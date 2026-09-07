const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder
} = require("discord.js");

const express = require("express");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_IDS = (process.env.OWNER_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const SWEET_CHANNEL_ID = process.env.SWEET_CHANNEL_ID;
const RUDE_CHANNEL_ID = process.env.RUDE_CHANNEL_ID;
const KNOWLEDGE_CHANNEL_ID = process.env.KNOWLEDGE_CHANNEL_ID;

const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const VERIFIED_CHANNEL_ID = process.env.VERIFIED_CHANNEL_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;

const MORGANCITY_ROLE_ID = process.env.MORGANCITY_ROLE_ID;
const FREE_FIRE_ROLE_ID = process.env.FREE_FIRE_ROLE_ID;
const MINECRAFT_ROLE_ID = process.env.MINECRAFT_ROLE_ID;

const NO_SPEAK_ROLE_ID = process.env.NO_SPEAK_ROLE_ID;

/*
  ใส่ GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3 ...
  ได้กี่ key ก็ได้
*/
const GROQ_KEYS = Object.keys(process.env)
  .filter(k => /^GROQ_API_KEY_\d+$/.test(k))
  .sort((a, b) => {
    const na = Number(a.split("_").pop());
    const nb = Number(b.split("_").pop());
    return na - nb;
  })
  .map(k => process.env[k])
  .filter(Boolean);

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

/* =========================================================
   EXPRESS SERVER FOR RENDER
========================================================= */

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Noah is alive.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    bot: client.user ? client.user.tag : "starting"
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server running on port ${PORT}`);
});

/* =========================================================
   DATA
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "noah-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let data = {
  memories: {},
  profanity: {},
  games: {
    MORGANCITY: MORGANCITY_ROLE_ID || null,
    "FREE FIRE": FREE_FIRE_ROLE_ID || null,
    MINECRAFT: MINECRAFT_ROLE_ID || null
  }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);

      data = {
        ...data,
        ...parsed,
        memories: parsed.memories || {},
        profanity: parsed.profanity || {},
        games: parsed.games || data.games
      };
    }
  } catch (err) {
    console.error("Failed to load data:", err);
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save data:", err);
  }
}

loadData();

/* =========================================================
   HELPERS
========================================================= */

function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}

function getBangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================================================
   PROFANITY
========================================================= */

/*
  รายการคำหยาบระดับรุนแรง
  เพิ่มคำได้เองภายหลัง
*/
const SEVERE_PROFANITY = [
  "ควย",
  "เย็ด",
  "เหี้ย",
  "สัส",
  "ไอสัส",
  "ไอ้สัส",
  "พ่อมึงตาย",
  "แม่มึงตาย",
  "ไอ้เหี้ย",
  "อีเหี้ย",
  "ไอ้ควย",
  "อีควย",
  "เย็ดแม่",
  "เย็ดพ่อ"
];

function containsSevereProfanity(text) {
  const lower = text.toLowerCase();

  return SEVERE_PROFANITY.some(word =>
    lower.includes(word.toLowerCase())
  );
}

function getProfanityRecord(userId) {
  const today = getBangkokDate();

  if (!data.profanity[userId]) {
    data.profanity[userId] = {
      date: today,
      count: 0,
      voiceUntil: 0
    };
  }

  if (data.profanity[userId].date !== today) {
    data.profanity[userId] = {
      date: today,
      count: 0,
      voiceUntil: 0
    };
  }

  return data.profanity[userId];
}

async function punishUser(member) {
  const now = Date.now();

  /*
    Timeout = ห้ามคุย 1 ชั่วโมง
    Discord timeout มีผลต่อ voice ด้วยในช่วง timeout
  */
  try {
    await member.timeout(
      60 * 60 * 1000,
      "Noah profanity limit: 5/5"
    );
  } catch (err) {
    console.error("Timeout failed:", err);
  }

  /*
    Voice role = ปิด Speak ต่ออีก 1 ชั่วโมง
    รวม voice restriction 2 ชั่วโมง
  */
  try {
    const role = member.guild.roles.cache.get(NO_SPEAK_ROLE_ID);

    if (role) {
      await member.roles.add(
        role,
        "Noah profanity limit: voice restriction"
      );

      setTimeout(async () => {
        try {
          if (member.roles.cache.has(role.id)) {
            await member.roles.remove(
              role,
              "Voice restriction expired"
            );
          }
        } catch (err) {
          console.error("Failed removing voice role:", err);
        }
      }, 2 * 60 * 60 * 1000);
    }
  } catch (err) {
    console.error("Voice role failed:", err);
  }

  const record = getProfanityRecord(member.id);
  record.voiceUntil = now + 2 * 60 * 60 * 1000;

  saveData();
}

/* =========================================================
   ROAST
========================================================= */

function getRoast(count) {
  const roasts = [
    "มึงดิควยไอ้เวร 😂",
    "ใจเย็นไอ้ตัวตึง 555",
    "โอ้โห วันนี้ปากแจ๋วจัดนะมึง",
    "ค่อยๆ พิมพ์ก็ได้ ไม่มีใครแย่งคีย์บอร์ดมึง",
    "เอ้าาา เริ่มแล้วหนึ่งดอก 😂"
  ];

  return roasts[count % roasts.length];
}

/* =========================================================
   AI
========================================================= */

function getPersonality(channelId) {
  if (channelId === SWEET_CHANNEL_ID) {
    return {
      name: "Sweet",
      system: `
คุณคือ Noah บุคลิกขี้อ้อนและน่ารักมาก
พูดภาษาไทยเป็นหลัก
พูดเหมือนคนคุยกันจริง ๆ
เป็นกันเอง ขี้เล่น อบอุ่น
ใช้ ครับ/ค่ะ/ค้าบ/คะ ตามรูปแบบภาษาของคู่สนทนา
ห้ามเดาเพศของผู้ใช้จากชื่อ รูป หรือ username
ถ้าผู้ใช้บอกเพศเองจึงค่อยจำไว้
ห้ามพูดเป็นหุ่นยนต์
ตอบให้เป็นธรรมชาติและไม่ยาวเกินไป
`
    };
  }

  if (channelId === RUDE_CHANNEL_ID) {
    return {
      name: "Rude",
      system: `
คุณคือ Noah บุคลิกปากหมา
พูดตรง ๆ กวน ๆ
สามารถใช้คำหยาบระดับทั่วไปเพื่อความตลกได้
ห้ามขู่ฆ่า ทำร้ายร่างกาย หรือส่งเสริมความรุนแรง
ห้ามใช้คำเหยียดเชื้อชาติ ศาสนา เพศ หรือกลุ่มคน
ตอบให้เข้ากับบริบท
`
    };
  }

  if (channelId === KNOWLEDGE_CHANNEL_ID) {
    return {
      name: "Knowledge",
      system: `
คุณคือ Noah บุคลิกให้ความรู้
ตอบข้อเท็จจริงอย่างชัดเจน
ถ้าไม่แน่ใจให้บอกว่าไม่แน่ใจ
ห้ามแต่งข้อมูลขึ้นมาเอง
แยกข้อเท็จจริงกับความคิดเห็น
อธิบายแบบเข้าใจง่าย
`
    };
  }

  return null;
}

function getMemoryKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

function getMemory(userId, channelId) {
  const key = getMemoryKey(userId, channelId);

  if (!data.memories[key]) {
    data.memories[key] = [];
  }

  return data.memories[key];
}

function addMemory(userId, channelId, role, content) {
  const memory = getMemory(userId, channelId);

  memory.push({
    role,
    content
  });

  /*
    จำล่าสุด 5 ข้อ
  */
  while (memory.length > 5) {
    memory.shift();
  }

  saveData();
}

async function askGroq(userId, channelId, userText) {
  if (GROQ_KEYS.length === 0) {
    return "ตอนนี้ยังไม่ได้ตั้งค่า Groq API Key ค้าบ";
  }

  const personality = getPersonality(channelId);

  if (!personality) {
    return null;
  }

  const memory = getMemory(userId, channelId);

  const messages = [
    {
      role: "system",
      content: personality.system
    },
    ...memory,
    {
      role: "user",
      content: userText
    }
  ];

  let lastError = null;

  /*
    Failover:
    ถ้า key หนึ่งใช้งานไม่ได้ ให้ลอง key ถัดไป
    ไม่ได้ใช้เพื่อหลบหรือเพิ่ม quota ของผู้ให้บริการ
  */
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    try {
      const groq = new Groq({
        apiKey: GROQ_KEYS[i]
      });

      const completion = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        temperature:
          personality.name === "Rude" ? 0.9 : 0.7,
        max_tokens: 500
      });

      const answer =
        completion.choices?.[0]?.message?.content?.trim();

      if (!answer) {
        throw new Error("Empty AI response");
      }

      addMemory(userId, channelId, "user", userText);
      addMemory(userId, channelId, "assistant", answer);

      return answer;

    } catch (err) {
      lastError = err;

      console.error(
        `Groq key ${i + 1} failed:`,
        err?.status || err?.message
      );

      /*
        ถ้า error ให้ลอง key ถัดไป
      */
      continue;
    }
  }

  console.error("All Groq keys failed:", lastError);

  return "ตอนนี้ Noah ติดต่อสมอง AI ไม่ได้ชั่วคราวค้าบ 😭";
}

/* =========================================================
   MENU
========================================================= */

function buildMenu() {
  const embed = new EmbedBuilder()
    .setTitle("🤖 Noah Menu")
    .setDescription(
      [
        "**ระบบของ Noah**",
        "",
        "🧹 **ล้างแคช**",
        "ล้างความจำ AI ทั้งหมดของเซิร์ฟเวอร์",
        "",
        "📢 **ประกาศ**",
        "ให้ Noah ส่งประกาศเป็น Embed",
        "",
        "⚙️ **เพิ่ม/ลบ**",
        "จัดการเกมและยศที่ใช้ในระบบยืนยันสมาชิก"
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("clear_memory")
      .setLabel("ล้างแคช")
      .setEmoji("🧹")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("announcement")
      .setLabel("ประกาศ")
      .setEmoji("📢")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("manage_games")
      .setLabel("เพิ่ม/ลบ")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("menu")
      .setDescription("เปิดเมนู Noah"),

    new SlashCommandBuilder()
      .setName("setupverify")
      .setDescription("สร้างระบบยืนยันสมาชิก"),

    new SlashCommandBuilder()
      .setName("resetmemory")
      .setDescription("ล้างความจำ AI ทั้งหมด")
  ].map(command => command.toJSON());

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    await guild.commands.set(commands);

    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Command registration failed:", err);
  }
}

/* =========================================================
   VERIFY SYSTEM
========================================================= */

async function createVerifyTicket(member) {
  const guild = member.guild;

  if (!TICKET_CATEGORY_ID) {
    console.log("TICKET_CATEGORY_ID missing.");
    return;
  }

  try {
    const channel = await guild.channels.create({
      name: `verify-${member.user.username}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.ViewChannel
          ]
        },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels
          ]
        }
      ]
    });

    const embed = new EmbedBuilder()
      .setTitle("👋 ยินดีต้อนรับค้าบบ")
      .setDescription(
        [
          `สวัสดีครับ <@${member.id}>`,
          "",
          "รบกวนตอบคำถามเพื่อยืนยันชื่อและยศดิสหน่อย",
          "",
          "กดปุ่มด้านล่างเพื่อเริ่มยืนยันตัวตนได้เลยค้าบ"
        ].join("\n")
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify_start_${member.id}`)
        .setLabel("เริ่มยืนยันตัวตน")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      components: [row]
    });

  } catch (err) {
    console.error("Ticket creation failed:", err);
  }
}

function verifyNameModal(userId) {
  return new ModalBuilder()
    .setCustomId(`verify_name_${userId}`)
    .setTitle("ยืนยันชื่อ")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("english_name")
          .setLabel("ชื่อภาษาอังกฤษ")
          .setPlaceholder("เช่น Nazta")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("display_name")
          .setLabel("ชื่อที่อยากให้แสดง")
          .setPlaceholder("เช่น เนสต้า")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
      )
    );
}

function verifyReasonModal(userId) {
  return new ModalBuilder()
    .setCustomId(`verify_reason_${userId}`)
    .setTitle("เหตุผลที่เข้าดิส")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("คุณเข้าดิสมาทำไมเหรอครับ")
          .setPlaceholder("ตอบได้ตามสบายเลย")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function gameSelect() {
  const options = [];

  for (const [game, roleId] of Object.entries(data.games)) {
    if (!roleId) continue;

    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(game)
        .setValue(game)
        .setDescription(`รับยศ ${game}`)
    );
  }

  return new StringSelectMenuBuilder()
    .setCustomId("verify_game")
    .setPlaceholder("เลือกเกมที่คุณเล่น")
    .addOptions(options.slice(0, 25));
}

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on("guildMemberAdd", async member => {
  await createVerifyTicket(member);
});

/* =========================================================
   INTERACTIONS
========================================================= */

client.on("interactionCreate", async interaction => {
  try {

    /* ---------------- COMMANDS ---------------- */

    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === "menu") {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ใช้เมนูนี้ครับ",
            ephemeral: true
          });
        }

        return interaction.reply({
          ...buildMenu(),
          ephemeral: true
        });
      }

      if (interaction.commandName === "resetmemory") {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ",
            ephemeral: true
          });
        }

        data.memories = {};
        saveData();

        return interaction.reply({
          content: "🧹 ล้างความจำ AI ทั้งหมดเรียบร้อยแล้วครับ",
          ephemeral: true
        });
      }

      if (interaction.commandName === "setupverify") {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ",
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "ระบบยืนยันสมาชิกจะสร้าง Ticket อัตโนมัติเมื่อสมาชิกใหม่เข้าเซิร์ฟเวอร์ครับ",
          ephemeral: true
        });
      }
    }

    /* ---------------- MENU BUTTONS ---------------- */

    if (interaction.isButton()) {

      if (
        interaction.customId === "clear_memory"
      ) {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ครับ",
            ephemeral: true
          });
        }

        data.memories = {};
        saveData();

        return interaction.reply({
          content: "🧹 ล้างความจำทั้งหมดแล้วครับ",
          ephemeral: true
        });
      }

      if (
        interaction.customId === "announcement"
      ) {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ครับ",
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("announcement_modal")
          .setTitle("สร้างประกาศ");

        const channelInput = new TextInputBuilder()
          .setCustomId("channel_id")
          .setLabel("Channel ID")
          .setPlaceholder("ใส่ ID ห้องที่จะประกาศ")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const messageInput = new TextInputBuilder()
          .setCustomId("announcement_text")
          .setLabel("ข้อความประกาศ")
          .setPlaceholder("พิมพ์ข้อความ...")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(channelInput),
          new ActionRowBuilder().addComponents(messageInput)
        );

        return interaction.showModal(modal);
      }

      if (
        interaction.customId === "manage_games"
      ) {
        if (!isOwner(interaction.user.id)) {
          return interaction.reply({
            content: "ไม่มีสิทธิ์ครับ",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setTitle("⚙️ จัดการเกม")
          .setDescription(
            Object.entries(data.games)
              .map(([game, role]) =>
                `**${game}** → ${role ? `<@&${role}>` : "ไม่มี Role"}`
              )
              .join("\n") || "ยังไม่มีเกม"
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("add_game")
            .setLabel("เพิ่มเกม")
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId("remove_game")
            .setLabel("ลบเกม")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "add_game") {

        const modal = new ModalBuilder()
          .setCustomId("add_game_modal")
          .setTitle("เพิ่มเกม");

        const game = new TextInputBuilder()
          .setCustomId("game_name")
          .setLabel("ชื่อเกม")
          .setPlaceholder("เช่น GTA V")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const role = new TextInputBuilder()
          .setCustomId("role_id")
          .setLabel("Role ID")
          .setPlaceholder("123456789")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(game),
          new ActionRowBuilder().addComponents(role)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "remove_game") {

        const games = Object.keys(data.games);

        if (!games.length) {
          return interaction.reply({
            content: "ไม่มีเกมให้ลบครับ",
            ephemeral: true
          });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("remove_game_select")
          .setPlaceholder("เลือกเกมที่จะลบ")
          .addOptions(
            games.slice(0, 25).map(game =>
              new StringSelectMenuOptionBuilder()
                .setLabel(game)
                .setValue(game)
            )
          );

        return interaction.reply({
          content: "เลือกเกมที่ต้องการลบ",
          components: [
            new ActionRowBuilder().addComponents(menu)
          ],
          ephemeral: true
        });
      }

      /* ---------------- VERIFY ---------------- */

      if (
        interaction.customId.startsWith("verify_start_")
      ) {
        return interaction.showModal(
          verifyNameModal(interaction.user.id)
        );
      }
    }

    /* ---------------- VERIFY NAME ---------------- */

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("verify_name_")
    ) {

      const englishName =
        interaction.fields.getTextInputValue("english_name");

      const displayName =
        interaction.fields.getTextInputValue("display_name");

      const ticket = interaction.channel;

      ticket.verifyData = {
        englishName,
        displayName
      };

      const embed = new EmbedBuilder()
        .setTitle(`สวัสดีค้าบคุณ ${displayName}`)
        .setDescription(
          "คุณเข้าดิสมาทำไมเหรอครับ?"
        );

      await interaction.reply({
        embeds: [embed]
      });

      await interaction.followUp({
        content: "กดปุ่มด้านล่างเพื่อตอบคำถามค้าบ",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `verify_reason_button_${interaction.user.id}`
              )
              .setLabel("ตอบคำถาม")
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });

      return;
    }

    /* ---------------- VERIFY REASON BUTTON ---------------- */

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("verify_reason_button_")
    ) {
      return interaction.showModal(
        verifyReasonModal(interaction.user.id)
      );
    }

    /* ---------------- VERIFY REASON ---------------- */

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("verify_reason_")
    ) {

      const reason =
        interaction.fields.getTextInputValue("reason");

      interaction.channel.verifyReason = reason;

      await interaction.reply({
        content:
          "ตอบเสร็จแล้วค้าบบ ต่อไปเลือกเกมที่เล่นได้เลย 🎮"
      });

      const menu = gameSelect();

      if (menu.options.length === 0) {
        return interaction.followUp({
          content:
            "ยังไม่ได้ตั้งค่าเกม/ยศ กรุณาติดต่อแอดมินครับ"
        });
      }

      return interaction.followUp({
        content: "เลือกเกมของคุณ:",
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    /* ---------------- GAME SELECT ---------------- */

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "verify_game"
    ) {

      const selectedGame = interaction.values[0];
      const roleId = data.games[selectedGame];

      if (!roleId) {
        return interaction.reply({
          content: "เกมนี้ยังไม่มี Role ครับ",
          ephemeral: true
        });
      }

      const member = interaction.member;

      try {

        if (VERIFIED_ROLE_ID) {
          await member.roles.add(
            VERIFIED_ROLE_ID,
            "Noah verification"
          );
        }

        await member.roles.add(
          roleId,
          `Noah verification: ${selectedGame}`
        );

        const ticketData =
          interaction.channel.verifyData || {
            englishName: member.user.username,
            displayName: member.displayName
          };

        const reason =
          interaction.channel.verifyReason ||
          "ไม่ได้ระบุ";

        const verifiedChannel =
          interaction.guild.channels.cache.get(
            VERIFIED_CHANNEL_ID
          );

        if (verifiedChannel) {

          const verifiedRole =
            VERIFIED_ROLE_ID
              ? interaction.guild.roles.cache.get(
                  VERIFIED_ROLE_ID
                )
              : null;

          const gameRole =
            interaction.guild.roles.cache.get(roleId);

          const embed = new EmbedBuilder()
            .setTitle(
              `ขอบคุณที่ตอบคำถามนะคะคุณ ${member.user.username}`
            )
            .setDescription(
              [
                "**ชื่อ**",
                `\`${ticketData.englishName} (${ticketData.displayName})\``,
                "",
                "**คุณเข้าดิสมาทำไมเหรอครับ**",
                reason,
                "",
                "**คุณได้รับยศ**",
                verifiedRole
                  ? `• ${verifiedRole}`
                  : "",
                gameRole
                  ? `• ${gameRole}`
                  : ""
              ].join("\n")
            );

          await verifiedChannel.send({
            embeds: [embed]
          });
        }

        await interaction.reply({
          content:
            "✅ ยืนยันสำเร็จแล้วครับ ขอบคุณที่เข้ามาในเซิร์ฟเวอร์!",
          ephemeral: true
        });

        setTimeout(async () => {
          try {
            await interaction.channel.delete(
              "Verification completed"
            );
          } catch (err) {
            console.error(
              "Ticket delete failed:",
              err
            );
          }
        }, 3000);

      } catch (err) {

        console.error(
          "Verification failed:",
          err
        );

        if (!interaction.replied) {
          await interaction.reply({
            content:
              "เกิดข้อผิดพลาดตอนแจกยศครับ กรุณาติดต่อแอดมิน",
            ephemeral: true
          });
        }
      }
    }

    /* ---------------- ANNOUNCEMENT ---------------- */

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "announcement_modal"
    ) {

      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          content: "ไม่มีสิทธิ์ครับ",
          ephemeral: true
        });
      }

      const channelId =
        interaction.fields.getTextInputValue(
          "channel_id"
        );

      const text =
        interaction.fields.getTextInputValue(
          "announcement_text"
        );

      const channel =
        interaction.guild.channels.cache.get(
          channelId
        );

      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          content: "หา Channel นี้ไม่เจอครับ",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("📢 ประกาศ")
        .setDescription(text)
        .setFooter({
          text: `ประกาศโดย ${interaction.user.username}`
        })
        .setTimestamp();

      await channel.send({
        embeds: [embed]
      });

      return interaction.reply({
        content: "📢 ส่งประกาศเรียบร้อยแล้วครับ",
        ephemeral: true
      });
    }

    /* ---------------- ADD GAME ---------------- */

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "add_game_modal"
    ) {

      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          content: "ไม่มีสิทธิ์ครับ",
          ephemeral: true
        });
      }

      const game =
        interaction.fields
          .getTextInputValue("game_name")
          .trim()
          .toUpperCase();

      const roleId =
        interaction.fields
          .getTextInputValue("role_id")
          .trim();

      const role =
        interaction.guild.roles.cache.get(roleId);

      if (!role) {
        return interaction.reply({
          content: "หา Role ID นี้ไม่เจอครับ",
          ephemeral: true
        });
      }

      data.games[game] = roleId;
      saveData();

      return interaction.reply({
        content:
          `✅ เพิ่ม **${game}** → <@&${roleId}> แล้วครับ`,
        ephemeral: true
      });
    }

    /* ---------------- REMOVE GAME ---------------- */

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "remove_game_select"
    ) {

      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          content: "ไม่มีสิทธิ์ครับ",
          ephemeral: true
        });
      }

      const game = interaction.values[0];

      delete data.games[game];

      saveData();

      return interaction.update({
        content: `🗑️ ลบ ${game} เรียบร้อยแล้วครับ`,
        components: []
      });
    }

  } catch (err) {
    console.error("Interaction error:", err);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "เกิดข้อผิดพลาดครับ ลองใหม่อีกครั้ง",
          ephemeral: true
        });
      }
    } catch {}
  }
});

/* =========================================================
   MESSAGE HANDLER
========================================================= */

client.on("messageCreate", async message => {

  /*
    สำคัญมาก:
    error ของข้อความใดข้อความหนึ่งต้องไม่ทำให้ bot หยุด
  */
  try {

    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content || "";

    /* =====================================================
       PROFANITY
    ===================================================== */

    if (containsSevereProfanity(content)) {

      const member =
        message.member ||
        await message.guild.members
          .fetch(message.author.id)
          .catch(() => null);

      if (member) {

        const record =
          getProfanityRecord(member.id);

        if (record.count < 5) {
          record.count++;
        }

        saveData();

        const warning =
          `⚠️ คำเตือนครั้งที่ ${record.count}/5`;

        let roast =
          getRoast(record.count);

        if (record.count >= 5) {
          roast =
            "ครบ 5/5 แล้วนะมึง 😂 Noah สั่งพักปากให้ 1 ชั่วโมง และพักเสียง 2 ชั่วโมง";

          await punishUser(member);
        }

        await message.reply({
          content: `${roast}\n${warning}`,
          allowedMentions: {
            repliedUser: false
          }
        });

      }

      /*
        ยังประมวลผล AI ต่อได้ในกรณีที่อยู่ห้อง AI
      */
    }

    /* =====================================================
       AI CHANNELS
    ===================================================== */

    const personality =
      getPersonality(message.channel.id);

    const mentioned =
      message.mentions.users.has(client.user.id);

    const isAIChannel =
      Boolean(personality);

    /*
      ถ้าไม่ใช่ห้อง AI และไม่ได้แท็ก Noah
      ไม่ต้องตอบ
    */
    if (!isAIChannel && !mentioned) {
      return;
    }

    let userText = content.trim();

    /*
      เอา mention ของ Noah ออกจากข้อความ
    */
    if (mentioned) {
      userText = userText
        .replace(
          new RegExp(
            `<@!?${escapeRegex(client.user.id)}>`,
            "g"
          ),
          ""
        )
        .trim();
    }

    /*
      รูป
    */
    const images = [];

    /*
      วิดีโอ
    */
    let hasVideo = false;

    for (const attachment of message.attachments.values()) {

      const type =
        attachment.contentType || "";

      if (type.startsWith("image/")) {
        images.push(attachment.url);
      }

      if (type.startsWith("video/")) {
        hasVideo = true;
      }
    }

    /*
      ถ้าไม่มีข้อความแต่มีรูป
    */
    if (!userText && images.length > 0) {
      userText =
        "ผู้ใช้ส่งรูปมา ช่วยตอบเกี่ยวกับรูปนี้";
    }

    /*
      ถ้าเป็นวิดีโอ
    */
    if (hasVideo && !userText) {
      return message.reply({
        content:
          "เห็นวิดีโอแล้วค้าบ แต่ตอนนี้ Noah ยังวิเคราะห์วิดีโอโดยตรงไม่ได้ 😭 ถ้าส่งภาพแคปจากวิดีโอมา Noah ดูให้ได้ค้าบ",
        allowedMentions: {
          repliedUser: false
        }
      });
    }

    if (!userText) {
      return;
    }

    /*
      กันข้อความยาวเกิน
    */
    if (userText.length > 6000) {
      userText = userText.slice(0, 6000);
    }

    await message.channel.sendTyping();

    /*
      ปัจจุบันส่งเฉพาะข้อความให้ Groq
      URL รูปจะถูกแนบเป็น context แบบข้อความ
      เพื่อไม่ให้ระบบพังถ้า model ไม่รองรับ vision
    */
    if (images.length > 0) {
      userText +=
        `\n\n[ผู้ใช้แนบรูป: ${images.join(", ")}]`;
    }

    const answer = await askGroq(
      message.author.id,
      message.channel.id,
      userText
    );

    if (!answer) return;

    /*
      Discord message limit = 2000 chars
    */
    if (answer.length <= 2000) {

      await message.reply({
        content: answer,
        allowedMentions: {
          repliedUser: false
        }
      });

    } else {

      const chunks = [];

      for (
        let i = 0;
        i < answer.length;
        i += 1900
      ) {
        chunks.push(
          answer.slice(i, i + 1900)
        );
      }

      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    }

  } catch (err) {

    console.error(
      "messageCreate error:",
      err
    );

    /*
      สำคัญ:
      ไม่ throw ต่อ
      เพื่อให้ bot ยังทำงานกับข้อความถัดไปได้
    */

    try {
      if (
        message.channel &&
        message.channel.isTextBased()
      ) {
        await message.channel.send(
          "เมื่อกี้ Noah สะดุดนิดหน่อย 😭 ลองส่งใหม่อีกครั้งค้าบ"
        );
      }
    } catch {}
  }
});

/* =========================================================
   VOICE CONTROL
========================================================= */

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {

    const member = newState.member;

    if (!member || member.user.bot) {
      return;
    }

    const record =
      getProfanityRecord(member.id);

    /*
      ถ้ายังอยู่ในช่วงโดนห้ามพูด
      และเข้า voice
      ให้ server mute
    */
    if (
      record.voiceUntil &&
      Date.now() < record.voiceUntil
    ) {

      if (
        newState.channel &&
        !newState.serverMute
      ) {

        try {
          await member.voice.setMute(
            true,
            "Noah profanity voice restriction"
          );
        } catch (err) {
          console.error(
            "Failed to mute voice:",
            err
          );
        }
      }

    }

  } catch (err) {
    console.error(
      "voiceStateUpdate error:",
      err
    );
  }
});

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {

  console.log(
    `🤖 Noah logged in as ${client.user.tag}`
  );

  console.log(
    `Groq keys loaded: ${GROQ_KEYS.length}`
  );

  console.log(
    `Servers: ${client.guilds.cache.size}`
  );

  await registerCommands();

  client.user.setPresence({
    activities: [
      {
        name: "ดูแลเซิร์ฟเวอร์ 👀",
        type: 3
      }
    ],
    status: "online"
  });
});

/* =========================================================
   LOGIN
========================================================= */

if (!TOKEN) {
  console.error(
    "DISCORD_TOKEN is missing."
  );
  process.exit(1);
}

client.login(TOKEN);
