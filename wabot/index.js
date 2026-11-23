const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { execFile, execSync } = require("child_process");
const pino = require("pino");
const QRCode = require("qrcode");
const sharp = require("sharp");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
} = require("@whiskeysockets/baileys");

const { MENU_TEXT, VALID_COMMANDS, AI_COMMAND_CATALOG, inferCommandIntent, handleBotCommand } = require("./commands");

const PORT = parseInt(process.env.WABOT_PORT || "8001", 10);
const AUTH_DIR = path.join(__dirname, "auth_info_baileys");
const DASHBOARD_STORE_FILE = path.join(__dirname, "dashboard_store.json");
const DASHBOARD_HTML_FILE = path.join(__dirname, "public", "index.html");
const AUDIO_MEDIA_DIR = path.join(__dirname, "public", "media", "audios");
try {
  fs.mkdirSync(AUDIO_MEDIA_DIR, { recursive: true });
} catch (e) {}

const ALLOWED_ADMIN_EMAIL = "support@auraflowtech.lat";
const ADMIN_SMTP_PASS = "YOUR_SMTP_PASSWORD";
let pendingOtp = { code: null, expiresAt: 0 };

const DEFAULT_AWAY_MESSAGE =
  "🤖 *Asistente de Santiago Delgado*\n\n" +
  "¡Hola! En este momento no me encuentro disponible, pero he recibido tu mensaje y *pronto serás atendido*.";

const PERSONALITY_PRESETS = {
  natural_cr: {
    label: "🇨🇷 Natural / Asistente Personal CR",
    prompt:
      "Eres el asistente personal de Santiago Delgado en WhatsApp. Tu personalidad es natural, cercana, amigable y conversacional (estilo costarricense natural, servicial y humano, sin sonar robótico ni repetir quién eres en cada mensaje). Contestas TODOS los mensajes de forma fluida, breve y útil, siguiendo el hilo de la conversación como en un chat real de WhatsApp. Si te consultan por servicios de AuraFlow Tech (Facturación Electrónica v4.4, bots, redes, desarrollo web) o asuntos de Santiago, ayudas con gusto.",
  },
  amigo_casual: {
    label: "😎 Amigo Casual / Relajado",
    prompt:
      "Hablas como un amigo cercano y buena nota por WhatsApp en Costa Rica. Tus respuestas son cortas, naturales, relajadas y al grano (puedes usar expresiones naturales como 'pura vida', 'claro', 'todo bien' sin exagerar). Cero discurso corporativo y cero listas largas a menos que te las pidan. Contestas todos los mensajes como una conversación normal de WhatsApp.",
  },
  ejecutivo_auraflow: {
    label: "💼 Ejecutivo AuraFlow Tech",
    prompt:
      "Eres el Asistente Ejecutivo de AuraFlow Tech Costa Rica y del Ing. Santiago Delgado Leiva (auraflowtech.lat). Tu tono es profesional, ejecutivo, claro y experto en soluciones tecnológicas, Facturación Electrónica Hacienda v4.4, automatización con IA, servidores y telecomunicaciones.",
  },
  vendedor_pro: {
    label: "🔥 Vendedor & Closer Comercial",
    prompt:
      "Eres un asesor comercial experto, carismático y persuasivo de AuraFlow Tech y de Santiago Delgado. Respondes con energía positiva a todos los mensajes, identificas qué necesita la persona, destacas beneficios claros y la guías amablemente a cotizar o agendar con Santiago.",
  },
  divertido: {
    label: "😏 Ingenioso / Divertido",
    prompt:
      "Tienes una personalidad carismática, ingeniosa y con buen sentido del humor. Respondes por WhatsApp con chispa y simpatía, haciendo la conversación entretenida pero siempre ayudando y respondiendo lo que te preguntan en mensajes cortos y dinámicos.",
  },
  custom: {
    label: "✍️ Personalizada",
    prompt: "",
  },
};

let sock = null;
let botState = {
  status: "starting", // starting | qr_ready | connected | reconnecting
  qrRaw: null,
  qrDataUrl: null,
  pairingCode: null,
  pairingPhone: "50689418680",
  connectedUser: null,
  commandsExecuted: 0,
  startedAt: new Date().toISOString(),
  logs: [],
};

// Track message IDs sent by the bot or assistant so we don't treat them as manual owner activity
const sentByBotIds = new Map(); // msgId -> "assistant" | "bot_command" | "dashboard"

function markSentByBot(msgId, kind = "bot_command") {
  if (!msgId) return;
  sentByBotIds.set(msgId, kind);
  if (sentByBotIds.size > 800) {
    const firstKey = sentByBotIds.keys().next().value;
    sentByBotIds.delete(firstKey);
  }
}

function loadDashboardStore() {
  try {
    if (fs.existsSync(DASHBOARD_STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DASHBOARD_STORE_FILE, "utf8"));
      let savedMsg = parsed.assistant?.awayMessage || DEFAULT_AWAY_MESSAGE;
      if (savedMsg.includes("-menu")) {
        savedMsg = DEFAULT_AWAY_MESSAGE;
      }
      const presetKey = PERSONALITY_PRESETS[parsed.assistant?.personalityPreset]
        ? parsed.assistant.personalityPreset
        : "natural_cr";
      const savedPrompt =
        (typeof parsed.assistant?.personalityPrompt === "string" && parsed.assistant.personalityPrompt.trim()) ||
        PERSONALITY_PRESETS[presetKey]?.prompt ||
        PERSONALITY_PRESETS.natural_cr.prompt;
      return {
        assistant: {
          mode: parsed.assistant?.mode || "always_away", // always_away | auto | commands_only
          replyAllMessages: parsed.assistant?.replyAllMessages !== undefined ? Boolean(parsed.assistant.replyAllMessages) : true,
          personalityPreset: presetKey,
          personalityPrompt: savedPrompt,
          awayMessage: savedMsg,
          inactivityMinutes: Number(parsed.assistant?.inactivityMinutes || 3),
          onlyPrivateChats: parsed.assistant?.onlyPrivateChats !== undefined ? Boolean(parsed.assistant.onlyPrivateChats) : true,
          dndEnabled: Boolean(parsed.assistant?.dndEnabled),
          dndStart: parsed.assistant?.dndStart || "22:00",
          dndEnd: parsed.assistant?.dndEnd || "07:00",
          dndMessage: parsed.assistant?.dndMessage || "🌙 En este momento estoy en horario de descanso (No Molestar). Te respondo a primera hora.",
          lastOwnerActivityAt: parsed.assistant?.lastOwnerActivityAt || 0,
        },
        stats: {
          totalMessagesSeen: Number(parsed.stats?.totalMessagesSeen || 0),
          autoRepliesSent: Number(parsed.stats?.autoRepliesSent || 0),
        },
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        blockedUsers: Array.isArray(parsed.blockedUsers) ? parsed.blockedUsers : [],
        chats: parsed.chats || {},
      };
    }
  } catch (e) {}

  return {
    assistant: {
      mode: "always_away", // Default active so it immediately answers all messages
      replyAllMessages: true,
      personalityPreset: "natural_cr",
      personalityPrompt: PERSONALITY_PRESETS.natural_cr.prompt,
      awayMessage: DEFAULT_AWAY_MESSAGE,
      inactivityMinutes: 3,
      onlyPrivateChats: true,
      dndEnabled: false,
      dndStart: "22:00",
      dndEnd: "07:00",
      dndMessage: "🌙 En este momento estoy en horario de descanso (No Molestar). Te respondo a primera hora.",
      lastOwnerActivityAt: 0,
    },
    stats: {
      totalMessagesSeen: 0,
      autoRepliesSent: 0,
    },
    sessions: [],
    blockedUsers: [],
    chats: {},
  };
}

function sendOtpEmailToAdmin(code6) {
  return new Promise((resolve) => {
    const pyScript = `
import smtplib, sys
from email.mime.text import MIMEText

code6 = sys.argv[1]
body = (
    f"AuraFlow Bot Dashboard (bot.auraflowtech.lat)\\n\\n"
    f"Hola Ing. Santiago Delgado Leiva,\\n"
    f"Tu codigo exclusivo de acceso de 6 digitos es: {code6}\\n\\n"
    f"Valido por 15 minutos."
)
msg = MIMEText(body, "plain", "utf-8")
msg["Subject"] = f"Código de Acceso {code6} — AuraFlow Bot Dashboard"
msg["From"] = "AuraFlow Bot <support@auraflowtech.lat>"
msg["To"] = "support@auraflowtech.lat"

try:
    with smtplib.SMTP_SSL("mail.spacemail.com", 465, timeout=10) as smtp:
        smtp.login("support@auraflowtech.lat", "YOUR_SMTP_PASSWORD")
        smtp.sendmail("support@auraflowtech.lat", ["support@auraflowtech.lat"], msg.as_string())
    print("OK")
except Exception as e:
    print(f"ERR:{e}")
`;
    execFile("python3", ["-c", pyScript, code6], (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.trim() === "OK");
    });
  });
}

function extractTokenFromReq(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers["cookie"] || "";
  const match = cookieHeader.match(/(?:^|;\s*)af_bot_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isAuthenticated(req) {
  const token = extractTokenFromReq(req);
  if (!token) return false;
  return Array.isArray(store.sessions) && store.sessions.includes(token);
}

let store = loadDashboardStore();
let saveTimer = null;

function normalizeBlockKey(jidOrPhone) {
  const raw = String(jidOrPhone || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@g.us") || raw.endsWith("@lid")) return raw;
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits || raw;
}

function isUserBlocked(remoteJid, senderJid = "", senderPhone = "") {
  if (remoteJid && store.chats[remoteJid]?.blocked) return true;
  if (senderJid && store.chats[senderJid]?.blocked) return true;
  const list = Array.isArray(store.blockedUsers) ? store.blockedUsers : [];
  if (list.length === 0) return false;
  const keys = new Set(
    [normalizeBlockKey(remoteJid), normalizeBlockKey(senderJid), normalizeBlockKey(senderPhone)].filter(Boolean)
  );
  return list.some((u) => keys.has(u.key) || (u.jid && (u.jid === remoteJid || u.jid === senderJid)));
}

function addBlockedUser({ jid = "", phone = "", name = "" }) {
  const key = normalizeBlockKey(jid || phone);
  if (!key) return null;
  if (!Array.isArray(store.blockedUsers)) store.blockedUsers = [];
  let entry = store.blockedUsers.find((u) => u.key === key || (jid && u.jid === jid));
  if (!entry) {
    entry = {
      key,
      jid: jid || "",
      phone: phone || (key.includes("@") ? "" : `+${key}`),
      name: name || phone || jid || key,
      blockedAt: Date.now(),
    };
    store.blockedUsers.push(entry);
  }
  for (const [cJid, chat] of Object.entries(store.chats)) {
    if (cJid === jid || normalizeBlockKey(cJid) === key) {
      chat.blocked = true;
    }
  }
  return entry;
}

function removeBlockedUser({ key = "", jid = "" }) {
  const targetKey = key || normalizeBlockKey(jid);
  if (!Array.isArray(store.blockedUsers)) store.blockedUsers = [];
  store.blockedUsers = store.blockedUsers.filter(
    (u) => u.key !== targetKey && (!jid || u.jid !== jid)
  );
  for (const [cJid, chat] of Object.entries(store.chats)) {
    if ((jid && cJid === jid) || (targetKey && normalizeBlockKey(cJid) === targetKey)) {
      chat.blocked = false;
    }
  }
}

function saveDashboardStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DASHBOARD_STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    } catch (e) {}
  }, 600);
}

function addLog(msg) {
  const ts = new Date().toLocaleTimeString("es-CR", { timeZone: "America/Costa_Rica", hour12: false });
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  botState.logs.unshift(entry);
  if (botState.logs.length > 60) botState.logs.pop();
}

