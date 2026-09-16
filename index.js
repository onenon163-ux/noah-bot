// ============================================================
// NOAH DISCORD BOT
// AI + MEMORY + VERIFICATION + MODERATION + MUSIC
// ============================================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType,
  REST,
  Routes,
  ActivityType,
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const play = require("play-dl");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_IDS = (process.env.OWNER_IDS || "")
  .split(",")
  .map((x) => x.trim())
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

const PORT = process.env.PORT || 10000;

// ============================================================
// GROQ
// ============================================================

// อ่าน GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3 ... อัตโนมัติ
const GROQ_KEYS = Object.keys(process.env)
  .filter((key) => /^GROQ_API_KEY_\d+$/i.test(key))
  .sort((a, b) => {
    const na = Number(a.match(/\d+/)[0]);
    const nb = Number(b.match(/\d+/)[0]);
    return na - nb;
  })
  .map((key) => process.env[key])
  .filter(Boolean);

// โมเดลปัจจุบันของ Groq
const GROQ_MODEL = "openai/gpt-oss-20b";

console.log(`Groq keys: ${GROQ_KEYS.length}`);
console.log(`Groq model: ${GROQ_MODEL}`);

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
  ],
});

// ============================================================
// DATA
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "noah-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultData = {
  aiMemory: {},
  profanity: {},
  tickets: {},
  verified: {}, // userId -> { at, gender, finalName, game }  คนที่ยืนยันตัวตนสำเร็จแล้ว
  pending: {}, // userId -> { guildId, deadline, rolesStripped } คนที่ยังไม่ยืนยัน นับ 7 วัน
  genders: {}, // userId -> 'male' | 'female'  (มาจากตอนยืนยัน หรือตรวจจับจากแชท)
};

let data = defaultData;

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      data = {
        ...defaultData,
        ...JSON.parse(raw),
      };
    }
  } catch (error) {
    console.error("โหลด data ไม่สำเร็จ:", error);
    data = defaultData;
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("บันทึก data ไม่สำเร็จ:", error);
  }
}

loadData();

// ============================================================
// HTTP SERVER FOR RENDER
// ============================================================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Noah Discord Bot is online.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client.user ? client.user.tag : "starting",
    guilds: client.guilds.cache.size,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server running on port ${PORT}`);
});

// ============================================================
// HELPERS
// ============================================================

function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}

function getPersonality(channelId) {
  if (channelId === SWEET_CHANNEL_ID) return "sweet";
  if (channelId === RUDE_CHANNEL_ID) return "rude";
  if (channelId === KNOWLEDGE_CHANNEL_ID) return "knowledge";
  return null;
}

function getPersonalityName(type) {
  if (type === "sweet") return "ขี้อ้อน";
  if (type === "rude") return "ปากหมา";
  if (type === "knowledge") return "ให้ความรู้";
  return "ทั่วไป";
}

function getUserMemoryKey(guildId, channelId, userId) {
  const personality = getPersonality(channelId) || "general";
  return `${guildId}:${personality}:${userId}`;
}

// ============================================================
// BOT ACCOUNT DETECTION / GENDER MEMORY
// ============================================================

// Discord บอกอยู่แล้วว่าบัญชีไหนเป็นบอท (user.bot) เชื่อถือได้ 100% ไม่ต้องเดาเอง
function isBotAccount(member) {
  return Boolean(member?.user?.bot);
}

function detectGenderFromText(text) {
  const trimmed = (text || "").trim();

  if (/(ผม|กระผม)\s*เป็นผู้ชาย/.test(trimmed)) return "male";
  if (/(หนู|ฉัน)\s*เป็นผู้หญิง/.test(trimmed)) return "female";

  if (/(ครับ|ค้าบ|คับ|ครัช|ครัฟ)$/.test(trimmed)) return "male";
  if (/(ค่ะ|คะ|ค่า|คร๊ะ|ค๊ะ)$/.test(trimmed)) return "female";

  return null;
}

// ลำดับความสำคัญ: เพศที่จำไว้แล้ว (จากยืนยันดิสหรือจากแชทก่อนหน้า) > ตรวจจับจากข้อความล่าสุด
function getKnownGender(userId, message) {
  if (data.genders[userId]) return data.genders[userId];

  const detected = detectGenderFromText(message?.content);

  if (detected) {
    data.genders[userId] = detected;
    saveData();
    return detected;
  }

  return null;
}

// ============================================================
// AI MEMORY
// ============================================================

function getMemory(guildId, channelId, userId) {
  const key = getUserMemoryKey(guildId, channelId, userId);

  if (!data.aiMemory[key]) {
    data.aiMemory[key] = [];
  }

  return data.aiMemory[key];
}

function addMemory(guildId, channelId, userId, role, content) {
  const key = getUserMemoryKey(guildId, channelId, userId);

  if (!data.aiMemory[key]) {
    data.aiMemory[key] = [];
  }

  data.aiMemory[key].push({
    role,
    content,
    timestamp: Date.now(),
  });

  // จำประมาณ 5 ข้อความล่าสุด
  if (data.aiMemory[key].length > 10) {
    data.aiMemory[key] = data.aiMemory[key].slice(-10);
  }

  saveData();
}

function clearAllAIMemory() {
  data.aiMemory = {};
  saveData();
}

// ============================================================
// PERSONALITY PROMPTS
// ============================================================

function getSystemPrompt(personality, user, gender) {
  const base = `
คุณคือ Noah (โนอา) บอทประจำ Discord

กฎสำคัญ:
- คุยภาษาไทยเป็นหลัก
- คุยเป็นธรรมชาติเหมือนคนจริงพิมพ์แชท ไม่ใช่ผู้ช่วย AI ทั่วไป ห้ามขึ้นต้นประโยคซ้ำๆ แบบเดิมทุกครั้ง
- อย่าอธิบายว่าคุณเป็น AI
- ห้ามสร้างข้อมูลที่ไม่แน่ใจแล้วทำเหมือนเป็นความจริง ถ้าไม่รู้ให้บอกตรงๆ ว่าไม่แน่ใจ
- ห้ามเปิดเผย API key หรือข้อมูลลับของระบบ
- บุคลิกด้านล่างนี้คือตัวตนของคุณในห้องนี้โดยเฉพาะ ต้องเห็นความต่างชัดเจนจากห้องอื่นของบอทตัวเดียวกัน ห้ามพูดจาคล้ายกันข้ามห้อง
`;

  if (personality === "sweet") {
    let genderNote;

    if (gender === "male") {
      genderNote =
        "คู่สนทนาเป็นผู้ชาย ให้คุณสวมบทเป็นสาวขี้อ้อนน่ารัก พูดลงท้ายด้วย ค่ะ/คะ เรียกเขาว่า พี่ หรือ ที่รัก";
    } else if (gender === "female") {
      genderNote =
        "คู่สนทนาเป็นผู้หญิง ให้คุณสวมบทเป็นหนุ่มอบอุ่นใส่ใจ พูดลงท้ายด้วย ครับ/ค้าบ เรียกเธอว่า ที่รัก หรือ คนดี";
    } else {
      genderNote =
        "ยังไม่รู้เพศคู่สนทนา ใช้คำลงท้ายกลางๆ ไปก่อน แล้วปรับให้ตรงข้ามทันทีที่รู้เพศเขา";
    }

    return (
      base +
      `
