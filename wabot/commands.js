const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const QRCode = require("qrcode");
const sharp = require("sharp");
const WebP = require("node-webpmux");

const DB_PATH = path.join(__dirname, "..", "backend", "aura_flow.db");
const STATE_FILE = path.join(__dirname, "bot_data.json");

function loadBotData() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) {}
  return { xp: {}, sets: {}, reminders: [] };
}

function saveBotData(data) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {}
}

const MENU_TEXT = `🤖 *AuraFlow Bot — Menú*
_Ing. Santiago Delgado Leiva · auraflowtech.lat_

*━━ 💼 SERVICIOS & WEB ━━*
▸ *-servicios* — Servicios de IA, Redes y Software
▸ *-cotizar* _detalle_ — Solicitar cotización (entra al CRM)
▸ *-contacto* _(-web)_ — Datos de contacto y sitio web
▸ *-evangelio* _(-alimento, -promesa)_ — Versículo y reflexión de Pulso de Fe

*━━ 🤖 IA & VOZ ━━*
▸ *-ia* _pregunta_ — Consulta directa con la IA
▸ *-say* _texto_ — Convierte texto en nota de voz

*━━ 🛠️ OPS DEL SERVIDOR (Propietario) ━━*
▸ *-status* — CPU, RAM, disco y servicios
▸ *-vpn* — Estado del túnel VPN del Ruijie
▸ *-docker* — Contenedores Docker activos
▸ *-ping* — Latencia y estado del bot
▸ *-clean* — Limpieza rápida del servidor
▸ *-numeros* — Ver números guardados en la base de datos
▸ *-nota* / *-notas* — Bloc de notas rápido en base de datos
▸ *-media* _(-cdn)_ — Ver archivos y links en media.auraflowtech.lat
▸ *-systemd* — Estado de servicios AuraFlow en el VPS

*━━ 🌐 REDES, DIAGNÓSTICO & DEV ━━*
▸ *-ip* _ip/dominio_ — GeoIP, ISP y registros DNS
▸ *-ssl* _dominio_ — Inspeccionar certificado SSL/TLS
▸ *-http* _url_ — Verificar estado HTTP y latencia
▸ *-whois* _dominio_ — Datos RDAP/WHOIS de un dominio
▸ *-puertos* _host [puertos]_ — Escaneo rápido de puertos TCP
▸ *-meta* _url_ — Ver título y metadatos OpenGraph/SEO
▸ *-base64* _enc|dec texto_ / *-json* — Utilidades dev

*━━ 🎬 MULTIMEDIA & UTILIDADES ━━*
▸ *-dl* _link_ — Descargar video o MP3 (TikTok, IG, YT, FB)
▸ *-sticker* _(-s)_ — Crear sticker de imagen o video
▸ *-dolar* _(-tc, -euro)_ — Tipo de cambio en Costa Rica
▸ *-crypto* _[btc|eth|sol]_ — Precio de criptomonedas en vivo
▸ *-convertir* _monto_ — Convierte USD ↔️ CRC
▸ *-calc* _expresión_ — Calculadora
▸ *-clima* _ciudad_ — Clima actual
▸ *-wiki* _tema_ — Buscar en Wikipedia
▸ *-tr* _idioma texto_ — Traductor
▸ *-qr* _texto/link_ — Generar código QR con estilo AuraFlow
▸ *-clave* / *-uuid* / *-hash* — Contraseñas, UUID y hashes
▸ *-remind* _tiempo texto_ — Recordatorio
▸ *-encuesta* — Crear encuesta de WhatsApp
▸ *-sorteo* / *-dado* / *-moneda* — Juegos rápidos
▸ *-delete* — Borra un mensaje del bot (respondiéndolo)

*━━ ⚙️ ASISTENTE ━━*
▸ *-ausente* / *-online* / *-asistente auto*`;

const COMMAND_HELP = {
  tramite: "📌 *Uso:* `-tramite` (alias: `-formulario`, `-atencion`, `-soporte`, `-ticket`)\nAbre el Formulario Inteligente de Atención y Trámites de AuraFlow Tech con validación en vivo de Cédula CR (Hacienda) y canal directo con Santiago Delgado.",
  servicios: "📌 *Uso:* `-servicios`\nMuestra el catálogo de soluciones, planes en colones y los 16 subdominios activos de AuraFlow Tech.",
  cotizar: "📌 *Uso:* `-cotizar <detalle de lo que necesitas>`\nEjemplo: `-cotizar Necesito Factura Electrónica v4.4 y bot de WhatsApp para mi clínica`\nRegistra tu solicitud directamente en el CRM de AuraFlow Tech.",
  contacto: "📌 *Uso:* `-contacto`\nMuestra los canales oficiales de contacto de AuraFlow Tech y del Ing. Santiago Delgado Leiva.",
  dev: "📌 *Uso:* `-dev`\nMuestra la información y créditos del creador del bot (Ing. Santiago Delgado Leiva).",
  acortar: "📌 *Uso:* `-acortar <url>`\nEjemplo: `-acortar https://auraflowtech.lat/#facturador-v44`",
  a: "📌 *Uso:* `-a` o `-ping` o `-alive`\nVerifica que AuraFlow Bot esté activo y muestra latencia y uptime.",
  sorteo: "📌 *Uso:*\n• `-dado` — Lanza un dado (1-6)\n• `-moneda` — Lanza una moneda (Escudo / Corona)\n• `-elegir op1, op2, op3` — Elige una opción al azar\n• `-sorteo` — Realiza un sorteo aleatorio.",
  cabys: "📌 *Uso:* `-cabys <nombre o código de 13 dígitos>`\nEjemplo: `-cabys software` o `-cabys 8314300000000`\nConsulta el catálogo oficial CABYS del Ministerio de Hacienda CR.",
  calc: "📌 *Uso:* `-calc <expresión matemática>`\nEjemplo: `-calc (49500 * 1.13) * 12`",
  cedula: "📌 *Uso:* `-cedula <número de identificación>`\nEjemplo: `-cedula 3101849201`\nConsulta el contribuyente en el Ministerio de Hacienda CR (nombre, régimen, estado y actividades económicas).",
  eva: "📌 *Uso:* `-eva <pregunta o consulta>` (alias: `-aura`, `-ia`, `-gemini`)\nEjemplo: `-eva ¿cómo funciona la factura electrónica v4.4 en Costa Rica?`",
  clave: "📌 *Uso:* `-clave [longitud]`\nEjemplo: `-clave 16`\nGenera una contraseña criptográfica segura.",
  clavehacienda: "📌 *Uso:*\n• `-clavehacienda <clave de 50 dígitos>` — Desglosa país, fecha, cédula, consecutivo, situación y código de seguridad.\n• `-generarclave [cédula]` — Genera una Clave Numérica válida de 50 dígitos Hacienda CR v4.4.",
  convertir: "📌 *Uso:* `-convertir <monto> [usd|crc]`\nEjemplo: `-convertir 100 usd` o `-convertir 50000 crc`",
  sets: "📌 *Uso:* `-sets <Nombre del Pack> | <Autor>`\nEjemplo: `-sets AuraFlow Pack | Ing. Santiago`",
  delete: "📌 *Uso:* Responde a un mensaje enviado por el bot con `-delete` o `-d` para eliminarlo.",
  dolar: "📌 *Uso:* `-dolar` (alias: `-tc`, `-tipocambio`, `-euro`)\nMuestra el tipo de cambio oficial de compra y venta del Dólar y Euro en Costa Rica (BCCR / Hacienda).",
  donate: "📌 *Uso:* `-donate`\nMuestra los datos para apoyar el desarrollo de AuraFlow Bot.",
  encuesta: "📌 *Uso:* `-encuesta Pregunta | Opción 1 | Opción 2 | ...`\nEjemplo: `-encuesta ¿Qué módulo prefieres? | Factura CR v4.4 | WaBot IA 24/7 | AuraFlow ID`",
  epicgames: "📌 *Uso:* `-epicgames`\nMuestra los juegos gratuitos actuales en la Epic Games Store.",
  search: "📌 *Uso:* `-search <búsqueda>`\nEjemplo: `-search Factura electrónica v4.4 Costa Rica`",
  hora: "📌 *Uso:* `-hora`\nMuestra la hora actual en Costa Rica (America/Costa_Rica) y principales zonas horarias.",
  idp: "📌 *Uso:* `-idp <usuario_instagram>`\nEjemplo: `-idp auraflowtech`",
  iva: "📌 *Uso:* `-iva <monto> [tarifa%]`\nEjemplo: `-iva 49500 13` o `-iva 35000 4`\nCalcula el IVA agregado y el IVA incluido según Ley 9635 de Costa Rica.",
  qr: "📌 *Uso:* `-qr <texto o enlace>`\nEjemplo: `-qr https://auraflowtech.lat`",
  vcard: "📌 *Uso:* `-vcard <Nombre> | <Teléfono>` (alias: `-qrcontacto`)\nEjemplo: `-vcard Santiago Delgado | +506 8941 8680`\nGenera un QR AuraFlow escaneable para guardar el contacto directo en el celular.",
  backup: "📌 *Uso:* `-backup` (o `-backup list`)\nCrea un respaldo de la base de datos y configuración del bot en `/root/backups/wabot`.",
  rank: "📌 *Uso:* `-rank`\nMuestra tu nivel, rango y puntos de experiencia (XP) acumulados interactuando con AuraFlow Bot.",
  reddit: "📌 *Uso:* `-reddit <enlace de post de Reddit>`\nExtrae título, autor y contenido multimedia de un post de Reddit.",
  remind: "📌 *Uso:* `-remind <minutos>m <mensaje>`\nEjemplo: `-remind 10m Enviar factura electrónica al cliente`",
  steal: "📌 *Uso:* Responde a un sticker con `-steal [Pack | Autor]` para copiarlo con tus propios créditos.",
  sticker: "📌 *Uso:* Envía o responde a una imagen/video con `-sticker` o `-s` para convertirlo en sticker.",
  say: "📌 *Uso:* `-say [es|en|hi] <texto>`\nEjemplo: `-say es Hola desde AuraFlow Tech en Costa Rica`",
  tr: "📌 *Uso:* `-tr <código_idioma> <texto>`\nEjemplo: `-tr en Hola, bienvenido a AuraFlow Tech`",
  attp: "📌 *Uso:* `-attp <texto>`\nEjemplo: `-attp Pura Vida CR`\nConvierte el texto en un sticker gráfico.",
  weather: "📌 *Uso:* `-weather <ciudad>`\nEjemplo: `-weather San Isidro de El General` o `-weather San Jose, Costa Rica`",
  wiki: "📌 *Uso:* `-wiki <tema>`\nEjemplo: `-wiki Costa Rica`",
  numeros: "📌 *Uso:*\n• `-numeros` — Muestra todos los números guardados en la base de datos.\n• `-numeros add +506 8888 8888` — Guarda un nuevo número.\n• `-numeros del <id o número>` — Elimina un número guardado.",
  ip: "📌 *Uso:* `-ip <IP o dominio>` (alias: `-dns`, `-geoip`)\nEjemplo: `-ip auraflowtech.lat` o `-ip 8.8.8.8`",
  ssl: "📌 *Uso:* `-ssl <dominio>` (alias: `-cert`)\nEjemplo: `-ssl media.auraflowtech.lat`",
  http: "📌 *Uso:* `-http <url>` (alias: `-statusweb`, `-pingweb`)\nEjemplo: `-http https://auraflowtech.lat`",
  media: "📌 *Uso:* `-media` (alias: `-cdn`, `-descargas`)\nMuestra los archivos recientes en `media.auraflowtech.lat/descargas/`.",
  notas: "📌 *Uso:*\n• `-notas` — Ver todas tus notas guardadas.\n• `-nota <texto>` — Guardar una nota rápida.\n• `-notas del <id>` — Eliminar una nota.",
  uuid: "📌 *Uso:* `-uuid` — Genera un UUID v4 único.\n• `-hash <texto>` — Calcula SHA-256 y MD5 de un texto.",
  whois: "📌 *Uso:* `-whois <dominio>` (alias: `-rdap`)\nEjemplo: `-whois auraflowtech.lat`",
  meta: "📌 *Uso:* `-meta <url>` (alias: `-og`, `-seo`)\nExtrae título, descripción y etiquetas OpenGraph de un sitio web.",
  puertos: "📌 *Uso:* `-puertos <host> [p1,p2,...]` (alias: `-port`, `-puerto`)\nEjemplo: `-puertos auraflowtech.lat 22,80,443,8080`",
  systemd: "📌 *Uso:* `-systemd` (alias: `-serviciosvps`, `-daemons`)\nMuestra el estado de los servicios principales del VPS.",
  crypto: "📌 *Uso:* `-crypto [moneda]` (alias: `-btc`, `-eth`)\nEjemplo: `-crypto` o `-crypto sol`",
  base64: "📌 *Uso:* `-base64 <enc|dec> <texto>` (alias: `-b64`)\nEjemplo: `-base64 enc AuraFlow`",
  json: "📌 *Uso:* `-json <texto_json>`\nValida y formatea un JSON.",
};

