import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFile, writeFile, rename, mkdir, copyFile, stat, readdir, unlink } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import JSZip from "jszip";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const markedModule = join(root, "node_modules", "marked", "lib", "marked.esm.js");
const fontRoot = join(root, "node_modules", "@fontsource", "literata", "files");
const bundledData = join(root, "data", "library.json");
const dataRoot = process.env.DATA_DIR || join(root, "data");
const dataFile = join(dataRoot, "library.json");
const mediaRoot = join(dataRoot, "media");
const backupRoot = join(dataRoot, "backups");
const port = Number(process.env.PORT || 4180);
const appVersion = safeBuildVersion(process.env.APP_VERSION || "development");
const adminSecret = process.env.ADMIN_PASSWORD;
const secureCookie = process.env.COOKIE_SECURE === "true";
const trustedProxyHops = Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || 0);
const revokedSessions = new Map();
const attempts = new Map();
let mutationQueue = Promise.resolve();
const derivePassword = promisify(scrypt);
let activeExports = 0;
const exportWaiters = [];
const exportCache = new Map();
let exportCacheBytes = 0;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function serializeMutation(task) { const next = mutationQueue.then(task, task); mutationQueue = next.catch(() => undefined); return next; }
async function limitedExport(task) { if (activeExports >= 2) { if (exportWaiters.length >= 8) throw new HttpError(503, "Der Exportdienst ist gerade ausgelastet. Bitte gleich erneut versuchen."); await new Promise((resolve) => exportWaiters.push(resolve)); } activeExports += 1; try { return await task(); } finally { activeExports -= 1; exportWaiters.shift()?.(); } }

function safeBuildVersion(value) { return /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : "development"; }

if (!adminSecret) {
  console.error("ADMIN_PASSWORD fehlt. Der Reader wird aus Sicherheitsgründen nicht gestartet.");
  process.exit(1);
}
const expectedPassword = await derivePassword(adminSecret, "oracle-reader-login", 64);

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif" };
const securityHeaders = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};
const send = (res, status, value, headers = {}) => { const outputHeaders = { ...securityHeaders, "Cache-Control": "no-store", ...headers }; let body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); const compressible = /^(?:text\/|application\/(?:json|javascript|manifest\+json))/i.test(outputHeaders["Content-Type"] || ""); const accepted = res._acceptEncoding || ""; if (compressible && body.length > 1024) { if (/\bbr\b/.test(accepted)) { body = brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } }); outputHeaders["Content-Encoding"] = "br"; } else if (/\bgzip\b/.test(accepted)) { body = gzipSync(body, { level: 6 }); outputHeaders["Content-Encoding"] = "gzip"; } if (outputHeaders["Content-Encoding"]) { outputHeaders.Vary = "Accept-Encoding"; delete outputHeaders["Content-Length"]; } } res.writeHead(status, outputHeaders); res.end(body); };
const json = (res, status, value, headers = {}) => send(res, status, JSON.stringify(value), { "Content-Type": types[".json"], ...headers });
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => item.trim().split(/=(.*)/s).slice(0, 2)));
const signSession = (payload) => createHmac("sha256", adminSecret).update(payload).digest("base64url");
function createSession() { const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 43_200_000, nonce: randomBytes(16).toString("base64url") })).toString("base64url"); return `${payload}.${signSession(payload)}`; }
function sessionExpiry(token) { try { const [payload, signature, extra] = String(token || "").split("."); if (!payload || !signature || extra) return 0; const expected = Buffer.from(signSession(payload)); const given = Buffer.from(signature); if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 0; const expires = Number(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).expires); return Number.isFinite(expires) ? expires : 0; } catch { return 0; } }
const isAdmin = (req) => {
  const token = parseCookies(req).oracle_reader_session; const expires = sessionExpiry(token);
  return Boolean(expires > Date.now() && !revokedSessions.has(token));
};
const requestBody = async (req, maximum = 6_000_000) => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new HttpError(413, "Datei ist zu groß."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "Ungültige JSON-Daten."); }
};
const requestBytes = async (req, maximum = 12_000_000) => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new HttpError(413, "Datei ist zu groß."); chunks.push(chunk); }
  return Buffer.concat(chunks);
};
const safeText = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const mediaPattern = /^\/media\/[a-f0-9]{32}\.(png|jpg|gif|webp|avif)$/;
function safeMediaPath(value, fallback = "") { const path = safeText(value === undefined ? fallback : value, 100); if (!path) return ""; if (!mediaPattern.test(path)) throw new HttpError(400, "Ungültiger Bildverweis."); return path; }
function imageExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "avif";
  return "";
}
const slug = (value) => safeText(value, 100).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomBytes(4).toString("hex");
const publicationStatus = (entry) => ["draft", "scheduled", "published"].includes(entry?.status) ? entry.status : "published";
const isPublished = (entry, now = Date.now()) => publicationStatus(entry) === "published" || (publicationStatus(entry) === "scheduled" && entry.publishAt && new Date(entry.publishAt).getTime() <= now);
function normalizeDueStatuses(books) { const normalized = structuredClone(books); for (const book of normalized) { if (book.status === "scheduled" && isPublished(book)) book.status = "published"; for (const chapter of book.chapters) { if (chapter.status === "scheduled" && isPublished(chapter)) chapter.status = "published"; for (const part of chapter.parts) if (part.status === "scheduled" && isPublished(part)) part.status = "published"; } } return normalized; }
function nextPublication(books) { const now = Date.now(); const dates = []; const add = (entry) => { const timestamp = entry?.status === "scheduled" ? new Date(entry.publishAt).getTime() : NaN; if (Number.isFinite(timestamp) && timestamp > now) dates.push(timestamp); }; for (const book of books) { add(book); for (const chapter of book.chapters) { add(chapter); for (const part of chapter.parts) add(part); } } return dates.length ? new Date(Math.min(...dates)).toISOString() : null; }
function publicBook(book, includeHidden = false) {
  const { previewToken, hidden, ...visible } = book;
  if (!includeHidden && visible.status === "scheduled" && isPublished(visible)) visible.status = "published";
  const chapters = (includeHidden ? book.chapters : book.chapters.filter((chapter) => !chapter.hidden && isPublished(chapter))).map((chapter) => { const { hidden: chapterHidden, ...chapterData } = chapter; if (!includeHidden && chapterData.status === "scheduled" && isPublished(chapterData)) chapterData.status = "published"; const sourceParts = includeHidden ? chapter.parts : chapter.parts.filter((part) => !part.hidden && isPublished(part)); return { ...chapterData, parts: sourceParts.map((part) => { const { hidden: partHidden, ...partData } = part; if (!includeHidden && partData.status === "scheduled" && isPublished(partData)) partData.status = "published"; return partData; }) }; });
  return syncReleaseDates({ ...visible, chapters });
}
function catalogBook(book) { const catalog = structuredClone(book); for (const chapter of catalog.chapters) for (const part of chapter.parts) delete part.content; return catalog; }
const oracleDescription = "ORACLE ist eine geheime Organisation für Fälle, die außerhalb jeder bekannten Ordnung liegen. Ihre Mitglieder besitzen ungewöhnliche Fähigkeiten – und tragen ebenso ungewöhnliche Lasten. Als sich übernatürliche Vorfälle häufen und längst vergessene Wesen zurückkehren, gerät das Team in einen Kampf um Kontrolle, Vertrauen und die Frage, wie viel Menschlichkeit im Angesicht des Unbegreiflichen bestehen bleibt. Eine düstere Mystery-Geschichte über gefundene Familie, uralte Legenden und die Dinge, die besser im Verborgenen geblieben wären.";
const numberFormats = new Set(["decimal", "pad2", "pad3", "pad4", "roman-upper", "roman-lower"]);
const defaultBookDisplay = () => ({ bookSingular: "Buch", bookPlural: "Bücher", chapterSingular: "Kapitel", chapterPlural: "Kapitel", partSingular: "Episode", partPlural: "Episoden", bookNumberFormat: "decimal", chapterNumberFormat: "decimal", partNumberFormat: "decimal" });
const oracleBookDisplay = () => ({ bookSingular: "Archiv", bookPlural: "Archive", chapterSingular: "Akte", chapterPlural: "Akten", partSingular: "Fragment", partPlural: "Fragmente", bookNumberFormat: "pad4", chapterNumberFormat: "pad4", partNumberFormat: "decimal" });
function normalizeBookDisplay(input, fallback = defaultBookDisplay()) {
  const value = input || {}; const text = (key) => safeText(value[key], 32) || fallback[key]; const number = (key) => numberFormats.has(value[key]) ? value[key] : fallback[key];
  return { bookSingular: text("bookSingular"), bookPlural: text("bookPlural"), chapterSingular: text("chapterSingular"), chapterPlural: text("chapterPlural"), partSingular: text("partSingular"), partPlural: text("partPlural"), bookNumberFormat: number("bookNumberFormat"), chapterNumberFormat: number("chapterNumberFormat"), partNumberFormat: number("partNumberFormat") };
}