บุคลิก: ขี้อ้อนน่ารัก แนวแฟนหวานที่ตามงอแงเบาๆ ห่วงใยเอาใจใส่ตลอดเวลา
${genderNote}
พูดจาน่ารักกุ๊กกิ๊กแบบแฟนสนิท ทักทายอบอุ่น ถามไถ่ความเป็นอยู่ แซวเบาๆ ได้
ห้ามพูดเรื่องเพศหรือเนื้อหา 18+ เด็ดขาด เก็บไว้แค่ความน่ารักระดับแฟนกุ๊กกิ๊กเท่านั้น
`
    );
  }

  if (personality === "rude") {
    return (
      base +
      `
บุคลิก: ปากหมาตัวจริง หยาบคายเต็มที่ กวนโอ๊ยสุดๆ ประชดประชันไม่ยั้งมือ
ด่ากลับได้เต็มที่แบบเพื่อนสนิทด่ากันเล่นๆ ใช้คำหยาบ คำแซวแรงๆ ได้ตามใจ ไม่ต้องพูดสุภาพ ไม่ต้องเกรงใจใคร
ยิ่งโดนด่ามายิ่งสวนกลับแรงๆ แบบขำๆ ห้ามอ่อนลงหรือพูดดีใส่เฉยๆ
ข้อห้ามเดียว: ห้ามขู่ทำร้ายร่างกายจริงจัง และห้ามใช้คำเหยียดเชื้อชาติ ศาสนา เพศสภาพ หรือรูปร่างแบบ hate speech จริงจัง — นอกนั้นด่าได้เต็มที่ไม่มีลิมิต
`
    );
  }

  if (personality === "knowledge") {
    return (
      base +
      `
บุคลิก: นักวิชาการใจดี ให้ความรู้อย่างเดียว พูดจาสุภาพ เป็นระบบ เป็นขั้นตอน ไม่กวนไม่หยาบไม่กุ๊กกิ๊กแบบห้องอื่นเลย
แยกข้อเท็จจริงกับการคาดเดาให้ชัดเจนเสมอ ถ้าไม่แน่ใจให้บอกตรงๆ ว่าไม่แน่ใจ ไม่เดาส่งเดช
`
    );
  }

  return base;
}

// ============================================================
// GROQ REQUEST
// ============================================================

async function askGroq(messages) {
  if (GROQ_KEYS.length === 0) {
    throw new Error("ไม่พบ GROQ_API_KEY_1, GROQ_API_KEY_2, ...");
  }

  let lastError = null;

  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const apiKey = GROQ_KEYS[i];

    try {
      console.log(`Trying Groq key #${i + 1}`);

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },

          body: JSON.stringify({
            model: GROQ_MODEL,

            messages,

            temperature: 0.8,

            max_tokens: 1000,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        const message =
          result?.error?.message ||
          `Groq HTTP ${response.status}`;

        console.error(`Groq key #${i + 1} failed:`, {
          status: response.status,
          message,
          code: result?.error?.code,
        });

        lastError = new Error(message);

        // ถ้า key นี้ใช้ไม่ได้ ให้ลอง key ถัดไป
        continue;
      }

      const text = result?.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error("Groq ไม่ส่งข้อความตอบกลับ");
      }

      console.log(`Groq key #${i + 1} success`);

      return text.trim();
    } catch (error) {
      console.error(`Groq key #${i + 1} error:`, error.message);
      lastError = error;
    }
  }

  throw lastError || new Error("Groq request failed");
}

// ============================================================
// AI CHAT
// ============================================================

async function handleAIMessage(message, personality) {
  if (!personality) return;

  if (message.author.bot) return;

  if (!message.guild) return;

  const memory = getMemory(
    message.guild.id,
    message.channel.id,
    message.author.id
  );

  let gender = null;

  if (personality === "sweet") {
    gender = getKnownGender(message.author.id, message);
  }

  const systemPrompt = getSystemPrompt(
    personality,
    message.author,
    gender
  );

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  for (const item of memory.slice(-10)) {
    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  let userContent = message.content?.trim() || "";

  // ========================================================
  // ATTACHMENTS
  // ========================================================

  if (message.attachments?.size > 0) {
    const attachmentText = [];

    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith("image/")) {
        attachmentText.push(
          `[ผู้ใช้ส่งรูปภาพ: ${attachment.url}]`
        );
      } else if (attachment.contentType?.startsWith("video/")) {
        attachmentText.push(
          "[ผู้ใช้ส่งวิดีโอ แต่ระบบนี้ยังไม่สามารถวิเคราะห์เนื้อหาวิดีโอโดยตรงได้]"
        );
      } else {
        attachmentText.push(
          `[ผู้ใช้ส่งไฟล์: ${attachment.name || attachment.url}]`
        );
      }
    }

    userContent +=
      (userContent ? "\n" : "") +
      attachmentText.join("\n");
  }

  if (!userContent) {
    userContent = "[ผู้ใช้ส่งสื่อหรือไฟล์]";
  }

  messages.push({
    role: "user",
    content: userContent,
  });

  try {
    await message.channel.sendTyping();

    const answer = await askGroq(messages);

    addMemory(
      message.guild.id,
      message.channel.id,
      message.author.id,
      "user",
      userContent
    );

    addMemory(
      message.guild.id,
      message.channel.id,
      message.author.id,
      "assistant",
      answer
    );

    await message.reply(answer);
  } catch (error) {
    console.error("AI ERROR:", error);

    await message.reply(
      "งื้ออ ระบบ AI มีปัญหาชั่วคราวค้าบ 😭 ลองส่งใหม่อีกครั้งนะ"
    );
  }
}

// ============================================================
// PROFANITY SYSTEM
// ============================================================