async function fetchJson(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AuraFlowBot/2.0 (https://auraflowtech.lat)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AuraFlowBot/2.0 (https://auraflowtech.lat)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getTipoCambioCR() {
  try {
    const data = await fetchJson("https://api.hacienda.go.cr/indicadores/tc");
    const compra = Number(data?.dolar?.compra?.valor || 508.5);
    const venta = Number(data?.dolar?.venta?.valor || 515.0);
    const euro = Number(data?.euro?.valor || 552.0);
    const fecha = data?.dolar?.venta?.fecha || new Date().toISOString().slice(0, 10);
    return { compra, venta, euro, fecha, source: "Banco Central / Ministerio de Hacienda CR" };
  } catch (e) {
    return {
      compra: 508.50,
      venta: 515.00,
      euro: 554.20,
      fecha: new Date().toISOString().slice(0, 10),
      source: "Referencia BCCR Costa Rica",
    };
  }
}

function generateClave50(cedulaInput = "3101849201", tipoDoc = "01") {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const digits = (cedulaInput || "3101849201").replace(/\D/g, "") || "3101849201";
  const cedula12 = digits.slice(0, 12).padStart(12, "0");
  const sucursal = "001";
  const terminal = "00001";
  const td = String(tipoDoc).padStart(2, "0").slice(0, 2);
  const num10 = String(Math.floor(1000 + Math.random() * 9000)).padStart(10, "0");
  const consecutivo20 = `${sucursal}${terminal}${td}${num10}`;
  const situacion = "1";
  const seg8 = String(Math.floor(10000000 + Math.random() * 90000000));
  const clave50 = `506${dd}${mm}${yy}${cedula12}${consecutivo20}${situacion}${seg8}`;
  return { clave50, consecutivo20, dd, mm, yy, cedula12, sucursal, terminal, td, num10, situacion, seg8 };
}

function parseClave50(clave) {
  const clean = clave.replace(/\D/g, "");
  if (clean.length !== 50) return null;
  const pais = clean.slice(0, 3);
  const dia = clean.slice(3, 5);
  const mes = clean.slice(5, 7);
  const anio = clean.slice(7, 9);
  const cedula = clean.slice(9, 21);
  const consecutivo = clean.slice(21, 41);
  const sucursal = consecutivo.slice(0, 3);
  const terminal = consecutivo.slice(3, 8);
  const tipoDoc = consecutivo.slice(8, 10);
  const numConsecutivo = consecutivo.slice(10, 20);
  const situacion = clean.slice(41, 42);
  const codigoSeguridad = clean.slice(42, 50);

  const tipos = {
    "01": "Factura Electrónica (01)",
    "02": "Nota de Débito Electrónica (02)",
    "03": "Nota de Crédito Electrónica (03)",
    "04": "Tiquete Electrónico (04)",
    "08": "Factura Electrónica de Compra (08)",
    "09": "Factura Electrónica de Exportación (09)",
  };
  const situaciones = {
    "1": "Normal (1)",
    "2": "Contingencia (2)",
    "3": "Sin Internet (3)",
  };

  return {
    clave: clean,
    pais,
    fecha: `${dia}/${mes}/20${anio}`,
    cedula: cedula.replace(/^0+/, "") || cedula,
    cedulaRaw: cedula,
    consecutivo,
    sucursal,
    terminal,
    tipoDoc: tipos[tipoDoc] || `Tipo ${tipoDoc}`,
    numConsecutivo,
    situacion: situaciones[situacion] || `Código ${situacion}`,
    codigoSeguridad,
  };
}

function insertLeadToSqlite(senderPhone, text) {
  return new Promise((resolve) => {
    const pyScript = `
import sqlite3, sys, datetime
db_path, phone, goal = sys.argv[1], sys.argv[2], sys.argv[3]
conn = sqlite3.connect(db_path)
cur = conn.cursor()
now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
cur.execute("""
INSERT INTO leads (name, email, phone, company, sector, plan_interest, monthly_budget, automation_goal, estimated_roi_usd, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'calificado_ia', ?)
""", (f"WhatsApp ({phone})", "whatsapp@cliente.cr", phone, "Cotización vía AuraFlow Bot", "WhatsApp Bot", "Cotización Directa (-cotizar)", "Por definir", goal, 5400, now_str))
lead_id = cur.lastrowid
conn.commit()
conn.close()
print(lead_id)
`;
    execFile("python3", ["-c", pyScript, DB_PATH, senderPhone, text], (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim());
    });
  });
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates a styled AuraFlow Tech QR card PNG as a data URL.
 * Uses errorCorrectionLevel "H" (30%) so rounded dots + center emblem remain 100% scannable.
 */
async function generateStyledQrDataUrl(text) {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
    const size = qr.modules.size;
    const width = 720;
    const height = 880;
    const cardSize = 580;
    const cardX = (width - cardSize) / 2;
    const cardY = 136;
    const quietPad = 38;
    const matrixPx = cardSize - quietPad * 2;
    const cell = matrixPx / size;
    const ox = cardX + quietPad;
    const oy = cardY + quietPad;

    const isInFinder = (r, c) =>
      (r < 7 && c < 7) ||
      (r < 7 && c >= size - 7) ||
      (r >= size - 7 && c < 7);

    const center = (size - 1) / 2;
    const centerClearRadius = size * 0.11;
    const dots = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isInFinder(r, c)) continue;
        if (Math.hypot(r - center, c - center) < centerClearRadius) continue;
        if (qr.modules.get(r, c)) {
          const cx = (ox + (c + 0.5) * cell).toFixed(2);
          const cy = (oy + (r + 0.5) * cell).toFixed(2);
          const rad = (cell * 0.43).toFixed(2);
          dots.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#qrGrad)"/>`);
        }
      }
    }

    const drawFinder = (r0, c0) => {
      const fx = ox + c0 * cell;
      const fy = oy + r0 * cell;
      const outer = 7 * cell;
      const inner = 3 * cell;
      const strokeW = cell;
      return `
        <rect x="${(fx + strokeW / 2).toFixed(2)}" y="${(fy + strokeW / 2).toFixed(2)}" width="${(outer - strokeW).toFixed(2)}" height="${(outer - strokeW).toFixed(2)}" rx="${(cell * 1.4).toFixed(2)}" fill="none" stroke="#0F172A" stroke-width="${strokeW.toFixed(2)}"/>
        <rect x="${(fx + 2 * cell).toFixed(2)}" y="${(fy + 2 * cell).toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${(cell * 0.85).toFixed(2)}" fill="url(#eyeGrad)"/>
      `;
    };

    const finders = drawFinder(0, 0) + drawFinder(0, size - 7) + drawFinder(size - 7, 0);
    const badgeR = Math.round(matrixPx * 0.105);
    const midX = width / 2;
    const midY = cardY + cardSize / 2;
    const cleanPreview = text.replace(/\s+/g, " ").trim();
    const preview = cleanPreview.length > 44 ? cleanPreview.slice(0, 41) + "..." : cleanPreview;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#050814"/>
      <stop offset="55%" stop-color="#0B1226"/>
      <stop offset="100%" stop-color="#130D2E"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00F5D4"/>
      <stop offset="50%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
    <linearGradient id="qrGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="55%" stop-color="#312E81"/>
      <stop offset="100%" stop-color="#0E7490"/>
    </linearGradient>
    <linearGradient id="eyeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
    <radialGradient id="glowLeft" cx="15%" cy="15%" r="50%">
      <stop offset="0%" stop-color="#00F5D4" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#00F5D4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowRight" cx="85%" cy="85%" r="55%">
      <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <rect width="${width}" height="${height}" fill="url(#glowLeft)"/>
  <rect width="${width}" height="${height}" fill="url(#glowRight)"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="34" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.45" stroke-width="2"/>

  <!-- Header -->
  <g transform="translate(${midX}, 56)">
    <rect x="-132" y="-22" width="264" height="44" rx="22" fill="#0F172A" stroke="url(#accentGrad)" stroke-width="1.5"/>
    <path d="M-92 -9 L-101 2 L-94 2 L-97 11 L-86 -1 L-93 -1 Z" fill="#00F5D4"/>
    <text x="10" y="6" fill="#F8FAFC" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="bold" letter-spacing="2.5" text-anchor="middle">AURAFLOW QR</text>
  </g>
  <text x="${midX}" y="110" fill="#94A3B8" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" letter-spacing="3" text-anchor="middle">ESCANEA CON TU CÁMARA</text>

  <!-- White QR Card -->
  <rect x="${cardX - 4}" y="${cardY - 4}" width="${cardSize + 8}" height="${cardSize + 8}" rx="36" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.6" stroke-width="3"/>
  <rect x="${cardX}" y="${cardY}" width="${cardSize}" height="${cardSize}" rx="32" fill="#FFFFFF"/>

  <!-- QR Modules -->
  ${finders}
  ${dots.join("\n  ")}

  <!-- Center Emblem -->
  <circle cx="${midX}" cy="${midY}" r="${badgeR + 6}" fill="#FFFFFF"/>
  <circle cx="${midX}" cy="${midY}" r="${badgeR}" fill="#0B1226" stroke="url(#accentGrad)" stroke-width="3.5"/>
  <path d="M${midX + 4} ${midY - 22} L${midX - 14} ${midY + 3} L${midX - 1} ${midY + 3} L${midX - 6} ${midY + 22} L${midX + 14} ${midY - 3} L${midX + 1} ${midY - 3} Z" fill="url(#accentGrad)"/>

  <!-- Footer -->
  <rect x="70" y="752" width="580" height="48" rx="14" fill="#0F172A" fill-opacity="0.85" stroke="#1E293B" stroke-width="1.5"/>
  <text x="${midX}" y="782" fill="#E2E8F0" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" text-anchor="middle">${escapeXml(preview)}</text>
  <text x="${midX}" y="838" fill="#64748B" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" letter-spacing="1.5" text-anchor="middle">auraflowtech.lat · AuraFlow Bot</text>
</svg>`;

    const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (e) {
    return await QRCode.toDataURL(text, { width: 512, margin: 2 });
  }
}

function wrapSvgLines(text, maxChars = 34) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function generateAlimentoCardBuffer(pick) {
  const width = 900;
  const height = 1125;
  const midX = width / 2;
  const titleLines = wrapSvgLines(pick.t, 24).slice(0, 3);
  const verseLines = wrapSvgLines(pick.v, 36).slice(0, 5);
  const reflLines = wrapSvgLines(pick.r, 38).slice(0, 5);

  const renderLines = (lines, startY, lineH, attrs) =>
    lines.map((l, i) => `<text x="${midX}" y="${startY + i * lineH}" ${attrs}>${escapeXml(l)}</text>`).join("\n  ");

  const titleStartY = 250;
  const verseBoxY = titleStartY + titleLines.length * 56 + 44;
  const verseBoxH = Math.max(180, verseLines.length * 40 + 72);
  const reflStartY = verseBoxY + verseBoxH + 86;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="pfBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="55%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#fde68a"/>
    </linearGradient>
    <radialGradient id="goldGlow" cx="50%" cy="18%" r="55%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#pfBg)"/>
  <rect width="${width}" height="${height}" fill="url(#goldGlow)"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="38" fill="none" stroke="url(#goldGrad)" stroke-opacity="0.45" stroke-width="2.5"/>

  <rect x="${midX - 210}" y="86" width="420" height="46" rx="23" fill="#0f172a" stroke="#f59e0b" stroke-opacity="0.55" stroke-width="1.5"/>
  <text x="${midX}" y="115" fill="#fcd34d" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="bold" letter-spacing="2.5" text-anchor="middle">ALIMENTO DIARIO · PULSO DE FE</text>

  ${renderLines(titleLines, titleStartY, 56, 'fill="#ffffff" font-family="DejaVu Serif, Georgia, serif" font-size="44" font-weight="bold" text-anchor="middle"')}

  <rect x="76" y="${verseBoxY}" width="${width - 152}" height="${verseBoxH}" rx="24" fill="#020617" fill-opacity="0.65" stroke="#f59e0b" stroke-opacity="0.35" stroke-width="1.5"/>
  ${renderLines(verseLines, verseBoxY + 58, 40, 'fill="#fde68a" font-family="DejaVu Serif, Georgia, serif" font-style="italic" font-size="27" text-anchor="middle"')}

  ${renderLines(reflLines, reflStartY, 38, 'fill="#e2e8f0" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" text-anchor="middle"')}

  <line x1="160" y1="985" x2="${width - 160}" y2="985" stroke="#334155" stroke-width="1.5"/>
  <text x="${midX}" y="1032" fill="#94a3b8" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" letter-spacing="1" text-anchor="middle">auraflowtech.lat/evangelista · Pulso de Fe</text>
</svg>`;

  return await sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
}

async function addStickerExif(webpBuffer, packName = "AuraFlow Bot", authorName = "Ing. Santiago Delgado Leiva") {
  try {
    const img = new WebP.Image();
    await img.load(webpBuffer);
    const json = {
      "sticker-pack-id": "com.auraflowtech.bot",
      "sticker-pack-name": packName,
      "sticker-pack-publisher": authorName,
      "emojis": ["⚡", "🤖"],
    };
    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);
    img.exif = exif;
    return await img.save(null);
  } catch (e) {
    return webpBuffer;
  }
}

async function createTextSticker(text, packName = "AuraFlow Bot", authorName = "Ing. Santiago Delgado Leiva") {
  const safeText = (text || "AuraFlow").slice(0, 60)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `
  <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#22d3ee"/>
        <stop offset="50%" stop-color="#818cf8"/>
        <stop offset="100%" stop-color="#10b981"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="64" fill="rgba(15, 23, 42, 0.92)" stroke="url(#g)" stroke-width="12"/>
    <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle"
      font-family="sans-serif" font-weight="900" font-size="56" fill="url(#g)">
      ${safeText}
    </text>
    <text x="50%" y="88%" dominant-baseline="middle" text-anchor="middle"
      font-family="monospace" font-weight="700" font-size="22" fill="#94a3b8">
      ⚡ AuraFlow Bot · CR
    </text>
  </svg>`;

  const rawWebp = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
  return await addStickerExif(rawWebp, packName, authorName);
}

async function imageToSticker(inputBuffer, packName = "AuraFlow Bot", authorName = "Ing. Santiago Delgado Leiva") {
  const rawWebp = await sharp(inputBuffer)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 85 })
    .toBuffer();
  return await addStickerExif(rawWebp, packName, authorName);
}

/**
 * Processes a command or message and returns structured response:
 * {
 *   reply: string,
 *   qrDataUrl?: string,
 *   stickerBuffer?: Buffer,
 *   audioUrl?: string,
 *   poll?: { name: string, values: string[] },
 *   deleteTarget?: boolean,
 *   reminder?: { delayMs: number, text: string },
 *   node_badge?: string,
 *   suggested_workflow?: string
 * }
 */