function isOwnerCurrentlyAway(chatObj = null) {
  const a = store.assistant;
  if (a.mode === "commands_only") return false;
  if (a.mode === "always_away") {
    return true;
  }
  // mode === "auto"
  const thresholdMs = Math.max(1, Number(a.inactivityMinutes || 3)) * 60 * 1000;
  const ownerIdle = !a.lastOwnerActivityAt || Date.now() - a.lastOwnerActivityAt >= thresholdMs;
  if (!ownerIdle) return false;
  if (chatObj?.lastOwnerReplyAt && Date.now() - chatObj.lastOwnerReplyAt < thresholdMs) {
    return false;
  }
  return true;
}

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessage(message.documentWithCaptionMessage.message);
  return message;
}

function extractMessageText(msg) {
  const m = unwrapMessage(msg?.message);
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  ).trim();
}

function describeMessageForDashboard(msg) {
  const m = unwrapMessage(msg?.message);
  if (!m) return { mediaType: "otro", text: "" };

  const text = extractMessageText(msg);
  if (m.imageMessage) {
    return { mediaType: "📷 imagen", text: text || "📷 [Imagen]" };
  }
  if (m.stickerMessage) {
    return { mediaType: "✨ sticker", text: text || "✨ [Sticker]" };
  }
  if (m.audioMessage) {
    const secs = m.audioMessage.seconds ? ` (${m.audioMessage.seconds}s)` : "";
    return {
      mediaType: m.audioMessage.ptt ? "🎤 nota de voz" : "🎵 audio",
      text: `${m.audioMessage.ptt ? "🎤 [Nota de voz" : "🎵 [Audio"}${secs}]`,
    };
  }
  if (m.videoMessage) {
    return { mediaType: "🎥 video", text: text ? `🎥 ${text}` : "🎥 [Video]" };
  }
  if (m.documentMessage) {
    const fn = m.documentMessage.fileName || "archivo";
    return { mediaType: "📄 documento", text: `📄 [Documento: ${fn}] ${text}`.trim() };
  }
  if (m.locationMessage || m.liveLocationMessage) {
    return { mediaType: "📍 ubicación", text: "📍 [Ubicación compartida]" };
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return { mediaType: "👤 contacto", text: "👤 [Tarjeta de contacto]" };
  }
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const pollName = m.pollCreationMessage?.name || m.pollCreationMessageV3?.name || "Encuesta";
    return { mediaType: "📊 encuesta", text: `📊 [Encuesta: ${pollName}]` };
  }
  if (m.reactionMessage) {
    return { mediaType: "reacción", text: `Reaccionó con ${m.reactionMessage.text || "👍"}` };
  }
  return { mediaType: "texto", text: text || "[Mensaje]" };
}

async function createMediaThumbnail(msg, logger) {
  try {
    const m = unwrapMessage(msg?.message);
    if (!m || (!m.imageMessage && !m.stickerMessage)) return null;
    const buf = await downloadMediaMessage(
      { key: msg.key, message: m },
      "buffer",
      {},
      { logger, reuploadRequest: sock?.updateMediaMessage }
    );
    if (!buf) return null;
    const thumbBuf = await sharp(buf)
      .resize(200, 200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 62 })
      .toBuffer();
    return `data:image/webp;base64,${thumbBuf.toString("base64")}`;
  } catch (e) {
    return null;
  }
}

