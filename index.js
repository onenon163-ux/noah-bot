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
const play = require("play-dl");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  getVoiceConnection
} = require("@discordjs/voice");

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

const SWEET_CHANNEL_ID =
  process.env.SWEET_CHANNEL_ID;

const RUDE_CHANNEL_ID =
  process.env.RUDE_CHANNEL_ID;

const KNOWLEDGE_CHANNEL_ID =
  process.env.KNOWLEDGE_CHANNEL_ID;

const TICKET_CATEGORY_ID =
  process.env.TICKET_CATEGORY_ID;

const VERIFIED_CHANNEL_ID =
  process.env.VERIFIED_CHANNEL_ID;

const VERIFIED_ROLE_ID =
  process.env.VERIFIED_ROLE_ID;

const MORGANCITY_ROLE_ID =
  process.env.MORGANCITY_ROLE_ID;

const FREE_FIRE_ROLE_ID =
  process.env.FREE_FIRE_ROLE_ID;

const MINECRAFT_ROLE_ID =
  process.env.MINECRAFT_ROLE_ID;

const NO_SPEAK_ROLE_ID =
  process.env.NO_SPEAK_ROLE_ID;

const GROQ_KEYS = Object.keys(process.env)
  .filter(k => /^GROQ_API_KEY_\d+$/.test(k))
  .sort((a, b) => {
    const na = Number(a.split("_").pop());
    const nb = Number(b.split("_").pop());
    return na - nb;
  })
  .map(k => process.env[k])
  .filter(Boolean);

const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";

/* =========================================================
   DISCORD CLIENT
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
   RENDER WEB SERVER
========================================================= */

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Noah is alive 🤖");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    bot: client.user
      ? client.user.tag
      : "starting"
  });
});

const PORT =
  process.env.PORT || 10000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HTTP server running on port ${PORT}`
    );
  }
);

/* =========================================================
   DATA
========================================================= */

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(
    DATA_DIR,
    "noah-data.json"
  );

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(
    DATA_DIR,
    { recursive: true }
  );
}

let data = {
  memories: {},
  profanity: {},
  games: {
    MORGANCITY:
      MORGANCITY_ROLE_ID || null,

    "FREE FIRE":
      FREE_FIRE_ROLE_ID || null,

    MINECRAFT:
      MINECRAFT_ROLE_ID || null
  }
};

function loadData() {
  try {
    if (
      fs.existsSync(DATA_FILE)
    ) {
      const raw =
        fs.readFileSync(
          DATA_FILE,
          "utf8"
        );

      const parsed =
        JSON.parse(raw);

      data = {
        ...data,
        ...parsed,
        memories:
          parsed.memories || {},
        profanity:
          parsed.profanity || {},
        games:
          parsed.games || data.games
      };
    }
  } catch (err) {
    console.error(
      "Data load error:",
      err
    );
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.error(
      "Data save error:",
      err
    );
  }
}

loadData();

/* =========================================================
   HELPERS
========================================================= */

function isOwner(userId) {
  return OWNER_IDS.includes(
    userId
  );
}

function getLocalDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Vientiane",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}

function escapeRegex(text) {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/* =========================================================
   AI PERSONALITY
========================================================= */

function getPersonality(channelId) {

  if (
    channelId ===
    SWEET_CHANNEL_ID
  ) {
    return {
      name: "Sweet",
      system: `
คุณคือ Noah บุคลิกขี้อ้อนและน่ารัก
พูดภาษาไทยเป็นหลัก
พูดเหมือนคนจริง ๆ
เป็นกันเอง ขี้เล่น อบอุ่น
ใช้ครับ/ค่ะ/ค้าบ/คะตามรูปแบบการพูดของผู้ใช้
ห้ามเดาเพศจากชื่อ username avatar
ผู้ใช้ต้องบอกเพศเองเท่านั้น
ตอบกระชับและเป็นธรรมชาติ
`
    };
  }

  if (
    channelId ===
    RUDE_CHANNEL_ID
  ) {
    return {
      name: "Rude",
      system: `
คุณคือ Noah บุคลิกปากหมา
กวน ๆ ตรง ๆ และใช้คำหยาบได้ในบริบทขำ ๆ
ห้ามขู่ฆ่า
ห้ามขู่ทำร้าย
ห้ามเหยียดเชื้อชาติ ศาสนา เพศ หรือกลุ่มคน
ตอบให้เข้ากับบริบท
`
    };
  }

  if (
    channelId ===
    KNOWLEDGE_CHANNEL_ID
  ) {
    return {
      name: "Knowledge",
      system: `