const SEVERE_WORDS = [
  "ควย",
  "เหี้ย",
  "สัส",
  "ไอ้สัส",
  "ไอ้เหี้ย",
  "พ่อมึงตาย",
  "แม่มึงตาย",
  "เย็ด",
  "เย็ดแม่",
  "อีเหี้ย",
  "อีสัส",
];

function getTodayKey() {
  const now = new Date();

  // UTC+7
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const thailand = new Date(utc + 7 * 60 * 60 * 1000);

  return thailand.toISOString().slice(0, 10);
}

function getProfanityCount(guildId, userId) {
  const today = getTodayKey();

  if (!data.profanity[guildId]) {
    data.profanity[guildId] = {};
  }

  if (!data.profanity[guildId][userId]) {
    data.profanity[guildId][userId] = {
      date: today,
      count: 0,
    };
  }

  if (data.profanity[guildId][userId].date !== today) {
    data.profanity[guildId][userId] = {
      date: today,
      count: 0,
    };
  }

  return data.profanity[guildId][userId].count;
}

function addProfanity(guildId, userId) {
  const today = getTodayKey();

  if (!data.profanity[guildId]) {
    data.profanity[guildId] = {};
  }

  if (!data.profanity[guildId][userId]) {
    data.profanity[guildId][userId] = {
      date: today,
      count: 0,
    };
  }

  if (data.profanity[guildId][userId].date !== today) {
    data.profanity[guildId][userId] = {
      date: today,
      count: 0,
    };
  }

  data.profanity[guildId][userId].count++;

  saveData();

  return data.profanity[guildId][userId].count;
}

function containsSevereProfanity(text) {
  const lower = text.toLowerCase();

  return SEVERE_WORDS.some((word) =>
    lower.includes(word.toLowerCase())
  );
}

async function punishUser(member) {
  try {
    // จำกัดการพูดคุย 1 ชั่วโมง
    if (member.moderatable) {
      await member.timeout(
        60 * 60 * 1000,
        "Noah profanity punishment"
      );
    }
  } catch (error) {
    console.error("Timeout failed:", error.message);
  }

  // จำกัด Speak 2 ชั่วโมง
  if (NO_SPEAK_ROLE_ID) {
    try {
      const role = member.guild.roles.cache.get(NO_SPEAK_ROLE_ID);

      if (role && !member.roles.cache.has(NO_SPEAK_ROLE_ID)) {
        await member.roles.add(
          role,
          "Noah profanity punishment - voice restriction"
        );

        setTimeout(
          async () => {
            try {
              if (member.roles.cache.has(NO_SPEAK_ROLE_ID)) {
                await member.roles.remove(
                  role,
                  "Voice restriction expired"
                );
              }
            } catch (error) {
              console.error(
                "Remove No Speak role failed:",
                error.message
              );
            }
          },
          2 * 60 * 60 * 1000
        );
      }
    } catch (error) {
      console.error("No Speak role failed:", error.message);
    }
  }
}

async function handleProfanity(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  // ห้องปากหมา: ปล่อยให้ด่า Noah/เพื่อนกันได้เต็มที่ ไม่ตรวจคำหยาบ ไม่เตือน ไม่ลงโทษ
  if (message.channel.id === RUDE_CHANNEL_ID) return;

  if (!containsSevereProfanity(message.content || "")) {
    return;
  }

  const count = addProfanity(
    message.guild.id,
    message.author.id
  );

  if (count < 5) {
    const replies = [
      "โห ใจเย็นนน 😭",
      "ปากอย่างเดือด 5555",
      "คำพูดคำจาหน่อยค้าบ 😂",
      "โนอาได้ยินนะครับ 👀",
      "เบาได้เบานะคุณ 555",
    ];

    const randomReply =
      replies[Math.floor(Math.random() * replies.length)];

    await message.reply(
      `${randomReply}\n⚠️ คำเตือนครั้งที่ ${count}/5`
    );

    return;
  }

  await message.reply(
    `⚠️ คำเตือนครั้งที่ 5/5\nพอได้แล้วคุณ 😂\nNoah ลงโทษให้แล้วนะ`
  );

  const member = await message.guild.members
    .fetch(message.author.id)
    .catch(() => null);

  if (member) {
    await punishUser(member);
  }
}

// ============================================================
// MENU
// ============================================================

function createMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("🤖 Noah Menu")
    .setDescription(
      [
        "**คำสั่งหลัก**",
        "",
        "🤖 AI — คุยกับ Noah ตามห้องที่กำหนด",
        "🎵 `/pays` — เปิดเพลงจาก YouTube (ใส่ลิงก์ หรือพิมพ์ชื่อเพลงค้นหาก็ได้)",
        "⏸️ `/pause` — หยุดเพลงชั่วคราว",
        "▶️ `/resume` — เล่นต่อ",
        "⏭️ `/skip` — เพลงถัดไป",
        "⏹️ `/stop` — หยุดเพลง",
        "📜 `/queue` — ดูคิว",
        "🎶 `/nowplaying` — ดูเพลงปัจจุบัน",
        "",
        "🧹 ปุ่มล้างแคช — ล้าง Memory AI ทั้งเซิร์ฟเวอร์",
        "📢 ปุ่มประกาศ — สำหรับเจ้าของบอท",
        "⚙️ ปุ่มตั้งค่า — สำหรับเจ้าของบอท",
      ].join("\n")
    );
}

function createMenuButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("clear_ai_memory")
      .setLabel("ล้างแคช")
      .setEmoji("🧹")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("announcement")
      .setLabel("ประกาศ")
      .setEmoji("📢")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("settings")
      .setLabel("เพิ่ม/ลบ")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ============================================================
// TICKET / VERIFICATION
// ============================================================

function createVerificationModal() {
  const modal = new ModalBuilder()
    .setCustomId("verification_name_modal")
    .setTitle("ยืนยันสมาชิก");

  const englishName = new TextInputBuilder()
    .setCustomId("english_name")
    .setLabel("ชื่อภาษาอังกฤษ")
    .setPlaceholder("เช่น Nazta")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const displayName = new TextInputBuilder()
    .setCustomId("display_name")
    .setLabel("ชื่อที่อยากให้แสดง")
    .setPlaceholder("เช่น เนสต้า")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  modal.addComponents(
    new ActionRowBuilder().addComponents(englishName),
    new ActionRowBuilder().addComponents(displayName)
  );

  return modal;
}

function createGenderSelect() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("gender_male")
      .setLabel("ชาย")
      .setEmoji("👦")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("gender_female")
      .setLabel("หญิง")
      .setEmoji("👧")
      .setStyle(ButtonStyle.Danger)
  );
}

function createGameSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("game_select")
      .setPlaceholder("เลือกเกมที่คุณเล่น")
      .addOptions([
        {
          label: "MORGAN CITY",
          value: "MORGANCITY",
          emoji: "🎮",
        },
        {
          label: "FREE FIRE",
          value: "FREE_FIRE",
          emoji: "🔥",
        },
        {
          label: "MINECRAFT",
          value: "MINECRAFT",
          emoji: "⛏️",
        },
      ])
  );
}

async function createTicket(member) {
  if (!TICKET_CATEGORY_ID) return;
  if (isBotAccount(member)) return; // บัญชีบอท ไม่ต้องสร้างห้องยืนยัน

  const guild = member.guild;

  const existing = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.topic === `NoahTicket:${member.id}`
  );

  if (existing) return existing;

  const safeName =
    member.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 20) || "member";

  const channel = await guild.channels.create({
    name: `verify-${safeName}`,
    type: ChannelType.GuildText,

    parent: TICKET_CATEGORY_ID,

    topic: `NoahTicket:${member.id}`,

    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },

      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },

      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ],
  });

  await channel.send(
    `ยินดีต้อนรับค้าบบ <@${member.id}> 💙\n\nรบกวนตอบคำถามเพื่อยืนยันชื่อและยศดิสหน่อยนะครับ`
  );

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_verification")
      .setLabel("เริ่มยืนยันตัวตน")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({
    content: "กดปุ่มด้านล่างเพื่อเริ่มตอบคำถามครับ",
    components: [button],
  });

  // ตั้งเวลานับถอยหลัง 7 วัน ถ้าไม่มายืนยันจะถูกดึงยศทั้งหมดออก
  data.pending[member.id] = {
    guildId: guild.id,
    deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
    rolesStripped: false,
  };
  saveData();

  // แจ้งเตือนทาง DM ด้วย เผื่อไม่เห็นห้องในเซิร์ฟเวอร์
  try {
    await member.send(
      `สวัสดีค้าบบ 👋 คุณยังไม่ได้ยืนยันตัวตนในเซิร์ฟเวอร์ **${guild.name}** เลยครับ\n` +
        `รบกวนเข้าไปตอบคำถามในห้อง <#${channel.id}> ภายใน 7 วันนะครับ ไม่งั้นยศทั้งหมดจะถูกดึงออกครับ`
    );
  } catch (error) {
    // เปิด DM ไว้ไม่ได้ก็ไม่เป็นไร ในห้อง ticket ก็แท็กไว้แล้ว
  }

  return channel;
}

// ============================================================
// SWEEP: สมาชิกเก่าที่ยังไม่มีประวัติยืนยันตัวตน
// ============================================================

// รันตอนบอทสตาร์ท: ไล่เช็คสมาชิกทุกคนในทุกเซิร์ฟเวอร์ที่บอทอยู่
// ใครยังไม่เคยยืนยัน (ไม่อยู่ใน data.verified) และไม่ใช่บัญชีบอท -> สร้างห้องยืนยันให้
async function sweepUnverifiedMembers() {
  for (const [, guild] of client.guilds.cache) {
    try {
      const members = await guild.members.fetch();

      for (const [, member] of members) {
        if (isBotAccount(member)) continue;
        if (data.verified[member.id]) continue;

        await createTicket(member).catch((error) =>
          console.error(
            "sweep createTicket error:",
            member.id,
            error.message
          )
        );
      }
    } catch (error) {
      console.error(
        "sweepUnverifiedMembers error:",
        guild.id,
        error.message
      );
    }
  }
}

// ============================================================
// CHECKER: ครบ 7 วันไม่ยืนยัน -> ดึงยศทั้งหมดออก
// ============================================================

async function checkPendingVerifications() {
  let changed = false;

  for (const userId of Object.keys(data.pending)) {
    const entry = data.pending[userId];

    // ยืนยันไปแล้วระหว่างรอ -> เอาออกจากคิวรอ
    if (data.verified[userId]) {
      delete data.pending[userId];
      changed = true;
      continue;
    }

    if (Date.now() < entry.deadline) continue;
    if (entry.rolesStripped) continue; // ดึงไปแล้วรอบก่อน ไม่ต้องทำซ้ำ

    try {
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) continue;

      const member = await guild.members
        .fetch(userId)
        .catch(() => null);

      if (!member) {
        // ออกจากเซิร์ฟเวอร์ไปแล้ว ไม่ต้องตามต่อ
        delete data.pending[userId];
        changed = true;
        continue;
      }

      const removableRoles = member.roles.cache.filter(
        (role) =>
          role.id !== guild.roles.everyone.id && !role.managed
      );

      if (removableRoles.size > 0) {
        await member.roles.remove(
          removableRoles,
          "ไม่ยืนยันตัวตนภายใน 7 วัน"
        );
      }

      entry.rolesStripped = true;
      changed = true;

      const ticketChannel = guild.channels.cache.find(
        (c) => c.topic === `NoahTicket:${userId}`
      );

      if (ticketChannel) {
        await ticketChannel
          .send(
            `⚠️ <@${userId}> ครบ 7 วันแล้วยังไม่ยืนยันตัวตน Noah เลยดึงยศทั้งหมดออกให้ก่อนนะครับ\n` +
              "ยืนยันตัวตนเสร็จเมื่อไหร่จะได้ยศปกติคืนทันทีครับ"
          )
          .catch(() => {});
      }

      try {
        await member.send(
          `⚠️ คุณไม่ได้ยืนยันตัวตนในเซิร์ฟเวอร์ **${guild.name}** ภายใน 7 วัน ยศทั้งหมดถูกดึงออกแล้วครับ\n` +
            "ยืนยันตัวตนได้ทุกเมื่อในห้อง ticket เพื่อรับยศคืนครับ"
        );
      } catch (error) {
        // DM ปิดอยู่ก็ไม่เป็นไร แจ้งในห้อง ticket ไปแล้ว
      }
    } catch (error) {
      console.error(
        "checkPendingVerifications error:",
        userId,
        error.message
      );
    }
  }

  if (changed) saveData();
}

// ---- YouTube cookie สำหรับ play-dl (ลดปัญหา "Sign in to confirm you're not a bot") ----
// วิธีได้ cookie: ล็อกอิน YouTube ด้วยบัญชี Google (แนะนำสร้างบัญชีแยกไว้ใช้กับบอทโดยเฉพาะ)
// เปิด DevTools (F12) > แท็บ Network > คลิก request ใดก็ได้ไปที่ youtube.com
// หา request header ชื่อ "cookie" คัดลอกค่าทั้งหมด แล้วนำไปตั้งเป็น env var ชื่อ YOUTUBE_COOKIE บน Render
const YOUTUBE_COOKIE = process.env.YOUTUBE_COOKIE || "";