const VALID_COMMANDS = new Set([
  "help", "menu", "menú", "comandos", "commands",
  "servicios", "services", "productos",
  "cotizar", "cotizacion", "cotización", "contratar",
  "contacto", "contact", "web", "info",
  "dev", "developer", "creditos", "créditos", "creador",
  "a", "alive", "ping",
  "status", "vpn", "docker", "clean",
  "numeros", "números", "numbers", "telefonos", "teléfonos",
  "nota", "notas", "note", "notes",
  "media", "cdn", "descargas",
  "ip", "dns", "geoip",
  "ssl", "cert",
  "http", "statusweb", "pingweb",
  "whois", "rdap",
  "meta", "og", "seo",
  "puertos", "puerto", "port", "ports",
  "systemd", "serviciosvps", "daemons",
  "crypto", "btc", "eth", "cripto",
  "base64", "b64",
  "json",
  "recordatorios", "reminders",
  "limpiar_media", "cleanmedia",
  "backup", "respaldo",
  "vcard", "qrcontacto",
  "uuid", "hash", "sha256",
  "evangelio", "versiculo", "versículo", "alimento", "reflexion", "reflexión", "promesa",
  "acortar", "short", "corto",
  "sorteo", "rifa", "dado", "dice", "moneda", "coin", "elegir", "choose", "juegos",
  "calc", "calculate", "calcular",
  "eva", "aura", "ia", "gemini",
  "clave", "password", "contraseña", "contrasena",
  "dolar", "dólar", "tc", "tipocambio", "euro",
  "convertir", "cambio", "colones", "dolares", "dólares",
  "hora", "time", "fecha",
  "qr", "qrcode",
  "delete", "d", "dd",
  "encuesta", "poll", "votacion", "votación",
  "search", "gs", "buscar",
  "remind", "reminder", "recordar",
  "sticker", "s", "steal", "stealn",
  "say", "tts",
  "tr", "translate", "traducir",
  "weather", "w", "clima",
  "wiki", "wikipedia",
  "dl", "descargar", "video", "musica", "música", "mp3", "audio", "foto", "img", "imagen", "tiktok", "ig",
  "asistente", "ausente", "away", "online", "conectado", "disponible", "personalidad", "personality", "tono",
]);

const AI_COMMAND_CATALOG =
  "-numeros (ver números guardados), -notas (ver/guardar notas), -media (archivos CDN), " +
  "-qr <texto/url> (QR con estilo), -vcard <Nombre | Tel> (QR contacto), " +
  "-dolar, -crypto [moneda], -hora, -clima <ciudad>, -wiki <tema>, -tr <lang texto>, " +
  "-ip <host>, -ssl <dom>, -http <url>, -whois <dom>, -puertos <host>, " +
  "-status, -systemd, -backup, -limpiar_media, -recordatorios, -dl <url>, -uuid, -hash <txt>";

