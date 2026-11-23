/**
 * AuraFlow Tech — Descargador Universal de Multimedia (Videos, Música, Fotos)
 * Soporta: YouTube, TikTok, Instagram, Facebook, X/Twitter, Pinterest, SoundCloud y Enlaces Directos.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const scraper = require("ruhend-scraper");
const sharp = require("sharp");

const MEDIA_DIR = "/root/media/descargas";
const CDN_BASE = "https://media.auraflowtech.lat/descargas";

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function sanitizeName(str) {
  return (str || "descarga")
    .replace(/[^a-zA-Z0-9_\-\. áéíóúÁÉÍÓÚñÑ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 50);
}

/**
 * Si un archivo MP4 no usa códec H.264 (ej. AV1, VP9, HEVC), lo transcodifica a H.264 + AAC + faststart
 * para garantizar reproducción en iOS Safari y WhatsApp.
 */
function ensureH264Mp4(filePath) {
  if (!filePath.toLowerCase().endsWith(".mp4")) return false;
  try {
    const vcodec = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf8", timeout: 15000 }
    ).trim();
    if (vcodec && vcodec !== "h264") {
      const h264Path = filePath.replace(/\.mp4$/i, "_h264.mp4");
      execSync(
        `ffmpeg -y -i "${filePath}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${h264Path}"`,
        { timeout: 180000, stdio: "ignore" }
      );
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 2048) {
        fs.unlinkSync(filePath);
        fs.renameSync(h264Path, filePath);
        return true;
      }
    }
  } catch {
    // Si falla la inspección o transcodificación, mantener el archivo original
  }
  return false;
}

/**
 * Descarga un archivo desde una URL HTTP directa hacia MEDIA_DIR
 */
async function downloadDirectFile(url, defaultExt = "mp4", filenamePrefix = "media") {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    throw new Error("El enlace proporcionado es una página web HTML y no un archivo multimedia descargable directo.");
  }

  const arrayBuf = await res.arrayBuffer();
  let buffer = Buffer.from(arrayBuf);

  // Validar que no sea un documento HTML disfrazado
  const headStr = buffer.toString("utf8", 0, 100).toLowerCase();
  if (headStr.includes("<!doctype") || headStr.includes("<html") || headStr.includes("<body")) {
    throw new Error("El contenido recibido es una página HTML protegida, no un archivo multimedia válido.");
  }

  let finalExt = defaultExt.toLowerCase();
  let mime = "application/octet-stream";

  // Si es un SVG o formato vectorial, convertirlo a PNG estándar para compatibilidad con WhatsApp iOS/Android
  if (finalExt === "svg" || headStr.includes("<svg")) {
    try {
      buffer = await sharp(buffer).png().toBuffer();
      finalExt = "png";
      mime = "image/png";
    } catch (e) {
      finalExt = "png";
      mime = "image/png";
    }
  } else if (["jpg", "jpeg"].includes(finalExt)) {
    mime = "image/jpeg";
  } else if (finalExt === "png") {
    mime = "image/png";
  } else if (finalExt === "mp4") {
    mime = "video/mp4";
  } else if (finalExt === "mp3") {
    mime = "audio/mp4";
  }

  const rand = Math.random().toString(36).substring(7);
  const cleanPrefix = sanitizeName(filenamePrefix);
  const fileName = `${cleanPrefix}_${Date.now()}_${rand}.${finalExt}`;
  const filePath = path.join(MEDIA_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  if (finalExt === "mp4" && ensureH264Mp4(filePath)) {
    const newSize = fs.statSync(filePath).size;
    buffer = newSize <= 60 * 1024 * 1024 ? fs.readFileSync(filePath) : null;
  }

  return {
    filePath,
    fileName,
    buffer: buffer && buffer.length <= 60 * 1024 * 1024 ? buffer : null,
    mimetype: mime,
    sizeBytes: fs.statSync(filePath).size,
    cdnUrl: `${CDN_BASE}/${encodeURIComponent(fileName)}`,
  };
}

/**
 * Descarga usando yt-dlp local con WARP proxy y extractor PO Token de bgutil
 */