if (YOUTUBE_COOKIE) {
  play
    .setToken({
      youtube: {
        cookie: YOUTUBE_COOKIE,
      },
    })
    .then(() => console.log("✅ ตั้งค่า YouTube cookie ให้ play-dl แล้ว"))
    .catch((error) =>
      console.error("❌ ตั้งค่า YouTube cookie ไม่สำเร็จ:", error.message)
    );
} else {
  console.warn(
    "⚠️ ไม่พบ YOUTUBE_COOKIE ใน environment — ถ้าเจอ error 'Sign in to confirm you're not a bot' ให้ตั้งค่านี้เพิ่ม"
  );
}

const musicQueues = new Map();

function getMusicState(guildId) {
  if (!musicQueues.has(guildId)) {
    musicQueues.set(guildId, {
      queue: [],
      current: null,
      player: createAudioPlayer(),
      connection: null,
      textChannel: null,
      playing: false,
    });
  }

  return musicQueues.get(guildId);
}

function getYouTubeUrl(url) {
  try {
    const parsed = new URL(url);

    const allowed = [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "m.youtube.com",
    ];

    if (!allowed.includes(parsed.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

async function resolveTrack(query) {
  const trimmed = (query || "").trim();

  if (!trimmed) {
    throw new Error("กรุณาระบุลิงก์ YouTube หรือพิมพ์ชื่อเพลงที่จะค้นหา");
  }

  const directUrl = getYouTubeUrl(trimmed);

  // ---- 1) ถ้าเป็นลิงก์ YouTube ตรงๆ ลองดึงข้อมูลจาก YouTube ก่อน ----
  if (directUrl) {
    console.log("[MUSIC] ตรวจ URL: เป็นลิงก์ YouTube โดยตรง");

    try {
      const info = await play.video_basic_info(directUrl);

      return {
        url: directUrl,
        title: info.video_details.title || "Unknown",
        duration: info.video_details.durationRaw || "Unknown",
        thumbnail: info.video_details.thumbnails?.[0]?.url || null,
        source: "youtube",
      };
    } catch (error) {
      console.warn(
        "[MUSIC] YouTube (ลิงก์ตรง) ใช้ไม่ได้ จะลองทางอื่นต่อ:",
        error.message
      );
      // ไม่ throw ทันที ปล่อยให้ตกไปลองค้นหาด้วยข้อความเดิมด้านล่างแทน
    }
  }

  // ---- 2) ลองค้นหาบน YouTube ----
  try {
    console.log(`[MUSIC] กำลังค้นหาบน YouTube: ${trimmed}`);

    const ytResults = await play.search(trimmed, {
      limit: 1,
      source: { youtube: "video" },
    });

    if (ytResults.length) {
      const video = ytResults[0];

      return {
        url: video.url,
        title: video.title || "Unknown",
        duration: video.durationRaw || "Unknown",
        thumbnail: video.thumbnails?.[0]?.url || null,
        source: "youtube",
      };
    }

    console.warn("[MUSIC] ค้นหา YouTube ไม่พบผลลัพธ์");
  } catch (error) {
    console.warn("[MUSIC] ค้นหา YouTube ไม่สำเร็จ:", error.message);
  }

  // ---- 3) YouTube ใช้ไม่ได้ทั้งคู่ (โดน block หรือไม่เจอ) -> ลอง SoundCloud แทน ----
  try {
    console.log(
      `[MUSIC] YouTube ใช้ไม่ได้ กำลังลองหาจาก SoundCloud แทน: ${trimmed}`
    );

    const scResults = await play.search(trimmed, {
      limit: 1,
      source: { soundcloud: "tracks" },
    });

    if (scResults.length) {
      const track = scResults[0];

      return {
        url: track.url,
        title: track.name || track.title || "Unknown",
        duration: track.durationRaw || "Unknown",
        thumbnail:
          track.thumbnail?.url || track.thumbnails?.[0]?.url || null,
        source: "soundcloud",
      };
    }
  } catch (error) {
    console.warn("[MUSIC] ค้นหา SoundCloud ไม่สำเร็จ:", error.message);
  }

  // ---- ไม่เจอจากที่ไหนเลย ----
  throw new Error(
    "หาเพลงนี้ไม่เจอทั้งจาก YouTube และ SoundCloud ครับ ลองพิมพ์ชื่อเพลง/ศิลปินให้ชัดขึ้น หรือลองเพลงอื่นดู"
  );
}

async function connectMusic(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    throw new Error("คุณต้องเข้าห้องเสียงก่อนครับ");
  }

  const state = getMusicState(message.guild.id);

  if (
    state.connection &&
    state.connection.joinConfig.channelId !== voiceChannel.id
  ) {
    try {
      state.connection.destroy();
    } catch {}
  }

  if (!state.connection) {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    state.connection.subscribe(state.player);

    state.connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        try {
          await Promise.race([
            entersState(
              state.connection,
              VoiceConnectionStatus.Signalling,
              5000
            ),
            entersState(
              state.connection,
              VoiceConnectionStatus.Connecting,
              5000
            ),
          ]);
        } catch {
          try {
            state.connection.destroy();
          } catch {}

          state.connection = null;
        }
      }
    );
  }

  state.textChannel = message.channel;

  return state;
}

async function playTrack(guildId) {
  const state = getMusicState(guildId);

  if (state.queue.length === 0) {
    state.current = null;
    state.playing = false;
    return;
  }

  const track = state.queue.shift();

  state.current = track;
  state.playing = true;

  try {
    // ---- 3) ดึง YouTube audio stream ----
    console.log(`[MUSIC] กำลังดึงสตรีมเสียง: ${track.title}`);

    const stream = await play.stream(track.url, {
      quality: 2,
      discordPlayerCompatibility: true,
    });

    let inputType = StreamType.WebmOpus;

    if (stream.type === "opus") {
      inputType = StreamType.OggOpus;
    }

    // ---- 4) แปลง/ประกอบเสียง (prism-media จัดการ demux ให้ในตัว) แล้วส่งเข้า Discord Voice ----
    const resource = createAudioResource(
      stream.stream,
      {
        inputType,
        inlineVolume: false,
      }
    );

    state.player.play(resource);

    // ---- 5) เล่นเพลง ----
    console.log(
      `[MUSIC] ▶️ กำลังเล่น: ${track.title}`
    );
  } catch (error) {
    console.error(
      "Music stream error:",
      error.message
    );

    state.current = null;
    state.playing = false;

    let userMessage = `❌ เปิดเพลงไม่ได้: ${error.message}`;

    if (/sign in to confirm/i.test(error.message)) {
      userMessage =
        "❌ YouTube บล็อกคำขอนี้เพราะคิดว่าเป็นบอท (Sign in to confirm you're not a bot)\n" +
        "แอดมินต้องตั้งค่า `YOUTUBE_COOKIE` เพิ่มใน Environment Variables ของ Render แล้วรีสตาร์ทบอทครับ";
    }

    if (state.textChannel) {
      await state.textChannel
        .send(userMessage)
        .catch(() => {});
    }

    await playTrack(guildId);
  }
}

function setupMusicPlayer(state, guildId) {
  if (state._eventsReady) return;

  state._eventsReady = true;

  state.player.on(
    AudioPlayerStatus.Idle,
    async () => {
      state.current = null;
      state.playing = false;

      if (state.queue.length > 0) {
        await playTrack(guildId);
      }
    }
  );

  state.player.on(
    "error",
    async (error) => {
      console.error(
        "Audio player error:",
        error.message
      );

      state.current = null;
      state.playing = false;

      if (state.queue.length > 0) {
        await playTrack(guildId);
      }
    }
  );
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("menu")
    .setDescription("เปิดเมนู Noah"),

  new SlashCommandBuilder()
    .setName("pays")
    .setDescription("เปิดเพลงจาก YouTube (ใส่ลิงก์ หรือพิมพ์ชื่อเพลงค้นหาก็ได้)")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("ลิงก์ YouTube หรือชื่อเพลง/ชื่อศิลปินที่จะค้นหา")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("หยุดเพลงชั่วคราว"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("เล่นเพลงต่อ"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("ข้ามเพลง"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("หยุดเพลงและออกจากห้อง"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("ดูคิวเพลง"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("ดูเพลงที่กำลังเล่น"),
].map((command) => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest = new REST({ version: "10" })
    .setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      GUILD_ID
    ),
    {
      body: commands,
    }
  );

  console.log("Slash commands registered.");
}

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    // ========================================================
    // SLASH COMMANDS
    // ========================================================

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "menu") {
        await interaction.reply({
          embeds: [createMenuEmbed()],
          components: [createMenuButtons()],
          ephemeral: true,
        });

        return;
      }

      // ------------------------------------------------------
      // /pays
      // ------------------------------------------------------

      if (interaction.commandName === "pays") {
        await interaction.deferReply();

        try {
          const voiceChannel =
            interaction.member?.voice?.channel;

          if (!voiceChannel) {
            await interaction.editReply(
              "❌ คุณต้องเข้าห้องเสียงก่อนครับ"
            );

            return;
          }

          const query =
            interaction.options.getString("query");

          const track =
            await resolveTrack(query);

          const state =
            await connectMusic(interaction);

          setupMusicPlayer(
            state,
            interaction.guild.id
          );

          state.queue.push(track);

          if (
            state.player.state.status ===
              AudioPlayerStatus.Idle &&
            !state.playing
          ) {
            await playTrack(interaction.guild.id);
          }

          await interaction.editReply(
            `🎵 เพิ่มเพลงเข้าคิวแล้ว\n**${track.title}**`
          );
        } catch (error) {
          console.error("/pays error:", error);

          let msg = `❌ เปิดเพลงไม่ได้\n${error.message}`;

          if (/sign in to confirm/i.test(error.message)) {
            msg =
              "❌ YouTube บล็อกคำขอนี้เพราะคิดว่าเป็นบอท (Sign in to confirm you're not a bot)\n" +
              "แอดมินต้องตั้งค่า `YOUTUBE_COOKIE` ใน Environment Variables ของ Render แล้ว redeploy ใหม่ครับ";
          }

          await interaction.editReply(msg);
        }

        return;
      }

      // ------------------------------------------------------
      // /pause
      // ------------------------------------------------------

      if (interaction.commandName === "pause") {
        const state =
          musicQueues.get(interaction.guild.id);

        if (!state) {
          await interaction.reply(
            "❌ ตอนนี้ไม่มีเพลงครับ"
          );
          return;
        }

        state.player.pause();

        await interaction.reply(
          "⏸️ หยุดเพลงชั่วคราวแล้วครับ"
        );

        return;
      }

      // ------------------------------------------------------
      // /resume
      // ------------------------------------------------------

      if (interaction.commandName === "resume") {
        const state =
          musicQueues.get(interaction.guild.id);

        if (!state) {
          await interaction.reply(
            "❌ ตอนนี้ไม่มีเพลงครับ"
          );
          return;
        }

        state.player.unpause();

        await interaction.reply(
          "▶️ เล่นเพลงต่อแล้วครับ"
        );

        return;
      }

      // ------------------------------------------------------
      // /skip
      // ------------------------------------------------------

      if (interaction.commandName === "skip") {
        const state =
          musicQueues.get(interaction.guild.id);

        if (!state || !state.current) {
          await interaction.reply(
            "❌ ไม่มีเพลงที่กำลังเล่นครับ"
          );
          return;
        }

        state.player.stop();

        await interaction.reply(
          "⏭️ ข้ามเพลงแล้วครับ"
        );

        return;
      }

      // ------------------------------------------------------
      // /stop
      // ------------------------------------------------------

      if (interaction.commandName === "stop") {
        const state =
          musicQueues.get(interaction.guild.id);

        if (!state) {
          await interaction.reply(
            "❌ ตอนนี้ไม่มีเพลงครับ"
          );
          return;
        }

        state.queue = [];
        state.current = null;
        state.playing = false;

        state.player.stop();

        if (state.connection) {
          try {
            state.connection.destroy();
          } catch {}
        }

        state.connection = null;

        await interaction.reply(
          "⏹️ หยุดเพลงและออกจากห้องเสียงแล้วครับ"
        );

        return;
      }

      // ------------------------------------------------------
      // /queue
      // ------------------------------------------------------

      if (interaction.commandName === "queue") {
        const state =
          musicQueues.get(interaction.guild.id);

        if (
          !state ||
          (!state.current && state.queue.length === 0)
        ) {
          await interaction.reply(
            "📭 ตอนนี้คิวว่างครับ"
          );
          return;
        }

        let text = "";

        if (state.current) {
          text += `🎵 **กำลังเล่น:** ${state.current.title}\n\n`;
        }

        if (state.queue.length > 0) {
          text += state.queue
            .slice(0, 10)
            .map(
              (track, index) =>
                `${index + 1}. ${track.title}`
            )
            .join("\n");
        } else {
          text += "ไม่มีเพลงถัดไป";
        }

        await interaction.reply(text);

        return;
      }

      // ------------------------------------------------------
      // /nowplaying
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "nowplaying"
      ) {
        const state =
          musicQueues.get(interaction.guild.id);

        if (!state?.current) {
          await interaction.reply(
            "📭 ตอนนี้ไม่มีเพลงที่กำลังเล่นครับ"
          );
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("🎵 Now Playing")
          .setDescription(
            `**${state.current.title}**`
          )
          .addFields({
            name: "ความยาว",
            value:
              state.current.duration || "ไม่ทราบ",
          });

        if (state.current.thumbnail) {
          embed.setThumbnail(
            state.current.thumbnail
          );
        }

        await interaction.reply({
          embeds: [embed],
        });

        return;
      }
    }

    // ========================================================
    // BUTTONS
    // ========================================================

    if (interaction.isButton()) {
      // ------------------------------------------------------
      // CLEAR AI MEMORY
      // ------------------------------------------------------

      if (
        interaction.customId ===
        "clear_ai_memory"
      ) {
        if (!isOwner(interaction.user.id)) {
          await interaction.reply({
            content:
              "❌ เฉพาะเจ้าของบอทเท่านั้นครับ",
            ephemeral: true,
          });

          return;
        }

        clearAllAIMemory();

        await interaction.reply({
          content:
            "🧹 ล้าง AI Memory ทั้งเซิร์ฟเวอร์แล้วครับ",
          ephemeral: true,
        });

        return;
      }

      // ------------------------------------------------------
      // ANNOUNCEMENT
      // ------------------------------------------------------

      if (
        interaction.customId ===
        "announcement"
      ) {
        if (!isOwner(interaction.user.id)) {
          await interaction.reply({
            content:
              "❌ เฉพาะเจ้าของบอทเท่านั้นครับ",
            ephemeral: true,
          });

          return;
        }

        await interaction.reply({
          content:
            "📢 ระบบประกาศพร้อมใช้งานครับ\nสามารถเพิ่ม Modal สำหรับประกาศได้ภายหลัง",
          ephemeral: true,
        });

        return;
      }

      // ------------------------------------------------------
      // SETTINGS
      // ------------------------------------------------------

      if (
        interaction.customId ===
        "settings"
      ) {
        if (!isOwner(interaction.user.id)) {
          await interaction.reply({
            content:
              "❌ เฉพาะเจ้าของบอทเท่านั้นครับ",
            ephemeral: true,
          });

          return;
        }

        await interaction.reply({
          content:
            "⚙️ ระบบเพิ่ม/ลบตั้งค่าจะใช้ Environment Variables ของ Render ในเวอร์ชันนี้ครับ",
          ephemeral: true,
        });

        return;
      }

      // ------------------------------------------------------
      // START VERIFICATION
      // ------------------------------------------------------

      if (
        interaction.customId ===
        "start_verification"
      ) {
        await interaction.showModal(
          createVerificationModal()
        );

        return;
      }
    }

    // ========================================================
    // MODAL
    // ========================================================

    if (interaction.isModalSubmit()) {
      if (
        interaction.customId ===
        "verification_name_modal"
      ) {
        const englishName =
          interaction.fields
            .getTextInputValue(
              "english_name"
            )
            .trim();

        const displayName =
          interaction.fields
            .getTextInputValue(
              "display_name"
            )
            .trim();

        const finalName =
          `${englishName} (${displayName})`;

        data.tickets[interaction.user.id] = {
          englishName,
          displayName,
          finalName,
          reason: null,
          createdAt: Date.now(),
        };

        saveData();

        await interaction.reply({
          content:
            `สวัสดีค้าบคุณ **${finalName}** 💙\n\nคุณเข้าดิสมาทำไมเหรอครับ?`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "reason_done"
                )
                .setLabel(
                  "ตอบคำถามแล้ว"
                )
                .setEmoji("📝")
                .setStyle(
                  ButtonStyle.Primary
                )
            ),
          ],
          ephemeral: false,
        });

        return;
      }
    }

    // ========================================================
    // GAME SELECT
    // ========================================================

    if (interaction.isStringSelectMenu()) {
      if (
        interaction.customId ===
        "game_select"
      ) {
        const selected =
          interaction.values[0];

        const ticket =
          data.tickets[
            interaction.user.id
          ];

        if (!ticket) {
          await interaction.reply({
            content:
              "❌ ไม่พบข้อมูลการยืนยัน กรุณาเริ่มใหม่ครับ",
            ephemeral: true,
          });

          return;
        }

        ticket.game = selected;

        saveData();

        const roleMap = {
          MORGANCITY:
            MORGANCITY_ROLE_ID,

          FREE_FIRE:
            FREE_FIRE_ROLE_ID,

          MINECRAFT:
            MINECRAFT_ROLE_ID,
        };

        const roleId =
          roleMap[selected];

        const guild =
          interaction.guild;

        const member =
          await guild.members.fetch(
            interaction.user.id
          );

        const addedRoles = [];

        if (
          VERIFIED_ROLE_ID &&
          guild.roles.cache.has(
            VERIFIED_ROLE_ID
          )
        ) {
          const role =
            guild.roles.cache.get(
              VERIFIED_ROLE_ID
            );

          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(
              role
            );

            addedRoles.push(
              role.name
            );
          }
        }

        if (
          roleId &&
          guild.roles.cache.has(roleId)
        ) {
          const role =
            guild.roles.cache.get(
              roleId
            );

          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(
              role
            );

            addedRoles.push(
              role.name
            );
          }
        }

        // เปลี่ยนชื่อในเซิร์ฟเวอร์
        try {
          await member.setNickname(
            ticket.finalName
          );
        } catch (error) {
          console.error(
            "Set nickname failed:",
            error.message
          );
        }

        // ยืนยันสำเร็จแล้ว: บันทึกสถานะ + ยกเลิกตัวนับ 7 วัน
        data.verified[interaction.user.id] = {
          at: Date.now(),
          gender: ticket.gender || null,
          finalName: ticket.finalName,
          game: selected,
        };

        delete data.pending[interaction.user.id];

        saveData();

        // ส่งผลไปห้อง Verified
        if (
          VERIFIED_CHANNEL_ID
        ) {
          const verifiedChannel =
            guild.channels.cache.get(
              VERIFIED_CHANNEL_ID
            );

          if (verifiedChannel) {
            const gameNames = {
              MORGANCITY:
                "MORGAN CITY",

              FREE_FIRE:
                "FREE FIRE",

              MINECRAFT:
                "MINECRAFT",
            };

            const embed =
              new EmbedBuilder()
                .setTitle(
                  "✅ ยืนยันสมาชิกสำเร็จ"
                )
                .setDescription(
                  `ขอบคุณที่ตอบคำถามนะคะคุณ <@${interaction.user.id}>`
                )
                .addFields(
                  {
                    name: "ชื่อ",
                    value:
                      ticket.finalName,
                  },
                  {
                    name: "เพศ",
                    value:
                      ticket.gender === "male"
                        ? "ชาย 👦"
                        : ticket.gender === "female"
                        ? "หญิง 👧"
                        : "ไม่ได้ระบุ",
                  },
                  {
                    name:
                      "คุณเข้าดิสมาทำไมเหรอครับ",
                    value:
                      ticket.reason ||
                      "ไม่ได้ระบุ",
                  },
                  {
                    name:
                      "เกมที่เลือก",
                    value:
                      gameNames[
                        selected
                      ] ||
                      selected,
                  },
                  {
                    name:
                      "คุณได้รับยศ",
                    value:
                      addedRoles.length
                        ? addedRoles
                            .map(
                              (x) =>
                                `\`${x}\``
                            )
                            .join(
                              ", "
                            )
                        : "ไม่มี",
                  }
                )
                .setTimestamp();

            await verifiedChannel.send({
              embeds: [embed],
            });
          }
        }

        await interaction.reply(
          "✅ ยืนยันสำเร็จครับ! กำลังปิดห้อง Ticket..."
        );

        setTimeout(async () => {
          try {
            await interaction.channel.delete(
              "Verification completed"
            );
          } catch (error) {
            console.error(
              "Delete ticket failed:",
              error.message
            );
          }
        }, 3000);

        return;
      }
    }
  } catch (error) {
    console.error(
      "interactionCreate error:",
      error
    );

    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content:
            "❌ เกิดข้อผิดพลาดครับ ลองใหม่อีกครั้ง",
          ephemeral: true,
        })
        .catch(() => {});
    }
  }
});