function pruneOldAudioFiles() {
  try {
    const files = fs.readdirSync(AUDIO_MEDIA_DIR)
      .map((name) => {
        const fullPath = path.join(AUDIO_MEDIA_DIR, name);
        try {
          return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (files.length > 600) {
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const oldFile of files.slice(600)) {
        try { fs.unlinkSync(oldFile.fullPath); } catch {}
      }
    }
  } catch {}
}

function saveAudioBufferForDashboard(audioBuf, msgId, extHint = "ogg") {
  if (!audioBuf || !audioBuf.length) return null;
  try {
    fs.mkdirSync(AUDIO_MEDIA_DIR, { recursive: true });
    const safeId = String(msgId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const outMp3Name = `${safeId}.mp3`;
    const outMp3Path = path.join(AUDIO_MEDIA_DIR, outMp3Name);
    if (fs.existsSync(outMp3Path) && fs.statSync(outMp3Path).size > 0) {
      return `/media/audios/${outMp3Name}`;
    }
    const tmpIn = path.join("/tmp", `wa_save_${safeId}_${Date.now()}.${extHint}`);
    fs.writeFileSync(tmpIn, audioBuf);
    try {
      execSync(
        `ffmpeg -y -i "${tmpIn}" -vn -ar 44100 -ac 1 -c:a libmp3lame -b:a 64k "${outMp3Path}" 2>/dev/null`,
        { timeout: 25000 }
      );
    } catch {
      // Fallback: write raw buffer if ffmpeg conversion fails
      fs.writeFileSync(outMp3Path, audioBuf);
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
    }
    pruneOldAudioFiles();
    if (fs.existsSync(outMp3Path) && fs.statSync(outMp3Path).size > 0) {
      return `/media/audios/${outMp3Name}`;
    }
  } catch (e) {
    addLog(`⚠️ Error guardando audio para dashboard: ${e.message}`);
  }
  return null;
}

async function extractAndSaveAudioFromMsg(msg, unwrapped, logger) {
  try {
    if (!unwrapped?.audioMessage) return { audioBuf: null, audioUrl: null };
    const audioBuf = await downloadMediaMessage(
      { key: msg.key, message: unwrapped },
      "buffer",
      {},
      { logger, reuploadRequest: sock?.updateMediaMessage }
    );
    if (!audioBuf || audioBuf.length === 0) return { audioBuf: null, audioUrl: null };
    const audioUrl = saveAudioBufferForDashboard(audioBuf, msg.key?.id || Date.now(), "ogg");
    return { audioBuf, audioUrl };
  } catch (err) {
    return { audioBuf: null, audioUrl: null };
  }
}

async function extractMediaBuffer(msg, logger) {
  try {
    const m = unwrapMessage(msg?.message);
    if (!m) return null;
    if (m.imageMessage || m.stickerMessage) {
      return await downloadMediaMessage(
        { key: msg.key, message: m },
        "buffer",
        {},
        { logger, reuploadRequest: sock.updateMediaMessage }
      );
    }
    const contextInfo =
      m.extendedTextMessage?.contextInfo ||
      m.imageMessage?.contextInfo ||
      m.stickerMessage?.contextInfo;
    const quoted = unwrapMessage(contextInfo?.quotedMessage);
    if (quoted && (quoted.imageMessage || quoted.stickerMessage)) {
      const fakeMsg = {
        key: {
          remoteJid: msg.key.remoteJid,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant,
        },
        message: quoted,
      };
      return await downloadMediaMessage(fakeMsg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    }
  } catch (e) {
    addLog(`⚠️ Error descargando media para sticker: ${e.message}`);
  }
  return null;
}

function formatForWhatsApp(text) {
  if (!text) return "";
  let res = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
  res = res.replace(/^###?\s+(.+)$/gm, "📌 *$1*");
  const lines = res.split("\n");
  const cleaned = [];
  let inTable = false;
  let headers = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cols = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (cols.every((c) => /^[-:]+$/.test(c))) {
        inTable = true;
        continue;
      }
      if (!inTable) {
        headers = cols;
        inTable = true;
      } else {
        const parts = cols.map((col, idx) => {
          const header = headers[idx] ? `*${headers[idx]}:* ` : "";
          return `${header}${col}`;
        });
        cleaned.push(`• ${parts.join(" — ")}`);
      }
      continue;
    } else {
      inTable = false;
      headers = [];
      cleaned.push(line);
    }
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function transcribeAudioFromMsg(msg, unwrapped, logger, preDownloadedBuf = null) {
  try {
    const audioBuf = preDownloadedBuf || await downloadMediaMessage(
      { key: msg.key, message: unwrapped },
      "buffer",
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );
    if (!audioBuf || audioBuf.length === 0) return "";
    const tmpPath = `/tmp/wa_audio_${Date.now()}_${Math.random().toString(36).substring(7)}.ogg`;
    fs.writeFileSync(tmpPath, audioBuf);
    let result = "";
    try {
      result = execSync(`/usr/local/bin/transcribe-audio.sh "${tmpPath}"`, { timeout: 25000 }).toString().trim();
    } catch (e) {}
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    return result;
  } catch (err) {
    return "";
  }
}

async function synthesizeVoiceNoteOgg(textToSpeak, lang = "es") {
  try {
    const cleanText = (textToSpeak || "")
      .replace(/[*_~`#]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
      .trim()
      .slice(0, 280);
    if (!cleanText) return null;

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${lang}&client=tw-ob`;
    const res = await fetch(ttsUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;

    const mp3Buf = Buffer.from(await res.arrayBuffer());
    const randId = Math.random().toString(36).substring(7);
    const tmpMp3 = `/tmp/tts_${Date.now()}_${randId}.mp3`;
    const tmpOgg = `/tmp/tts_${Date.now()}_${randId}.ogg`;

    fs.writeFileSync(tmpMp3, mp3Buf);
    execSync(`ffmpeg -y -i "${tmpMp3}" -c:a libopus -b:a 32k -vbr on -application voip "${tmpOgg}" 2>/dev/null`);

    if (fs.existsSync(tmpOgg)) {
      const oggBuf = fs.readFileSync(tmpOgg);
      try { fs.unlinkSync(tmpMp3); fs.unlinkSync(tmpOgg); } catch (e) {}
      return oggBuf;
    }
  } catch (err) {
    return null;
  }
  return null;
}

const groupNameCache = new Map();
const profilePicCache = new Map();

async function fetchProfilePicCached(jid) {
  if (!jid || !sock || botState.status !== "connected") return null;
  const cached = profilePicCache.get(jid);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return cached.url;
  }
  try {
    const url = await sock.profilePictureUrl(jid, "image");
    profilePicCache.set(jid, { url: url || null, ts: Date.now() });
    if (store.chats[jid] && url) {
      store.chats[jid].avatarUrl = url;
    }
    return url || null;
  } catch (e) {
    profilePicCache.set(jid, { url: null, ts: Date.now() });
    return null;
  }
}

async function ensureChatEntry(remoteJid, pushName = null, fromMe = false) {
  const isGroup = remoteJid.endsWith("@g.us");
  const cleanPhone = `+${remoteJid.split("@")[0].split(":")[0]}`;
  const myLidPrefix = (sock?.user?.lid || "").split(":")[0];
  const myIdPrefix = (sock?.user?.id || "").split(":")[0];
  const isSelf = Boolean(
    (myLidPrefix && remoteJid.includes(myLidPrefix)) ||
    (myIdPrefix && remoteJid.includes(myIdPrefix)) ||
    remoteJid.startsWith("50337704575165") ||
    remoteJid.startsWith("50689418680")
  );

  if (!store.chats[remoteJid]) {
    store.chats[remoteJid] = {
      jid: remoteJid,
      name: isSelf ? "💬 Mensajes Guardados (Pruebas IA)" : ((!fromMe && pushName) ? pushName : cleanPhone),
      phone: isGroup ? "Grupo de WhatsApp" : cleanPhone,
      isGroup,
      muteAssistant: false,
      blocked: false,
      lastMessageAt: Date.now(),
      lastMessagePreview: "",
      lastOwnerReplyAt: 0,
      lastAutoReplyAt: 0,
      messages: [],
    };
  }
  const chat = store.chats[remoteJid];
  if (isSelf) {
    chat.name = "💬 Mensajes Guardados (Pruebas IA)";
  } else if (!isGroup && !fromMe && pushName && (chat.name === chat.phone || chat.name.startsWith("+"))) {
    chat.name = pushName;
  }
  if (isGroup && sock && !groupNameCache.has(remoteJid)) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      if (meta?.subject) {
        groupNameCache.set(remoteJid, meta.subject);
        chat.name = meta.subject;
      }
    } catch (e) {}
  } else if (isGroup && groupNameCache.has(remoteJid)) {
    chat.name = groupNameCache.get(remoteJid);
  }
  if (!profilePicCache.has(remoteJid)) {
    fetchProfilePicCached(remoteJid).catch(() => {});
  }
  return chat;
}

function appendMessageToChat(chat, msgRecord) {
  // Avoid duplicate message IDs, but merge new media fields if present
  if (msgRecord.id) {
    const existing = chat.messages.find((m) => m.id === msgRecord.id);
    if (existing) {
      let updated = false;
      if (msgRecord.audioUrl && !existing.audioUrl) {
        existing.audioUrl = msgRecord.audioUrl;
        updated = true;
      }
      if (msgRecord.audioDuration && !existing.audioDuration) {
        existing.audioDuration = msgRecord.audioDuration;
        updated = true;
      }
      if (msgRecord.mediaThumb && !existing.mediaThumb) {
        existing.mediaThumb = msgRecord.mediaThumb;
        updated = true;
      }
      if (msgRecord.transcription && !existing.transcription) {
        existing.transcription = msgRecord.transcription;
        updated = true;
      }
      if (updated) saveDashboardStore();
      return;
    }
  }
  chat.messages.push(msgRecord);
  if (chat.messages.length > 120) {
    chat.messages = chat.messages.slice(-120);
  }
  chat.lastMessageAt = msgRecord.timestamp || Date.now();
  chat.lastMessagePreview = (msgRecord.text || "").slice(0, 90);
  store.stats.totalMessagesSeen = (store.stats.totalMessagesSeen || 0) + 1;

  // Keep max 80 chats sorted by recency
  const jids = Object.keys(store.chats);
  if (jids.length > 85) {
    const sorted = jids.sort((a, b) => (store.chats[b].lastMessageAt || 0) - (store.chats[a].lastMessageAt || 0));
    for (const oldJid of sorted.slice(80)) {
      delete store.chats[oldJid];
    }
  }
  saveDashboardStore();
}

async function handleAssistantWhatsAppCommand(cmd, arg) {
  const sub = (arg || "").trim().toLowerCase();

  if (["personalidad", "personality", "tono"].includes(cmd) || sub.startsWith("personalidad")) {
    const cleanArg = ["personalidad", "personality", "tono"].includes(cmd)
      ? (arg || "").trim()
      : (arg || "").trim().replace(/^personalidad\s*/i, "").trim();
    const lowArg = cleanArg.toLowerCase();

    const aliasMap = {
      natural: "natural_cr",
      natural_cr: "natural_cr",
      cr: "natural_cr",
      asistente: "natural_cr",
      casual: "amigo_casual",
      amigo: "amigo_casual",
      amigo_casual: "amigo_casual",
      compa: "amigo_casual",
      ejecutivo: "ejecutivo_auraflow",
      ejecutivo_auraflow: "ejecutivo_auraflow",
      corporativo: "ejecutivo_auraflow",
      vendedor: "vendedor_pro",
      vendedor_pro: "vendedor_pro",
      ventas: "vendedor_pro",
      divertido: "divertido",
      humor: "divertido",
      sarcastico: "divertido",
    };

    if (cleanArg) {
      if (aliasMap[lowArg]) {
        const key = aliasMap[lowArg];
        store.assistant.personalityPreset = key;
        store.assistant.personalityPrompt = PERSONALITY_PRESETS[key].prompt;
        store.assistant.mode = "always_away";
        store.assistant.replyAllMessages = true;
        saveDashboardStore();
        addLog(`🧠 Personalidad IA cambiada a: ${PERSONALITY_PRESETS[key].label}`);
        return {
          reply:
            `🧠 *Personalidad del Bot Actualizada*\n\n` +
            `• *Estilo:* ${PERSONALITY_PRESETS[key].label}\n` +
            `• *Modo:* Respondiendo TODOS los mensajes\n` +
            `• *Instrucciones:* _${store.assistant.personalityPrompt}_\n\n` +
            `🌐 Edítala también en vivo en: https://bot.auraflowtech.lat`,
          node_badge: "PERSONALIDAD • IA",
        };
      } else {
        store.assistant.personalityPreset = "custom";
        store.assistant.personalityPrompt = cleanArg;
        store.assistant.mode = "always_away";
        store.assistant.replyAllMessages = true;
        saveDashboardStore();
        addLog(`🧠 Personalidad IA personalizada actualizada (${cleanArg.slice(0, 45)}...)`);
        return {
          reply:
            `✍️ *Personalidad Personalizada Activada*\n\n` +
            `• *Modo:* Respondiendo TODOS los mensajes\n` +
            `• *Instrucciones activas:*\n_${cleanArg}_\n\n` +
            `🌐 Panel web: https://bot.auraflowtech.lat`,
          node_badge: "PERSONALIDAD • CUSTOM",
        };
      }
    }

    const currentPreset = PERSONALITY_PRESETS[store.assistant.personalityPreset]?.label || "✍️ Personalizada";
    return {
      reply:
        `🧠 *Personalidad Actual de AuraFlow Bot*\n\n` +
        `• *Perfil activo:* ${currentPreset}\n` +
        `• *Contestar todos los mensajes:* ${store.assistant.replyAllMessages !== false ? "✅ Sí (Conversación continua)" : "1️⃣ Solo 1 vez por contacto"}\n` +
        `• *Prompt activo:*\n_${store.assistant.personalityPrompt || PERSONALITY_PRESETS.natural_cr.prompt}_\n\n` +
        `📌 *Cambiar personalidad rápido:*\n` +
        `• \`-personalidad natural\` — 🇨🇷 Asistente Natural CR\n` +
        `• \`-personalidad casual\` — 😎 Amigo Casual / Relajado\n` +
        `• \`-personalidad ejecutivo\` — 💼 Ejecutivo AuraFlow Tech\n` +
        `• \`-personalidad vendedor\` — 🔥 Vendedor & Closer\n` +
        `• \`-personalidad divertido\` — 😏 Ingenioso / Divertido\n` +
        `• \`-personalidad <tus instrucciones>\` — ✍️ Definir personalidad a tu gusto\n\n` +
        `🌐 *Editor en el Panel Web:* https://bot.auraflowtech.lat`,
      node_badge: "PERSONALIDAD • IA",
    };
  }

  if (cmd === "ausente" || cmd === "away" || sub === "on" || sub === "ausente" || sub === "todo") {
    store.assistant.mode = "always_away";
    store.assistant.replyAllMessages = true;
    for (const c of Object.values(store.chats)) {
      c.awayNotified = false;
    }
    saveDashboardStore();
    addLog("🤖 Modo Asistente cambiado a: IA ACTIVA (Contesta TODOS los mensajes)");
    return {
      reply:
        "🤖 *Modo Asistente: IA ACTIVA (Contesta Todo)*\n\n" +
        `A partir de ahora contestaré **todos los mensajes** con la personalidad activa (*${PERSONALITY_PRESETS[store.assistant.personalityPreset]?.label || "Personalizada"}*).\n\n` +
        "• Usa `-personalidad` para cambiar mi tono o instrucciones.\n" +
        "• Usa `-online` cuando quieras pausar las respuestas automáticas.\n" +
        "• Ver y editar en vivo: https://bot.auraflowtech.lat",
      node_badge: "ASISTENTE • IA ACTIVA",
    };
  }

  if (cmd === "online" || cmd === "conectado" || cmd === "disponible" || sub === "off") {
    store.assistant.mode = "commands_only";
    store.assistant.lastOwnerActivityAt = Date.now();
    for (const c of Object.values(store.chats)) {
      c.awayNotified = false;
    }
    saveDashboardStore();
    addLog("🟢 Modo Asistente cambiado a: DISPONIBLE (Solo comandos -)");
    return {
      reply:
        "🟢 *Modo Asistente: DISPONIBLE (Pausado)*\n\n" +
        "He pausado los avisos automáticos de ausencia. Solo responderé a comandos con `-`.\n\n" +
        "• Usa `-ausente` cuando quieras que avise por ti.\n" +
        "• Panel en vivo: https://bot.auraflowtech.lat",
      node_badge: "ASISTENTE • PAUSADO",
    };
  }

  if (sub === "auto") {
    store.assistant.mode = "auto";
    saveDashboardStore();
    addLog(`🤖 Modo Asistente cambiado a: AUTOMÁTICO (${store.assistant.inactivityMinutes} min inactividad)`);
    return {
      reply:
        `🤖 *Modo Asistente: AUTOMÁTICO*\n\n` +
        `Si no envías mensajes durante *${store.assistant.inactivityMinutes} minutos*, avisaré **una sola vez** a quien te escriba que no estás disponible.\n\n` +
        `• Panel en vivo: https://bot.auraflowtech.lat`,
      node_badge: "ASISTENTE • AUTO",
    };
  }

  if (sub.startsWith("msg ") && arg.trim().length > 4) {
    const customMsg = arg.trim().slice(4).trim();
    store.assistant.awayMessage = customMsg;
    saveDashboardStore();
    return {
      reply:
        `✅ *Mensaje del Asistente Actualizado:*\n\n${customMsg}`,
      node_badge: "ASISTENTE • MENSAJE",
    };
  }

  const modeNames = {
    always_away: "🌙 No Disponible (Avisando 1 vez por contacto)",
    auto: `🤖 Automático (${store.assistant.inactivityMinutes} min de inactividad, 1 vez por contacto)`,
    commands_only: "🟢 Disponible (Solo comandos -)",
  };
  return {
    reply:
      `🤖 *Estado de tu Asistente Personal*\n\n` +
      `• *Modo actual:* ${modeNames[store.assistant.mode] || store.assistant.mode}\n` +
      `• *Modo de envío:* 1 sola vez por contacto (sin menú)\n` +
      `• *Avisos enviados:* ${store.stats.autoRepliesSent || 0}\n\n` +
      `📌 *Comandos rápidos:*\n` +
      `• \`-ausente\` — Activar aviso de "No disponible"\n` +
      `• \`-online\` — Pausar asistente (cuando estás disponible)\n` +
      `• \`-asistente auto\` — Activar por inactividad\n` +
      `• \`-asistente msg <texto>\` — Cambiar el mensaje\n\n` +
      `🖥️ *Dashboard Privado (support@auraflowtech.lat):*\nhttps://bot.auraflowtech.lat`,
    node_badge: "ASISTENTE PERSONAL",
  };
}

async function startWhatsAppBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest?.version) version = latest.version;
    } catch (e) {}

    const logger = pino({ level: "silent" });
    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        botState.qrRaw = qr;
        botState.status = "qr_ready";
        botState.qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
        addLog("📱 Código QR generado. Listo para escanear en bot.auraflowtech.lat o vincular con código.");
      }

      if (connection === "open") {
        botState.status = "connected";
        botState.qrRaw = null;
        botState.qrDataUrl = null;
        botState.pairingCode = null;
        const userJid = sock.user?.id || "";
        const cleanNum = userJid.split(":")[0].split("@")[0];
        botState.connectedUser = {
          phone: `+${cleanNum}`,
          name: sock.user?.name || "AuraFlow Bot",
          jid: userJid,
        };
        addLog(`✅ AuraFlow Bot CONECTADO en WhatsApp: +${cleanNum} (${botState.connectedUser.name})`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        addLog(`⚠️ Conexión cerrada (código ${statusCode || "desconocido"}). Reconectar: ${shouldReconnect}`);

        if (!shouldReconnect) {
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) {}
        }
        botState.status = "reconnecting";
        botState.connectedUser = null;
        setTimeout(() => startWhatsAppBot(), 2500);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          const unwrapped = unwrapMessage(msg.message);
          if (!unwrapped || unwrapped.protocolMessage || unwrapped.senderKeyDistributionMessage) continue;

          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter")) continue;

          const msgId = msg.key?.id;
          const botKind = msgId ? sentByBotIds.get(msgId) : null;
          const fromMe = Boolean(msg.key?.fromMe);

          const myLidPrefix = (sock?.user?.lid || "").split(":")[0];
          const myIdPrefix = (sock?.user?.id || "").split(":")[0];
          const isSelfChat = Boolean(
            (myLidPrefix && remoteJid.includes(myLidPrefix)) ||
            (myIdPrefix && remoteJid.includes(myIdPrefix)) ||
            remoteJid.startsWith("50337704575165") ||
            remoteJid.startsWith("50689418680")
          );

          const senderJid = msg.key.participant || remoteJid;
          const senderPhone = `+${senderJid.split("@")[0].split(":")[0]}`;
          const pushName = msg.pushName || (fromMe ? "Santiago Delgado" : senderPhone);

          const desc = describeMessageForDashboard(msg);
          const text = extractMessageText(msg);

          // Ensure chat exists in dashboard store
          const chat = await ensureChatEntry(remoteJid, pushName, fromMe);

          // Generate lightweight thumbnail if incoming/outgoing image or sticker
          let mediaThumb = null;
          if (unwrapped.imageMessage || unwrapped.stickerMessage) {
            mediaThumb = await createMediaThumbnail(msg, logger);
          }

          // Download and save playable MP3 if incoming/outgoing audio or voice note
          let audioMedia = { audioBuf: null, audioUrl: null };
          if (unwrapped.audioMessage) {
            audioMedia = await extractAndSaveAudioFromMsg(msg, unwrapped, logger);
          }

          // If this message was sent manually by the owner to an external contact:
          if (fromMe && !botKind && !isSelfChat) {
            store.assistant.lastOwnerActivityAt = Date.now();
            chat.lastOwnerReplyAt = Date.now();
            chat.awayNotified = false;
          }

          const msgTimestamp = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * (Number(msg.messageTimestamp) < 1e12 ? 1000 : 1)
            : Date.now();

          const effectiveMsgId = msgId || `${Date.now()}_${Math.random()}`;
          appendMessageToChat(chat, {
            id: effectiveMsgId,
            timestamp: msgTimestamp,
            fromMe,
            kind: botKind || (fromMe ? "owner" : "incoming"),
            senderName: pushName,
            senderPhone,
            mediaType: desc.mediaType,
            text: desc.text,
            mediaThumb,
            audioUrl: audioMedia.audioUrl || null,
            audioDuration: unwrapped.audioMessage?.seconds || null,
            isPtt: Boolean(unwrapped.audioMessage?.ptt),
          });

          // If this message was generated by the bot itself, don't process it again
          if (botKind) continue;

          // Log what the bot sees in live feed
          if (!fromMe || isSelfChat) {
            addLog(`👁️ [${chat.isGroup ? `Grupo: ${chat.name}` : chat.name}] (${desc.mediaType}): ${(desc.text || "").slice(0, 65)}`);
          } else {
            addLog(`📤 [Tú ➔ ${chat.name}]: ${(desc.text || "").slice(0, 65)}`);
          }

          // Only trigger commands or auto-replies on real-time "notify" events
          if (type !== "notify") continue;

          const userBlocked = !fromMe && isUserBlocked(remoteJid, senderJid, senderPhone);
          if (userBlocked) {
            if (!unwrapped.reactionMessage) {
              addLog(`🚫 Mensaje ignorado (usuario bloqueado): ${pushName} (${senderPhone})`);
            }
            continue;
          }

          // 1. Check if it's a valid '-' or '/' command
          const isExplicitCommand = Boolean(text && /^[-/][a-zA-ZáéíóúñÁÉÍÓÚÑ_]+/.test(text));
          const cmdWord = isExplicitCommand ? text.slice(1).trim().split(/\s+/)[0].toLowerCase() : "";

          if (isExplicitCommand && (VALID_COMMANDS.has(cmdWord) || fromMe || isSelfChat)) {
            if (VALID_COMMANDS.has(cmdWord)) {
              addLog(`⚡ Comando ejecutado por ${pushName} (${senderPhone}): ${text.slice(0, 60)}`);
              sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});
            }

            let mediaBuffer = null;
            if (["sticker", "s", "steal", "stealn"].includes(cmdWord)) {
              mediaBuffer = await extractMediaBuffer(msg, logger);
            }

            let groupParticipants = [];
            if (remoteJid.endsWith("@g.us")) {
              try {
                const meta = await sock.groupMetadata(remoteJid);
                groupParticipants = (meta.participants || []).map((p) => p.id);
              } catch (e) {}
            }

            const result = await handleBotCommand(text, {
              senderId: senderJid,
              senderPhone,
              pushName,
              isOwner: fromMe || isSelfChat,
              mediaBuffer,
              groupParticipants,
              onAssistantCommand: handleAssistantWhatsAppCommand,
            });

            if (!result) {
              sock.sendPresenceUpdate("paused", remoteJid).catch(() => {});
              continue;
            }
            botState.commandsExecuted += 1;
            sock.sendPresenceUpdate("paused", remoteJid).catch(() => {});

            if (result.deleteTarget) {
              const quotedInfo = unwrapped?.extendedTextMessage?.contextInfo;
              if (quotedInfo?.stanzaId) {
                const targetKey = {
                  remoteJid,
                  fromMe: true,
                  id: quotedInfo.stanzaId,
                  participant: quotedInfo.participant,
                };
                await sock.sendMessage(remoteJid, { delete: targetKey });
                addLog(`🗑️ Mensaje eliminado por comando -delete en ${chat.name}`);
              } else {
                const sent = await sock.sendMessage(
                  remoteJid,
                  { text: "⚠️ Responde a un mensaje enviado por el bot con `-delete` para borrarlo." },
                  { quoted: msg }
                );
                if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              }
              continue;
            }

            if (result.mediaType === "video" && result.buffer) {
              const sent = await sock.sendMessage(
                remoteJid,
                { video: result.buffer, caption: result.reply, mimetype: result.mimetype || "video/mp4" },
                { quoted: msg }
              );
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              continue;
            }

            if (result.mediaType === "audio" && result.buffer) {
              const sent = await sock.sendMessage(
                remoteJid,
                { audio: result.buffer, mimetype: result.mimetype || "audio/mp4", fileName: result.fileName || "musica.mp3" },
                { quoted: msg }
              );
              if (result.reply) {
                await sock.sendMessage(remoteJid, { text: result.reply }, { quoted: msg });
              }
              const sentId = sent?.key?.id || `cmd_aud_${Date.now()}`;
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              const savedUrl = saveAudioBufferForDashboard(result.buffer, sentId, "mp3");
              appendMessageToChat(chat, {
                id: sentId,
                timestamp: Date.now(),
                fromMe: true,
                kind: "bot_command",
                senderName: "AuraFlow Bot",
                senderPhone: botState.connectedUser?.phone || "+50689418680",
                mediaType: "🎵 audio",
                text: `🎵 [${result.fileName || "Audio"}]`,
                audioUrl: savedUrl,
              });
              continue;
            }

            if (result.mediaType === "image" && result.buffer) {
              let imgBuf = result.buffer;
              if (result.mimetype?.includes("svg") || imgBuf.toString("utf8", 0, 50).includes("<svg")) {
                try {
                  const sharp = require("sharp");
                  imgBuf = await sharp(imgBuf).png().toBuffer();
                } catch (e) {}
              }
              const sent = await sock.sendMessage(
                remoteJid,
                { image: imgBuf, caption: result.reply, mimetype: "image/png" },
                { quoted: msg }
              );
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              continue;
            }

            if (result.stickerBuffer) {
              const sent = await sock.sendMessage(remoteJid, { sticker: result.stickerBuffer }, { quoted: msg });
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              continue;
            }

            if (result.qrDataUrl) {
              const base64Data = result.qrDataUrl.replace(/^data:image\/png;base64,/, "");
              const imgBuffer = Buffer.from(base64Data, "base64");
              const sent = await sock.sendMessage(
                remoteJid,
                { image: imgBuffer, caption: result.reply },
                { quoted: msg }
              );
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              continue;
            }

            if (result.poll) {
              const sent = await sock.sendMessage(
                remoteJid,
                {
                  poll: {
                    name: result.poll.name,
                    values: result.poll.values,
                    selectableCount: 1,
                  },
                },
                { quoted: msg }
              );
              if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
              continue;
            }

            if (result.audioUrl) {
              try {
                const audioRes = await fetch(result.audioUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
                const arrayBuf = await audioRes.arrayBuffer();
                const audioBuffer = Buffer.from(arrayBuf);
                const sent = await sock.sendMessage(
                  remoteJid,
                  { audio: audioBuffer, mimetype: "audio/mp4", ptt: true },
                  { quoted: msg }
                );
                const sentId = sent?.key?.id || `tts_cmd_${Date.now()}`;
                if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
                const savedUrl = saveAudioBufferForDashboard(audioBuffer, sentId, "mp3");
                appendMessageToChat(chat, {
                  id: sentId,
                  timestamp: Date.now(),
                  fromMe: true,
                  kind: "bot_command",
                  senderName: "AuraFlow Bot",
                  senderPhone: botState.connectedUser?.phone || "+50689418680",
                  mediaType: "🎤 nota de voz",
                  text: "🎤 [Nota de voz TTS]",
                  audioUrl: savedUrl,
                  isPtt: true,
                });
                continue;
              } catch (e) {}
            }

            if (result.reminder) {
              setTimeout(async () => {
                try {
                  const remSent = await sock.sendMessage(remoteJid, {
                    text: `⏰ *RECORDATORIO AURAFLOW BOT*\n\n📌 ${result.reminder.text}`,
                  });
                  if (remSent?.key?.id) markSentByBot(remSent.key.id, "bot_command");
                } catch (e) {}
              }, result.reminder.delayMs);
            }

            const sent = await sock.sendMessage(
              remoteJid,
              {
                text: result.reply,
                mentions: result.mentions || undefined,
              },
              { quoted: msg }
            );
            if (sent?.key?.id) markSentByBot(sent.key.id, "bot_command");
            continue;
          }

          // 2. Not a command: Conversational AI & Audio Assistant
          const replyAll = store.assistant.replyAllMessages !== false;
          const shouldHandleAi = isSelfChat
            ? !botKind && !unwrapped.reactionMessage
            : (
                !fromMe &&
                !unwrapped.reactionMessage &&
                (!store.assistant.onlyPrivateChats || !chat.isGroup) &&
                !chat.muteAssistant &&
                (replyAll || !chat.awayNotified) &&
                (store.assistant.mode === "always_away" || (store.assistant.mode === "auto" && isOwnerCurrentlyAway(chat)))
              );

          if (shouldHandleAi) {
            // Check if incoming message is an audio / voice note
            const isAudioMsg = Boolean(unwrapped.audioMessage);
            let transcribedSpeech = "";

            if (isAudioMsg) {
              try {
                await sock.sendPresenceUpdate("recording", remoteJid);
              } catch (e) {}
              addLog(`🎙️ Descargando y transcribiendo nota de voz de ${pushName}...`);
              transcribedSpeech = await transcribeAudioFromMsg(msg, unwrapped, logger, audioMedia.audioBuf);
              if (transcribedSpeech) {
                addLog(`📝 Transcripción de ${pushName}: "${transcribedSpeech}"`);
                appendMessageToChat(chat, {
                  id: effectiveMsgId,
                  transcription: transcribedSpeech,
                });
              } else {
                addLog(`⚠️ Nota de voz de ${pushName} vacía o no transcribible`);
              }
            } else {
              try {
                await sock.sendPresenceUpdate("composing", remoteJid);
              } catch (e) {}
            }

            let incomingText = (transcribedSpeech || text || "").trim();
            if (!incomingText) {
              if (isAudioMsg) incomingText = "[El usuario envió una nota de voz, pregúntale amablemente en qué le puedes ayudar o si te lo puede escribir]";
              else if (unwrapped.stickerMessage) incomingText = "[El usuario envió un sticker de WhatsApp]";
              else if (unwrapped.imageMessage) incomingText = "[El usuario envió una imagen/foto sin texto]";
              else if (unwrapped.videoMessage) incomingText = "[El usuario envió un video]";
              else if (unwrapped.documentMessage) incomingText = `[El usuario envió un documento: ${unwrapped.documentMessage.fileName || "archivo"}]`;
              else if (unwrapped.locationMessage || unwrapped.liveLocationMessage) incomingText = "[El usuario compartió su ubicación GPS]";
              else if (unwrapped.contactMessage || unwrapped.contactsArrayMessage) incomingText = "[El usuario compartió una tarjeta de contacto]";
            }

            // Detección automática y descarga de enlaces multimedia (TikTok, IG, FB, YouTube, fotos, música)
            const urlMatch = incomingText.match(/https?:\/\/[^\s]+/i);
            const isMediaLink = urlMatch && (
              /\b(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|youtube\.com|youtu\.be|soundcloud\.com|pinterest\.com)\b/i.test(urlMatch[0]) ||
              /\.(mp4|mov|mp3|wav|m4a|jpe?g|png|webp|gif)($|\?)/i.test(urlMatch[0])
            );
            const isDownloadIntent = isMediaLink && (
              /\b(descarg|baja|pasa|manda|guarda|video|musica|música|cancion|canción|audio|foto|imagen|mp3|mp4)\b/i.test(incomingText) ||
              incomingText.trim() === urlMatch[0]
            );

            if (isDownloadIntent) {
              try {
                await sock.sendPresenceUpdate("recording", remoteJid);
                const { downloadMedia } = require("./downloader");
                let dlMode = "auto";
                if (/\b(musica|música|cancion|canción|audio|mp3)\b/i.test(incomingText)) dlMode = "audio";
                else if (/\b(foto|imagen|img)\b/i.test(incomingText)) dlMode = "foto";
                else if (/\b(video|mp4)\b/i.test(incomingText)) dlMode = "video";

                addLog(`⬇️ Descargando enlace detectado para ${pushName}: ${urlMatch[0]} (${dlMode})`);
                const media = await downloadMedia(urlMatch[0], dlMode);
                const mb = (media.sizeBytes / (1024 * 1024)).toFixed(1);
                const captionText = `${media.title}\n\n💾 *Tamaño:* ${mb} MB\n🔗 *CDN:* ${media.cdnUrl}\n\n⚡ _AuraFlow Tech Media_`;

                if (media.type === "video" && media.buffer) {
                  const sent = await sock.sendMessage(remoteJid, { video: media.buffer, caption: captionText, mimetype: media.mimetype || "video/mp4" }, { quoted: msg });
                  if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                } else if (media.type === "audio" && media.buffer) {
                  const sent = await sock.sendMessage(remoteJid, { audio: media.buffer, mimetype: media.mimetype || "audio/mp4", fileName: media.fileName }, { quoted: msg });
                  await sock.sendMessage(remoteJid, { text: captionText }, { quoted: msg });
                  if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                } else if (media.type === "image" && media.buffer) {
                  let imgBuf = media.buffer;
                  if (media.mimetype?.includes("svg") || imgBuf.toString("utf8", 0, 50).includes("<svg")) {
                    try {
                      const sharp = require("sharp");
                      imgBuf = await sharp(imgBuf).png().toBuffer();
                    } catch (e) {}
                  }
                  const sent = await sock.sendMessage(remoteJid, { image: imgBuf, caption: captionText, mimetype: "image/png" }, { quoted: msg });
                  if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                } else {
                  const sent = await sock.sendMessage(remoteJid, { text: `🎬 *${media.title}*\n\n💾 *Tamaño:* ${mb} MB (Excede el límite de WhatsApp)\n\n⬇️ *Descárgalo directo en tu navegador/iPhone:*\n${media.cdnUrl}` }, { quoted: msg });
                  if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                }

                chat.awayNotified = true;
                chat.lastAutoReplyAt = Date.now();
                saveDashboardStore();
                continue;
              } catch (dlErr) {
                addLog(`⚠️ Fallo en descarga automática: ${dlErr.message}`);
              }
            }

            // Check Modo No Molestar (DND) por horario en Costa Rica
            if (incomingText && !fromMe && !isGroup && store.assistant.dndEnabled) {
              const nowCr = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Costa_Rica", hour: "2-digit", minute: "2-digit", hour12: false });
              const startDnd = store.assistant.dndStart || "22:00";
              const endDnd = store.assistant.dndEnd || "07:00";
              const inDnd = startDnd <= endDnd ? (nowCr >= startDnd && nowCr <= endDnd) : (nowCr >= startDnd || nowCr <= endDnd);
              if (inDnd && !chat.awayNotified) {
                const dndReply = store.assistant.dndMessage || "🌙 En este momento estoy en horario de descanso (No Molestar). Te respondo a primera hora.";
                const sent = await sock.sendMessage(remoteJid, { text: dndReply }, { quoted: msg });
                if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                chat.awayNotified = true;
                chat.lastAutoReplyAt = Date.now();
                saveDashboardStore();
                addLog(`🌙 Respuesta No Molestar enviada a ${pushName}`);
                continue;
              }
            }

            // Check custom keyword Flows (bot_flows in SQLite) before AI
            if (incomingText && !fromMe && !isGroup) {
              try {
                const dbFlow = new DatabaseSync(path.join(__dirname, "..", "backend", "aura_flow.db"));
                dbFlow.exec("CREATE TABLE IF NOT EXISTS bot_flows (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_text TEXT NOT NULL, reply_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL)");
                const activeFlows = dbFlow.prepare("SELECT id, trigger_text, reply_text FROM bot_flows WHERE enabled = 1").all();
                dbFlow.close();
                const lowerIn = incomingText.toLowerCase();
                const matchedFlow = activeFlows.find((fl) =>
                  fl.trigger_text.split(",").some((kw) => kw.trim() && lowerIn.includes(kw.trim().toLowerCase()))
                );
                if (matchedFlow) {
                  const sent = await sock.sendMessage(remoteJid, { text: matchedFlow.reply_text }, { quoted: msg });
                  if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                  appendMessageToChat(chat, {
                    id: sent?.key?.id || `flow_${Date.now()}`,
                    timestamp: Date.now(),
                    fromMe: true,
                    kind: "assistant",
                    senderName: "AuraFlow • Flow",
                    senderPhone: botState.connectedUser?.phone || "+50689418680",
                    mediaType: "texto",
                    text: matchedFlow.reply_text,
                  });
                  addLog(`🔀 Flow #${matchedFlow.id} activado para ${pushName}`);
                  continue;
                }
              } catch (e) {}
            }

            // Try to respond using synchronized Commands + AuraAgent AI
            let repliedWithAi = false;
            if (incomingText && incomingText.length > 0) {
              try {
                const directIntent = inferCommandIntent(incomingText, fromMe || isSelfChat);
                if (directIntent) {
                  const cmdRes = await handleBotCommand(directIntent, {
                    senderId: senderJid,
                    senderPhone,
                    pushName,
                    isOwner: fromMe || isSelfChat,
                    onAssistantCommand: handleAssistantWhatsAppCommand,
                  });
                  if (cmdRes) {
                    if (cmdRes.qrDataUrl) {
                      const imgBuf = Buffer.from(cmdRes.qrDataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
                      const sent = await sock.sendMessage(remoteJid, { image: imgBuf, caption: cmdRes.reply }, { quoted: msg });
                      if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                    } else if (cmdRes.reply) {
                      const sent = await sock.sendMessage(remoteJid, { text: cmdRes.reply }, { quoted: msg });
                      if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                    }
                    appendMessageToChat(chat, {
                      id: `ai_cmd_${Date.now()}`,
                      timestamp: Date.now(),
                      fromMe: true,
                      kind: "assistant",
                      senderName: "Aura IA • Comando",
                      senderPhone: botState.connectedUser?.phone || "+50689418680",
                      mediaType: cmdRes.qrDataUrl ? "imagen" : "texto",
                      text: cmdRes.reply || "[Comando ejecutado]",
                    });
                    addLog(`⚡ Aura IA sincronizada ejecutó ${directIntent} para ${pushName}`);
                    repliedWithAi = true;
                  }
                }

                if (!repliedWithAi) {
                const activePersonality =
                  (store.assistant.personalityPrompt && store.assistant.personalityPrompt.trim()) ||
                  PERSONALITY_PRESETS[store.assistant.personalityPreset]?.prompt ||
                  PERSONALITY_PRESETS.natural_cr.prompt;

                const aiPrompt = isSelfChat
                  ? `[Mensaje de Santiago (Propietario / Admin)]: "${incomingText}". Responde siguiendo tu personalidad activa. Si pide ejecutar una herramienta del bot, responde SOLO con [RUN_CMD: -comando argumentos] usando: ${AI_COMMAND_CATALOG}`
                  : isAudioMsg
                    ? `[Nota de voz en WhatsApp de ${pushName}]: "${incomingText}". Responde en español siguiendo exactamente tu personalidad.`
                    : `[Mensaje en WhatsApp de ${pushName}]: "${incomingText}". Responde en español siguiendo exactamente tu personalidad.`;

                const aiRes = await fetch("http://127.0.0.1:8095/api/chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    agent_slug: "aura-director",
                    message: aiPrompt,
                    system_prompt: activePersonality,
                    session_id: `wa-${senderPhone || remoteJid}`,
                  }),
                  signal: AbortSignal.timeout(35000),
                });

                if (aiRes.ok) {
                  const aiData = await aiRes.json();
                  if (aiData.ok && aiData.reply) {
                    const runMatch = isSelfChat ? aiData.reply.match(/\[RUN_CMD:\s*([^\]]+)\]/i) : null;
                    if (runMatch) {
                      const cmdRes = await handleBotCommand(runMatch[1].trim(), {
                        senderId: senderJid,
                        senderPhone,
                        pushName,
                        isOwner: true,
                        onAssistantCommand: handleAssistantWhatsAppCommand,
                      });
                      if (cmdRes) {
                        if (cmdRes.qrDataUrl) {
                          const imgBuf = Buffer.from(cmdRes.qrDataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
                          const sent = await sock.sendMessage(remoteJid, { image: imgBuf, caption: cmdRes.reply }, { quoted: msg });
                          if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                        } else if (cmdRes.reply) {
                          const sent = await sock.sendMessage(remoteJid, { text: cmdRes.reply }, { quoted: msg });
                          if (sent?.key?.id) markSentByBot(sent.key.id, "assistant");
                        }
                        repliedWithAi = true;
                      }
                    }
                    if (!repliedWithAi) {
                    let aiReply = formatForWhatsApp(aiData.reply);
                    if (isAudioMsg) {
                      aiReply = `🎙️ _Escuché tu nota de voz: "${transcribedSpeech}"_\n\n${aiReply}`;
                    }

                    // Detección inteligente de solicitud de audio / nota de voz
                    const lowerIncoming = incomingText.toLowerCase();
                    const lastMsgs = (chat.messages || []).slice(-3);
                    const wasAskedForAudio = lastMsgs.some(
                      (m) => m.kind === "assistant" && (
                        (m.text || "").toLowerCase().includes("generar el audio") ||
                        (m.text || "").toLowerCase().includes("contenido exacto") ||
                        (m.text || "").toLowerCase().includes("nota de voz")
                      )
                    );

                    const wantsAudio = wasAskedForAudio ||
                      /\b(audio|nota de voz|grabar voz|dime en audio|m[aá]ndame un audio|env[ií]ame un audio|dame audio|hazme un audio)\b/i.test(lowerIncoming) ||
                      (wasAskedForAudio && (lowerIncoming.startsWith("dime ") || lowerIncoming.startsWith("di ")));

                    if (wantsAudio) {
                      let textToSpeak = "";
                      if (lowerIncoming.startsWith("dime ")) {
                        textToSpeak = incomingText.replace(/^dime\s+/i, "").trim();
                      } else if (lowerIncoming.startsWith("di ")) {
                        textToSpeak = incomingText.replace(/^di\s+/i, "").trim();
                      } else if (lowerIncoming.includes(" que diga ")) {
                        textToSpeak = incomingText.split(/ que diga /i)[1].trim();
                      } else {
                        textToSpeak = aiData.reply;
                      }

                      try {
                        await sock.sendPresenceUpdate("recording", remoteJid);
                        const oggBuf = await synthesizeVoiceNoteOgg(textToSpeak || aiData.reply);
                        if (oggBuf && oggBuf.length > 0) {
                          const audioSent = await sock.sendMessage(
                            remoteJid,
                            { audio: oggBuf, mimetype: "audio/ogg; codecs=opus", ptt: true },
                            { quoted: msg }
                          );
                          const sentAudioId = audioSent?.key?.id || `tts_${Date.now()}`;
                          if (audioSent?.key?.id) {
                            markSentByBot(audioSent.key.id, "assistant");
                          }
                          const savedTtsUrl = saveAudioBufferForDashboard(oggBuf, sentAudioId, "ogg");
                          appendMessageToChat(chat, {
                            id: sentAudioId,
                            timestamp: Date.now(),
                            fromMe: true,
                            kind: "assistant",
                            senderName: "Asistente Personal",
                            senderPhone: botState.connectedUser?.phone || "+50689418680",
                            mediaType: "🎤 nota de voz",
                            text: "🎤 [Nota de voz IA]",
                            audioUrl: savedTtsUrl,
                            isPtt: true,
                            transcription: (textToSpeak || aiData.reply || "").slice(0, 280),
                          });
                          addLog(`🎙️ Nota de voz enviada a ${pushName}: "${(textToSpeak || aiData.reply).slice(0, 40)}..."`);
                        }
                      } catch (errAudio) {
                        logger.warn({ err: errAudio }, "Error enviando nota de voz PTT");
                      }
                    }

                    const sent = await sock.sendMessage(remoteJid, { text: aiReply }, { quoted: msg });
                    if (sent?.key?.id) {
                      markSentByBot(sent.key.id, "assistant");
                    }
                    chat.awayNotified = true;
                    chat.lastAutoReplyAt = Date.now();
                    store.stats.autoRepliesSent = (store.stats.autoRepliesSent || 0) + 1;
                    saveDashboardStore();
                    addLog(`🤖 AuraAgent IA respondió a ${pushName}: ${aiReply.slice(0, 60)}...`);
                    repliedWithAi = true;
                    }
                  }
                }
                }
              } catch (err) {
                addLog(`⚠️ Fallo consulta AuraAgent: ${err.message}`);
              } finally {
                try {
                  await sock.sendPresenceUpdate("paused", remoteJid);
                } catch (e) {}
              }
            }

            // Fallback: If AI did not reply, send away message (either if replyAll is enabled or haven't notified away yet)
            if (!repliedWithAi && !isSelfChat && (replyAll || !chat.awayNotified)) {
              const replyText = (store.assistant.awayMessage || DEFAULT_AWAY_MESSAGE).trim();
              const sent = await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
              if (sent?.key?.id) {
                markSentByBot(sent.key.id, "assistant");
              }
              chat.awayNotified = true;
              chat.lastAutoReplyAt = Date.now();
              store.stats.autoRepliesSent = (store.stats.autoRepliesSent || 0) + 1;
              saveDashboardStore();
              addLog(`🤖 Asistente envió aviso de respaldo a ${pushName} (${senderPhone})`);
            }
          }
        } catch (err) {
          addLog(`❌ Error procesando mensaje: ${err.message}`);
        }
      }
    });
  } catch (err) {
    addLog(`❌ Error al iniciar Baileys: ${err.message}`);
    setTimeout(() => startWhatsAppBot(), 4000);
  }
}