function normalizedDate(value, fallback = "") { let timestamp = new Date(value).getTime(); if (!Number.isFinite(timestamp)) timestamp = new Date(fallback).getTime(); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null; }
function latestDate(values) { return values.map((value) => normalizedDate(value)).filter(Boolean).sort().at(-1) || null; }
function syncReleaseDates(book) {
  for (const chapter of book.chapters) chapter.releasedAt = latestDate(chapter.parts.filter((part) => isPublished(part)).map((part) => part.releasedAt));
  book.releasedAt = latestDate(book.chapters.filter((chapter) => isPublished(chapter)).map((chapter) => chapter.releasedAt));
  return book;
}

async function ensureData() { await mkdir(mediaRoot, { recursive: true }); await mkdir(backupRoot, { recursive: true }); try { await stat(dataFile); } catch { await copyFile(bundledData, dataFile); } }
const loadLibrary = async () => JSON.parse(await readFile(dataFile, "utf8"));
async function snapshotLibrary() { try { const name = `library-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.json`; await copyFile(dataFile, join(backupRoot, name)); const files = (await readdir(backupRoot)).filter((file) => /^library-[a-zA-Z0-9-]+\.json$/.test(file)).sort().reverse(); await Promise.all(files.slice(50).map((file) => unlink(join(backupRoot, file)))); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
let lastMediaPrune = 0;
async function pruneUnusedMedia() { const used = new Set(); const collect = (text) => { for (const match of text.matchAll(/\/media\/([a-f0-9]{32}\.(?:png|jpg|gif|webp|avif))/g)) used.add(match[1]); }; collect(await readFile(dataFile, "utf8")); for (const file of (await readdir(backupRoot)).filter((name) => name.endsWith(".json"))) { try { collect(await readFile(join(backupRoot, file), "utf8")); } catch {} } const cutoff = Date.now() - 86_400_000; await Promise.all((await readdir(mediaRoot)).filter((file) => /^[a-f0-9]{32}\.(?:png|jpg|gif|webp|avif)$/.test(file) && !used.has(file)).map(async (file) => { const path = join(mediaRoot, file); if ((await stat(path)).mtimeMs < cutoff) await unlink(path); })); }
const saveLibrary = async (library) => { library.books.forEach(syncReleaseDates); await snapshotLibrary(); const temp = `${dataFile}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(library, null, 2)}\n`, "utf8"); await rename(temp, dataFile); if (Date.now() - lastMediaPrune > 3_600_000) { lastMediaPrune = Date.now(); pruneUnusedMedia().catch((error) => console.error("Medienbereinigung fehlgeschlagen:", error)); } };
function validateBackup(value) {
  const invalid = () => { throw new HttpError(400, "Diese Datei ist kein gültiges OracReader-Backup."); }; if (!value || typeof value !== "object" || !Array.isArray(value.books) || value.books.length > 1000 || (value.links !== undefined && !Array.isArray(value.links))) invalid();
  const ids = new Set(); let parts = 0; let contentSize = 0; const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\/\\\0]/.test(id); const uniqueId = (id) => { if (!validId(id) || ids.has(id)) invalid(); ids.add(id); }; const validText = (text, maximum) => typeof text === "string" && text.length <= maximum;
  for (const book of value.books) {
    if (!book || typeof book !== "object" || !Array.isArray(book.chapters) || book.chapters.length > 5000 || !validText(book.title, 160) || !validText(book.description ?? "", 20_000)) invalid(); uniqueId(book.id); safeMediaPath(book.coverImage, "");
    for (const chapter of book.chapters) {
      if (!chapter || typeof chapter !== "object" || !Array.isArray(chapter.parts) || !validText(chapter.title, 160) || !validText(chapter.tldr ?? "", 3000)) invalid(); uniqueId(chapter.id); parts += chapter.parts.length; if (parts > 50_000) invalid();
      for (const part of chapter.parts) { if (!part || typeof part !== "object" || !validText(part.title, 160) || !validText(part.tldr ?? "", 3000) || !validText(part.content, 5_000_000)) invalid(); uniqueId(part.id); safeMediaPath(part.image, ""); contentSize += part.content.length; if (contentSize > 100_000_000) throw new HttpError(413, "Das Backup enthält zu viel Text."); }
    }
  }
  if ((value.links || []).length > 8 || (value.links || []).some((link) => !link || !validText(link.label ?? "", 60) || !validText(link.url ?? "", 500))) invalid(); return value;
}
function backupMediaNames(library) { const names = new Set(); for (const match of JSON.stringify(library).matchAll(/\/media\/([a-f0-9]{32}\.(?:png|jpg|gif|webp|avif))/g)) names.add(match[1]); return names; }
async function createBackupArchive(library) {
  const zip = new JSZip(); zip.file("library.json", `${JSON.stringify(library, null, 2)}\n`);
  for (const name of backupMediaNames(library)) { try { zip.file(`media/${name}`, await readFile(join(mediaRoot, name))); } catch (error) { if (error?.code === "ENOENT") throw new HttpError(409, `Das referenzierte Bild ${name} fehlt auf dem Server.`); throw error; } }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
async function parseBackup(bytes) {
  if (bytes.subarray(0, 2).toString("binary") !== "PK") { try { return { library: validateBackup(JSON.parse(bytes.toString("utf8"))), media: [] }; } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Diese Datei ist kein gültiges OracReader-Backup."); } }
  let zip; try { zip = await JSZip.loadAsync(bytes); } catch { throw new HttpError(400, "Das Backup-Archiv ist beschädigt."); }
  const libraryEntry = zip.file("library.json"); if (!libraryEntry) throw new HttpError(400, "Im Backup fehlt library.json.");
  const entries = Object.values(zip.files).filter((entry) => !entry.dir); if (entries.length > 1002) throw new HttpError(400, "Das Backup enthält zu viele Dateien.");
  const declaredSize = entries.reduce((sum, entry) => sum + Number(entry?._data?.uncompressedSize || 0), 0); if (declaredSize > 150_000_000) throw new HttpError(413, "Das entpackte Backup ist zu groß.");
  let library; try { library = validateBackup(JSON.parse(await libraryEntry.async("string"))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "library.json enthält ungültige Daten."); }
  const expected = backupMediaNames(library); const media = [];
  for (const entry of entries) {
    if (entry.name === "library.json") continue;
    const match = entry.name.match(/^media\/([a-f0-9]{32}\.(png|jpg|gif|webp|avif))$/); if (!match || !expected.has(match[1])) throw new HttpError(400, "Das Backup enthält eine unerwartete Datei.");
    const content = await entry.async("nodebuffer"); if (content.length > 12_000_000 || imageExtension(content) !== match[2]) throw new HttpError(400, `Ungültige Mediendatei im Backup: ${match[1]}`); media.push([match[1], content]);
  }
  if (media.length !== expected.size) throw new HttpError(400, "Im Backup fehlen referenzierte Bilder.");
  return { library, media };
}
async function restoreBackup(restored) {
  const supplied = new Map(restored.media); const installed = [];
  for (const name of backupMediaNames(restored.library)) {
    const destination = join(mediaRoot, name); let existing = null; try { existing = await readFile(destination); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const content = supplied.get(name); if (existing) { if (content && !existing.equals(content)) throw new HttpError(409, `Die Mediendatei ${name} widerspricht der vorhandenen Datei.`); continue; }
    if (!content) throw new HttpError(400, `Im Backup fehlt das referenzierte Bild ${name}.`); const temporary = join(mediaRoot, `.${name}.${randomBytes(4).toString("hex")}.tmp`); await writeFile(temporary, content); await rename(temporary, destination); installed.push(destination);
  }
  try { await saveLibrary(restored.library); } catch (error) { await Promise.all(installed.map((path) => unlink(path).catch(() => undefined))); throw error; }
}
async function migrateLibrary() {
  const library = await loadLibrary(); let changed = false; const schemaVersion = Number(library.schemaVersion) || 1;
  if (!library.settings) { library.settings = { numberDigits: 4 }; changed = true; }
  library.books.forEach((book, index) => { if (!Number.isInteger(book.number)) { const stored = book.id?.match(/oracle-(\d+)/)?.[1]; book.number = stored !== undefined ? Number(stored) : index; changed = true; } if (book.kicker === "ORACLE · CHRONIK") { book.kicker = "ORACLE · ARCHIV"; changed = true; } if (book.description?.startsWith("Eine Chronik aus dem ORACLE-Universum.")) { book.description = book.description.replace("Eine Chronik aus dem ORACLE-Universum.", "Ein Eintrag des ORACLE-Archivs."); changed = true; } });
  if (schemaVersion < 3) {
    library.books.forEach((book) => { const official = book.id?.match(/^oracle-(\d+)$/)?.[1]; if (official !== undefined && book.chapters.length === 1 && book.chapters[0].number !== Number(official)) { book.chapters[0].number = Number(official); changed = true; } });
    library.schemaVersion = 3; changed = true;
  }
  if (schemaVersion < 4) {
    library.books.forEach((book) => {
      const legacyTldr = safeText(book.tldr, 3000);
      book.chapters.forEach((chapter, index) => {
        if (typeof chapter.tldr !== "string") { chapter.tldr = index === 0 ? legacyTldr : ""; changed = true; }
        chapter.parts.forEach((part) => { if (typeof part.tldr !== "string") { part.tldr = ""; changed = true; } });
      });
      if (Object.hasOwn(book, "tldr")) { delete book.tldr; changed = true; }
    });
    library.schemaVersion = 4; changed = true;
  }
  if (schemaVersion < 5) {
    library.books.forEach((book) => {
      book.chapters.forEach((chapter, index) => {
        if (!Number.isInteger(chapter.order)) { chapter.order = index; changed = true; }
      });
    });
    library.schemaVersion = 5; changed = true;
  }
  if (schemaVersion < 6) {
    library.books.forEach((book) => {
      if (book.status !== "published" && !/^[a-zA-Z0-9_-]{24,80}$/.test(book.previewToken || "")) { book.previewToken = randomBytes(24).toString("base64url"); changed = true; }
      if (book.status === "published" && Object.hasOwn(book, "previewToken")) { delete book.previewToken; changed = true; }
    });
    library.schemaVersion = 6; changed = true;
  }
  if (schemaVersion < 7) {
    const target = library.books.find((book) => book.id === "oracle-0000");
    const sourceBooks = [1, 2, 3].map((number) => library.books.find((book) => book.id === `oracle-${String(number).padStart(4, "0")}`));
    const canConsolidate = target?.chapters?.some((chapter) => chapter.number === 0) && sourceBooks.every((book, index) => book?.chapters?.length === 1 && book.chapters[0].number === index + 1);
    if (canConsolidate) {
      target.title = target.title === "Prolog" ? "Oracle" : target.title;
      if (/^Ein Eintrag des ORACLE-Archivs\./.test(target.description || "")) target.description = oracleDescription;
      const officialNumbers = new Set(sourceBooks.map((book) => book.chapters[0].number));
      const occupiedNumbers = new Set([...target.chapters.map((chapter) => chapter.number), ...officialNumbers]);
      let nextNumber = Math.max(-1, ...occupiedNumbers) + 1;
      target.chapters.forEach((chapter) => { if (officialNumbers.has(chapter.number)) { while (occupiedNumbers.has(nextNumber)) nextNumber += 1; chapter.number = nextNumber; occupiedNumbers.add(nextNumber); nextNumber += 1; } });
      target.chapters = [...target.chapters, ...sourceBooks.map((book) => book.chapters[0])].sort((a, b) => a.number - b.number).map((chapter, order) => ({ ...chapter, order }));
      target.updatedAt = [target, ...sourceBooks].map((book) => book.updatedAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
      const mergedIds = new Set(sourceBooks.map((book) => book.id));
      library.books = library.books.filter((book) => !mergedIds.has(book.id));
      changed = true;
    }
    library.schemaVersion = 7; changed = true;
  }
  if (schemaVersion < 8) {
    library.books.forEach((book) => { book.display = normalizeBookDisplay(book.display, book.id === "oracle-0000" ? oracleBookDisplay() : defaultBookDisplay()); });
    library.schemaVersion = 8; changed = true;
  }
  if (schemaVersion < 9) {
    library.books.forEach((book) => { book.hidden = Boolean(book.hidden); book.chapters.forEach((chapter) => { chapter.hidden = Boolean(chapter.hidden); chapter.parts.forEach((part) => { part.hidden = Boolean(part.hidden); }); }); });
    library.schemaVersion = 9; changed = true;
  }
  if (schemaVersion < 10) {
    const migratedAt = new Date().toISOString().slice(0, 10);
    library.books.forEach((book) => book.chapters.forEach((chapter) => chapter.parts.forEach((part) => { part.releasedAt = normalizedDate(part.releasedAt, chapter.releasedAt || book.releasedAt || book.updatedAt || migratedAt); })));
    library.schemaVersion = 10; changed = true;
  }
  if (schemaVersion < 11) {
    library.books.forEach((book) => { book.coverImage = safeMediaPath(book.coverImage); book.chapters.forEach((chapter) => chapter.parts.forEach((part) => { part.image = safeMediaPath(part.image); })); });
    library.schemaVersion = 11; changed = true;
  }
  if (schemaVersion < 12) {
    library.books.forEach((book) => book.chapters.forEach((chapter) => chapter.parts.forEach((part) => { part.status = "published"; part.publishAt = null; })));
    library.schemaVersion = 12; changed = true;
  }
  if (schemaVersion < 13) {
    library.links = (library.links || []).filter((link) => safeText(link.label, 60).toLocaleLowerCase("de") !== "oracledb" && !/^https?:\/\/oracledb\.ishiku\.de(?:\/|$)/i.test(safeText(link.url, 500)));
    library.schemaVersion = 13; changed = true;
  }
  if (schemaVersion < 14) {
    library.books.forEach((book) => book.chapters.forEach((chapter) => { chapter.status = "published"; chapter.publishAt = null; }));
    library.schemaVersion = 14; changed = true;
  }
  if (changed) await saveLibrary(library);
}

function validateBook(input, old = null) {
  const title = safeText(input.title, 160); const description = safeText(input.description, 2000);
  const number = Number(input.number);
  if (!title || !description || !Number.isInteger(number) || number < 0) throw new HttpError(400, "Offizielle Nummer, Name und Beschreibung sind Pflichtfelder.");
  const status = ["draft", "scheduled", "published"].includes(input.status) ? input.status : "draft";
  let publishAt = null;
  if (status === "scheduled") { const timestamp = new Date(input.publishAt).getTime(); if (!Number.isFinite(timestamp)) throw new HttpError(400, "Für eine geplante Veröffentlichung wird ein Datum benötigt."); publishAt = new Date(timestamp).toISOString(); }
  const needsPreview = status !== "published";
  const previewToken = needsPreview ? (old?.status !== "published" && /^[a-zA-Z0-9_-]{24,80}$/.test(old?.previewToken || "") ? old.previewToken : randomBytes(24).toString("base64url")) : undefined;
  const book = { id: old?.id || `${slug(title)}-${Date.now().toString(36)}`, number, title, kicker: safeText(input.kicker, 80) || "ORACLE · ARCHIV", description, status, publishAt, updatedAt: new Date().toISOString(), chapters: old?.chapters || [], display: normalizeBookDisplay(old?.display), coverImage: safeMediaPath(input.coverImage, old?.coverImage), hidden: input.hidden === undefined ? old?.hidden === true : input.hidden === true };
  if (previewToken) book.previewToken = previewToken;
  return book;
}
function validateChapter(input, old = null) {
  const number = Number(input.number); const title = safeText(input.title, 160); const tldr = safeText(input.tldr, 3000);
  if (!Number.isInteger(number) || number < 0 || !title) throw new HttpError(400, "Kapitelnummer (ab 0) und Kapitelname sind Pflichtfelder.");
  const status = ["draft", "scheduled", "published"].includes(input.status) ? input.status : old ? publicationStatus(old) : "draft"; let publishAt = null;
  if (status === "scheduled") { const timestamp = new Date(input.publishAt).getTime(); if (!Number.isFinite(timestamp)) throw new HttpError(400, "Für ein geplantes Kapitel wird ein Datum mit Uhrzeit benötigt."); publishAt = new Date(timestamp).toISOString(); }
  return { id: old?.id || `chapter-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, number, title, tldr, status, publishAt, order: old?.order ?? 0, parts: old?.parts || [], hidden: input.hidden === undefined ? old?.hidden === true : input.hidden === true };
}
function validatePart(input, old = null) {
  const chapterId = safeText(input.chapterId, 200); const partNumber = Number(input.part); const title = safeText(input.partTitle, 160); const tldr = safeText(input.tldr, 3000); const content = String(input.content || "").trim().slice(0, 5_000_000);
  if (!chapterId || !Number.isInteger(partNumber) || partNumber < 1 || !title || !content) throw new HttpError(400, "Kapitel, Teilnummer (ab 1), Teilname und Text sind Pflichtfelder.");
  const releasedAt = normalizedDate(input.releasedAt, old?.releasedAt || new Date().toISOString().slice(0, 10));
  if (!releasedAt) throw new HttpError(400, "Für den Teil wird ein gültiges Releasedatum benötigt.");
  const status = ["draft", "scheduled", "published"].includes(input.status) ? input.status : publicationStatus(old);
  let publishAt = null;
  if (status === "scheduled") { const timestamp = new Date(input.publishAt).getTime(); if (!Number.isFinite(timestamp)) throw new HttpError(400, "Für eine geplante Veröffentlichung wird ein Datum mit Uhrzeit benötigt."); publishAt = new Date(timestamp).toISOString(); }
  return { chapterId, part: { id: old?.id || `part-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, number: partNumber, title, tldr, content, releasedAt, status, publishAt, image: safeMediaPath(input.image, old?.image), hidden: input.hidden === undefined ? old?.hidden === true : input.hidden === true } };
}
function findPart(book, partId) { for (const chapter of book.chapters) { const index = chapter.parts.findIndex((part) => part.id === partId); if (index >= 0) return { chapter, index, part: chapter.parts[index] }; } return null; }
function sortContent(book) { book.chapters.sort((a,b) => (a.order ?? a.number) - (b.order ?? b.number) || a.number - b.number); for (const chapter of book.chapters) chapter.parts.sort((a,b) => a.number - b.number); }
const hasContent = (book) => book.chapters.some((chapter) => chapter.parts.length > 0);
const hasReleasableContent = (book) => book.chapters.some((chapter) => publicationStatus(chapter) !== "draft" && chapter.parts.some((part) => publicationStatus(part) !== "draft" && !part.hidden));
const partCountAfter = (book, removed) => book.chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0) - removed;
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { const host = req.headers["x-forwarded-host"] || req.headers.host; return new URL(origin).host === host; } catch { return false; } }
function clientAddress(req) { const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((value) => value.trim()).filter(Boolean); return trustedProxyHops > 0 && forwarded.length >= trustedProxyHops ? forwarded.at(-trustedProxyHops) : req.socket.remoteAddress || "unknown"; }

async function api(req, res, url) {
  if (["POST", "PUT", "DELETE"].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: "Ungültige Anfrage." });
  if (req.method === "GET" && url.pathname === "/api/health") { await loadLibrary(); return json(res, 200, { ok: true, version: appVersion }); }
  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = clientAddress(req); const now = Date.now(); let entry = attempts.get(ip) || { count: 0, until: 0, updatedAt: now }; if (now - entry.updatedAt > 300_000) entry = { count: 0, until: 0, updatedAt: now };
    if (entry.until > Date.now()) return json(res, 429, { error: "Zu viele Versuche. Bitte kurz warten." });
    const input = await requestBody(req); const given = await derivePassword(String(input.password || ""), "oracle-reader-login", 64);
    if (!timingSafeEqual(given, expectedPassword)) { entry.count += 1; entry.updatedAt = Date.now(); if (entry.count >= 5) { entry.until = Date.now() + 60_000; entry.count = 0; } attempts.set(ip, entry); return json(res, 401, { error: "Anmeldung fehlgeschlagen." }); }
    attempts.delete(ip); const token = createSession();
    const flags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie ? "; Secure" : ""}`;
    return json(res, 200, { ok: true }, { "Set-Cookie": `oracle_reader_session=${token}; ${flags}` });
  }
  if (req.method === "POST" && url.pathname === "/api/logout") { const token = parseCookies(req).oracle_reader_session; const expires = sessionExpiry(token); if (expires > Date.now()) revokedSessions.set(token, expires); return json(res, 200, { ok: true }, { "Set-Cookie": "oracle_reader_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" }); }
  if (req.method === "GET" && url.pathname === "/api/session") return json(res, 200, { admin: isAdmin(req) });
  const library = await loadLibrary();
  if (req.method === "GET" && ["/api/library", "/api/offline-library"].includes(url.pathname)) { const admin = isAdmin(req); library.books.forEach(syncReleaseDates); const fullBooks = library.books.filter((book) => isPublished(book) && !book.hidden).map((book) => publicBook(book)).filter(hasContent); const books = url.pathname === "/api/library" && !admin ? fullBooks.map(catalogBook) : fullBooks; return json(res, 200, { books, ...(admin ? { adminBooks: normalizeDueStatuses(library.books) } : {}), links: library.links || [], settings: library.settings || { numberDigits: 4 }, nextPublishAt: nextPublication(library.books), admin, version: appVersion }); }
  const publicBookMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if (req.method === "GET" && publicBookMatch) { const source = library.books.find((item) => item.id === decodeURIComponent(publicBookMatch[1]) && isPublished(item) && !item.hidden); const book = source && publicBook(source); return book && hasContent(book) ? json(res, 200, { book }) : json(res, 404, { error: "Buch nicht gefunden." }); }
  const exportMatch = url.pathname.match(/^\/api\/export\/(epub|pdf)\/(book|chapter|part)\/([^/]+)(?:\/([^/]+))?$/);
  if (req.method === "GET" && exportMatch) {
    const { createExport, selectExport } = await import("./exports.mjs");
    const [, format, scope, encodedBookId, encodedContentId = ""] = exportMatch; const bookId = decodeURIComponent(encodedBookId); const contentId = decodeURIComponent(encodedContentId);
    const source = library.books.find((item) => item.id === bookId && isPublished(item) && !item.hidden); const book = source && publicBook(source); const selection = book && hasContent(book) ? selectExport(book, scope, contentId) : null;
    if (!selection) return json(res, 404, { error: "Der gewünschte veröffentlichte Inhalt wurde nicht gefunden." });
    const sourceSize = selection.chapters.reduce((total, chapter) => total + chapter.parts.reduce((sum, part) => sum + String(part.content || "").length, 0), 0); if (sourceSize > 20_000_000) return json(res, 413, { error: "Dieser Export ist zu groß. Bitte einzelne Kapitel herunterladen." });
    const cacheKey = createHash("sha256").update(format).update(JSON.stringify(selection)).digest("hex"); let exported = exportCache.get(cacheKey);
    if (!exported) { exported = await limitedExport(() => createExport(selection, format, { readMedia: (filename) => readFile(join(mediaRoot, filename)) })); if (exported.bytes.length <= 16_000_000) { exportCache.set(cacheKey, exported); exportCacheBytes += exported.bytes.length; while (exportCache.size > 8 || exportCacheBytes > 64_000_000) { const oldest = exportCache.keys().next().value; exportCacheBytes -= exportCache.get(oldest).bytes.length; exportCache.delete(oldest); } } }
    const asciiName = exported.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    return send(res, 200, exported.bytes, { "Content-Type": exported.type, "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(exported.filename)}`, "Content-Length": String(exported.bytes.length), "Cache-Control": "private, no-store" });
  }
  const previewMatch = url.pathname.match(/^\/api\/preview\/([a-zA-Z0-9_-]{24,80})$/);
  if (req.method === "GET" && previewMatch) { const book = library.books.find((item) => !isPublished(item) && item.previewToken === previewMatch[1]); return book ? json(res, 200, { book: publicBook(book, true) }) : json(res, 404, { error: "Vorschau nicht gefunden." }); }
  if (url.pathname.startsWith("/api/admin/") && !isAdmin(req)) return json(res, 401, { error: "Admin-Anmeldung erforderlich." });

  if (req.method === "GET" && url.pathname === "/api/admin/backup") return send(res, 200, await createBackupArchive(library), { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="oracreader-backup-${new Date().toISOString().slice(0, 10)}.zip"` });
  if (req.method === "PUT" && url.pathname === "/api/admin/backup") { const restored = await parseBackup(await requestBytes(req, 120_000_000)); await restoreBackup(restored); return json(res, 200, { ok: true, media: restored.media.length }); }
  if (req.method === "GET" && url.pathname === "/api/admin/backups") { const files = (await readdir(backupRoot)).filter((file) => /^library-[a-zA-Z0-9-]+\.json$/.test(file)).sort().reverse(); return json(res, 200, files.slice(0, 50)); }
  const restoreMatch = url.pathname.match(/^\/api\/admin\/backups\/(library-[a-zA-Z0-9-]+\.json)\/restore$/);
  if (req.method === "POST" && restoreMatch) { const restored = validateBackup(JSON.parse(await readFile(join(backupRoot, restoreMatch[1]), "utf8"))); await saveLibrary(restored); return json(res, 200, { ok: true }); }

  if (req.method === "POST" && url.pathname === "/api/admin/media") {
    const bytes = await requestBytes(req); const extension = imageExtension(bytes);
    if (!extension) return json(res, 415, { error: "Unterstützt werden PNG, JPEG, GIF, WebP und AVIF." });
    const filename = `${randomBytes(16).toString("hex")}.${extension}`; await writeFile(join(mediaRoot, filename), bytes);
    return json(res, 201, { url: `/media/${filename}` });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/books") { const book = validateBook(await requestBody(req)); if (book.status !== "draft") return json(res, 409, { error: "Ein neuer Archiveintrag muss vor dem Veröffentlichen mindestens einen Teil enthalten." }); if (library.books.some((item) => item.number === book.number)) return json(res, 409, { error: "Diese offizielle Nummer ist bereits vergeben." }); library.books.unshift(book); await saveLibrary(library); return json(res, 201, book); }
  const bookMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)$/); const book = bookMatch ? library.books.find((item) => item.id === decodeURIComponent(bookMatch[1])) : null;
  if (bookMatch && !book) return json(res, 404, { error: "Archiveintrag nicht gefunden." });
  if (req.method === "PUT" && bookMatch) { const updated = validateBook(await requestBody(req), book); if (library.books.some((item) => item !== book && item.number === updated.number)) return json(res, 409, { error: "Diese offizielle Nummer ist bereits vergeben." }); if (updated.status !== "draft" && !hasReleasableContent(updated)) return json(res, 409, { error: "Ein Buch benötigt mindestens ein freigegebenes oder geplantes Kapitel mit einem freigegebenen oder geplanten Teil." }); if (updated.status === "published") delete book.previewToken; Object.assign(book, updated); await saveLibrary(library); return json(res, 200, book); }
  if (req.method === "DELETE" && bookMatch) { library.books.splice(library.books.indexOf(book), 1); await saveLibrary(library); return json(res, 200, { ok: true }); }

  if (req.method === "PUT" && url.pathname === "/api/admin/chapters/move") {
    const input = await requestBody(req); const sourceBookId = safeText(input.sourceBookId, 200); const targetBookId = safeText(input.targetBookId, 200); const chapterId = safeText(input.chapterId, 200); const targetChapterId = safeText(input.targetChapterId, 200);
    const source = library.books.find((item) => item.id === sourceBookId); const target = library.books.find((item) => item.id === targetBookId); const chapter = source?.chapters.find((item) => item.id === chapterId);
    if (!source || !target || !chapter) return json(res, 404, { error: "Archiveintrag oder Kapitel nicht gefunden." });
    if (source !== target && target.chapters.some((item) => item.number === chapter.number)) return json(res, 409, { error: `Kapitel ${chapter.number} ist im Ziel bereits vorhanden.` });
    if (source === target && targetChapterId === chapter.id) return json(res, 200, { source, target, sourceBecameDraft: false });
    source.chapters.splice(source.chapters.indexOf(chapter), 1);
    let targetIndex = targetChapterId ? target.chapters.findIndex((item) => item.id === targetChapterId) : target.chapters.length;
    if (targetIndex < 0) targetIndex = target.chapters.length; else if (input.placeAfter === true) targetIndex += 1;
    target.chapters.splice(targetIndex, 0, chapter);
    source.chapters.forEach((item, order) => { item.order = order; }); target.chapters.forEach((item, order) => { item.order = order; });
    const now = new Date().toISOString(); source.updatedAt = now; target.updatedAt = now; let sourceBecameDraft = false;
    if (source !== target && !hasContent(source) && source.status !== "draft") { source.status = "draft"; source.publishAt = null; source.previewToken = randomBytes(24).toString("base64url"); sourceBecameDraft = true; }
    await saveLibrary(library); return json(res, 200, { source, target, sourceBecameDraft });
  }

  const chapterCollection = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/chapters$/);
  if (req.method === "POST" && chapterCollection) {
    const target = library.books.find((item) => item.id === decodeURIComponent(chapterCollection[1])); if (!target) return json(res, 404, { error: "Archiveintrag nicht gefunden." });
    const chapter = validateChapter(await requestBody(req)); if (target.chapters.some((item) => item.number === chapter.number)) return json(res, 409, { error: "Diese Kapitelnummer ist im Archiveintrag bereits vergeben." });
    chapter.order = Math.max(-1, ...target.chapters.map((item) => item.order ?? item.number)) + 1;
    target.chapters.push(chapter); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 201, chapter);
  }
  const chapterOrderMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/chapters\/order$/);
  if (req.method === "PUT" && chapterOrderMatch) {
    const target = library.books.find((item) => item.id === decodeURIComponent(chapterOrderMatch[1])); if (!target) return json(res, 404, { error: "Archiveintrag nicht gefunden." });
    const input = await requestBody(req); const chapterIds = (input.chapterIds || []).map((id) => safeText(id, 200)); const knownIds = new Set(target.chapters.map((chapter) => chapter.id));
    if (chapterIds.length !== target.chapters.length || new Set(chapterIds).size !== chapterIds.length || chapterIds.some((id) => !knownIds.has(id))) return json(res, 400, { error: "Die Kapitelsortierung ist unvollständig oder ungültig." });
    chapterIds.forEach((id, order) => { target.chapters.find((chapter) => chapter.id === id).order = order; }); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, target.chapters);
  }
  const chapterMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/chapters\/([^/]+)$/);
  if (chapterMatch) {
    const target = library.books.find((item) => item.id === decodeURIComponent(chapterMatch[1])); const chapter = target?.chapters.find((item) => item.id === decodeURIComponent(chapterMatch[2])); if (!target || !chapter) return json(res, 404, { error: "Kapitel nicht gefunden." });
    if (req.method === "PUT") { const updated = validateChapter(await requestBody(req), chapter); if (target.chapters.some((item) => item !== chapter && item.number === updated.number)) return json(res, 409, { error: "Diese Kapitelnummer ist im Archiveintrag bereits vergeben." }); Object.assign(chapter, updated); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, chapter); }
    if (req.method === "DELETE") { if (target.status !== "draft" && partCountAfter(target, chapter.parts.length) === 0) return json(res, 409, { error: "Der letzte Teil eines veröffentlichten Archiveintrags kann nicht gelöscht werden. Setze ihn zuerst auf Entwurf." }); target.chapters.splice(target.chapters.indexOf(chapter), 1); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, { ok: true }); }
  }

  const partCollection = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/parts$/);
  if (req.method === "POST" && partCollection) {
    const target = library.books.find((item) => item.id === decodeURIComponent(partCollection[1])); if (!target) return json(res, 404, { error: "Archiveintrag nicht gefunden." });
    const valid = validatePart(await requestBody(req)); const chapter = target.chapters.find((item) => item.id === valid.chapterId); if (!chapter) return json(res, 404, { error: "Kapitel nicht gefunden." });
    if (chapter.parts.some((part) => part.number === valid.part.number)) return json(res, 409, { error: "Diese Teilnummer ist im Kapitel bereits vergeben." });
    chapter.parts.push(valid.part); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 201, valid.part);
  }
  const partMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/parts\/([^/]+)$/);
  if (partMatch) {
    const target = library.books.find((item) => item.id === decodeURIComponent(partMatch[1])); const found = target && findPart(target, decodeURIComponent(partMatch[2])); if (!found) return json(res, 404, { error: "Teil nicht gefunden." });
    if (req.method === "PUT") { const valid = validatePart(await requestBody(req), found.part); const destination = target.chapters.find((item) => item.id === valid.chapterId); if (!destination) return json(res, 404, { error: "Kapitel nicht gefunden." }); if (destination.parts.some((part) => part.id !== found.part.id && part.number === valid.part.number)) return json(res, 409, { error: "Diese Teilnummer ist im Kapitel bereits vergeben." }); found.chapter.parts.splice(found.index, 1); destination.parts.push(valid.part); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, valid.part); }
    if (req.method === "DELETE") { if (target.status !== "draft" && partCountAfter(target, 1) === 0) return json(res, 409, { error: "Der letzte Teil eines veröffentlichten Archiveintrags kann nicht gelöscht werden. Setze ihn zuerst auf Entwurf." }); found.chapter.parts.splice(found.index, 1); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, { ok: true }); }
  }
  const displayMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/display$/);
  if (req.method === "PUT" && displayMatch) { const target = library.books.find((item) => item.id === decodeURIComponent(displayMatch[1])); if (!target) return json(res, 404, { error: "Buch nicht gefunden." }); target.display = normalizeBookDisplay(await requestBody(req), target.display || defaultBookDisplay()); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, target.display); }
  if (req.method === "PUT" && url.pathname === "/api/admin/links") { const input = await requestBody(req); library.links = (input.links || []).slice(0,8).map((link) => ({ label: safeText(link.label,60), url: safeText(link.url,500) })).filter((link) => link.label && (/^https?:\/\/\S+$/i.test(link.url) || /^discord:\/\/\S+$/i.test(link.url))); await saveLibrary(library); return json(res, 200, library.links); }
  if (req.method === "PUT" && url.pathname === "/api/admin/settings") { const input = await requestBody(req); const numberDigits = Number(input.numberDigits); if (![1,2,3,4].includes(numberDigits)) return json(res, 400, { error: "Ungültiges Nummernformat." }); library.settings = { ...(library.settings || {}), numberDigits }; await saveLibrary(library); return json(res, 200, library.settings); }
  return json(res, 404, { error: "Nicht gefunden." });
}

await ensureData();
await migrateLibrary();
const cleanupTimer = setInterval(() => { const now = Date.now(); for (const [token, expires] of revokedSessions) if (expires < now) revokedSessions.delete(token); for (const [address, entry] of attempts) if (now - entry.updatedAt > 300_000 && entry.until < now) attempts.delete(address); }, 300_000);
cleanupTimer.unref();
createServer(async (req, res) => {
  try {
    res._acceptEncoding = String(req.headers["accept-encoding"] || "");
    if (secureCookie && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "http") { const host = req.headers["x-forwarded-host"] || req.headers.host; return send(res, 308, "HTTPS erforderlich", { Location: `https://${host}${req.url}`, "Content-Type": "text/plain; charset=utf-8" }); }
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); if (url.pathname.startsWith("/api/")) return await (["POST", "PUT", "DELETE"].includes(req.method) ? serializeMutation(() => api(req, res, url)) : api(req, res, url));
    if (mediaPattern.test(url.pathname)) { const file = join(mediaRoot, url.pathname.slice("/media/".length)); const extension = extname(file); return send(res, 200, await readFile(file), { "Content-Type": types[extension], "Cache-Control": "public, max-age=31536000, immutable" }); }
    const fontMatch = url.pathname.match(/^\/fonts\/literata-(400|500|600)\.woff2$/); if (fontMatch) return send(res, 200, await readFile(join(fontRoot, `literata-latin-${fontMatch[1]}-normal.woff2`)), { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" });
    if (url.pathname === "/vendor/marked.esm.js") return send(res, 200, await readFile(markedModule), { "Content-Type": types[".js"], "Cache-Control": "no-cache, must-revalidate" });
    const requested = ["/", "/admin", "/admin/"].includes(url.pathname) ? "index.html" : url.pathname.slice(1); const file = normalize(join(publicRoot, requested)); if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return send(res, 403, "Nicht erlaubt"); await stat(file);
    const extension = extname(file); const cacheControl = ["index.html", "sw.js"].includes(requested) ? "no-store" : [".html", ".css", ".js", ".json", ".webmanifest"].includes(extension) ? "no-cache, must-revalidate" : "public, max-age=86400"; let payload = await readFile(file);
    if ([".html", ".js"].includes(extension)) payload = payload.toString("utf8").replaceAll("__APP_VERSION__", encodeURIComponent(appVersion));
    const workerHeaders = requested === "sw.js" ? { "Service-Worker-Allowed": "/", "Surrogate-Control": "no-store", "Pragma": "no-cache", "Expires": "0" } : {};
    return send(res, 200, payload, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": cacheControl, ...workerHeaders });
  } catch (error) { if (error?.code === "ENOENT") return send(res, 404, "Nicht gefunden", { "Content-Type": "text/plain; charset=utf-8" }); if (!error?.status || error.status >= 500) console.error(error); return json(res, error?.status || 500, { error: error?.status ? error.message : "Interner Fehler." }); }
}).listen(port, "0.0.0.0", () => console.log(`ORACLE Reader läuft auf Port ${port}`));