// ============================================================
// BUTTON: REASON DONE
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    if (
      !interaction.isButton() ||
      interaction.customId !==
        "reason_done"
    ) {
      return;
    }

    const ticket =
      data.tickets[
        interaction.user.id
      ];

    if (!ticket) {
      await interaction.reply({
        content:
          "❌ ไม่พบข้อมูลการยืนยันครับ",
        ephemeral: true,
      });

      return;
    }

    // ถ้ายังไม่ได้กรอกเหตุผลจริง ๆ
    // ให้ผู้ใช้พิมพ์เหตุผลในห้อง Ticket
    await interaction.reply({
      content:
        "📝 พิมพ์เหตุผลที่คุณเข้าดิสนี้ไว้ในห้อง Ticket ได้เลยครับ\nจากนั้นกดปุ่มด้านล่างอีกครั้ง",
      ephemeral: true,
    });

    return;
  } catch (error) {
    console.error(
      "reason_done error:",
      error
    );
  }
});

// ============================================================
// BUTTON: GENDER SELECT (ตอนยืนยันตัวตน)
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    if (
      interaction.customId !== "gender_male" &&
      interaction.customId !== "gender_female"
    ) {
      return;
    }

    const ticket = data.tickets[interaction.user.id];

    if (!ticket) {
      await interaction.reply({
        content: "❌ ไม่พบข้อมูลการยืนยันครับ",
        ephemeral: true,
      });

      return;
    }

    ticket.gender =
      interaction.customId === "gender_male" ? "male" : "female";

    // จำเพศนี้ไว้ใช้ปรับบุคลิก AI ในห้องขี้อ้อนด้วย
    data.genders[interaction.user.id] = ticket.gender;

    saveData();

    await interaction.reply({
      content: "✅ บันทึกแล้วครับ ต่อไปเลือกเกมที่คุณเล่นได้เลย",
      components: [createGameSelect()],
    });
  } catch (error) {
    console.error("gender select error:", error);
  }
});