// HTTP Control, Dashboard & Command API on 127.0.0.1:8001
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // Serve static files in public folder (e.g. /bot-avatar.jpg, /media/audios/*.mp3) with HTTP Range support
  const publicFilePath = path.join(__dirname, "public", decodeURIComponent(url.pathname).replace(/^\//, ""));
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname !== "/" && url.pathname !== "/dashboard" && publicFilePath.startsWith(path.join(__dirname, "public")) && fs.existsSync(publicFilePath) && fs.statSync(publicFilePath).isFile()) {
    const ext = path.extname(publicFilePath).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".css": "text/css",
      ".js": "application/javascript",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".oga": "audio/ogg",
      ".opus": "audio/ogg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".webm": "audio/webm",
      ".mp4": "video/mp4",
    };
    const stat = fs.statSync(publicFilePath);
    const total = stat.size;
    const contentType = mimeMap[ext] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (range && total > 0) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (!isNaN(start) && !isNaN(end) && start >= 0 && end < total && start <= end) {
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", end - start + 1);
        res.writeHead(206);
        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(publicFilePath, { start, end }).pipe(res);
      }
    }

    res.setHeader("Content-Length", total);
    res.writeHead(200);
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(publicFilePath).pipe(res);
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/robots.txt") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.writeHead(200);
    return res.end("User-agent: *\nAllow: /\nSitemap: https://bot.auraflowtech.lat/sitemap.xml\n");
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/sitemap.xml") {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.writeHead(200);
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://bot.auraflowtech.lat/</loc><lastmod>2026-11-23</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>`);
  }

  if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/health" || url.pathname === "/api/health")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.writeHead(200);
    return res.end(req.method === "HEAD" ? "" : JSON.stringify({
      ok: true,
      status: "ONLINE",
      service: "auraflow-wabot",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  }

  // Serve Live Dashboard HTML on / or /dashboard
  if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/dashboard")) {
    try {
      const html = fs.readFileSync(DASHBOARD_HTML_FILE, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.writeHead(200);
      return res.end(req.method === "HEAD" ? "" : html);
    } catch (e) {
      res.writeHead(500);
      return res.end("Error loading dashboard HTML");
    }
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET" && url.pathname === "/status") {
    res.writeHead(200);
    return res.end(
      JSON.stringify({
        status: botState.status,
        qrDataUrl: botState.qrDataUrl,
        pairingCode: botState.pairingCode,
        pairingPhone: botState.pairingPhone,
        connectedUser: botState.connectedUser,
        commandsExecuted: botState.commandsExecuted,
        startedAt: botState.startedAt,
        assistant: {
          ...store.assistant,
          presets: PERSONALITY_PRESETS,
          isCurrentlyAway: isOwnerCurrentlyAway(),
        },
        logs: botState.logs.slice(0, 25),
      })
    );
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    if (!isAuthenticated(req)) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
    }

    const requestedJid = url.searchParams.get("chatJid");
    const sortedChats = Object.values(store.chats)
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

    const pendingAvatars = sortedChats
      .slice(0, 15)
      .filter((c) => !profilePicCache.has(c.jid))
      .map((c) => fetchProfilePicCached(c.jid).catch(() => null));
    if (pendingAvatars.length > 0) {
      await Promise.race([
        Promise.allSettled(pendingAvatars),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
    }

    const chatList = sortedChats.map((c) => {
      const avatarUrl = c.avatarUrl || profilePicCache.get(c.jid)?.url || null;
      const lastMsg = Array.isArray(c.messages) && c.messages.length ? c.messages[c.messages.length - 1] : null;
      return {
        jid: c.jid,
        name: c.name,
        phone: c.phone,
        avatarUrl,
        lastFromMe: Boolean(lastMsg?.fromMe),
        isGroup: c.isGroup,
        muteAssistant: Boolean(c.muteAssistant),
        blocked: Boolean(c.blocked) || isUserBlocked(c.jid, c.jid, c.phone),
        awayNotified: Boolean(c.awayNotified),
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        lastAutoReplyAt: c.lastAutoReplyAt,
        messageCount: (c.messages || []).length,
      };
    });

    const activeChat = requestedJid && store.chats[requestedJid]
      ? {
          ...store.chats[requestedJid],
          avatarUrl: store.chats[requestedJid].avatarUrl || profilePicCache.get(requestedJid)?.url || null,
          blocked: Boolean(store.chats[requestedJid].blocked) || isUserBlocked(requestedJid, requestedJid, store.chats[requestedJid].phone),
        }
      : null;

    res.writeHead(200);
    return res.end(
      JSON.stringify({
        status: botState.status,
        qrDataUrl: botState.qrDataUrl,
        connectedUser: botState.connectedUser,
        commandsExecuted: botState.commandsExecuted,
        adminEmail: ALLOWED_ADMIN_EMAIL,
        assistant: {
          ...store.assistant,
          presets: PERSONALITY_PRESETS,
          isCurrentlyAway: isOwnerCurrentlyAway(),
        },
        stats: {
          totalChats: chatList.length,
          totalMessagesSeen: store.stats.totalMessagesSeen || 0,
          autoRepliesSent: store.stats.autoRepliesSent || 0,
        },
        system: {
          uptimeSec: Math.floor(process.uptime()),
          rssMb: Math.round(process.memoryUsage().rss / 1048576),
          freeRamMb: Math.round(os.freemem() / 1048576),
          totalRamMb: Math.round(os.totalmem() / 1048576),
          load1m: os.loadavg()[0].toFixed(2),
        },
        blockedUsers: store.blockedUsers || [],
        chats: chatList,
        activeChat,
        logs: botState.logs.slice(0, 40),
      })
    );
  }

  if (req.method === "GET" && url.pathname === "/api/db/items") {
    if (!isAuthenticated(req)) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
    }
    const db = new DatabaseSync(path.join(__dirname, "..", "backend", "aura_flow.db"));
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_numbers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, label TEXT DEFAULT '', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bot_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bot_flows (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_text TEXT NOT NULL, reply_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS quick_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, message_text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, contact_name TEXT DEFAULT '', message_text TEXT NOT NULL, send_at_ts INTEGER NOT NULL, sent INTEGER DEFAULT 0, created_at TEXT NOT NULL);
      `);
      const qrCount = db.prepare("SELECT COUNT(*) as c FROM quick_replies").get().c;
      if (qrCount === 0) {
        const ins = db.prepare("INSERT INTO quick_replies (label, message_text) VALUES (?, ?)");
        ins.run("👋 Saludo", "👋 ¡Hola! Con gusto te atiendo, ¿en qué te puedo ayudar?");
        ins.run("📋 Cotización", "📋 Puedes ver nuestros servicios y cotizaciones en https://auraflowtech.lat");
        ins.run("⏳ Ocupado", "⏳ En este momento estoy ocupado, te escribo en unos minutos.");
        ins.run("💳 Pagos", "💳 Puedes solicitar los datos de cuenta para transferencia.");
      }
      const numbers = db.prepare("SELECT id, phone, label, created_at FROM saved_numbers ORDER BY id ASC").all();
      const notes = db.prepare("SELECT id, content, created_at FROM bot_notes ORDER BY id DESC LIMIT 20").all();
      const flows = db.prepare("SELECT id, trigger_text, reply_text, enabled FROM bot_flows ORDER BY id DESC").all();
      const quickReplies = db.prepare("SELECT id, label, message_text FROM quick_replies ORDER BY id ASC").all();
      const scheduled = db.prepare("SELECT id, jid, contact_name, message_text, send_at_ts, sent FROM scheduled_messages ORDER BY send_at_ts ASC LIMIT 25").all();
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, numbers, notes, flows, quickReplies, scheduled }));
    } finally {
      db.close();
    }
  }

  let rawBody = "";
  req.on("data", (chunk) => {
    rawBody += chunk;
  });

  req.on("end", async () => {
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {}

    // Auth endpoints for support@auraflowtech.lat ONLY
    if (req.method === "POST" && url.pathname === "/api/auth/send-code") {
      const email = String(body.email || "").trim().toLowerCase();
      if (email !== ALLOWED_ADMIN_EMAIL) {
        res.writeHead(403);
        return res.end(
          JSON.stringify({
            error: "⛔ Acceso denegado. Este panel es privado y exclusivo para support@auraflowtech.lat.",
          })
        );
      }
      const code6 = String(Math.floor(100000 + Math.random() * 900000));
      pendingOtp = {
        code: code6,
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
      const emailSent = await sendOtpEmailToAdmin(code6);
      addLog(`🔐 Código de acceso de 6 dígitos generado y enviado a ${ALLOWED_ADMIN_EMAIL}`);
      res.writeHead(200);
      return res.end(
        JSON.stringify({
          ok: true,
          emailSent,
          message: `Código de 6 dígitos enviado a ${ALLOWED_ADMIN_EMAIL}. Revisa tu bandeja de entrada.`,
        })
      );
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify") {
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const password = String(body.password || "").trim();

      if (email !== ALLOWED_ADMIN_EMAIL) {
        res.writeHead(403);
        return res.end(
          JSON.stringify({
            error: "⛔ Acceso restringido exclusivamente a support@auraflowtech.lat.",
          })
        );
      }

      const validOtp = pendingOtp.code && Date.now() < pendingOtp.expiresAt && code === pendingOtp.code;
      const validPass = password && password === "YOUR_ADMIN_PASSWORD";

      if (!validOtp && !validPass) {
        res.writeHead(401);
        return res.end(
          JSON.stringify({
            error: "Código o contraseña incorrectos. Solicita un nuevo código a support@auraflowtech.lat.",
          })
        );
      }

      pendingOtp = { code: null, expiresAt: 0 };
      const token = crypto.randomBytes(32).toString("hex");
      if (!Array.isArray(store.sessions)) store.sessions = [];
      store.sessions.push(token);
      if (store.sessions.length > 20) store.sessions = store.sessions.slice(-20);
      saveDashboardStore();

      addLog(`✅ Inicio de sesión autorizado en Dashboard: ${ALLOWED_ADMIN_EMAIL}`);
      res.setHeader(
        "Set-Cookie",
        `af_bot_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
      );
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, token, email: ALLOWED_ADMIN_EMAIL }));
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = extractTokenFromReq(req);
      if (token && Array.isArray(store.sessions)) {
        store.sessions = store.sessions.filter((t) => t !== token);
        saveDashboardStore();
      }
      res.setHeader("Set-Cookie", "af_bot_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === "POST" && url.pathname === "/api/assistant/config") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      if (body.mode && ["always_away", "auto", "commands_only"].includes(body.mode)) {
        store.assistant.mode = body.mode;
        if (body.mode === "commands_only") {
          store.assistant.lastOwnerActivityAt = Date.now();
        }
        if (body.mode === "always_away") {
          for (const c of Object.values(store.chats)) {
            c.awayNotified = false;
          }
        }
        addLog(`⚙️ Modo del Asistente actualizado desde Dashboard: ${body.mode}`);
      }
      if (typeof body.personalityPreset === "string" && PERSONALITY_PRESETS[body.personalityPreset]) {
        store.assistant.personalityPreset = body.personalityPreset;
        if (body.personalityPreset !== "custom" && (!body.personalityPrompt || !String(body.personalityPrompt).trim())) {
          store.assistant.personalityPrompt = PERSONALITY_PRESETS[body.personalityPreset].prompt;
        }
      }
      if (typeof body.personalityPrompt === "string" && body.personalityPrompt.trim()) {
        store.assistant.personalityPrompt = body.personalityPrompt.trim();
      }
      if (body.replyAllMessages !== undefined) {
        store.assistant.replyAllMessages = Boolean(body.replyAllMessages);
      }
      if (typeof body.awayMessage === "string" && body.awayMessage.trim()) {
        store.assistant.awayMessage = body.awayMessage.trim();
      }
      if (body.inactivityMinutes !== undefined) {
        store.assistant.inactivityMinutes = Math.max(1, Number(body.inactivityMinutes) || 3);
      }
      if (body.onlyPrivateChats !== undefined) {
        store.assistant.onlyPrivateChats = Boolean(body.onlyPrivateChats);
      }
      if (body.dndEnabled !== undefined) {
        store.assistant.dndEnabled = Boolean(body.dndEnabled);
      }
      if (typeof body.dndStart === "string" && /^\d{2}:\d{2}$/.test(body.dndStart)) {
        store.assistant.dndStart = body.dndStart;
      }
      if (typeof body.dndEnd === "string" && /^\d{2}:\d{2}$/.test(body.dndEnd)) {
        store.assistant.dndEnd = body.dndEnd;
      }
      if (typeof body.dndMessage === "string" && body.dndMessage.trim()) {
        store.assistant.dndMessage = body.dndMessage.trim();
      }
      if (body.resetCooldowns) {
        for (const c of Object.values(store.chats)) {
          c.awayNotified = false;
          c.lastAutoReplyAt = 0;
        }
        addLog("🔄 Avisos únicos reiniciados: el asistente volverá a avisar 1 vez si escriben.");
      }
      saveDashboardStore();
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, assistant: store.assistant }));
    }

    if (req.method === "POST" && url.pathname === "/api/chat/toggle-mute") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const jid = String(body.jid || "");
      if (!jid || !store.chats[jid]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Chat no encontrado" }));
      }
      store.chats[jid].muteAssistant = !store.chats[jid].muteAssistant;
      saveDashboardStore();
      addLog(
        `${store.chats[jid].muteAssistant ? "🔕 Asistente silenciado" : "🔔 Asistente activado"} para ${store.chats[jid].name}`
      );
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, muteAssistant: store.chats[jid].muteAssistant }));
    }

    if (req.method === "POST" && url.pathname === "/api/chat/toggle-block") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const jid = String(body.jid || "");
      if (!jid || !store.chats[jid]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Chat no encontrado" }));
      }
      const chat = store.chats[jid];
      const currentlyBlocked = Boolean(chat.blocked) || isUserBlocked(jid, jid, chat.phone);
      if (currentlyBlocked) {
        removeBlockedUser({ jid });
        addLog(`🔓 Usuario desbloqueado: ${chat.name} (${chat.phone})`);
      } else {
        addBlockedUser({ jid, phone: chat.phone, name: chat.name });
        addLog(`🚫 Usuario bloqueado (bot no responderá): ${chat.name} (${chat.phone})`);
      }
      saveDashboardStore();
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, blocked: !currentlyBlocked, blockedUsers: store.blockedUsers }));
    }

    if (req.method === "POST" && url.pathname === "/api/blocked/add") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const phone = String(body.phone || "").trim();
      const name = String(body.name || "").trim();
      const jid = String(body.jid || "").trim();
      const entry = addBlockedUser({ jid, phone, name });
      if (!entry) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "Ingresa un número o JID válido" }));
      }
      saveDashboardStore();
      addLog(`🚫 Número bloqueado manualmente: ${entry.name} (${entry.phone || entry.key})`);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, entry, blockedUsers: store.blockedUsers }));
    }

    if (req.method === "POST" && url.pathname === "/api/blocked/remove") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const key = String(body.key || "").trim();
      const jid = String(body.jid || "").trim();
      if (!key && !jid) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "Falta key o jid" }));
      }
      removeBlockedUser({ key, jid });
      saveDashboardStore();
      addLog(`🔓 Usuario desbloqueado: ${key || jid}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, blockedUsers: store.blockedUsers }));
    }

    if (req.method === "POST" && url.pathname === "/api/chat/send") {
      const isLoopback = req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1";
      if (!isLoopback && !isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const jid = String(body.jid || "").trim();
      const text = String(body.text || "").trim();
      const isAssistant = Boolean(body.isAssistant);
      if (!jid || !text) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "Falta jid o texto" }));
      }
      if (!sock || botState.status !== "connected") {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "WhatsApp no está conectado en este momento" }));
      }
      try {
        const sent = await sock.sendMessage(jid, { text });
        if (sent?.key?.id) {
          markSentByBot(sent.key.id, isAssistant ? "assistant" : "dashboard");
        }
        const chat = await ensureChatEntry(jid, null, true);
        if (isAssistant) {
          chat.awayNotified = true;
          chat.lastAutoReplyAt = Date.now();
          store.stats.autoRepliesSent = (store.stats.autoRepliesSent || 0) + 1;
        } else {
          store.assistant.lastOwnerActivityAt = Date.now();
          chat.lastOwnerReplyAt = Date.now();
          chat.awayNotified = false;
        }
        appendMessageToChat(chat, {
          id: sent?.key?.id || `${Date.now()}`,
          timestamp: Date.now(),
          fromMe: true,
          kind: isAssistant ? "assistant" : "owner",
          senderName: isAssistant ? "Asistente Personal" : "Santiago (Dashboard)",
          senderPhone: botState.connectedUser?.phone || "+50689418680",
          mediaType: "texto",
          text,
        });
        addLog(`${isAssistant ? "🤖 Asistente" : "💻 Dashboard"} envió mensaje a ${chat.name}: ${text.slice(0, 50)}`);
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat/send-media") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const jid = String(body.jid || "").trim();
      const dataUrl = String(body.dataUrl || "");
      const caption = String(body.caption || "").trim();
      const asSticker = Boolean(body.asSticker);
      const asAudio = Boolean(body.asAudio);
      if (!jid || !dataUrl.includes("base64,")) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "Falta jid o archivo" }));
      }
      if (!sock || botState.status !== "connected") {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: "WhatsApp no está conectado" }));
      }
      try {
        const b64 = dataUrl.split("base64,")[1];
        const rawBuf = Buffer.from(b64, "base64");
        let sent;
        let savedAudioUrl = null;
        if (asAudio) {
          const tmpIn = path.join("/tmp", `wa_rec_${Date.now()}.webm`);
          const tmpOut = path.join("/tmp", `wa_rec_${Date.now()}.ogg`);
          fs.writeFileSync(tmpIn, rawBuf);
          try {
            execSync(`ffmpeg -y -i "${tmpIn}" -c:a libopus -b:a 64k -ar 48000 -ac 1 "${tmpOut}"`, { stdio: "ignore", timeout: 30000 });
            const oggBuf = fs.readFileSync(tmpOut);
            sent = await sock.sendMessage(jid, { audio: oggBuf, mimetype: "audio/ogg; codecs=opus", ptt: true });
            savedAudioUrl = saveAudioBufferForDashboard(oggBuf, sent?.key?.id || Date.now(), "ogg");
          } finally {
            try { fs.unlinkSync(tmpIn); } catch {}
            try { fs.unlinkSync(tmpOut); } catch {}
          }
        } else if (asSticker) {
          const webpBuf = await sharp(rawBuf)
            .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 85 })
            .toBuffer();
          sent = await sock.sendMessage(jid, { sticker: webpBuf });
        } else {
          sent = await sock.sendMessage(jid, { image: rawBuf, caption: caption || undefined });
        }
        if (sent?.key?.id) markSentByBot(sent.key.id, "dashboard");
        const chat = await ensureChatEntry(jid, null, true);
        appendMessageToChat(chat, {
          id: sent?.key?.id || `${Date.now()}`,
          timestamp: Date.now(),
          fromMe: true,
          kind: "owner",
          senderName: "Santiago (Dashboard)",
          senderPhone: botState.connectedUser?.phone || "+50689418680",
          mediaType: asAudio ? "🎤 nota de voz" : (asSticker ? "✨ sticker" : "📷 imagen"),
          text: asAudio ? "🎤 [Nota de voz enviada]" : (asSticker ? "🎨 [Sticker enviado]" : (caption ? `🖼️ ${caption}` : "🖼️ [Imagen enviada]")),
          audioUrl: savedAudioUrl,
          isPtt: asAudio,
        });
        addLog(`💻 Dashboard envió ${asAudio ? "nota de voz" : (asSticker ? "sticker" : "imagen")} a ${chat.name}`);
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, audioUrl: savedAudioUrl }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat/transcribe-audio") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const jid = String(body.jid || "").trim();
      const msgId = String(body.msgId || "").trim();
      const chat = store.chats[jid];
      if (!chat || !Array.isArray(chat.messages)) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Chat no encontrado" }));
      }
      const msgObj = chat.messages.find((m) => m.id === msgId);
      if (!msgObj || !msgObj.audioUrl) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Audio no disponible para este mensaje" }));
      }
      if (msgObj.transcription) {
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, transcription: msgObj.transcription }));
      }
      const localAudioPath = path.join(__dirname, "public", msgObj.audioUrl.replace(/^\//, ""));
      if (!fs.existsSync(localAudioPath)) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "Archivo de audio no encontrado en el servidor" }));
      }
      try {
        const result = execSync(`/usr/local/bin/transcribe-audio.sh "${localAudioPath}"`, { timeout: 25000 }).toString().trim();
        msgObj.transcription = result || "(Sin voz clara detectada)";
        saveDashboardStore();
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, transcription: msgObj.transcription }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: "No se pudo transcribir el audio" }));
      }
    }

    if (req.method === "POST" && url.pathname === "/pair") {
      const phone = String(body.phone || "50689418680").replace(/\D/g, "");
      if (!phone || phone.length < 8) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "Número de teléfono inválido. Usa formato 50689418680." }));
      }
      try {
        if (!sock) {
          res.writeHead(503);
          return res.end(JSON.stringify({ error: "El socket de WhatsApp aún se está iniciando." }));
        }
        botState.pairingPhone = phone;
        const code = await sock.requestPairingCode(phone);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        botState.pairingCode = formattedCode;
        addLog(`🔑 Código de vinculación generado para +${phone}: ${formattedCode}`);
        res.writeHead(200);
        return res.end(
          JSON.stringify({
            pairingCode: formattedCode,
            phone: `+${phone}`,
            message: `Ingresa el código ${formattedCode} en tu WhatsApp > Dispositivos vinculados > Vincular con el número de teléfono.`,
          })
        );
      } catch (err) {
        addLog(`⚠️ Error solicitando código de vinculación: ${err.message}`);
        res.writeHead(500);
        return res.end(JSON.stringify({ error: `No se pudo generar código: ${err.message}. Prueba reiniciar sesión.` }));
      }
    }

    if (req.method === "POST" && url.pathname === "/reset") {
      try {
        addLog("🔄 Reiniciando sesión de WhatsApp para generar nuevo QR / Código...");
        botState.pairingCode = null;
        botState.qrDataUrl = null;
        botState.connectedUser = null;
        botState.status = "starting";
        if (sock) {
          try {
            sock.end();
          } catch (e) {}
        }
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(() => startWhatsAppBot(), 800);
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, message: "Sesión reiniciada. Generando nuevo código QR..." }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === "POST" && url.pathname === "/command") {
      const message = String(body.message || "-menu").trim();
      const senderPhone = String(body.senderPhone || "+506 8941-8680");
      try {
        let cmdInput = message;
        const result = await handleBotCommand(cmdInput, {
          senderId: "web_user@s.whatsapp.net",
          senderPhone,
          pushName: "Usuario Web AuraFlow",
          isOwner: isAuthenticated(req),
          onAssistantCommand: handleAssistantWhatsAppCommand,
        });

        if (result) {
          botState.commandsExecuted += 1;
          addLog(`🌐 Comando Web ejecutado: ${cmdInput.slice(0, 50)}`);
          let stickerDataUrl = null;
          if (result.stickerBuffer) {
            stickerDataUrl = `data:image/webp;base64,${result.stickerBuffer.toString("base64")}`;
          }
          let cmdAudioUrl = result.audioUrl || null;
          if (cmdAudioUrl && /^https?:\/\//i.test(cmdAudioUrl)) {
            try {
              const extRes = await fetch(cmdAudioUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
              if (extRes.ok) {
                const extBuf = Buffer.from(await extRes.arrayBuffer());
                const localUrl = saveAudioBufferForDashboard(extBuf, `cmd_tts_${Date.now()}`, "mp3");
                if (localUrl) cmdAudioUrl = localUrl;
              }
            } catch {}
          } else if (!cmdAudioUrl && result.mediaType === "audio" && result.buffer) {
            cmdAudioUrl = saveAudioBufferForDashboard(result.buffer, `cmd_${Date.now()}`, "mp3");
          }
          res.writeHead(200);
          return res.end(
            JSON.stringify({
              isCommand: true,
              reply: result.reply,
              qrDataUrl: result.qrDataUrl || null,
              stickerDataUrl,
              audioUrl: cmdAudioUrl,
              node_badge: result.node_badge || "AURAFLOW BOT",
              suggested_workflow: result.suggested_workflow || "AuraFlow Bot Multi-Device",
              estimated_savings_hrs: "180 hrs / mes",
            })
          );
        }

        res.writeHead(200);
        return res.end(JSON.stringify({ isCommand: false }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === "POST" && url.pathname === "/api/db/items") {
      if (!isAuthenticated(req)) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "No autenticado", requiresAuth: true }));
      }
      const db = new DatabaseSync(path.join(__dirname, "..", "backend", "aura_flow.db"));
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS saved_numbers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, label TEXT DEFAULT '', created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS bot_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS bot_flows (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_text TEXT NOT NULL, reply_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS quick_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, message_text TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, contact_name TEXT DEFAULT '', message_text TEXT NOT NULL, send_at_ts INTEGER NOT NULL, sent INTEGER DEFAULT 0, created_at TEXT NOT NULL);
        `);
        const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
        const action = String(body.action || "");
        if (action === "add_number") {
          const phone = String(body.phone || "").trim();
          const label = String(body.label || "").trim();
          if (!phone) { res.writeHead(400); return res.end(JSON.stringify({ error: "Falta teléfono" })); }
          db.prepare("INSERT OR IGNORE INTO saved_numbers (phone, label, created_at) VALUES (?, ?, ?)").run(phone, label, nowStr);
        } else if (action === "del_number") {
          db.prepare("DELETE FROM saved_numbers WHERE id = ?").run(Number(body.id));
        } else if (action === "add_note") {
          const content = String(body.content || "").trim();
          if (!content) { res.writeHead(400); return res.end(JSON.stringify({ error: "Falta nota" })); }
          db.prepare("INSERT INTO bot_notes (content, created_at) VALUES (?, ?)").run(content, nowStr);
        } else if (action === "del_note") {
          db.prepare("DELETE FROM bot_notes WHERE id = ?").run(Number(body.id));
        } else if (action === "add_flow") {
          const trigger = String(body.trigger_text || "").trim();
          const reply = String(body.reply_text || "").trim();
          if (!trigger || !reply) { res.writeHead(400); return res.end(JSON.stringify({ error: "Falta palabra clave o respuesta" })); }
          db.prepare("INSERT INTO bot_flows (trigger_text, reply_text, enabled, created_at) VALUES (?, ?, 1, ?)").run(trigger, reply, nowStr);
        } else if (action === "toggle_flow") {
          db.prepare("UPDATE bot_flows SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?").run(Number(body.id));
        } else if (action === "del_flow") {
          db.prepare("DELETE FROM bot_flows WHERE id = ?").run(Number(body.id));
        } else if (action === "add_quick_reply") {
          const label = String(body.label || "").trim();
          const msgTxt = String(body.message_text || "").trim();
          if (!label || !msgTxt) { res.writeHead(400); return res.end(JSON.stringify({ error: "Falta etiqueta o mensaje" })); }
          db.prepare("INSERT INTO quick_replies (label, message_text) VALUES (?, ?)").run(label, msgTxt);
        } else if (action === "del_quick_reply") {
          db.prepare("DELETE FROM quick_replies WHERE id = ?").run(Number(body.id));
        } else if (action === "add_schedule") {
          const jid = String(body.jid || "").trim();
          const contactName = String(body.contact_name || "").trim();
          const msgTxt = String(body.message_text || "").trim();
          const sendAtTs = Number(body.send_at_ts || 0);
          if (!jid || !msgTxt || !sendAtTs) { res.writeHead(400); return res.end(JSON.stringify({ error: "Faltan datos de programación" })); }
          db.prepare("INSERT INTO scheduled_messages (jid, contact_name, message_text, send_at_ts, sent, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(jid, contactName, msgTxt, sendAtTs, nowStr);
        } else if (action === "del_schedule") {
          db.prepare("DELETE FROM scheduled_messages WHERE id = ?").run(Number(body.id));
        }
        const numbers = db.prepare("SELECT id, phone, label, created_at FROM saved_numbers ORDER BY id ASC").all();
        const notes = db.prepare("SELECT id, content, created_at FROM bot_notes ORDER BY id DESC LIMIT 20").all();
        const flows = db.prepare("SELECT id, trigger_text, reply_text, enabled FROM bot_flows ORDER BY id DESC").all();
        const quickReplies = db.prepare("SELECT id, label, message_text FROM quick_replies ORDER BY id ASC").all();
        const scheduled = db.prepare("SELECT id, jid, contact_name, message_text, send_at_ts, sent FROM scheduled_messages ORDER BY send_at_ts ASC LIMIT 25").all();
        res.writeHead(200);
        return res.end(JSON.stringify({ ok: true, numbers, notes, flows, quickReplies, scheduled }));
      } finally {
        db.close();
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  addLog(`🚀 Servidor AuraFlow Bot & Dashboard escuchando en http://127.0.0.1:${PORT}`);
  startWhatsAppBot();
});