function downloadWithYtDlp(url, isAudio = false) {
  const rand = Math.random().toString(36).substring(7);
  const outTemplate = path.join(MEDIA_DIR, `media_%(title).40B_${rand}.%(ext)s`);
  const args = [
    "--proxy", "socks5://127.0.0.1:40000",
    "--remote-components", "ejs:github",
    "--extractor-args", "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416",
    "--no-playlist",
    "--restrict-filenames",
    "-o", outTemplate,
  ];

  if (fs.existsSync("/root/media/cookies.txt")) {
    args.push("--cookies", "/root/media/cookies.txt");
  }

  if (isAudio) {
    args.push("-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    // Priorizar video H.264 (avc1) + audio AAC (m4a) en contenedor MP4 para 100% compatibilidad con WhatsApp iOS/Android
    args.push(
      "-f",
      "bv*[vcodec^=avc][height<=720]+ba[acodec^=mp4a]/bv*[vcodec^=avc]+ba/b[vcodec^=avc]/bv*+ba/b",
      "--merge-output-format",
      "mp4"
    );
  }

  args.push(url);

  execSync(`/usr/local/bin/yt-dlp ${args.map((a) => `"${a}"`).join(" ")}`, {
    timeout: 180000,
  });

  // Buscar el archivo generado más reciente con el id único rand
  const files = fs.readdirSync(MEDIA_DIR).filter((f) => f.includes(rand));
  if (files.length === 0) throw new Error("No se pudo procesar la descarga del video/audio.");
  let fileName = files[0];
  let filePath = path.join(MEDIA_DIR, fileName);

  if (!isAudio) {
    ensureH264Mp4(filePath);
  }

  const stat = fs.statSync(filePath);

  // Verificar que el archivo no esté vacío o sea un HTML
  if (stat.size < 2048) {
    const preview = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" }).slice(0, 100).toLowerCase();
    if (preview.includes("<html") || preview.includes("<!doctype")) {
      fs.unlinkSync(filePath);
      throw new Error("El archivo descargado no es un medio válido.");
    }
  }

  const buffer = stat.size <= 60 * 1024 * 1024 ? fs.readFileSync(filePath) : null;
  return {
    filePath,
    fileName,
    buffer,
    sizeBytes: stat.size,
    cdnUrl: `${CDN_BASE}/${encodeURIComponent(fileName)}`,
  };
}

/**
 * Descarga usando gallery-dl para fotos / galerías
 */
function downloadWithGalleryDl(url) {
  const rand = Math.random().toString(36).substring(7);
  const destDir = path.join(MEDIA_DIR, `g_${rand}`);
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`gallery-dl -d "${destDir}" "${url}" 2>/dev/null`, { timeout: 60000 });

  function findFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) results = results.concat(findFiles(full));
      else results.push(full);
    }
    return results;
  }

  const allFiles = findFiles(destDir);
  if (allFiles.length === 0) throw new Error("No se encontraron imágenes");
  const first = allFiles[0];
  let fileName = path.basename(first);
  let targetPath = path.join(MEDIA_DIR, fileName);
  let buffer = fs.readFileSync(first);
  let mime = "image/jpeg";

  if (fileName.toLowerCase().endsWith(".svg") || buffer.toString("utf8", 0, 100).includes("<svg")) {
    try {
      execSync(`node -e 'const sharp=require("sharp"); sharp(process.argv[1]).png().toFile(process.argv[2])' "${first}" "${targetPath.replace(/\.svg$/i, ".png")}"`);
      fileName = fileName.replace(/\.svg$/i, ".png");
      targetPath = targetPath.replace(/\.svg$/i, ".png");
      buffer = fs.readFileSync(targetPath);
      mime = "image/png";
    } catch (e) {
      fs.copyFileSync(first, targetPath);
    }
  } else {
    fs.copyFileSync(first, targetPath);
  }

  try {
    fs.rmSync(destDir, { recursive: true, force: true });
  } catch (e) {}

  return {
    filePath: targetPath,
    fileName,
    buffer,
    mimetype: mime,
    sizeBytes: buffer.length,
    cdnUrl: `${CDN_BASE}/${encodeURIComponent(fileName)}`,
  };
}

/**
 * Procesador universal de descargas
 * @param {string} rawUrl - Enlace a descargar
 * @param {"auto"|"video"|"audio"|"foto"} mode - Modo deseado
 */