คุณคือ Noah บุคลิกให้ความรู้
ตอบข้อเท็จจริง
ห้ามแต่งข้อมูล
ถ้าไม่แน่ใจให้บอกว่าไม่แน่ใจ
อธิบายง่ายและชัดเจน
`
    };
  }

  return null;
}

/* =========================================================
   AI MEMORY
========================================================= */

function memoryKey(
  userId,
  channelId
) {
  return `${userId}:${channelId}`;
}

function getMemory(
  userId,
  channelId
) {
  const key =
    memoryKey(
      userId,
      channelId
    );

  if (
    !data.memories[key]
  ) {
    data.memories[key] = [];
  }

  return data.memories[key];
}

function addMemory(
  userId,
  channelId,
  role,
  content
) {
  const memory =
    getMemory(
      userId,
      channelId
    );

  memory.push({
    role,
    content
  });

  while (
    memory.length > 5
  ) {
    memory.shift();
  }

  saveData();
}

/* =========================================================
   GROQ
========================================================= */

async function askGroq(
  userId,
  channelId,
  userText
) {
  if (
    GROQ_KEYS.length === 0
  ) {
    return "ยังไม่ได้ตั้งค่า Groq API Key ค้าบ";
  }

  const personality =
    getPersonality(
      channelId
    );

  if (!personality) {
    return null;
  }

  const memory =
    getMemory(
      userId,
      channelId
    );

  const messages = [
    {
      role: "system",
      content:
        personality.system
    },
    ...memory,
    {
      role: "user",
      content: userText
    }
  ];

  let lastError;

  for (
    let i = 0;
    i < GROQ_KEYS.length;
    i++
  ) {
    try {

      const groq =
        new Groq({
          apiKey:
            GROQ_KEYS[i]
        });

      const result =
        await groq.chat.completions.create(
          {
            model:
              GROQ_MODEL,
            messages,
            temperature:
              personality.name ===
              "Rude"
                ? 0.9
                : 0.7,
            max_tokens: 500
          }
        );

      const answer =
        result
          .choices?.[0]
          ?.message
          ?.content
          ?.trim();

      if (!answer) {
        throw new Error(
          "Empty AI response"
        );
      }

      addMemory(
        userId,
        channelId,
        "user",
        userText
      );

      addMemory(
        userId,
        channelId,
        "assistant",
        answer
      );

      return answer;

    } catch (err) {

      lastError = err;

      console.error(
        `Groq key ${i + 1} failed`,
        err?.status,
        err?.message
      );

      continue;
    }
  }

  console.error(
    "All Groq keys failed:",
    lastError
  );

  return "ตอนนี้สมอง AI ของ Noah สะดุดค้าบ 😭";
}

/* =========================================================
   PROFANITY
========================================================= */

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

function containsProfanity(
  text
) {
  const lower =
    text.toLowerCase();

  return SEVERE_PROFANITY.some(
    word =>
      lower.includes(
        word.toLowerCase()
      )
  );
}

function getProfanityRecord(
  userId
) {
  const today =
    getLocalDate();

  if (
    !data.profanity[userId]
  ) {
    data.profanity[userId] = {
      date: today,
      count: 0,
      voiceUntil: 0
    };
  }

  const record =
    data.profanity[userId];

  if (
    record.date !== today
  ) {
    data.profanity[userId] = {
      date: today,
      count: 0,
      voiceUntil: 0
    };
  }

  return data.profanity[userId];
}

function getRoast(count) {

  const replies = [
    "มึงดิควยไอ้เวร 😂",
    "ใจเย็นไอ้ตัวตึง 555",
    "โอ้โห ปากแจ๋วจัดนะมึง",
    "ค่อย ๆ พิมพ์ก็ได้มึง 😂",
    "เอ้าาา เริ่มแล้วหนึ่งดอก"
  ];

  return replies[
    count %
      replies.length
  ];
}

async function punishUser(
  member
) {

  try {

    await member.timeout(
      60 * 60 * 1000,
      "Noah profanity 5/5"
    );

  } catch (err) {

    console.error(
      "Timeout error:",
      err
    );
  }

  try {

    const role =
      member.guild.roles.cache.get(
        NO_SPEAK_ROLE_ID
      );

    if (role) {

      await member.roles.add(
        role,
        "Noah voice restriction"
      );

      setTimeout(
        async () => {

          try {

            if (
              member.roles.cache.has(
                role.id
              )
            ) {

              await member.roles.remove(
                role,
                "Noah voice restriction expired"
              );

            }

          } catch (err) {
            console.error(
              "Remove voice role error:",
              err
            );
          }

        },
        2 * 60 * 60 * 1000
      );
    }

  } catch (err) {

    console.error(
      "Voice punishment error:",
      err
    );
  }

  const record =
    getProfanityRecord(
      member.id
    );

  record.voiceUntil =
    Date.now() +
    2 * 60 * 60 * 1000;

  saveData();
}

/* =========================================================
   MUSIC SYSTEM
========================================================= */

/*
  Music state แยกตาม Server
*/

const musicQueues =
  new Map();

/*
  {
    guildId,
    voiceChannelId,
    connection,
    player,
    queue: [],
    current: null
  }
*/

function getMusicState(
  guildId
) {

  if (
    !musicQueues.has(
      guildId
    )
  ) {

    const player =
      createAudioPlayer({
        behaviors: {
          noSubscriber:
            NoSubscriberBehavior.Pause
        }
      });

    const state = {
      guildId,
      voiceChannelId: null,
      connection: null,
      player,
      queue: [],
      current: null
    };

    player.on(
      AudioPlayerStatus.Idle,
      async () => {

        try {
          await playNext(
            guildId
          );
        } catch (err) {
          console.error(
            "Play next error:",
            err
          );
        }

      }
    );

    player.on(
      "error",
      async error => {

        console.error(
          "Audio player error:",
          error
        );

        const state =
          musicQueues.get(
            guildId
          );

        if (!state) return;

        try {
          await playNext(
            guildId
          );
        } catch (err) {
          console.error(
            "Recovery error:",
            err
          );
        }
      }
    );

    musicQueues.set(
      guildId,
      state
    );
  }

  return musicQueues.get(
    guildId
  );
}

function isYouTubeUrl(
  url
) {
  return (
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(
      url
    )
  );
}

async function createYouTubeTrack(
  url,
  requestedBy
) {

  if (
    !isYouTubeUrl(url)
  ) {
    throw new Error(
      "รองรับเฉพาะ YouTube URL"
    );
  }

  const info =
    await play.video_basic_info(
      url
    );

  const details =
    info.video_details;

  return {
    url,
    title:
      details.title ||
      "Unknown",
    duration:
      details.durationRaw ||
      "Unknown",
    thumbnail:
      details.thumbnails?.[0]
        ?.url ||
      null,
    requestedBy
  };
}

async function connectMusic(
  member
) {

  const voiceChannel =
    member.voice.channel;

  if (!voiceChannel) {
    throw new Error(
      "คุณต้องเข้า Voice Channel ก่อนครับ"
    );
  }

  const state =
    getMusicState(
      member.guild.id
    );

  state.voiceChannelId =
    voiceChannel.id;

  if (
    !state.connection ||
    state.connection.state.status ===
      VoiceConnectionStatus.Destroyed
  ) {

    state.connection =
      joinVoiceChannel({
        channelId:
          voiceChannel.id,
        guildId:
          member.guild.id,
        adapterCreator:
          member.guild
            .voiceAdapterCreator,
        selfDeaf: true
      });

    state.connection.subscribe(
      state.player
    );

    state.connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {

        console.log(
          "Music voice disconnected."
        );

        /*
          พยายาม reconnect
        */
        try {

          if (
            state.connection &&
            state.connection.state.status !==
              VoiceConnectionStatus.Destroyed
          ) {

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  3000
                )
            );

          }

        } catch {}
      }
    );
  }

  return state;
}

async function playNext(
  guildId
) {

  const state =
    musicQueues.get(
      guildId
    );

  if (!state) return;

  if (
    state.queue.length === 0
  ) {

    state.current =
      null;

    return;
  }

  const track =
    state.queue.shift();

  state.current =
    track;

  try {

    console.log(
      `Playing: ${track.title}`
    );

    const stream =
      await play.stream(
        track.url,
        {
          quality: 2,
          discordPlayerCompatibility:
            false
        }
      );

    /*
      play-dl สามารถคืน stream
      ที่เป็น Opus/WebM ได้
    */
    const resource =
      createAudioResource(
        stream.stream,
        {
          inputType:
            stream.type ===
            "opus"
              ? StreamType.Opus
              : StreamType.WebmOpus,
          inlineVolume: true,
          metadata: track
        }
      );

    if (
      resource.volume
    ) {
      resource.volume.setVolume(
        0.7
      );
    }

    state.player.play(
      resource
    );

  } catch (err) {

    console.error(
      "YouTube playback error:",
      err
    );

    state.current =
      null;

    /*
      ถ้าเพลงหนึ่งเล่นไม่ได้
      ข้ามไปเพลงถัดไป
    */
    await playNext(
      guildId
    );
  }
}

async function addToQueue(
  member,
  url
) {

  const state =
    await connectMusic(
      member
    );

  const track =
    await createYouTubeTrack(
      url,
      member.user
        .username
    );

  state.queue.push(
    track
  );

  /*
    ถ้าไม่มีเพลงกำลังเล่น
    ให้เริ่มทันที
  */
  if (
    !state.current &&
    state.player.state.status !==
      AudioPlayerStatus.Playing
  ) {

    await playNext(
      member.guild.id
    );

    return {
      track,
      started: true
    };
  }

  return {
    track,
    started: false
  };
}

/* =========================================================
   MENU
========================================================= */

function buildMenu() {

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🤖 Noah Menu"
      )
      .setDescription(
        [
          "**ระบบของ Noah**",
          "",
          "🧹 ล้างแคช",
          "ล้างความจำ AI ทั้งหมด",
          "",
          "📢 ประกาศ",
          "ส่งประกาศเป็น Embed",
          "",
          "⚙️ เพิ่ม/ลบ",
          "จัดการเกมและ Role"
        ].join("\n")
      );

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "clear_memory"
          )
          .setLabel(
            "ล้างแคช"
          )
          .setEmoji("🧹")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "announcement"
          )
          .setLabel(
            "ประกาศ"
          )
          .setEmoji("📢")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "manage_games"
          )
          .setLabel(
            "เพิ่ม/ลบ"
          )
          .setEmoji("⚙️")
          .setStyle(
            ButtonStyle.Secondary
          )
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
      .setDescription(
        "เปิดเมนู Noah"
      ),

    new SlashCommandBuilder()
      .setName("resetmemory")
      .setDescription(
        "ล้างความจำ AI ทั้งหมด"
      ),

    new SlashCommandBuilder()
      .setName("setupverify")
      .setDescription(
        "ตรวจสอบระบบยืนยันสมาชิก"
      ),

    new SlashCommandBuilder()
      .setName("play")
      .setDescription(
        "เปิดเพลงจาก YouTube"
      )
      .addStringOption(
        option =>
          option
            .setName("url")
            .setDescription(
              "YouTube URL"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("pause")
      .setDescription(
        "หยุดเพลงชั่วคราว"
      ),

    new SlashCommandBuilder()
      .setName("resume")
      .setDescription(
        "เล่นเพลงต่อ"
      ),

    new SlashCommandBuilder()
      .setName("skip")
      .setDescription(
        "ข้ามเพลง"
      ),

    new SlashCommandBuilder()
      .setName("stop")
      .setDescription(
        "หยุดเพลงและล้างคิว"
      ),

    new SlashCommandBuilder()
      .setName("queue")
      .setDescription(
        "ดูคิวเพลง"
      ),

    new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription(
        "ดูเพลงที่กำลังเล่น"
      )

  ].map(
    command =>
      command.toJSON()
  );

  try {

    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    await guild.commands.set(
      commands
    );

    console.log(
      "Slash commands registered."
    );

  } catch (err) {

    console.error(
      "Command registration error:",
      err
    );
  }
}

/* =========================================================
   MEMBER JOIN
========================================================= */

async function createVerifyTicket(
  member
) {

  if (
    !TICKET_CATEGORY_ID
  ) {
    return;
  }

  try {

    const channel =
      await member.guild.channels.create(
        {
          name:
            `verify-${member.user.username}`
              .slice(0, 100),

          type:
            ChannelType.GuildText,

          parent:
            TICKET_CATEGORY_ID,

          permissionOverwrites: [
            {
              id:
                member.guild.roles
                  .everyone.id,

              deny: [
                PermissionsBitField.Flags
                  .ViewChannel
              ]
            },

            {
              id:
                member.id,

              allow: [
                PermissionsBitField.Flags
                  .ViewChannel,

                PermissionsBitField.Flags
                  .SendMessages,

                PermissionsBitField.Flags
                  .ReadMessageHistory
              ]
            },

            {
              id:
                client.user.id,

              allow: [
                PermissionsBitField.Flags
                  .ViewChannel,

                PermissionsBitField.Flags
                  .SendMessages,

                PermissionsBitField.Flags
                  .ReadMessageHistory,

                PermissionsBitField.Flags
                  .ManageChannels
              ]
            }
          ]
        }
      );

    const embed =
      new EmbedBuilder()
        .setTitle(
          "👋 ยินดีต้อนรับค้าบบ"
        )
        .setDescription(
          [
            `สวัสดีครับ <@${member.id}>`,
            "",
            "รบกวนตอบคำถามเพื่อยืนยันชื่อและยศดิสหน่อย",
            "",
            "กดปุ่มด้านล่างเพื่อเริ่มครับ"
          ].join("\n")
        );

    const row =
      new ActionRowBuilder()
        .addComponents(

          new ButtonBuilder()
            .setCustomId(
              `verify_start_${member.id}`
            )
            .setLabel(
              "เริ่มยืนยันตัวตน"
            )
            .setEmoji("✅")
            .setStyle(
              ButtonStyle.Success
            )

        );

    await channel.send({
      content:
        `<@${member.id}>`,
      embeds: [embed],
      components: [row]
    });

  } catch (err) {

    console.error(
      "Ticket creation error:",
      err
    );
  }
}

client.on(
  "guildMemberAdd",
  async member => {
    await createVerifyTicket(
      member
    );
  }
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
  "interactionCreate",
  async interaction => {

    try {

      /* =====================================================
         SLASH COMMANDS
      ===================================================== */

      if (
        interaction.isChatInputCommand()
      ) {

        /* MENU */

        if (
          interaction.commandName ===
          "menu"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          return interaction.reply({
            ...buildMenu(),
            ephemeral: true
          });
        }

        /* RESET MEMORY */

        if (
          interaction.commandName ===
          "resetmemory"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          data.memories = {};

          saveData();

          return interaction.reply({
            content:
              "🧹 ล้างความจำ AI ทั้งหมดแล้วครับ",
            ephemeral: true
          });
        }

        /* SETUP */

        if (
          interaction.commandName ===
          "setupverify"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          return interaction.reply({
            content:
              "ระบบ Verify จะสร้าง Ticket เมื่อสมาชิกใหม่เข้าเซิร์ฟเวอร์ครับ",
            ephemeral: true
          });
        }

        /* ===================================================
           PLAY
        =================================================== */

        if (
          interaction.commandName ===
          "play"
        ) {

          const url =
            interaction.options
              .getString(
                "url"
              );

          if (
            !isYouTubeUrl(url)
          ) {

            return interaction.reply({
              content:
                "❌ ตอนนี้ `/play` รองรับเฉพาะลิงก์ YouTube ครับ",
              ephemeral: true
            });
          }

          if (
            !interaction.member.voice
              ?.channel
          ) {

            return interaction.reply({
              content:
                "❌ เข้า Voice Channel ก่อนครับ",
              ephemeral: true
            });
          }

          await interaction.deferReply();

          try {

            const result =
              await addToQueue(
                interaction.member,
                url
              );

            const embed =
              new EmbedBuilder()
                .setTitle(
                  result.started
                    ? "🎵 กำลังเปิดเพลง"
                    : "🎵 เพิ่มเข้าคิวแล้ว"
                )
                .setDescription(
                  `**${result.track.title}**`
                )
                .addFields(
                  {
                    name:
                      "ระยะเวลา",
                    value:
                      result.track.duration,
                    inline: true
                  },
                  {
                    name:
                      "ขอโดย",
                    value:
                      result.track.requestedBy,
                    inline: true
                  }
                );

            if (
              result.track.thumbnail
            ) {
              embed.setThumbnail(
                result.track.thumbnail
              );
            }

            return interaction.editReply({
              embeds: [embed]
            });

          } catch (err) {

            console.error(
              "Play command error:",
              err
            );

            return interaction.editReply({
              content:
                `❌ เปิดเพลงไม่ได้ครับ\n\`${err.message || "Unknown error"}\``
            });
          }
        }

        /* PAUSE */

        if (
          interaction.commandName ===
          "pause"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (!state) {
            return interaction.reply(
              "ไม่มีเพลงกำลังเล่นครับ"
            );
          }

          state.player.pause();

          return interaction.reply(
            "⏸️ หยุดเพลงชั่วคราวแล้วครับ"
          );
        }

        /* RESUME */

        if (
          interaction.commandName ===
          "resume"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (!state) {
            return interaction.reply(
              "ไม่มีเพลงครับ"
            );
          }

          state.player.unpause();

          return interaction.reply(
            "▶️ เล่นเพลงต่อแล้วครับ"
          );
        }

        /* SKIP */

        if (
          interaction.commandName ===
          "skip"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (!state) {
            return interaction.reply(
              "ไม่มีเพลงครับ"
            );
          }

          state.player.stop();

          return interaction.reply(
            "⏭️ ข้ามเพลงแล้วครับ"
          );
        }

        /* STOP */

        if (
          interaction.commandName ===
          "stop"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (!state) {
            return interaction.reply(
              "ไม่มีเพลงที่กำลังเล่นครับ"
            );
          }

          state.queue = [];

          state.current = null;

          state.player.stop();

          try {

            const connection =
              getVoiceConnection(
                interaction.guild.id
              );

            if (
              connection
            ) {
              connection.destroy();
            }

          } catch {}

          state.connection =
            null;

          return interaction.reply(
            "⏹️ หยุดเพลงและออกจากห้องแล้วครับ"
          );
        }

        /* QUEUE */

        if (
          interaction.commandName ===
          "queue"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (!state) {
            return interaction.reply(
              "คิวว่างครับ"
            );
          }

          const lines = [];

          if (
            state.current
          ) {
            lines.push(
              `🎵 **กำลังเล่น:** ${state.current.title}`
            );
          }

          if (
            state.queue.length
          ) {

            state.queue.forEach(
              (track, index) => {
                lines.push(
                  `${index + 1}. ${track.title}`
                );
              }
            );

          } else {

            lines.push(
              "คิวถัดไปว่างครับ"
            );
          }

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🎶 Music Queue"
                )
                .setDescription(
                  lines.join("\n")
                )
            ]
          });
        }

        /* NOW PLAYING */

        if (
          interaction.commandName ===
          "nowplaying"
        ) {

          const state =
            musicQueues.get(
              interaction.guild.id
            );

          if (
            !state?.current
          ) {
            return interaction.reply(
              "ตอนนี้ไม่มีเพลงครับ"
            );
          }

          const track =
            state.current;

          const embed =
            new EmbedBuilder()
              .setTitle(
                "🎵 Now Playing"
              )
              .setDescription(
                `**${track.title}**`
              )
              .addFields(
                {
                  name:
                    "ระยะเวลา",
                  value:
                    track.duration,
                  inline: true
                },
                {
                  name:
                    "ขอโดย",
                  value:
                    track.requestedBy,
                  inline: true
                }
              );

          if (
            track.thumbnail
          ) {
            embed.setThumbnail(
              track.thumbnail
            );
          }

          return interaction.reply({
            embeds: [embed]
          });
        }
      }

      /* =====================================================
         BUTTONS
      ===================================================== */

      if (
        interaction.isButton()
      ) {

        /* CLEAR MEMORY */

        if (
          interaction.customId ===
          "clear_memory"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          data.memories = {};

          saveData();

          return interaction.reply({
            content:
              "🧹 ล้างความจำทั้งหมดแล้วครับ",
            ephemeral: true
          });
        }

        /* ANNOUNCEMENT */

        if (
          interaction.customId ===
          "announcement"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                "announcement_modal"
              )
              .setTitle(
                "สร้างประกาศ"
              );

          const channelInput =
            new TextInputBuilder()
              .setCustomId(
                "channel_id"
              )
              .setLabel(
                "Channel ID"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          const messageInput =
            new TextInputBuilder()
              .setCustomId(
                "announcement_text"
              )
              .setLabel(
                "ข้อความ"
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMaxLength(4000);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(
                channelInput
              ),
            new ActionRowBuilder()
              .addComponents(
                messageInput
              )
          );

          return interaction.showModal(
            modal
          );
        }

        /* MANAGE GAMES */

        if (
          interaction.customId ===
          "manage_games"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          const embed =
            new EmbedBuilder()
              .setTitle(
                "⚙️ จัดการเกม"
              )
              .setDescription(
                Object.entries(
                  data.games
                )
                  .map(
                    ([game, role]) =>
                      `**${game}** → ${
                        role
                          ? `<@&${role}>`
                          : "ไม่มี Role"
                      }`
                  )
                  .join("\n")
              );

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setCustomId(
                    "add_game"
                  )
                  .setLabel(
                    "เพิ่มเกม"
                  )
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    "remove_game"
                  )
                  .setLabel(
                    "ลบเกม"
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  )

              );

          return interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
          });
        }

        /* ADD GAME */

        if (
          interaction.customId ===
          "add_game"
        ) {

          const modal =
            new ModalBuilder()
              .setCustomId(
                "add_game_modal"
              )
              .setTitle(
                "เพิ่มเกม"
              );

          const game =
            new TextInputBuilder()
              .setCustomId(
                "game_name"
              )
              .setLabel(
                "ชื่อเกม"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          const role =
            new TextInputBuilder()
              .setCustomId(
                "role_id"
              )
              .setLabel(
                "Role ID"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(
                game
              ),
            new ActionRowBuilder()
              .addComponents(
                role
              )
          );

          return interaction.showModal(
            modal
          );
        }

        /* REMOVE GAME */

        if (
          interaction.customId ===
          "remove_game"
        ) {

          const games =
            Object.keys(
              data.games
            );

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                "remove_game_select"
              )
              .setPlaceholder(
                "เลือกเกม"
              )
              .addOptions(
                games
                  .slice(0, 25)
                  .map(
                    game =>
                      new StringSelectMenuOptionBuilder()
                        .setLabel(
                          game
                        )
                        .setValue(
                          game
                        )
                  )
              );

          return interaction.reply({
            content:
              "เลือกเกมที่จะลบครับ",
            components: [
              new ActionRowBuilder()
                .addComponents(
                  menu
                )
            ],
            ephemeral: true
          });
        }

        /* VERIFY START */

        if (
          interaction.customId
            .startsWith(
              "verify_start_"
            )
        ) {

          const modal =
            new ModalBuilder()
              .setCustomId(
                `verify_name_${interaction.user.id}`
              )
              .setTitle(
                "ยืนยันชื่อ"
              );

          const english =
            new TextInputBuilder()
              .setCustomId(
                "english_name"
              )
              .setLabel(
                "ชื่อภาษาอังกฤษ"
              )
              .setPlaceholder(
                "เช่น Nazta"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          const display =
            new TextInputBuilder()
              .setCustomId(
                "display_name"
              )
              .setLabel(
                "ชื่อที่อยากให้แสดง"
              )
              .setPlaceholder(
                "เช่น เนสต้า"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(
                english
              ),
            new ActionRowBuilder()
              .addComponents(
                display
              )
          );

          return interaction.showModal(
            modal
          );
        }

        /* VERIFY REASON BUTTON */

        if (
          interaction.customId
            .startsWith(
              "verify_reason_button_"
            )
        ) {

          const modal =
            new ModalBuilder()
              .setCustomId(
                `verify_reason_${interaction.user.id}`
              )
              .setTitle(
                "เหตุผลที่เข้าดิส"
              );

          const reason =
            new TextInputBuilder()
              .setCustomId(
                "reason"
              )
              .setLabel(
                "คุณเข้าดิสมาทำไมเหรอครับ"
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(
                reason
              )
          );

          return interaction.showModal(
            modal
          );
        }
      }

      /* =====================================================
         MODALS
      ===================================================== */

      if (
        interaction.isModalSubmit()
      ) {

        /* VERIFY NAME */

        if (
          interaction.customId
            .startsWith(
              "verify_name_"
            )
        ) {

          const englishName =
            interaction.fields
              .getTextInputValue(
                "english_name"
              );

          const displayName =
            interaction.fields
              .getTextInputValue(
                "display_name"
              );

          interaction.channel.verifyData =
            {
              englishName,
              displayName
            };

          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  `สวัสดีค้าบคุณ ${displayName}`
                )
                .setDescription(
                  "คุณเข้าดิสมาทำไมเหรอครับ?"
                )
            ]
          });

          return interaction.followUp({
            content:
              "กดปุ่มเพื่อตอบคำถามค้าบ",
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `verify_reason_button_${interaction.user.id}`
                    )
                    .setLabel(
                      "ตอบคำถาม"
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                )
            ]
          });
        }

        /* VERIFY REASON */

        if (
          interaction.customId
            .startsWith(
              "verify_reason_"
            )
        ) {

          const reason =
            interaction.fields
              .getTextInputValue(
                "reason"
              );

          interaction.channel.verifyReason =
            reason;

          const options =
            Object.keys(
              data.games
            )
              .filter(
                game =>
                  data.games[game]
              )
              .slice(0, 25)
              .map(
                game =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(
                      game
                    )
                    .setValue(
                      game
                    )
              );

          if (!options.length) {
            return interaction.reply({
              content:
                "ยังไม่มีเกมที่ตั้งค่าไว้ครับ",
              ephemeral: true
            });
          }

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                "verify_game"
              )
              .setPlaceholder(
                "เลือกเกม"
              )
              .addOptions(
                options
              );

          return interaction.reply({
            content:
              "🎮 เลือกเกมที่คุณเล่นครับ",
            components: [
              new ActionRowBuilder()
                .addComponents(
                  menu
                )
            ]
          });
        }

        /* ANNOUNCEMENT */

        if (
          interaction.customId ===
          "announcement_modal"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          const channelId =
            interaction.fields
              .getTextInputValue(
                "channel_id"
              );

          const text =
            interaction.fields
              .getTextInputValue(
                "announcement_text"
              );

          const channel =
            interaction.guild.channels.cache.get(
              channelId
            );

          if (
            !channel ||
            !channel.isTextBased()
          ) {
            return interaction.reply({
              content:
                "หา Channel ไม่เจอครับ",
              ephemeral: true
            });
          }

          const embed =
            new EmbedBuilder()
              .setTitle(
                "📢 ประกาศ"
              )
              .setDescription(
                text
              )
              .setTimestamp();

          await channel.send({
            embeds: [embed]
          });

          return interaction.reply({
            content:
              "📢 ส่งประกาศแล้วครับ",
            ephemeral: true
          });
        }

        /* ADD GAME */

        if (
          interaction.customId ===
          "add_game_modal"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          const game =
            interaction.fields
              .getTextInputValue(
                "game_name"
              )
              .trim()
              .toUpperCase();

          const roleId =
            interaction.fields
              .getTextInputValue(
                "role_id"
              )
              .trim();

          const role =
            interaction.guild.roles.cache.get(
              roleId
            );

          if (!role) {
            return interaction.reply({
              content:
                "หา Role ไม่เจอครับ",
              ephemeral: true
            });
          }

          data.games[game] =
            roleId;

          saveData();

          return interaction.reply({
            content:
              `✅ เพิ่ม ${game} → <@&${roleId}> แล้วครับ`,
            ephemeral: true
          });
        }
      }

      /* =====================================================
         SELECT MENUS
      ===================================================== */

      if (
        interaction.isStringSelectMenu()
      ) {

        /* REMOVE GAME */

        if (
          interaction.customId ===
          "remove_game_select"
        ) {

          if (
            !isOwner(
              interaction.user.id
            )
          ) {
            return interaction.reply({
              content:
                "ไม่มีสิทธิ์ครับ",
              ephemeral: true
            });
          }

          const game =
            interaction.values[0];

          delete data.games[
            game
          ];

          saveData();

          return interaction.update({
            content:
              `🗑️ ลบ ${game} แล้วครับ`,
            components: []
          });
        }

        /* VERIFY GAME */

        if (
          interaction.customId ===
          "verify_game"
        ) {

          const game =
            interaction.values[0];

          const roleId =
            data.games[game];

          const member =
            interaction.member;

          try {

            if (
              VERIFIED_ROLE_ID
            ) {
              await member.roles.add(
                VERIFIED_ROLE_ID
              );
            }

            await member.roles.add(
              roleId
            );

            const ticketData =
              interaction.channel
                .verifyData ||
              {
                englishName:
                  member.user.username,
                displayName:
                  member.displayName
              };

            const reason =
              interaction.channel
                .verifyReason ||
              "ไม่ได้ระบุ";

            const verifiedChannel =
              interaction.guild.channels.cache.get(
                VERIFIED_CHANNEL_ID
              );

            if (
              verifiedChannel
            ) {

              const verifiedRole =
                VERIFIED_ROLE_ID
                  ? interaction.guild.roles.cache.get(
                      VERIFIED_ROLE_ID
                    )
                  : null;

              const gameRole =
                interaction.guild.roles.cache.get(
                  roleId
                );

              const embed =
                new EmbedBuilder()
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
                "✅ ยืนยันสำเร็จแล้วครับ",
              ephemeral: true
            });

            setTimeout(
              async () => {
                try {
                  await interaction.channel.delete();
                } catch {}
              },
              3000
            );

          } catch (err) {

            console.error(
              "Verify error:",
              err
            );

            if (
              !interaction.replied
            ) {
              await interaction.reply({
                content:
                  "แจกยศไม่สำเร็จครับ ตรวจสอบ Role ของ Noah",
                ephemeral: true
              });
            }
          }
        }
      }

    } catch (err) {

      console.error(
        "Interaction error:",
        err
      );

      try {

        if (
          !interaction.replied &&
          !interaction.deferred
        ) {

          await interaction.reply({
            content:
              "เกิดข้อผิดพลาดครับ ลองใหม่อีกครั้ง",
            ephemeral: true
          });

        }

      } catch {}
    }
  }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
  "messageCreate",
  async message => {

    try {

      if (
        !message.guild ||
        message.author.bot
      ) {
        return;
      }

      const content =
        message.content || "";

      /* PROFANITY */

      if (
        containsProfanity(
          content
        )
      ) {

        const member =
          message.member ||
          await message.guild.members
            .fetch(
              message.author.id
            )
            .catch(
              () => null
            );

        if (member) {

          const record =
            getProfanityRecord(
              member.id
            );

          if (
            record.count < 5
          ) {
            record.count++;
          }

          saveData();

          if (
            record.count >= 5
          ) {

            await message.reply({
              content:
                `⚠️ คำเตือนครั้งที่ 5/5\n${getRoast(5)}\n🔇 ครบ 5 ครั้งแล้ว — ห้ามแชต 1 ชั่วโมง และห้ามพูดในห้องเสียง 2 ชั่วโมง`,
              allowedMentions: {
                repliedUser: false
              }
            });

            await punishUser(
              member
            );

          } else {

            await message.reply({
              content:
                `${getRoast(record.count)}\n⚠️ คำเตือนครั้งที่ ${record.count}/5`,
              allowedMentions: {
                repliedUser: false
              }
            });
          }
        }
      }

      /* AI */

      const personality =
        getPersonality(
          message.channel.id
        );

      const mentioned =
        client.user &&
        message.mentions.users.has(
          client.user.id
        );

      if (
        !personality &&
        !mentioned
      ) {
        return;
      }

      let userText =
        content.trim();

      if (
        client.user
      ) {

        userText =
          userText.replace(
            new RegExp(
              `<@!?${escapeRegex(
                client.user.id
              )}>`,
              "g"
            ),
            ""
          ).trim();
      }

      const images = [];

      let hasVideo =
        false;

      for (
        const attachment
        of message.attachments.values()
      ) {

        const type =
          attachment.contentType ||
          "";

        if (
          type.startsWith(
            "image/"
          )
        ) {
          images.push(
            attachment.url
          );
        }

        if (
          type.startsWith(
            "video/"
          )
        ) {
          hasVideo = true;
        }
      }

      if (
        hasVideo &&
        !userText
      ) {

        return message.reply({
          content:
            "เห็นวิดีโอแล้วค้าบ แต่ตอนนี้ Noah ยังดูวิดีโอโดยตรงไม่ได้ 😭",
          allowedMentions: {
            repliedUser: false
          }
        });
      }

      if (
        !userText &&
        images.length
      ) {

        userText =
          "ผู้ใช้ส่งรูปมา ช่วยตอบเกี่ยวกับรูปนี้";
      }

      if (!userText) {
        return;
      }

      if (
        images.length
      ) {

        userText +=
          `\n[รูปที่แนบ: ${images.join(
            ", "
          )}]`;
      }

      if (
        userText.length > 6000
      ) {
        userText =
          userText.slice(
            0,
            6000
          );
      }

      await message.channel
        .sendTyping();

      const answer =
        await askGroq(
          message.author.id,
          message.channel.id,
          userText
        );

      if (!answer) {
        return;
      }

      if (
        answer.length <= 2000
      ) {

        await message.reply({
          content: answer,
          allowedMentions: {
            repliedUser: false
          }
        });

      } else {

        for (
          let i = 0;
          i < answer.length;
          i += 1900
        ) {

          await message.channel.send(
            answer.slice(
              i,
              i + 1900
            )
          );
        }
      }

    } catch (err) {

      console.error(
        "Message error:",
        err
      );

      /*
        สำคัญ:
        ไม่ให้ข้อความที่มีปัญหาทำให้ bot ตาย
      */
    }
  }
);