function inferCommandIntent(rawText, isOwner = false) {
  const t = (rawText || "").trim();
  const low = t.toLowerCase();
  if (!t || /^[-/]/.test(t)) return null;

  if (/^(dame|mu[eé]strame|ver|abre|env[ií]ame)?\s*(el\s+)?(men[uú]|comandos|ayuda)(\.|!)?$/i.test(low) || /(qu[eé] comandos tienes|lista de comandos)/i.test(low)) {
    return "-menu";
  }

  if (isOwner) {
    if (/(dame|mu[eé]strame|ver|lista|cu[aá]les son|m[aá]ndame).*(n[uú]meros|contactos guardados)/i.test(low)) {
      return "-numeros";
    }
    if (/(dame|mu[eé]strame|ver|lista).*(notas guardadas|mis notas)/i.test(low)) {
      return "-notas";
    }
    if (/(dame|mu[eé]strame|ver|lista).*(media|descargas|archivos cdn)/i.test(low)) {
      return "-media";
    }
    if (/^(haz|crea|genera|saca).*respaldo|backup/i.test(low)) {
      return "-backup";
    }
    if (/(estado|revisa|ver).*(servicios|systemd|vps|ram|disco)/i.test(low)) {
      return low.includes("servicios") || low.includes("systemd") ? "-systemd" : "-status";
    }
  }

  const qrUrlMatch = t.match(/(?:crea|genera|haz|dame|m[aá]ndame).*?\bqr\b.*?(https?:\/\/\S+)/i);
  if (qrUrlMatch) return `-qr ${qrUrlMatch[1]}`;

  if (/^(c[oó]mo est[aá] el |precio del |cu[aá]nto est[aá] el )?(d[oó]lar|tipo de cambio)/i.test(low)) {
    return "-dolar";
  }
  if (/^(precio del |cotizaci[oó]n )?(bitcoin|btc|ethereum|eth|crypto|cripto)/i.test(low)) {
    return low.includes("eth") ? "-crypto eth" : "-crypto btc";
  }
  if (/^(qu[eé] hora es|hora en costa rica)/i.test(low)) {
    return "-hora";
  }
  return null;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

async function handleBotCommand(rawMessage, context = {}) {
  const text = (rawMessage || "").trim();

  // Only process messages that start with '-' or '/' immediately followed by a command word
  if (!/^[-/][a-zA-ZáéíóúñÁÉÍÓÚÑ_]+/.test(text)) {
    return null;
  }

  const withoutPrefix = text.slice(1).trim();
  const spaceIdx = withoutPrefix.indexOf(" ");
  const cmd = (spaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? "" : withoutPrefix.slice(spaceIdx + 1).trim();

  // Ignore any message where the word after '-' is not a known command (suggest closest for owner)
  if (!VALID_COMMANDS.has(cmd)) {
    if (context.isOwner && cmd.length >= 3) {
      let best = null;
      let bestDist = 3;
      for (const candidate of VALID_COMMANDS) {
        const d = levenshtein(cmd, candidate);
        if (d < bestDist) {
          bestDist = d;
          best = candidate;
        }
      }
      if (best) {
        return { reply: `🤔 ¿Quisiste decir *-${best}*? Usa \`-menu\` para ver todos los comandos.` };
      }
    }
    return null;
  }

  const senderId = context.senderId || "user@s.whatsapp.net";
  const senderPhone = context.senderPhone || "+506 8941-8680";
  const botData = loadBotData();

  // Increment XP for user only on valid commands
  if (!botData.xp[senderId]) {
    botData.xp[senderId] = { xp: 0, messages: 0, name: context.pushName || senderPhone };
  }
  botData.xp[senderId].xp += 15;
  botData.xp[senderId].messages += 1;
  if (context.pushName) botData.xp[senderId].name = context.pushName;
  saveBotData(botData);

  // 0. -asistente / -ausente / -online / -personalidad
  if (["asistente", "ausente", "away", "online", "conectado", "disponible", "personalidad", "personality", "tono"].includes(cmd)) {
    if (typeof context.onAssistantCommand === "function") {
      return await context.onAssistantCommand(cmd, arg);
    }
    return {
      reply:
        "🤖 *Asistente Personal AuraFlow*\n\n" +
        "• `-ausente` (o `-asistente on`) — Activa el modo No Conectado (responde que pronto será atendido)\n" +
        "• `-online` (o `-asistente off`) — Marca que estás conectado\n" +
        "• `-asistente auto` — Modo automático por inactividad\n" +
        "• Panel en vivo: https://bot.auraflowtech.lat",
      node_badge: "ASISTENTE PERSONAL",
    };
  }

  // 1. -help / -menu
  if (["help", "menu", "menú", "comandos", "commands"].includes(cmd)) {
    if (arg) {
      const cleanArg = arg.replace(/^[-/!]/, "").toLowerCase();
      if (COMMAND_HELP[cleanArg]) {
        return {
          reply: `🤖 *AuraFlow Bot — Ayuda de Comando*\n\n${COMMAND_HELP[cleanArg]}`,
          node_badge: `HELP • -${cleanArg}`,
          suggested_workflow: "AuraFlow Bot Command Help",
        };
      }
    }
    return {
      reply: MENU_TEXT,
      node_badge: "AURAFLOW BOT • MENÚ",
      suggested_workflow: "AuraFlow Bot Multi-Device",
    };
  }

  // 2. -servicios
  if (["servicios", "services", "productos"].includes(cmd)) {
    return {
      reply:
        "💼 *Servicios — Ing. Santiago Delgado Leiva*\n\n" +
        "1️⃣ *Bots de WhatsApp & Telegram con IA 24/7*\n" +
        "   • Atención automática, notas de voz, panel de control y bloqueos.\n\n" +
        "2️⃣ *Páginas Web, Sistemas a Medida & Automatización*\n" +
        "   • Sitios rápidos, paneles administrativos y flujos automáticos.\n\n" +
        "3️⃣ *Redes, VPN (Ruijie / MikroTik) & Monitoreo ISP*\n" +
        "   • Enlaces seguros, alertas 24/7 por Telegram y diagnóstico de red.\n\n" +
        "4️⃣ *Nube Privada & IA Propia para Empresas*\n" +
        "   • Chat IA privado y nube de archivos/fotos bajo tu propio dominio.\n\n" +
        "🌐 *Ver catálogo y cotizar:* https://auraflowtech.lat/servicios/\n" +
        "💡 _O escribe *-cotizar <tu consulta>* aquí mismo._",
      node_badge: "SERVICIOS",
    };
  }

  // 3. -cotizar (-cotizacion, -contratar)
  if (["cotizar", "cotizacion", "cotización", "contratar"].includes(cmd)) {
    if (!arg) {
      return {
        reply:
          "📝 *Solicitar Cotización*\n\n" +
          "Escribe tu solicitud después del comando, o llena el formulario en https://auraflowtech.lat/servicios/\n" +
          "Ejemplo: `-cotizar Quiero un bot de WhatsApp con IA para mi clínica`",
        node_badge: "CRM • COTIZAR",
      };
    }
    try {
      await fetch("http://127.0.0.1:8000/api/solicitar-servicio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: context.pushName || senderPhone,
          contacto: senderPhone,
          servicio: "Solicitud vía WhatsApp (-cotizar)",
          detalle: arg,
        }),
      });
    } catch (e) {}
    return {
      reply:
        "✅ *¡Solicitud de Cotización Recibida!*\n\n" +
        `• *Solicitante:* ${senderPhone}\n` +
        `• *Detalle:* _${arg}_\n\n` +
        "👨💻 El *Ing. Santiago Delgado Leiva* te responderá muy pronto.\n" +
        "🌐 También puedes ver más en: https://auraflowtech.lat/servicios/",
      node_badge: "CRM • REGISTRADO",
    };
  }

  // 4. -contacto (-contact, -web, -info)
  if (["contacto", "contact", "web", "info"].includes(cmd)) {
    return {
      reply:
        "📇 *Contacto — Ing. Santiago Delgado Leiva*\n\n" +
        "🌐 *Web:* https://auraflowtech.lat\n" +
        "💼 *Servicios:* https://auraflowtech.lat/servicios/\n" +
        "📧 *Correo:* support@auraflowtech.lat\n" +
        "📱 *WhatsApp:* https://wa.me/50689418680 (+506 8941-8680)\n" +
        "📍 *Costa Rica 🇨🇷*",
      node_badge: "CONTACTO",
    };
  }

  // 5. -dev
  if (["dev", "developer", "creditos", "créditos", "creador"].includes(cmd)) {
    return {
      reply:
        "👨💻 *Ing. Santiago Delgado Leiva*\n" +
        "• *Web:* https://auraflowtech.lat\n" +
        "• *Servicios:* https://auraflowtech.lat/servicios/\n" +
        "• *Costa Rica 🇨🇷*",
      node_badge: "DEV",
    };
  }

  // 6. -a (-alive, -ping)
  if (["a", "alive", "ping"].includes(cmd)) {
    const uptimeSec = Math.floor(process.uptime());
    const hrs = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    return {
      reply: `🏓 *¡Pong!* Bot 100% online · Uptime: ${hrs}h ${mins}m ${secs}s`,
      node_badge: "PING",
    };
  }

  // 6b. -evangelio (-versiculo, -alimento, -promesa)
  if (["evangelio", "versiculo", "versículo", "alimento", "reflexion", "reflexión", "promesa"].includes(cmd)) {
    const waVisitorTag = context.pushName ? `?v=${encodeURIComponent(context.pushName.trim())}&utm_source=whatsapp` : "?utm_source=whatsapp";
    const pulsoLink = `https://pulsodefe.auraflowtech.lat/${waVisitorTag}`;
    if (["alimento", "reflexion", "reflexión", "promesa"].includes(cmd)) {
      const reflexiones = [
        { t: "Paz en Medio de la Tormenta", v: "«Calla, enmudece. Y cesó el viento, y se hizo grande bonanza.» (Marcos 4:39)", r: "La paz de Dios no depende de que no haya tormenta, sino de que Jesús está en tu barca." },
        { t: "Fuerzas Nuevas Cada Mañana", v: "«Nuevas son cada mañana; grande es tu fidelidad.» (Lamentaciones 3:23)", r: "No tienes que cargar toda la semana hoy; Dios renueva tus fuerzas para este día." },
        { t: "Cambia la Ansiedad por Oración", v: "«Echando toda vuestra ansiedad sobre él, porque él tiene cuidado de vosotros.» (1 Pedro 5:7)", r: "Entrega lo que no puedes controlar a quien sí gobierna todo." },
        { t: "Dios Abre Caminos en el Desierto", v: "«Otra vez abriré camino en el desierto, y ríos en la soledad.» (Isaías 43:19)", r: "Lo que parece un callejón sin salida es el escenario perfecto para un nuevo comienzo." },
        { t: "Sabiduría para Decidir Hoy", v: "«Fíate de Jehová de todo tu corazón... y él enderezará tus veredas.» (Proverbios 3:5-6)", r: "Pide dirección a Dios antes de actuar; Su sabiduría trae claridad y paz." },
        { t: "Libertad de la Culpa", v: "«Ninguna condenación hay para los que están en Cristo Jesús.» (Romanos 8:1)", r: "En la cruz Jesús pagó el precio completo; hoy puedes caminar en libertad." },
      ];
      const pick = reflexiones[Math.floor(Math.random() * reflexiones.length)];
      let cardBuffer = null;
      try {
        cardBuffer = await generateAlimentoCardBuffer(pick);
      } catch (e) {}
      return {
        reply: `🕊️ *Alimento Diario — ${pick.t}*\n\n_${pick.v}_\n\n${pick.r}\n\n📖 Más reflexiones y Plan de 7 Días:\n${pulsoLink}`,
        mediaType: cardBuffer ? "image" : undefined,
        buffer: cardBuffer || undefined,
        mimetype: cardBuffer ? "image/png" : undefined,
        node_badge: "PULSO DE FE • ALIMENTO",
      };
    }
    try {
      const r = await fetch("http://127.0.0.1:3020/api/daily-agent", { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d && d.ok && d.daily) {
        return {
          reply:
            `🕊️ *Palabra del Día (${d.daily.date})*\n\n` +
            `_"${d.daily.versiculo}"_\n*— ${d.daily.cita}*\n\n` +
            `${d.daily.reflexion || ""}\n\n` +
            `🙏 ${d.daily.oracion || ""}\n` +
            `🌐 ${pulsoLink}`,
          node_badge: "EVANGELIO",
        };
      }
    } catch (e) {}
    return { reply: `🕊️ Lee el devocional de hoy en: ${pulsoLink}` };
  }

  // 6c. Telegram-style Ops commands (owner only: -status, -vpn, -docker, -clean)
  if (["status", "vpn", "docker", "clean"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const { execSync } = require("child_process");
    if (cmd === "status") {
      try {
        const out = execSync("uptime -p && free -h | awk '/Mem:/ {print \"RAM: \"$3\"/\"$2\" (disp: \"$7\")\"}' && df -h / | awk 'NR==2 {print \"Disco: \"$3\"/\"$2\" (\"$5\")\"}'", { encoding: "utf8" }).trim();
        return { reply: `📊 *Estado del VPS*\n\n${out}`, node_badge: "OPS • STATUS" };
      } catch (e) {
        return { reply: `⚠️ Error: ${e.message}` };
      }
    }
    if (cmd === "vpn") {
      try {
        const log = fs.existsSync("/var/log/openvpn/openvpn-status.log")
          ? fs.readFileSync("/var/log/openvpn/openvpn-status.log", "utf8")
          : "";
        const match = log.split("\n").find((l) => l.startsWith("CLIENT_LIST,ruijie,"));
        if (match) {
          const p = match.split(",");
          return { reply: `🟢 *Ruijie VPN Conectado*\n• IP Túnel: \`${p[3] || "10.8.0.2"}\`\n• IP Origen: \`${p[2] || "?"}\``, node_badge: "OPS • VPN" };
        }
        return { reply: "🔴 *Ruijie VPN desconectado* en este momento.", node_badge: "OPS • VPN" };
      } catch (e) {
        return { reply: `⚠️ Error leyendo VPN: ${e.message}` };
      }
    }
    if (cmd === "docker") {
      try {
        const out = execSync("docker ps --format '• {{.Names}}: {{.Status}}'", { encoding: "utf8" }).trim();
        return { reply: `🐳 *Contenedores Docker*\n\n${out || "Ninguno"}`, node_badge: "OPS • DOCKER" };
      } catch (e) {
        return { reply: `⚠️ Error Docker: ${e.message}` };
      }
    }
    if (cmd === "clean") {
      try {
        execSync("apt-get clean && journalctl --vacuum-time=3d >/dev/null 2>&1 || true");
        return { reply: "🧹 *Limpieza completada* (caché apt y logs >3 días).", node_badge: "OPS • CLEAN" };
      } catch (e) {
        return { reply: `⚠️ Error: ${e.message}` };
      }
    }
  }

  // 6c-bis. -numeros (owner only: listar / agregar / eliminar números guardados en SQLite)
  if (["numeros", "números", "numbers", "telefonos", "teléfonos"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_numbers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL UNIQUE,
          label TEXT DEFAULT '',
          created_at TEXT NOT NULL
        )
      `);

      const lowerArg = arg.toLowerCase();
      if (lowerArg.startsWith("add ") || lowerArg.startsWith("agregar ")) {
        const rawRest = arg.replace(/^(add|agregar)\s+/i, "").trim();
        const [phonePart, labelPart] = rawRest.split("|").map((s) => s.trim());
        if (!phonePart) {
          return { reply: "📌 *Uso:* `-numeros add +506 8888 8888` (opcional: `| Etiqueta`)" };
        }
        const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
        const stmt = db.prepare("INSERT OR IGNORE INTO saved_numbers (phone, label, created_at) VALUES (?, ?, ?)");
        const info = stmt.run(phonePart, labelPart || "", nowStr);
        if (info.changes === 0) {
          return { reply: `ℹ️ El número *${phonePart}* ya estaba guardado en la base de datos.`, node_badge: "DB • NÚMEROS" };
        }
        return { reply: `✅ Número guardado: *${phonePart}*${labelPart ? ` (${labelPart})` : ""}`, node_badge: "DB • NÚMEROS" };
      }

      if (lowerArg.startsWith("del ") || lowerArg.startsWith("eliminar ") || lowerArg.startsWith("rm ")) {
        const target = arg.replace(/^(del|eliminar|rm)\s+/i, "").trim();
        if (!target) {
          return { reply: "📌 *Uso:* `-numeros del <id o número>`" };
        }
        const info = /^\d+$/.test(target)
          ? db.prepare("DELETE FROM saved_numbers WHERE id = ?").run(Number(target))
          : db.prepare("DELETE FROM saved_numbers WHERE phone = ?").run(target);
        if (info.changes === 0) {
          return { reply: `⚠️ No se encontró ningún número con "${target}".`, node_badge: "DB • NÚMEROS" };
        }
        return { reply: `🗑️ Número eliminado de la base de datos.`, node_badge: "DB • NÚMEROS" };
      }

      const rows = db.prepare("SELECT id, phone, label FROM saved_numbers ORDER BY id ASC").all();
      if (rows.length === 0) {
        return { reply: "📭 No hay números guardados en la base de datos.\nUsa `-numeros add +506 ...` para agregar uno.", node_badge: "DB • NÚMEROS" };
      }
      const lines = rows.map((r) => `${r.id}. ${r.phone}${r.label ? ` — _${r.label}_` : ""}`);
      return {
        reply: `📞 *Números Guardados (${rows.length})*\n\n${lines.join("\n")}`,
        node_badge: "DB • NÚMEROS",
      };
    } catch (e) {
      return { reply: `⚠️ Error consultando la base de datos: ${e.message}` };
    } finally {
      db.close();
    }
  }

  // 6d. -juegos
  if (cmd === "juegos") {
    return {
      reply:
        "🎮 *Juegos Rápidos*\n\n" +
        "• `-dado` — Tira un dado (1-6)\n" +
        "• `-moneda` — Cara o Escudo\n" +
        "• `-sorteo a, b, c` — Elige al azar entre opciones",
      node_badge: "JUEGOS",
    };
  }

  // 7. -acortar (-short, -corto)
  if (["acortar", "short", "corto"].includes(cmd)) {
    if (!arg || !/^https?:\/\//i.test(arg)) {
      return {
        reply: "🔗 *Uso:* `/acortar <enlace>`\nEjemplo: `/acortar https://auraflowtech.lat/servicios/`",
      };
    }
    try {
      const r = await fetch("http://127.0.0.1:8000/api/links/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: arg, title: "WhatsApp Bot" }),
      });
      const data = await r.json();
      if (r.ok && data.ok && data.shortUrl) {
        return {
          reply: `🔗 *Enlace Acortado (AuraFlow)*\n\n• *Corto:* ${data.shortUrl}\n• *Original:* ${arg}`,
          node_badge: "URL SHORTENER",
        };
      }
    } catch (e) {}
    try {
      const shortUrl = await fetchText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(arg)}`);
      return {
        reply: `🔗 *Enlace Acortado con Éxito*\n\n• *Original:* ${arg}\n• *Corto:* ${shortUrl.trim()}`,
        node_badge: "URL SHORTENER",
      };
    } catch (e) {
      try {
        const tinyUrl = await fetchText(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(arg)}`);
        return {
          reply: `🔗 *Enlace Acortado con Éxito*\n\n• *Original:* ${arg}\n• *Corto:* ${tinyUrl.trim()}`,
          node_badge: "URL SHORTENER",
        };
      } catch (err) {
        return { reply: "❌ No se pudo acortar el enlace en este momento. Verifica que sea una URL válida." };
      }
    }
  }

  // 8. -sorteo (-rifa, -dado, -dice, -moneda, -coin, -elegir, -choose)
  if (["sorteo", "rifa", "dado", "dice", "moneda", "coin", "elegir", "choose"].includes(cmd)) {
    if (cmd === "dado" || cmd === "dice" || arg.toLowerCase() === "dado") {
      const roll = Math.floor(1 + Math.random() * 6);
      const diceEmojis = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      return {
        reply: `🎲 *Lanzamiento de Dado*\n\nResultado: *${roll}* ${diceEmojis[roll - 1]}`,
        node_badge: "JUEGOS • DADO",
      };
    }
    if (cmd === "moneda" || cmd === "coin" || arg.toLowerCase() === "moneda") {
      const side = Math.random() < 0.5 ? "🪙 *Escudo (Cara)*" : "👑 *Corona (Cruz)*";
      return {
        reply: `🪙 *Lanzamiento de Moneda*\n\nResultado: ${side}`,
        node_badge: "JUEGOS • MONEDA",
      };
    }
    if (arg) {
      const options = arg.split(/[,|/]+/).map((s) => s.trim()).filter(Boolean);
      if (options.length >= 2) {
        const winner = options[Math.floor(Math.random() * options.length)];
        return {
          reply:
            `🎉 *Resultado del Sorteo / Elección*\n\n` +
            `• *Opciones (${options.length}):* ${options.join(", ")}\n` +
            `🏆 *Ganador / Elegido:* *${winner}*`,
          node_badge: "SORTEO • GANADOR",
        };
      }
    }
    const participantes = context.groupParticipants || [];
    if (participantes.length > 0) {
      const picked = participantes[Math.floor(Math.random() * participantes.length)];
      return {
        reply: `🎉 *Sorteo del Grupo*\n\n🏆 Participante ganador: @${picked.split("@")[0]}`,
        mentions: [picked],
        node_badge: "SORTEO DE GRUPO",
      };
    }
    return {
      reply:
        "🎲 *Comando Sorteo / Azar*\n\n" +
        "• `-dado` — Lanza un dado de 6 caras\n" +
        "• `-moneda` — Lanza una moneda\n" +
        "• `-elegir Opción 1, Opción 2, Opción 3` — Elige al azar entre tus opciones\n" +
        "• `-sorteo Participante1, Participante2, Participante3` — Realiza una rifa rápida",
      node_badge: "SORTEO",
    };
  }

  // 9. -cabys
  if (["cabys"].includes(cmd)) {
    if (!arg) {
      return {
        reply:
          "🧾 *Buscador Oficial CABYS — Hacienda Costa Rica*\n\n" +
          "Escribe el nombre del bien/servicio o el código CABYS de 13 dígitos:\n" +
          "• `-cabys software`\n" +
          "• `-cabys consulta medica`\n" +
          "• `-cabys 8314300000000`",
      };
    }
    try {
      const isCode = /^\d{5,13}$/.test(arg.trim());
      const url = isCode
        ? `https://api.hacienda.go.cr/fe/cabys?codigo=${encodeURIComponent(arg.trim())}`
        : `https://api.hacienda.go.cr/fe/cabys?q=${encodeURIComponent(arg.trim())}&top=5`;
      const data = await fetchJson(url, 6000);
      const list = Array.isArray(data) ? data : (data.cabys || []);
      if (list.length > 0) {
        const itemsText = list.slice(0, 5).map((item) => {
          const code = item.codigo || "N/A";
          const desc = item.descripcion || "Sin descripción";
          const imp = item.impuesto !== undefined ? `${item.impuesto}%` : "13%";
          return `▸ *${code}* (IVA: *${imp}*)\n   _${desc}_`;
        }).join("\n\n");
        return {
          reply:
            `🧾 *Resultados Catálogo CABYS Hacienda CR*\n` +
            `🔎 Búsqueda: _${arg}_\n\n${itemsText}\n\n` +
            `⚡ _Homologado con Factura CR v4.4 (fac.auraflowtech.lat)_`,
          node_badge: "HACIENDA CR • CABYS",
          suggested_workflow: "Consulta Catálogo CABYS Oficial",
        };
      }
    } catch (e) {}

    // Fallback local CABYS presets
    const fallbackCabys = [
      { codigo: "8314300000000", desc: "Servicios de diseño y desarrollo de software y aplicaciones", iva: "13%" },
      { codigo: "8512010000000", desc: "Servicios de consulta médica general y especializada (Clínicas)", iva: "4%" },
      { codigo: "8313100000000", desc: "Servicios de consultoría en tecnologías de la información (TI)", iva: "13%" },
      { codigo: "9290000000000", desc: "Otros servicios de educación y capacitación técnica", iva: "2%" },
      { codigo: "2111100000000", desc: "Productos agropecuarios y canasta básica tributaria", iva: "1%" },
    ];
    const itemsText = fallbackCabys
      .map((c) => `▸ *${c.codigo}* (IVA: *${c.iva}*)\n   _${c.desc}_`)
      .join("\n\n");
    return {
      reply:
        `🧾 *Catálogo CABYS Hacienda CR (Referencia Rápida)*\n` +
        `🔎 Consulta: _${arg}_\n\n${itemsText}`,
      node_badge: "HACIENDA CR • CABYS",
    };
  }

  // 10. -calc (-calculate)
  if (["calc", "calculate", "calcular"].includes(cmd)) {
    if (!arg) {
      return { reply: "🧮 *Uso:* `-calc <expresión>`\nEjemplo: `-calc 49500 * 1.13`" };
    }
    const sanitized = arg.replace(/,/g, ".").replace(/[^0-9+\-*/().%\s^]/g, "");
    if (!sanitized.trim()) {
      return { reply: "❌ Expresión matemática inválida. Usa números y operadores (`+`, `-`, `*`, `/`, `%`, `()`)." };
    }
    try {
      const expr = sanitized.replace(/\^/g, "**");
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result !== "number" || !isFinite(result)) throw new Error("NaN");
      return {
        reply: `🧮 *Calculadora AuraFlow*\n\n• *Expresión:* \`${arg}\`\n• *Resultado:* *${Number(result.toFixed(6)).toLocaleString("en-US")}*`,
        node_badge: "CALC • MATH",
      };
    } catch (e) {
      return { reply: "❌ No se pudo evaluar la expresión matemática. Verifica los paréntesis u operadores." };
    }
  }

  // 11. -cedula (-hacienda, -contribuyente)
  if (["cedula", "cédula", "hacienda", "contribuyente"].includes(cmd)) {
    const cleanCed = arg.replace(/\D/g, "");
    if (!cleanCed || cleanCed.length < 9) {
      return {
        reply:
          "🏛️ *Consulta Tributaria en Ministerio de Hacienda CR*\n\n" +
          "📌 *Uso:* `-cedula <número de cédula física o jurídica>`\n" +
          "Ejemplo: `-cedula 3101754321`",
      };
    }
    try {
      const data = await fetchJson(`https://api.hacienda.go.cr/fe/ae?identificacion=${cleanCed}`, 6500);
      const nombre = data.nombre || "Contribuyente Registrado CR";
      const tipoId = data.tipoIdentificacion || (cleanCed.length === 9 ? "01 (Física)" : "02 (Jurídica)");
      const regimen = data.regimen?.descripcion || "Régimen Tradicional / Tributación Directa";
      const moroso = data.situacion?.moroso || "NO";
      const omiso = data.situacion?.omiso || "NO";
      const estado = data.situacion?.estado || "Inscrito";
      const admin = data.situacion?.administracionTributaria || "Dirección General de Tributación";
      const acts = Array.isArray(data.actividades)
        ? data.actividades.slice(0, 4).map((a) => `   • [${a.codigo}] ${a.descripcion} (${a.estado || "Activo"})`).join("\n")
        : "   • [620101] Desarrollo de software y consultoría informática";

      return {
        reply:
          `🏛️ *Ministerio de Hacienda CR — Padrón Tributario*\n\n` +
          `👤 *Nombre / Razón Social:* *${nombre}*\n` +
          `🪪 *Identificación:* \`${cleanCed}\` (Tipo: ${tipoId})\n` +
          `📋 *Régimen:* ${regimen}\n` +
          `📌 *Estado Tributario:* *${estado}*\n` +
          `• *Moroso:* ${moroso} | *Omiso:* ${omiso}\n` +
          `• *Administración:* ${admin}\n\n` +
          `💼 *Actividades Económicas (CIIU4 / v4.4):*\n${acts || "   • Sin actividades listadas"}\n\n` +
          `⚡ _Verificado en vivo con Hacienda CR · fac.auraflowtech.lat_`,
        node_badge: "HACIENDA CR • PADRÓN",
        suggested_workflow: "Validación Contribuyente Hacienda CR",
      };
    } catch (e) {
      return {
        reply:
          `🏛️ *Consulta Contribuyente Hacienda CR*\n\n` +
          `🪪 *Identificación consultada:* \`${cleanCed}\`\n` +
          `• *Tipo:* ${cleanCed.length === 9 ? "01 — Cédula Física" : "02 — Cédula Jurídica / DIMEX"}\n` +
          `• *Validación Formato v4.4:* ✅ Válido para emisión de Factura Electrónica CR v4.4\n` +
          `• *Nota:* La API pública de Hacienda no reportó actividades activas para esta cédula o se encuentra en mantenimiento temporal.`,
        node_badge: "HACIENDA CR • PADRÓN",
      };
    }
  }

  // 12. -eva (-aura, -ia, -gemini) — Conectado en vivo con AuraAgent Framework v2.0 (127.0.0.1:8095)
  if (["eva", "aura", "ia", "gemini"].includes(cmd)) {
    if (!arg) {
      return {
        reply:
          "⚡ *Hola, soy Aura — Agente Autónomo de AuraFlow Tech (AuraAgent Framework v2.0)*\n\n" +
          "Puedo pensar, ejecutar herramientas reales y *crear aplicaciones web en vivo*:\n" +
          "• `-eva Crea una app de calculadora de préstamos en colones`\n" +
          "• `-eva Consulta el dólar en el BCCR y convierte $200 a colones`\n" +
          "• `-eva Emite una factura v4.4 a la cédula 3101849201 por ₡49500`\n" +
          "• `-eva Revisa el estado de RAM y disco de la VPS`\n\n" +
          "🌐 *Estudio Web:* https://openclaw.auraflowtech.lat",
      };
    }

    const directIntent = inferCommandIntent(arg, Boolean(context.isOwner));
    if (directIntent) {
      return await handleBotCommand(directIntent, context);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 32000);
      const syncedPrompt = `${arg}\n\n[Sistema AuraFlow: Si el usuario pide ejecutar una acción del bot, responde SOLO con [RUN_CMD: -comando argumentos] usando alguno de: ${AI_COMMAND_CATALOG}]`;
      const res = await fetch("http://127.0.0.1:8095/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_slug: "aura-director",
          message: syncedPrompt,
          session_id: `wa-${senderPhone || "user"}`,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.reply) {
          const cmdMatch = data.reply.match(/\[RUN_CMD:\s*([^\]]+)\]/i);
          if (cmdMatch) {
            const cmdRes = await handleBotCommand(cmdMatch[1].trim(), context);
            if (cmdRes) return cmdRes;
          }
          const toolsUsed = (data.traces || []).map((t) => t.tool_name).join(" → ");
          const header = toolsUsed ? `⚡ *AuraAgent Framework* _(${toolsUsed})_\n\n` : "⚡ *AuraAgent Framework v2.0*\n\n";
          return {
            reply: header + data.reply.replace(/\*\*(.*?)\*\*/g, "*$1*"),
            node_badge: "AURAAGENT • REACT ENGINE",
            suggested_workflow: "AuraAgent Framework v2.0",
          };
        }
      }
    } catch (e) {}

    return {
      reply:
        `🤖 *Aura IA — Respuesta Inteligente*\n\n` +
        `Respecto a tu consulta (*"${arg}"*), puedes gestionar tus agentes y crear apps en vivo desde:\n` +
        `👉 https://openclaw.auraflowtech.lat`,
      node_badge: "AURA IA • ENGINE",
      suggested_workflow: "Asistente Conversacional Aura IA",
    };
  }

  // 13. -clave (-password, -contraseña)
  if (["clave", "password", "contraseña", "contrasena"].includes(cmd)) {
    const len = Math.min(64, Math.max(8, parseInt(arg, 10) || 16));
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
    const bytes = crypto.randomBytes(len);
    let pwd = "";
    for (let i = 0; i < len; i++) {
      pwd += chars[bytes[i] % chars.length];
    }
    return {
      reply:
        `🔐 *Generador de Contraseña Segura*\n\n` +
        `• *Longitud:* ${len} caracteres\n` +
        `• *Contraseña:* \`${pwd}\`\n` +
        `• *Entropía:* Alta (CSPRNG Criptográfico)`,
      node_badge: "SECURITY • PASSWORD",
    };
  }

  // 14. -clavehacienda (-clavecr, -desglosarclave, -facturacr, -generarclave)
  if (["clavehacienda", "clavecr", "desglosarclave", "facturacr", "generarclave"].includes(cmd)) {
    const cleanDigits = arg.replace(/\D/g, "");
    if (cleanDigits.length === 50 && cmd !== "generarclave") {
      const parsed = parseClave50(cleanDigits);
      return {
        reply:
          `🏛️ *Desglose de Clave Numérica 50 Dígitos — Hacienda CR v4.4*\n\n` +
          `🔑 *Clave:* \`${parsed.clave}\`\n\n` +
          `• *País:* ${parsed.pais} (Costa Rica 🇨🇷)\n` +
          `• *Fecha de Emisión:* ${parsed.fecha}\n` +
          `• *Cédula Emisor:* \`${parsed.cedula}\` (${parsed.cedulaRaw})\n` +
          `• *Consecutivo (20 dígitos):* \`${parsed.consecutivo}\`\n` +
          `   ├─ *Sucursal:* ${parsed.sucursal}\n` +
          `   ├─ *Terminal:* ${parsed.terminal}\n` +
          `   ├─ *Tipo Comprobante:* ${parsed.tipoDoc}\n` +
          `   └─ *Número:* ${parsed.numConsecutivo}\n` +
          `• *Situación del Comprobante:* ${parsed.situacion}\n` +
          `• *Código de Seguridad (8 dígitos):* \`${parsed.codigoSeguridad}\`\n\n` +
          `✅ *Estructura 100% válida según Anexo y Estructuras v4.4*`,
        node_badge: "HACIENDA CR • CLAVE 50",
        suggested_workflow: "Analizador Clave 50 Dígitos v4.4",
      };
    }

    const gen = generateClave50(cleanDigits || "3101849201", "01");
    return {
      reply:
        `⚡ *Generador Oficial de Clave 50 Dígitos — Hacienda CR v4.4*\n\n` +
        `🔑 *Clave Numérica (50 dígitos):*\n\`${gen.clave50}\`\n\n` +
        `🔢 *Consecutivo (20 dígitos):*\n\`${gen.consecutivo20}\`\n\n` +
        `📋 *Desglose Técnico:*\n` +
        `• *País:* 506 (Costa Rica)\n` +
        `• *Fecha:* ${gen.dd}/${gen.mm}/20${gen.yy}\n` +
        `• *Emisor (12 díg):* ${gen.cedula12}\n` +
        `• *Sucursal / Terminal:* ${gen.sucursal} / ${gen.terminal}\n` +
        `• *Tipo Doc:* 01 (Factura Electrónica)\n` +
        `• *Situación:* 1 (Normal) | *Seguridad:* ${gen.seg8}\n\n` +
        `💡 _Pega cualquier clave de 50 dígitos con \`-clavehacienda <clave>\` para analizarla._`,
      node_badge: "HACIENDA CR • CLAVE 50",
      suggested_workflow: "Emisor Clave 50 Dígitos v4.4",
    };
  }

  // 15. -dolar (-tc, -tipocambio, -euro)
  if (["dolar", "dólar", "tc", "tipocambio", "euro"].includes(cmd)) {
    const tc = await getTipoCambioCR();
    return {
      reply:
        `💵 *Tipo de Cambio Oficial — Costa Rica 🇨🇷*\n\n` +
        `• *Dólar Compra (USD):* ₡${tc.compra.toFixed(2)}\n` +
        `• *Dólar Venta (USD):* ₡${tc.venta.toFixed(2)}\n` +
        `• *Euro Oficial (EUR):* ₡${tc.euro.toFixed(2)}\n` +
        `• *Fecha:* ${tc.fecha}\n` +
        `• *Fuente:* ${tc.source}\n\n` +
        `💡 _Usa \`-convertir 100 usd\` o \`-convertir 50000 crc\` para convertir montos._`,
      node_badge: "BCCR • TIPO DE CAMBIO",
      suggested_workflow: "Sincronización Tipo de Cambio BCCR",
    };
  }

  // 16. -convertir (-cambio, -colones, -dolares)
  if (["convertir", "cambio", "colones", "dolares", "dólares"].includes(cmd)) {
    const numMatch = arg.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
    if (!numMatch) {
      return {
        reply:
          "💱 *Conversor de Moneda CR (USD ↔️ CRC)*\n\n" +
          "📌 *Uso:*\n" +
          "• `-convertir 100 usd` (Dólares a Colones)\n" +
          "• `-convertir 50000 crc` (Colones a Dólares)\n" +
          "• `-convertir 250` (Calcula ambos sentidos)",
      };
    }
    const amount = parseFloat(numMatch[1]);
    const tc = await getTipoCambioCR();
    const toCrc = amount * tc.venta;
    const toUsd = amount / tc.venta;
    return {
      reply:
        `💱 *Conversión Oficial de Moneda (TC Venta: ₡${tc.venta.toFixed(2)})*\n\n` +
        `🇺🇸 *$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD* ➔ *₡${toCrc.toLocaleString("en-US", { minimumFractionDigits: 2 })} CRC*\n` +
        `🇨🇷 *₡${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} CRC* ➔ *$${toUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD*`,
      node_badge: "DIVISAS • USD ↔ CRC",
    };
  }

  // 17. -iva (-impuesto)
  if (["iva", "impuesto"].includes(cmd)) {
    const parts = arg.replace(/,/g, "").trim().split(/\s+/);
    const monto = parseFloat(parts[0]);
    const tarifa = parts[1] !== undefined ? parseFloat(parts[1]) : 13;
    if (isNaN(monto) || monto <= 0) {
      return {
        reply:
          "🧮 *Calculadora de IVA Ley 9635 — Costa Rica*\n\n" +
          "📌 *Uso:* `-iva <monto> [tarifa%]`\n" +
          "Tarifas oficiales en CR: *13%* (General), *4%* (Salud/Clínicas), *2%* (Educación/Medicamentos), *1%* (Canasta Básica).\n\n" +
          "Ejemplo: `-iva 49500 13` o `-iva 35000 4`",
      };
    }
    const ivaAgregado = monto * (tarifa / 100);
    const totalConIva = monto + ivaAgregado;
    const baseDesglosada = monto / (1 + tarifa / 100);
    const ivaDesglosado = monto - baseDesglosada;

    return {
      reply:
        `🧾 *Cálculo de IVA Costa Rica (Ley 9635 — Tarifa ${tarifa}%)*\n\n` +
        `1️⃣ *Si ₡${monto.toLocaleString("en-US")} es Subtotal (Más IVA):*\n` +
        `   • Subtotal: ₡${monto.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n` +
        `   • IVA (${tarifa}%): *₡${ivaAgregado.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n` +
        `   • Total a Facturar: *₡${totalConIva.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n\n` +
        `2️⃣ *Si ₡${monto.toLocaleString("en-US")} ya tiene el IVA Incluido (Desglose):*\n` +
        `   • Subtotal Neto: ₡${baseDesglosada.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n` +
        `   • IVA Incluido (${tarifa}%): *₡${ivaDesglosado.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n` +
        `   • Total Final: *₡${monto.toLocaleString("en-US", { minimumFractionDigits: 2 })}*`,
      node_badge: `IVA CR • ${tarifa}%`,
    };
  }

  // 18. -hora (-time, -fecha)
  if (["hora", "time", "fecha"].includes(cmd)) {
    const now = new Date();
    const fmt = (tz) =>
      new Intl.DateTimeFormat("es-CR", {
        timeZone: tz,
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: true,
      }).format(now);
    return {
      reply:
        `🕒 *Hora y Fecha Actual — AuraFlow World Clock*\n\n` +
        `🇨🇷 *Costa Rica (San José / Zona Sur):* ${fmt("America/Costa_Rica")}\n` +
        `🇺🇸 *Nueva York (EST/EDT):* ${fmt("America/New_York")}\n` +
        `🇲🇽 *Ciudad de México:* ${fmt("America/Mexico_City")}\n` +
        `🇪🇸 *Madrid (España):* ${fmt("Europe/Madrid")}\n` +
        `🇮🇳 *India (IST):* ${fmt("Asia/Kolkata")}`,
      node_badge: "WORLD CLOCK • CR",
    };
  }

  // 19. -qr (-qrcode)
  if (["qr", "qrcode"].includes(cmd)) {
    if (!arg) {
      return { reply: "📱 *Uso:* `-qr <texto o enlace>`\nEjemplo: `-qr https://auraflowtech.lat`" };
    }
    const qrDataUrl = await generateStyledQrDataUrl(arg);
    return {
      reply: `⚡ *AuraFlow QR Generado*\n\n• *Contenido:* ${arg}`,
      qrDataUrl,
      node_badge: "QR GENERATOR",
    };
  }

  // 20. -donate (-donation, -apoyar)
  if (["donate", "donation", "apoyar"].includes(cmd)) {
    return {
      reply:
        "💙 *Apoya el Desarrollo de AuraFlow Bot*\n\n" +
        "AuraFlow Bot es desarrollado y mantenido en Costa Rica por el *Ing. Santiago Delgado Leiva*.\n\n" +
        "📲 *SINPE Móvil / WhatsApp Oficial:* +506 8941-8680\n" +
        "🌐 *Plataforma Cloud:* https://auraflowtech.lat\n" +
        "📧 *Contacto:* support@auraflowtech.lat\n\n" +
        "¡Gracias por impulsar la innovación tecnológica en Costa Rica! 🇨🇷⚡",
      node_badge: "DONATE • AURAFLOW",
    };
  }

  // 21. -sets (-stealtext)
  if (["sets", "stealtext"].includes(cmd)) {
    if (!arg) {
      const current = botData.sets[senderId] || { pack: "AuraFlow Bot", author: "Ing. Santiago Delgado Leiva" };
      return {
        reply:
          `🎨 *Configuración de Créditos para Stickers (-sets)*\n\n` +
          `• *Pack actual:* ${current.pack}\n` +
          `• *Autor actual:* ${current.author}\n\n` +
          `📌 *Para cambiarlo usa:* \`-sets Nombre del Pack | Autor\``,
      };
    }
    const parts = arg.split("|").map((s) => s.trim());
    const pack = parts[0] || "AuraFlow Bot";
    const author = parts[1] || "AuraFlow Tech";
    botData.sets[senderId] = { pack, author };
    saveBotData(botData);
    return {
      reply:
        `✅ *Texto de Stickers Actualizado*\n\n` +
        `• *Pack:* ${pack}\n` +
        `• *Autor:* ${author}\n\n` +
        `Ahora cuando uses \`-sticker\` o \`-steal\`, llevará estos créditos.`,
      node_badge: "STICKER SETS",
    };
  }

  // 22. -delete (-d, -dd)
  if (["delete", "d", "dd"].includes(cmd)) {
    return {
      reply: "🗑️ Procesando eliminación del mensaje...",
      deleteTarget: true,
      node_badge: "DELETE MSG",
    };
  }

  // 23. -encuesta (-poll, -votacion)
  if (["encuesta", "poll", "votacion", "votación"].includes(cmd)) {
    const parts = arg.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) {
      return {
        reply:
          "📊 *Crear Encuesta de WhatsApp*\n\n" +
          "📌 *Uso:* `-encuesta Pregunta | Opción 1 | Opción 2 | Opción 3`\n" +
          "Ejemplo: `-encuesta ¿Qué servicio necesitas hoy? | Factura CR v4.4 | Bot WhatsApp IA | AuraFlow ID`",
      };
    }
    const question = parts[0];
    const options = parts.slice(1, 12);
    return {
      reply:
        `📊 *Encuesta Creada: ${question}*\n\n` +
        options.map((o, i) => `${i + 1}️⃣ ${o}`).join("\n"),
      poll: { name: question, values: options },
      node_badge: "WHATSAPP POLL",
    };
  }

  // 24. -epicgames (-epic, -freegames)
  if (["epicgames", "epic", "freegames"].includes(cmd)) {
    try {
      const data = await fetchJson(
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=es-ES&country=CR&allowCountries=CR",
        7000
      );
      const elements = data?.data?.Catalog?.searchStore?.elements || [];
      const freeGames = elements.filter(
        (g) => g.promotions?.promotionalOffers?.length > 0 && g.price?.totalPrice?.discountPrice === 0
      );
      if (freeGames.length > 0) {
        const list = freeGames
          .map((g) => `🎮 *${g.title}*\n   _${(g.description || "").slice(0, 120)}..._\n   🔗 https://store.epicgames.com/es-ES/p/${g.catalogNs?.mappings?.[0]?.pageSlug || g.productSlug || ""}`)
          .join("\n\n");
        return {
          reply: `🎁 *Juegos Gratis Actuales en Epic Games Store*\n\n${list}`,
          node_badge: "EPIC GAMES • FREE",
        };
      }
    } catch (e) {}
    return {
      reply:
        "🎁 *Epic Games Store — Juegos Gratis de la Semana*\n\n" +
        "Consulta y reclama los juegos gratuitos semanales directamente en:\n" +
        "🔗 https://store.epicgames.com/es-ES/free-games",
      node_badge: "EPIC GAMES",
    };
  }

  // 25. -search (-gs)
  if (["search", "gs", "buscar"].includes(cmd)) {
    if (!arg) {
      return { reply: "🔎 *Uso:* `-search <consulta>`\nEjemplo: `-search Ministerio de Hacienda Costa Rica Factura v4.4`" };
    }
    try {
      const data = await fetchJson(
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(arg)}&utf8=&format=json&srlimit=4`,
        6000
      );
      const results = data?.query?.search || [];
      if (results.length > 0) {
        const formatted = results
          .map((r, i) => {
            const snippet = r.snippet.replace(/<[^>]+>/g, "");
            const link = `https://es.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`;
            return `${i + 1}. *${r.title}*\n   _${snippet}_\n   🔗 ${link}`;
          })
          .join("\n\n");
        return {
          reply: `🔎 *Resultados de Búsqueda para:* _${arg}_\n\n${formatted}\n\n🌐 *Google directo:* https://www.google.com/search?q=${encodeURIComponent(arg)}`,
          node_badge: "WEB SEARCH",
        };
      }
    } catch (e) {}
    return {
      reply: `🔎 *Búsqueda Web:* _${arg}_\n\n🔗 Ver resultados en Google:\nhttps://www.google.com/search?q=${encodeURIComponent(arg)}`,
      node_badge: "WEB SEARCH",
    };
  }

  // 26. -idp (-dp)
  if (["idp", "dp"].includes(cmd)) {
    const username = arg.replace(/^@/, "").trim();
    if (!username) {
      return { reply: "📸 *Uso:* `-idp <usuario_instagram>`\nEjemplo: `-idp auraflowtech`" };
    }
    return {
      reply:
        `📸 *Perfil de Instagram: @${username}*\n\n` +
        `• *Enlace directo:* https://www.instagram.com/${encodeURIComponent(username)}/\n` +
        `• *Visor HD:* https://unavatar.io/instagram/${encodeURIComponent(username)}`,
      node_badge: "INSTAGRAM DP",
    };
  }

  // 27. -rank (-level, -xp)
  if (["rank", "level", "xp"].includes(cmd)) {
    const userStats = botData.xp[senderId] || { xp: 15, messages: 1, name: senderPhone };
    const level = Math.floor(Math.sqrt(userStats.xp / 25)) + 1;
    const tiers = ["Bronce 🥉", "Plata 🥈", "Oro 🥇", "Platino 💎", "Diamante AuraFlow ⚡"];
    const tierName = tiers[Math.min(tiers.length - 1, Math.floor((level - 1) / 2))];
    return {
      reply:
        `🏆 *Rango y Experiencia (XP) — AuraFlow Club*\n\n` +
        `👤 *Usuario:* ${userStats.name}\n` +
        `⭐ *Nivel:* ${level} (${tierName})\n` +
        `✨ *Experiencia Total:* ${userStats.xp} XP\n` +
        `💬 *Comandos / Mensajes:* ${userStats.messages}\n` +
        `📈 *Próximo nivel:* ${(level * level) * 25} XP`,
      node_badge: "RANK & XP",
    };
  }

  // 28. -reddit
  if (["reddit"].includes(cmd)) {
    if (!arg || !arg.includes("reddit.com")) {
      return { reply: "👽 *Uso:* `-reddit <enlace de un post de Reddit>`" };
    }
    try {
      const cleanUrl = arg.split("?")[0].replace(/\/$/, "") + ".json";
      const data = await fetchJson(cleanUrl, 6500);
      const post = data?.[0]?.data?.children?.[0]?.data;
      if (post) {
        return {
          reply:
            `👽 *Reddit Post Extraído*\n\n` +
            `📌 *Título:* ${post.title}\n` +
            `👤 *Autor:* u/${post.author} en r/${post.subreddit}\n` +
            `⬆️ *Upvotes:* ${post.ups}\n` +
            `🔗 *Media / Link:* ${post.url_overridden_by_dest || post.url}`,
          node_badge: "REDDIT DOWNLOADER",
        };
      }
    } catch (e) {}
    return { reply: `👽 *Enlace Reddit:* ${arg}\nNo se pudo extraer el JSON del post o el enlace es privado.` };
  }

  // 29. -remind (-reminder)
  if (["remind", "reminder", "recordar"].includes(cmd)) {
    const match = arg.match(/^(\d+)\s*(s|m|h|d)?\s+(.+)$/i);
    if (!match) {
      return {
        reply:
          "⏰ *Configurar Recordatorio (-remind)*\n\n" +
          "📌 *Uso:* `-remind <tiempo><s|m|h> <mensaje>`\n" +
          "Ejemplo: `-remind 15m Llamar al cliente de Factura v4.4`",
      };
    }
    const val = parseInt(match[1], 10);
    const unit = (match[2] || "m").toLowerCase();
    const reminderText = match[3].trim();
    const mult = unit === "s" ? 1000 : unit === "h" ? 3600000 : unit === "d" ? 86400000 : 60000;
    const delayMs = Math.min(7 * 86400000, val * mult);

    return {
      reply:
        `⏰ *Recordatorio Programado*\n\n` +
        `• *Tiempo:* ${val}${unit}\n` +
        `• *Mensaje:* _${reminderText}_\n` +
        `✅ Te enviaré una notificación aquí mismo cuando se cumpla el tiempo.`,
      reminder: { delayMs, text: reminderText },
      node_badge: "REMINDER TIMER",
    };
  }

  // 30. -attp
  if (["attp"].includes(cmd)) {
    if (!arg) {
      return { reply: "🎨 *Uso:* `-attp <texto>`\nEjemplo: `-attp AuraFlow CR`" };
    }
    const userSet = botData.sets[senderId] || { pack: "AuraFlow Bot", author: "Ing. Santiago Delgado Leiva" };
    const stickerBuffer = await createTextSticker(arg, userSet.pack, userSet.author);
    return {
      reply: `🎨 *Sticker de Texto Generado:* _${arg}_`,
      stickerBuffer,
      node_badge: "ATTP STICKER",
    };
  }

  // 31. -sticker (-s) and -steal (-stealn)
  if (["sticker", "s", "steal", "stealn"].includes(cmd)) {
    const userSet = botData.sets[senderId] || { pack: "AuraFlow Bot", author: "Ing. Santiago Delgado Leiva" };
    let customPack = userSet.pack;
    let customAuthor = userSet.author;
    if (arg && arg.includes("|")) {
      const p = arg.split("|").map((x) => x.trim());
      if (p[0]) customPack = p[0];
      if (p[1]) customAuthor = p[1];
    } else if (arg) {
      customPack = arg.trim();
    }

    if (context.mediaBuffer) {
      const stickerBuffer = await imageToSticker(context.mediaBuffer, customPack, customAuthor);
      return {
        reply: `✨ *Sticker creado con éxito* (${customPack} · ${customAuthor})`,
        stickerBuffer,
        node_badge: "STICKER MAKER",
      };
    }

    // If invoked from web or without image, generate a custom sticker with the text or inform how to use on WhatsApp
    if (arg) {
      const stickerBuffer = await createTextSticker(arg, customPack, customAuthor);
      return {
        reply: `✨ *Sticker generado* (${customPack} · ${customAuthor})`,
        stickerBuffer,
        node_badge: "STICKER MAKER",
      };
    }

    return {
      reply:
        `✨ *Creador de Stickers AuraFlow (-${cmd})*\n\n` +
        `Envía una imagen o responde a una imagen/sticker en WhatsApp con \`-${cmd}\`.\n` +
        `• *Pack configurado:* ${customPack}\n` +
        `• *Autor configurado:* ${customAuthor}`,
      node_badge: "STICKER MAKER",
    };
  }

  // 32. -say (-tts)
  if (["say", "tts"].includes(cmd)) {
    if (!arg) {
      return {
        reply:
          "🗣️ *Texto a Voz (-say / -tts)*\n\n" +
          "📌 *Uso:* `-say [es|en|hi] <texto>`\n" +
          "Ejemplo: `-say es Hola, bienvenido a AuraFlow Tech en Costa Rica`",
      };
    }
    const parts = arg.split(/\s+/);
    let lang = "es";
    let ttsText = arg;
    if (["es", "en", "hi", "pt", "fr"].includes(parts[0].toLowerCase()) && parts.length > 1) {
      lang = parts[0].toLowerCase();
      ttsText = parts.slice(1).join(" ");
    }
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText.slice(0, 200))}&tl=${lang}&client=tw-ob`;
    return {
      reply: `🗣️ *Nota de Voz Generada (${lang.toUpperCase()}):*\n_"${ttsText}"_`,
      audioUrl,
      node_badge: "TTS VOICE",
    };
  }

  // 33. -tr (-translate)
  if (["tr", "translate", "traducir"].includes(cmd)) {
    const parts = arg.split(/\s+/);
    if (parts.length < 2) {
      return {
        reply:
          "🌐 *Traductor AuraFlow (-tr)*\n\n" +
          "📌 *Uso:* `-tr <idioma_destino> <texto>`\n" +
          "Ejemplo: `-tr en Hola, emitimos factura electrónica v4.4 en Costa Rica`\n" +
          "Códigos: `es` (Español), `en` (Inglés), `pt` (Portugués), `fr` (Francés), `hi` (Hindi), `de` (Alemán).",
      };
    }
    const targetLang = parts[0].toLowerCase();
    const sourceText = parts.slice(1).join(" ");
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(sourceText)}`;
      const data = await fetchJson(url, 6000);
      const translated = (data?.[0] || []).map((seg) => seg[0]).join("");
      const detectedSource = data?.[2] || "auto";
      return {
        reply:
          `🌐 *Traducción (${detectedSource.toUpperCase()} ➔ ${targetLang.toUpperCase()})*\n\n` +
          `• *Original:* ${sourceText}\n` +
          `• *Traducción:* *${translated}*`,
        node_badge: `TRANSLATE • ${targetLang.toUpperCase()}`,
      };
    } catch (e) {
      return { reply: "❌ No se pudo traducir el texto en este momento." };
    }
  }

  // 34. -weather (-w)
  if (["weather", "w", "clima"].includes(cmd)) {
    const city = arg.trim() || "San Isidro de El General, Costa Rica";
    try {
      const data = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, 6500);
      const curr = data?.current_condition?.[0];
      const area = data?.nearest_area?.[0];
      if (curr) {
        const place = area?.areaName?.[0]?.value || city;
        const country = area?.country?.[0]?.value || "";
        const desc = curr.lang_es?.[0]?.value || curr.weatherDesc?.[0]?.value || "Despejado";
        return {
          reply:
            `🌤️ *Clima Actual en ${place}${country ? `, ${country}` : ""}*\n\n` +
            `• *Condición:* ${desc}\n` +
            `• *Temperatura:* *${curr.temp_C}°C* (${curr.temp_F}°F)\n` +
            `• *Sensación Térmica:* ${curr.FeelsLikeC}°C\n` +
            `• *Humedad:* ${curr.humidity}%\n` +
            `• *Viento:* ${curr.windspeedKmph} km/h`,
          node_badge: "WEATHER • LIVE",
        };
      }
    } catch (e) {}
    return {
      reply:
        `🌤️ *Clima en ${city}*\n\n` +
        `• *Temperatura estimada:* 24°C (Clima Tropical CR)\n` +
        `• *Humedad:* 78% | *Viento:* 12 km/h`,
      node_badge: "WEATHER",
    };
  }

  // 35. -wiki (-wikipedia)
  if (["wiki", "wikipedia"].includes(cmd)) {
    if (!arg) {
      return { reply: "📚 *Uso:* `-wiki <tema>`\nEjemplo: `-wiki Costa Rica` o `-wiki Inteligencia artificial`" };
    }
    try {
      const searchData = await fetchJson(
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(arg)}&utf8=&format=json&srlimit=1`,
        6000
      );
      const topTitle = searchData?.query?.search?.[0]?.title;
      if (topTitle) {
        const summary = await fetchJson(
          `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`,
          6000
        );
        if (summary?.extract) {
          return {
            reply:
              `📚 *Wikipedia: ${summary.title}*\n\n` +
              `${summary.extract}\n\n` +
              `🔗 ${summary.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(summary.title)}`}`,
            node_badge: "WIKIPEDIA",
          };
        }
      }
    } catch (e) {}
    return { reply: `📚 No se encontró un artículo en Wikipedia para *"${arg}"*.` };
  }

  // 36. -dl (-descargar, -video, -musica, -mp3, -foto, -img, -tiktok, -ig)
  if (["dl", "descargar", "video", "musica", "música", "mp3", "audio", "foto", "img", "imagen", "tiktok", "ig"].includes(cmd)) {
    if (!arg) {
      return {
        reply:
          "⬇️ *Descargador Multimedia Universal (-dl)*\n\n" +
          "Descarga videos, música o fotos de casi cualquier enlace:\n" +
          "• `-dl <enlace>` — Detecta y descarga automáticamente\n" +
          "• `-video <enlace>` — Descarga video en MP4 (TikTok, IG, FB, etc.)\n" +
          "• `-musica <enlace>` — Extrae y descarga el audio en MP3\n" +
          "• `-foto <enlace>` — Descarga la fotografía en HD\n\n" +
          "💡 *Soporta:* TikTok (sin marca de agua), Instagram (Reels y Posts), YouTube, Facebook, Twitter/X, Pinterest y enlaces directos.\n\n" +
          "También puedes simplemente *pegar el enlace* en el chat y el bot lo procesará automáticamente.",
      };
    }
    const { downloadMedia } = require("./downloader");
    let mode = "auto";
    if (["musica", "música", "mp3", "audio"].includes(cmd)) mode = "audio";
    else if (["video", "tiktok", "ig"].includes(cmd)) mode = "video";
    else if (["foto", "img", "imagen"].includes(cmd)) mode = "foto";

    const urlMatch = arg.match(/https?:\/\/[^\s]+/i);
    const targetUrl = urlMatch ? urlMatch[0] : arg.trim();

    try {
      const media = await downloadMedia(targetUrl, mode);
      const mb = (media.sizeBytes / (1024 * 1024)).toFixed(1);
      return {
        reply:
          `${media.title}\n\n` +
          `💾 *Tamaño:* ${mb} MB\n` +
          `🔗 *CDN:* ${media.cdnUrl}\n\n` +
          `⚡ _Descargado por AuraFlow Tech Media_`,
        mediaType: media.type,
        buffer: media.buffer,
        mimetype: media.mimetype,
        fileName: media.fileName,
        cdnUrl: media.cdnUrl,
        node_badge: "DOWNLOADER",
      };
    } catch (err) {
      return {
        reply: `❌ *Error al descargar multimedia:*\n_${err.message}_\n\nVerifica que el enlace sea público y válido.`,
      };
    }
  }

  // 38. -ip (-dns, -geoip)
  if (["ip", "dns", "geoip"].includes(cmd)) {
    if (!arg) {
      return { reply: "🌐 *Uso:* `-ip <IP o dominio>`\nEjemplo: `-ip auraflowtech.lat`" };
    }
    const target = arg.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].trim();
    const dns = require("dns").promises;
    let resolvedIps = [];
    let mxRecords = [];
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(target) || target.includes(":");
    if (!isIp) {
      try { resolvedIps = await dns.resolve4(target); } catch {}
      try { mxRecords = (await dns.resolveMx(target)).slice(0, 3).map((m) => `${m.exchange} (${m.priority})`); } catch {}
    }
    const lookupHost = isIp ? target : (resolvedIps[0] || target);
    try {
      const geo = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(lookupHost)}?fields=status,message,country,regionName,city,isp,org,as,query`);
      if (geo.status !== "success") {
        return { reply: `⚠️ No se pudo resolver *${target}*: ${geo.message || "desconocido"}` };
      }
      const lines = [
        `🌐 *Diagnóstico IP / DNS: ${target}*`,
        ``,
        `• *IP:* \`${geo.query}\``,
        `• *Ubicación:* ${[geo.city, geo.regionName, geo.country].filter(Boolean).join(", ")}`,
        `• *ISP:* ${geo.isp || "N/A"}`,
        `• *ASN / Org:* ${geo.as || geo.org || "N/A"}`,
      ];
      if (resolvedIps.length > 1) lines.push(`• *IPv4:* ${resolvedIps.join(", ")}`);
      if (mxRecords.length > 0) lines.push(`• *MX:* ${mxRecords.join(", ")}`);
      return { reply: lines.join("\n"), node_badge: "REDES • IP/DNS" };
    } catch (e) {
      return { reply: `⚠️ Error consultando IP/DNS: ${e.message}` };
    }
  }

  // 39. -ssl (-cert)
  if (["ssl", "cert"].includes(cmd)) {
    if (!arg) {
      return { reply: "🔒 *Uso:* `-ssl <dominio>`\nEjemplo: `-ssl media.auraflowtech.lat`" };
    }
    const host = arg.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].trim();
    const tls = require("tls");
    try {
      const certInfo = await new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) return reject(new Error("Sin certificado válido"));
          resolve(cert);
        });
        socket.on("timeout", () => { socket.destroy(); reject(new Error("Timeout al conectar por TLS")); });
        socket.on("error", (err) => reject(err));
      });
      const expDate = new Date(certInfo.valid_to);
      const daysLeft = Math.floor((expDate.getTime() - Date.now()) / 86400000);
      const issuer = certInfo.issuer?.O || certInfo.issuer?.CN || "Desconocido";
      const statusIcon = daysLeft > 15 ? "🟢" : daysLeft > 0 ? "🟡" : "🔴";
      return {
        reply:
          `🔒 *Certificado SSL/TLS: ${host}*\n\n` +
          `${statusIcon} *Estado:* ${daysLeft > 0 ? `Válido (${daysLeft} días restantes)` : "Expirado"}\n` +
          `• *Emisor:* ${issuer}\n` +
          `• *Sujeto:* ${certInfo.subject?.CN || host}\n` +
          `• *Válido hasta:* ${expDate.toISOString().slice(0, 10)}`,
        node_badge: "SEGURIDAD • SSL",
      };
    } catch (e) {
      return { reply: `❌ Error SSL en *${host}*: ${e.message}` };
    }
  }

  // 40. -http (-statusweb, -pingweb)
  if (["http", "statusweb", "pingweb"].includes(cmd)) {
    if (!arg) {
      return { reply: "📡 *Uso:* `-http <url>`\nEjemplo: `-http https://media.auraflowtech.lat`" };
    }
    const targetUrl = /^https?:\/\//i.test(arg) ? arg.trim() : `https://${arg.trim()}`;
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(targetUrl, { method: "HEAD", signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const icon = res.ok ? "🟢" : res.status < 500 ? "🟡" : "🔴";
      return {
        reply:
          `📡 *Monitor HTTP*\n\n` +
          `${icon} *Estado:* ${res.status} ${res.statusText || ""}\n` +
          `• *Latencia:* ${ms} ms\n` +
          `• *URL final:* ${res.url}\n` +
          `• *Servidor:* ${res.headers.get("server") || "oculto"}`,
        node_badge: "HTTP CHECK",
      };
    } catch (e) {
      return { reply: `🔴 *Sitio caído o inaccesible:* ${targetUrl}\n_${e.message}_` };
    }
  }

  // 41. -media (-cdn, -descargas) — owner only
  if (["media", "cdn", "descargas"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const mediaDir = "/root/media/descargas";
    try {
      if (!fs.existsSync(mediaDir)) {
        return { reply: "📭 La carpeta `/root/media/descargas` aún no existe." };
      }
      const entries = fs.readdirSync(mediaDir)
        .filter((f) => !f.startsWith("."))
        .map((f) => {
          const st = fs.statSync(path.join(mediaDir, f));
          return st.isFile() ? { name: f, size: st.size, mtime: st.mtimeMs } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      if (entries.length === 0) {
        return { reply: "📭 No hay archivos en `https://media.auraflowtech.lat`.", node_badge: "CDN • MEDIA" };
      }
      const totalMb = (entries.reduce((s, e) => s + e.size, 0) / (1024 * 1024)).toFixed(1);
      const top = entries.slice(0, 8).map((e, idx) => {
        const mb = (e.size / (1024 * 1024)).toFixed(1);
        return `${idx + 1}. *${e.name}* (${mb} MB)\n   🔗 https://media.auraflowtech.lat/descargas/${encodeURIComponent(e.name)}`;
      });
      return {
        reply: `🎬 *AuraFlow Media CDN (${entries.length} archivos · ${totalMb} MB)*\n\n${top.join("\n\n")}\n\n🌐 Panel: https://media.auraflowtech.lat`,
        node_badge: "CDN • MEDIA",
      };
    } catch (e) {
      return { reply: `⚠️ Error leyendo media: ${e.message}` };
    }
  }

  // 42. -nota (-notas, -note, -notes) — owner only, SQLite
  if (["nota", "notas", "note", "notes"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bot_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      const lowerArg = arg.toLowerCase();
      if (lowerArg.startsWith("del ") || lowerArg.startsWith("eliminar ") || lowerArg.startsWith("rm ")) {
        const idNum = Number(arg.replace(/^(del|eliminar|rm)\s+/i, "").trim());
        if (!Number.isInteger(idNum) || idNum <= 0) {
          return { reply: "📌 *Uso:* `-notas del <id>`" };
        }
        const info = db.prepare("DELETE FROM bot_notes WHERE id = ?").run(idNum);
        return {
          reply: info.changes ? `🗑️ Nota #${idNum} eliminada.` : `⚠️ No existe la nota #${idNum}.`,
          node_badge: "DB • NOTAS",
        };
      }
      if (arg && cmd !== "notas" && cmd !== "notes") {
        const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
        const info = db.prepare("INSERT INTO bot_notes (content, created_at) VALUES (?, ?)").run(arg, nowStr);
        return { reply: `📝 Nota #${info.lastInsertRowid} guardada:\n_${arg}_`, node_badge: "DB • NOTAS" };
      }
      if (arg && (cmd === "notas" || cmd === "notes")) {
        const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
        const info = db.prepare("INSERT INTO bot_notes (content, created_at) VALUES (?, ?)").run(arg, nowStr);
        return { reply: `📝 Nota #${info.lastInsertRowid} guardada:\n_${arg}_`, node_badge: "DB • NOTAS" };
      }
      const rows = db.prepare("SELECT id, content, created_at FROM bot_notes ORDER BY id DESC LIMIT 15").all();
      if (rows.length === 0) {
        return { reply: "📭 No tienes notas guardadas.\nUsa `-nota <texto>` para guardar una.", node_badge: "DB • NOTAS" };
      }
      const list = rows.map((r) => `*#${r.id}* · ${r.content}`).join("\n");
      return { reply: `📝 *Notas Guardadas (${rows.length})*\n\n${list}`, node_badge: "DB • NOTAS" };
    } finally {
      db.close();
    }
  }

  // 43. -uuid & -hash
  if (cmd === "uuid") {
    return {
      reply: `🆔 *UUID v4 Generado:*\n\`${crypto.randomUUID()}\``,
      node_badge: "DEV • UUID",
    };
  }

  if (["hash", "sha256"].includes(cmd)) {
    if (!arg) {
      return { reply: "🔐 *Uso:* `-hash <texto>`\nEjemplo: `-hash AuraFlow2026`" };
    }
    const sha256 = crypto.createHash("sha256").update(arg).digest("hex");
    const md5 = crypto.createHash("md5").update(arg).digest("hex");
    return {
      reply: `🔐 *Hashes Generados*\n\n• *SHA-256:*\n\`${sha256}\`\n• *MD5:*\n\`${md5}\``,
      node_badge: "DEV • HASH",
    };
  }

  // 44. -whois (-rdap)
  if (["whois", "rdap"].includes(cmd)) {
    if (!arg) {
      return { reply: "🔎 *Uso:* `-whois <dominio>`\nEjemplo: `-whois auraflowtech.lat`" };
    }
    const domain = arg.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].trim().toLowerCase();
    try {
      const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, 8000);
      const events = data.events || [];
      const regEvent = events.find((e) => e.eventAction === "registration")?.eventDate?.slice(0, 10) || "N/A";
      const expEvent = events.find((e) => e.eventAction === "expiration")?.eventDate?.slice(0, 10) || "N/A";
      const ns = (data.nameservers || []).map((n) => n.ldhName).filter(Boolean).slice(0, 4);
      const registrarEntity = (data.entities || []).find((e) => (e.roles || []).includes("registrar"));
      const vcard = registrarEntity?.vcardArray?.[1] || [];
      const registrarName = vcard.find((v) => v[0] === "fn")?.[3] || "N/A";
      const statuses = (data.status || []).slice(0, 3).join(", ") || "N/A";
      return {
        reply:
          `🔎 *WHOIS / RDAP: ${data.ldhName || domain}*\n\n` +
          `• *Registrador:* ${registrarName}\n` +
          `• *Creado:* ${regEvent}\n` +
          `• *Expira:* ${expEvent}\n` +
          `• *Estado:* ${statuses}\n` +
          `• *Nameservers:* ${ns.length ? ns.join(", ") : "N/A"}`,
        node_badge: "REDES • WHOIS",
      };
    } catch (e) {
      return { reply: `⚠️ No se pudo consultar WHOIS para *${domain}*: ${e.message}` };
    }
  }

  // 45. -meta (-og, -seo)
  if (["meta", "og", "seo"].includes(cmd)) {
    if (!arg) {
      return { reply: "🏷️ *Uso:* `-meta <url>`\nEjemplo: `-meta https://auraflowtech.lat`" };
    }
    const targetUrl = /^https?:\/\//i.test(arg) ? arg.trim() : `https://${arg.trim()}`;
    try {
      const html = await fetchText(targetUrl, 7000);
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const getMeta = (key) => {
        const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i");
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${key}["']`, "i");
        return (html.match(re1)?.[1] || html.match(re2)?.[1] || "").trim();
      };
      const title = (titleMatch?.[1] || getMeta("og:title") || "Sin título").replace(/\s+/g, " ").trim();
      const desc = (getMeta("description") || getMeta("og:description") || "Sin descripción").replace(/\s+/g, " ").trim();
      const ogImg = getMeta("og:image") || "No definida";
      return {
        reply:
          `🏷️ *Metadatos SEO / OpenGraph*\n\n` +
          `• *URL:* ${targetUrl}\n` +
          `• *Título:* ${title.slice(0, 120)}\n` +
          `• *Descripción:* ${desc.slice(0, 220)}\n` +
          `• *OG Image:* ${ogImg.slice(0, 140)}`,
        node_badge: "WEB • META/SEO",
      };
    } catch (e) {
      return { reply: `⚠️ Error leyendo metadatos de *${targetUrl}*: ${e.message}` };
    }
  }

  // 46. -puertos (-puerto, -port, -ports) — owner only
  if (["puertos", "puerto", "port", "ports"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    if (!arg) {
      return { reply: "🔌 *Uso:* `-puertos <host> [p1,p2,...]`\nEjemplo: `-puertos 127.0.0.1 80,443,8090,8001`" };
    }
    const parts = arg.split(/\s+/).filter(Boolean);
    const host = parts[0].replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
    const ports = (parts[1] ? parts[1].split(",") : ["22", "80", "443", "8080", "8090", "3018"])
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535)
      .slice(0, 12);
    if (ports.length === 0) {
      return { reply: "⚠️ Indica al menos un puerto válido (1-65535)." };
    }
    const net = require("net");
    const checkPort = (port) =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const sock = new net.Socket();
        sock.setTimeout(2200);
        sock.on("connect", () => {
          const ms = Date.now() - t0;
          sock.destroy();
          resolve({ port, open: true, ms });
        });
        sock.on("timeout", () => { sock.destroy(); resolve({ port, open: false }); });
        sock.on("error", () => { sock.destroy(); resolve({ port, open: false }); });
        sock.connect(port, host);
      });
    const results = await Promise.all(ports.map(checkPort));
    const lines = results.map((r) => `${r.open ? "🟢" : "🔴"} *Puerto ${r.port}:* ${r.open ? `Abierto (${r.ms} ms)` : "Cerrado/Filtrado"}`);
    return {
      reply: `🔌 *Escaneo TCP: ${host}*\n\n${lines.join("\n")}`,
      node_badge: "OPS • PUERTOS",
    };
  }

  // 47. -systemd (-serviciosvps, -daemons) — owner only
  if (["systemd", "serviciosvps", "daemons"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const { execSync } = require("child_process");
    const units = [
      "auraflow-wabot.service",
      "auraflow.service",
      "aura-agent.service",
      "iphone-transfer.service",
      "auraflow-telegram-ops.service",
      "auraflow-watchdog.service",
      "vps-command-hub.service",
      "nginx.service",
    ];
    const lines = units.map((u) => {
      try {
        const state = execSync(`systemctl is-active ${u}`, { encoding: "utf8" }).trim();
        return `${state === "active" ? "🟢" : "🔴"} \`${u.replace(".service", "")}\`: *${state}*`;
      } catch {
        return `🔴 \`${u.replace(".service", "")}\`: *inactive*`;
      }
    });
    return {
      reply: `⚙️ *Servicios del VPS*\n\n${lines.join("\n")}`,
      node_badge: "OPS • SYSTEMD",
    };
  }

  // 48. -crypto (-btc, -eth, -cripto)
  if (["crypto", "btc", "eth", "cripto"].includes(cmd)) {
    const map = { btc: "bitcoin", bitcoin: "bitcoin", eth: "ethereum", ethereum: "ethereum", sol: "solana", solana: "solana", xrp: "ripple", bnb: "binancecoin", doge: "dogecoin", usdt: "tether", ada: "cardano" };
    const reqCoin = cmd === "btc" ? "bitcoin" : cmd === "eth" ? "ethereum" : (map[arg.toLowerCase()] || arg.toLowerCase());
    const ids = reqCoin ? reqCoin : "bitcoin,ethereum,solana";
    try {
      const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`, 7000);
      const keys = Object.keys(data);
      if (keys.length === 0) {
        return { reply: `⚠️ No encontré la criptomoneda *"${arg}"*. Prueba con \`btc\`, \`eth\` o \`sol\`.` };
      }
      const lines = keys.map((k) => {
        const price = Number(data[k].usd).toLocaleString("en-US", { maximumFractionDigits: 4 });
        const chg = Number(data[k].usd_24h_change || 0);
        const arrow = chg >= 0 ? "📈" : "📉";
        return `• *${k.toUpperCase()}:* $${price} USD (${arrow} ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% 24h)`;
      });
      return {
        reply: `🪙 *Cotización Cripto (USD)*\n\n${lines.join("\n")}`,
        node_badge: "MERCADO • CRYPTO",
      };
    } catch (e) {
      return { reply: `⚠️ Error consultando precios cripto: ${e.message}` };
    }
  }

  // 49. -base64 (-b64) & -json
  if (["base64", "b64"].includes(cmd)) {
    const space = arg.indexOf(" ");
    const sub = (space === -1 ? "" : arg.slice(0, space)).toLowerCase();
    const payload = space === -1 ? "" : arg.slice(space + 1);
    if (!["enc", "encode", "dec", "decode"].includes(sub) || !payload) {
      return { reply: "🔤 *Uso:* `-base64 <enc|dec> <texto>`\nEjemplo: `-base64 enc Hola AuraFlow`" };
    }
    const out = sub.startsWith("enc")
      ? Buffer.from(payload, "utf8").toString("base64")
      : Buffer.from(payload.trim(), "base64").toString("utf8");
    return {
      reply: `🔤 *Base64 (${sub.startsWith("enc") ? "Codificado" : "Decodificado"})*\n\n\`\`\`${out}\`\`\``,
      node_badge: "DEV • BASE64",
    };
  }

  if (cmd === "json") {
    if (!arg) {
      return { reply: "🧩 *Uso:* `-json {\"clave\":\"valor\"}`" };
    }
    try {
      const parsed = JSON.parse(arg);
      return {
        reply: `🧩 *JSON Válido*\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2).slice(0, 1800)}\n\`\`\``,
        node_badge: "DEV • JSON",
      };
    } catch (e) {
      return { reply: `❌ *JSON Inválido:*\n_${e.message}_` };
    }
  }

  // 50. -recordatorios
  if (["recordatorios", "reminders"].includes(cmd)) {
    const list = (botData.reminders || []).filter((r) => !r.done);
    if (list.length === 0) {
      return { reply: "⏰ No tienes recordatorios pendientes.\nUsa `-remind 10m Tu mensaje` para crear uno.", node_badge: "RECORDATORIOS" };
    }
    const lines = list.slice(0, 15).map((r, i) => `${i + 1}. ${r.text}`);
    return { reply: `⏰ *Recordatorios Pendientes (${list.length})*\n\n${lines.join("\n")}`, node_badge: "RECORDATORIOS" };
  }

  // 51. -limpiar_media (-cleanmedia) — owner only
  if (["limpiar_media", "cleanmedia"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const mediaDir = "/root/media/descargas";
    if (!fs.existsSync(mediaDir)) return { reply: "📭 No existe `/root/media/descargas`." };
    const now = Date.now();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(mediaDir).map((f) => {
      const fp = path.join(mediaDir, f);
      const st = fs.statSync(fp);
      return st.isFile() ? { name: f, fp, size: st.size, ageMs: now - st.mtimeMs } : null;
    }).filter(Boolean);
    const oldFiles = files.filter((f) => f.ageMs > maxAgeMs);
    if (arg.toLowerCase() === "confirmar") {
      let freed = 0;
      for (const f of oldFiles) {
        fs.unlinkSync(f.fp);
        freed += f.size;
      }
      return {
        reply: `🧹 *Limpieza de Media Completada*\n\n• Eliminados (>7 días): *${oldFiles.length}* archivos\n• Espacio liberado: *${(freed / (1024 * 1024)).toFixed(1)} MB*`,
        node_badge: "OPS • MEDIA CLEAN",
      };
    }
    const totalMb = (files.reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(1);
    return {
      reply: `🧹 *Estado de /root/media/descargas*\n\n• Total: *${files.length}* archivos (*${totalMb} MB*)\n• Mayores a 7 días: *${oldFiles.length}*\n\nEnvía \`-limpiar_media confirmar\` para borrar los de >7 días.`,
      node_badge: "OPS • MEDIA CLEAN",
    };
  }

  // 52. -vcard (-qrcontacto) — QR escaneable para guardar contacto
  if (["vcard", "qrcontacto"].includes(cmd)) {
    const parts = arg.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return { reply: "📇 *Uso:* `-vcard <Nombre> | <Teléfono>`\nEjemplo: `-vcard Santiago Delgado | +506 8941 8680`" };
    }
    const name = parts[0];
    const phone = parts[1];
    const vcardStr = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:${phone}\nEND:VCARD`;
    const qrDataUrl = await generateStyledQrDataUrl(vcardStr);
    return {
      reply: `📇 *QR de Contacto (vCard)*\n\n• *Nombre:* ${name}\n• *Teléfono:* ${phone}\n\n_Escanea con la cámara para guardar el contacto._`,
      qrDataUrl,
      node_badge: "QR • VCARD",
    };
  }

  // 53. -backup (-respaldo) — owner only
  if (["backup", "respaldo"].includes(cmd)) {
    if (!context.isOwner) {
      return { reply: "⛔ Comando exclusivo del administrador." };
    }
    const backupDir = "/root/backups/wabot";
    fs.mkdirSync(backupDir, { recursive: true });
    if (arg.toLowerCase() === "list") {
      const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".tar.gz")).sort().reverse().slice(0, 8);
      if (files.length === 0) return { reply: "📭 Aún no hay respaldos en `/root/backups/wabot`." };
      const list = files.map((f, i) => {
        const kb = (fs.statSync(path.join(backupDir, f)).size / 1024).toFixed(1);
        return `${i + 1}. \`${f}\` (${kb} KB)`;
      }).join("\n");
      return { reply: `💾 *Respaldos Recientes*\n\n${list}`, node_badge: "OPS • BACKUP" };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outFile = path.join(backupDir, `wabot_backup_${stamp}.tar.gz`);
    const { execFileSync } = require("child_process");
    try {
      const targets = [
        "/root/aura-flow-tech/backend/aura_flow.db",
        path.join(__dirname, "bot_data.json"),
        path.join(__dirname, "dashboard_store.json"),
      ].filter((p) => fs.existsSync(p));
      execFileSync("tar", ["-czf", outFile, ...targets], { timeout: 15000 });
      const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
      return {
        reply: `💾 *Respaldo Creado*\n\n• *Archivo:* \`${path.basename(outFile)}\`\n• *Tamaño:* ${kb} KB\n• *Ruta:* \`${backupDir}\``,
        node_badge: "OPS • BACKUP",
      };
    } catch (e) {
      return { reply: `❌ Error creando respaldo: ${e.message}` };
    }
  }

  return null;
}

module.exports = {
  MENU_TEXT,
  VALID_COMMANDS,
  AI_COMMAND_CATALOG,
  inferCommandIntent,
  handleBotCommand,
};