async function downloadMedia(rawUrl, mode = "auto") {
  const url = (rawUrl || "").trim();
  const lowerUrl = url.toLowerCase();

  // 1. Detección de fotos / imágenes directas
  const isImageExt = /\.(jpe?g|png|webp|gif|svg)($|\?)/i.test(lowerUrl);
  if (mode === "foto" || isImageExt) {
    if (isImageExt) {
      const ext = lowerUrl.split(".").pop().split("?")[0] || "jpg";
      const direct = await downloadDirectFile(url, ext, "foto");
      return {
        type: "image",
        title: "📸 Fotografía HD",
        ...direct,
      };
    }
    try {
      const gdl = downloadWithGalleryDl(url);
      return {
        type: "image",
        title: "📸 Imagen HD",
        ...gdl,
      };
    } catch (e) {}
  }

  // 2. Detección de enlaces de audio directo
  const isAudioExt = /\.(mp3|wav|m4a|ogg|flac)($|\?)/i.test(lowerUrl);
  if (isAudioExt) {
    const ext = lowerUrl.split(".").pop().split("?")[0] || "mp3";
    const direct = await downloadDirectFile(url, ext, "audio");
    return {
      type: "audio",
      title: "🎵 Pista de audio descargada",
      mimetype: "audio/mp4",
      ...direct,
    };
  }

  // 3. TikTok
  if (/tiktok\.com/i.test(lowerUrl)) {
    try {
      const tt = await scraper.ttdl(url);
      if (tt && (tt.video || tt.video_hd)) {
        if (mode === "audio" && tt.music) {
          const direct = await downloadDirectFile(tt.music, "mp3", tt.title || "tiktok_music");
          return {
            type: "audio",
            title: `🎵 ${tt.title || "TikTok Audio"} (${tt.author || ""})`,
            mimetype: "audio/mp4",
            ...direct,
          };
        }
        const videoUrl = tt.video_hd || tt.video;
        const direct = await downloadDirectFile(videoUrl, "mp4", tt.title || "tiktok_video");
        return {
          type: "video",
          title: `🎬 ${tt.title || "TikTok Video"} (@${tt.username || "tiktok"})`,
          mimetype: "video/mp4",
          ...direct,
        };
      }
    } catch (e) {}
  }

  // 4. Instagram
  if (/instagram\.com/i.test(lowerUrl)) {
    try {
      const ig = (await scraper.igdl(url)) || (await scraper.igdl2(url));
      if (ig && ig.data && ig.data.length > 0) {
        const item = ig.data[0];
        const mediaUrl = item.url || item;
        const isVid = item.type === "video" || /\.mp4/i.test(mediaUrl);
        const direct = await downloadDirectFile(mediaUrl, isVid ? "mp4" : "jpg", "instagram");
        return {
          type: isVid ? "video" : "image",
          title: "📸 Instagram Media HD",
          mimetype: isVid ? "video/mp4" : "image/jpeg",
          ...direct,
        };
      }
    } catch (e) {}
  }

  // 5. Facebook
  if (/facebook\.com|fb\.watch/i.test(lowerUrl)) {
    try {
      const fb = await scraper.fbdl(url);
      const fbVideo = fb?.video_hd || fb?.video_sd;
      if (fbVideo) {
        const direct = await downloadDirectFile(fbVideo, "mp4", fb.title || "facebook");
        return {
          type: "video",
          title: `🎬 ${fb.title || "Facebook Video"}`,
          mimetype: "video/mp4",
          ...direct,
        };
      }
    } catch (e) {}
  }

  // 6. YouTube (Música / Video)
  if (/youtube\.com|youtu\.be/i.test(lowerUrl)) {
    const isAudioMode = mode === "audio" || mode === "musica" || mode === "mp3";
    const ytRes = downloadWithYtDlp(url, isAudioMode);
    return {
      type: isAudioMode ? "audio" : "video",
      title: isAudioMode ? "🎵 Pista de Audio de YouTube" : "🎬 Video de YouTube HD (720p H.264)",
      mimetype: isAudioMode ? "audio/mp4" : "video/mp4",
      ...ytRes,
    };
  }

  // 7. Plataformas generales soportadas por yt-dlp (X/Twitter, SoundCloud, Pinterest, Vimeo, etc.)
  try {
    const isAudioMode = mode === "audio" || mode === "musica" || mode === "mp3";
    const ytRes = downloadWithYtDlp(url, isAudioMode);
    return {
      type: isAudioMode ? "audio" : "video",
      title: isAudioMode ? "🎵 Pista de Audio Extraída" : "🎬 Video Descargado HD",
      mimetype: isAudioMode ? "audio/mp4" : "video/mp4",
      ...ytRes,
    };
  } catch (errYt) {
    // 8. Sólo si el enlace tiene una extensión de archivo explícita, intentar descarga directa
    const hasMediaExt = /\.(mp4|m4v|mkv|mov|avi|webm|mp3|wav|m4a|ogg|flac|jpe?g|png|webp|gif)($|\?)/i.test(lowerUrl);
    if (hasMediaExt) {
      try {
        const ext = lowerUrl.split(".").pop().split("?")[0] || "mp4";
        const direct = await downloadDirectFile(url, ext, "archivo");
        const isAudio = ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext);
        const isImg = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        return {
          type: isImg ? "image" : isAudio ? "audio" : "video",
          title: "📁 Archivo multimedia directo",
          ...direct,
        };
      } catch (e) {
        throw new Error(`No se pudo descargar el archivo directo: ${e.message}`);
      }
    }
    throw new Error(`No se pudo descargar el enlace. Asegúrate de que el video o contenido sea público.`);
  }
}

module.exports = {
  downloadMedia,
  MEDIA_DIR,
  CDN_BASE,
};