// Watchdog VPS -> Alertas automáticas por WhatsApp (cada 5 min)
const _alertState = new Map();
setInterval(async () => {
  if (!sock || botState.status !== "connected" || !sock.user?.id) return;
  const ownerJid = `${sock.user.id.split(":")[0]}@s.whatsapp.net`;
  const units = ["auraflow.service", "iphone-transfer.service", "aura-agent.service", "nginx.service"];
  for (const u of units) {
    let active = false;
    try {
      active = execSync(`systemctl is-active ${u}`, { encoding: "utf8" }).trim() === "active";
    } catch {}
    const prev = _alertState.get(u);
    if (prev === undefined) {
      _alertState.set(u, active);
    } else if (prev && !active) {
      _alertState.set(u, false);
      const alertText = `🚨 *Alerta VPS:* El servicio \`${u}\` se detuvo. Usa \`-systemd\` para revisar.`;
      addLog(alertText);
      sock.sendMessage(ownerJid, { text: alertText }).catch(() => {});
    } else if (!prev && active) {
      _alertState.set(u, true);
      sock.sendMessage(ownerJid, { text: `✅ *Recuperado:* \`${u}\` volvió a estar activo.` }).catch(() => {});
    }
  }
  try {
    const pct = parseInt(execSync("df -P / | awk 'NR==2 {gsub(/%/,\"\",$5); print $5}'", { encoding: "utf8" }).trim(), 10);
    if (pct >= 92 && !_alertState.get("disk_warn")) {
      _alertState.set("disk_warn", true);
      sock.sendMessage(ownerJid, { text: `⚠️ *Alerta Disco VPS:* El uso del disco raíz alcanzó *${pct}%*.` }).catch(() => {});
    } else if (pct < 85) {
      _alertState.set("disk_warn", false);
    }
  } catch {}
}, 5 * 60 * 1000);

// Programador de mensajes pendientes (cada 30s)
setInterval(async () => {
  if (!sock || botState.status !== "connected") return;
  try {
    const db = new DatabaseSync(path.join(__dirname, "..", "backend", "aura_flow.db"));
    db.exec("CREATE TABLE IF NOT EXISTS scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, contact_name TEXT DEFAULT '', message_text TEXT NOT NULL, send_at_ts INTEGER NOT NULL, sent INTEGER DEFAULT 0, created_at TEXT NOT NULL)");
    const now = Date.now();
    const due = db.prepare("SELECT id, jid, contact_name, message_text FROM scheduled_messages WHERE sent = 0 AND send_at_ts <= ?").all(now);
    for (const item of due) {
      try {
        const sent = await sock.sendMessage(item.jid, { text: item.message_text });
        if (sent?.key?.id) markSentByBot(sent.key.id, "dashboard");
        db.prepare("UPDATE scheduled_messages SET sent = 1 WHERE id = ?").run(item.id);
        addLog(`📅 Mensaje programado #${item.id} enviado a ${item.contact_name || item.jid}`);
      } catch (e) {}
    }
    db.close();
  } catch {}
}, 30 * 1000);