/* =========================================================
   VOICE STATE
========================================================= */

client.on(
  "voiceStateUpdate",
  async (
    oldState,
    newState
  ) => {

    try {

      const member =
        newState.member;

      if (
        !member ||
        member.user.bot
      ) {
        return;
      }

      const record =
        getProfanityRecord(
          member.id
        );

      if (
        record.voiceUntil &&
        Date.now() <
          record.voiceUntil &&
        newState.channel
      ) {

        try {

          await member.voice.setMute(
            true,
            "Noah voice restriction"
          );

        } catch (err) {

          console.error(
            "Voice mute error:",
            err
          );
        }
      }

    } catch (err) {

      console.error(
        "VoiceState error:",
        err
      );
    }
  }
);

/* =========================================================
   READY
========================================================= */

client.once(
  "ready",
  async () => {

    console.log(
      `🤖 Noah logged in as ${client.user.tag}`
    );

    console.log(
      `Groq keys: ${GROQ_KEYS.length}`
    );

    console.log(
      `Guilds: ${client.guilds.cache.size}`
    );

    await registerCommands();

    client.user.setPresence({
      activities: [
        {
          name:
            "ดูแลเซิร์ฟเวอร์ 👀",
          type: 3
        }
      ],
      status: "online"
    });
  }
);

/* =========================================================
   PROCESS ERROR PROTECTION
========================================================= */

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

if (!TOKEN) {

  console.error(
    "DISCORD_TOKEN is missing."
  );

  process.exit(1);
}

client.login(
  TOKEN
);