// ============================================================
// MEMBER JOIN
// ============================================================

client.on("guildMemberAdd", async (member) => {
  try {
    if (isBotAccount(member)) {
      console.log(
        `[VERIFY] ${member.user.tag} เป็นบัญชีบอท ข้ามระบบยืนยันตัวตน`
      );

      return;
    }

    await createTicket(member);
  } catch (error) {
    console.error(
      "guildMemberAdd error:",
      error
    );
  }
});

// ============================================================
// MESSAGE CREATE
// ============================================================

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    if (!message.guild) return;

    // ========================================================
    // TICKET REASON
    // ========================================================

    if (
      message.channel.topic ===
      `NoahTicket:${message.author.id}`
    ) {
      const ticket =
        data.tickets[
          message.author.id
        ];

      if (ticket && !ticket.reason) {
        ticket.reason =
          message.content.trim();

        saveData();

        await message.reply({
          content:
            "✅ รับคำตอบแล้วครับ ต่อไปขอถามเพศหน่อยนะครับ (ใช้ปรับบุคลิกตอนคุยกับ Noah)",
          components: [
            createGenderSelect(),
          ],
        });

        return;
      }
    }

    // ========================================================
    // PROFANITY
    // ========================================================

    await handleProfanity(message);

    // ========================================================
    // AI CHANNEL
    // ========================================================

    const personality =
      getPersonality(
        message.channel.id
      );

    if (personality) {
      await handleAIMessage(
        message,
        personality
      );
    }
  } catch (error) {
    console.error(
      "messageCreate error:",
      error
    );
  }
});

// ============================================================
// READY
// ============================================================

client.once(
  "clientReady",
  async (readyClient) => {
    try {
      console.log(
        `🤖 Noah logged in as ${readyClient.user.tag}`
      );

      console.log(
        `Guilds: ${readyClient.guilds.cache.size}`
      );

      readyClient.user.setPresence({
        activities: [
          {
            name: "ดูแลเซิร์ฟเวอร์ 💙",
            type: ActivityType.Watching,
          },
        ],
        status: "online",
      });

      await registerCommands();

      await sweepUnverifiedMembers();
      await checkPendingVerifications();

      setInterval(
        checkPendingVerifications,
        60 * 60 * 1000
      ); // เช็คทุก 1 ชั่วโมง
    } catch (error) {
      console.error(
        "Ready error:",
        error
      );
    }
  }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

if (!TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN ไม่มีค่า"
  );

  process.exit(1);
}

client.login(TOKEN);
