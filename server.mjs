import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, mkdir, copyFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const bundledData = join(root, "data", "library.json");
const dataRoot = process.env.DATA_DIR || join(root, "data");
const dataFile = join(dataRoot, "library.json");
const port = Number(process.env.PORT || 4180);
const appVersion = safeBuildVersion(process.env.APP_VERSION || "development");
const adminSecret = process.env.ADMIN_PASSWORD;
const secureCookie = process.env.COOKIE_SECURE === "true";
const sessions = new Map();
const attempts = new Map();

function safeBuildVersion(value) { return /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : "development"; }

if (!adminSecret) {
  console.error("ADMIN_PASSWORD fehlt. Der Reader wird aus Sicherheitsgründen nicht gestartet.");
  process.exit(1);
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const securityHeaders = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};
const send = (res, status, value, headers = {}) => { res.writeHead(status, { ...securityHeaders, "Cache-Control": "no-store", ...headers }); res.end(value); };
const json = (res, status, value, headers = {}) => send(res, status, JSON.stringify(value), { "Content-Type": types[".json"], ...headers });
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => item.trim().split(/=(.*)/s).slice(0, 2)));
const isAdmin = (req) => {
  const token = parseCookies(req).oracle_reader_session; const expires = sessions.get(token);
  if (!expires || expires < Date.now()) { if (token) sessions.delete(token); return false; }
  return true;
};
const requestBody = async (req) => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 6_000_000) throw new Error("Datei ist zu groß."); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};
const safeText = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const slug = (value) => safeText(value, 100).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomBytes(4).toString("hex");
const isPublished = (book) => book.status === "published" || (book.status === "scheduled" && book.publishAt && new Date(book.publishAt).getTime() <= Date.now());
const publicBook = (book) => { const { previewToken, ...visible } = book; return visible; };
const oracleDescription = "ORACLE ist eine geheime Organisation für Fälle, die außerhalb jeder bekannten Ordnung liegen. Ihre Mitglieder besitzen ungewöhnliche Fähigkeiten – und tragen ebenso ungewöhnliche Lasten. Als sich übernatürliche Vorfälle häufen und längst vergessene Wesen zurückkehren, gerät das Team in einen Kampf um Kontrolle, Vertrauen und die Frage, wie viel Menschlichkeit im Angesicht des Unbegreiflichen bestehen bleibt. Eine düstere Mystery-Geschichte über gefundene Familie, uralte Legenden und die Dinge, die besser im Verborgenen geblieben wären.";

async function ensureData() { await mkdir(dataRoot, { recursive: true }); try { await stat(dataFile); } catch { await copyFile(bundledData, dataFile); } }
const loadLibrary = async () => JSON.parse(await readFile(dataFile, "utf8"));
const saveLibrary = async (library) => { const temp = `${dataFile}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(library, null, 2)}\n`, "utf8"); await rename(temp, dataFile); };
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
  if (changed) await saveLibrary(library);
}

function validateBook(input, old = null) {
  const title = safeText(input.title, 160); const description = safeText(input.description, 2000);
  const number = Number(input.number);
  if (!title || !description || !Number.isInteger(number) || number < 0) throw new Error("Offizielle Nummer, Name und Beschreibung sind Pflichtfelder.");
  const status = ["draft", "scheduled", "published"].includes(input.status) ? input.status : "draft";
  let publishAt = null;
  if (status === "scheduled") { const timestamp = new Date(input.publishAt).getTime(); if (!Number.isFinite(timestamp)) throw new Error("Für eine geplante Veröffentlichung wird ein Datum benötigt."); publishAt = new Date(timestamp).toISOString(); }
  const needsPreview = status !== "published";
  const previewToken = needsPreview ? (old?.status !== "published" && /^[a-zA-Z0-9_-]{24,80}$/.test(old?.previewToken || "") ? old.previewToken : randomBytes(24).toString("base64url")) : undefined;
  const book = { id: old?.id || `${slug(title)}-${Date.now().toString(36)}`, number, title, kicker: safeText(input.kicker, 80) || "ORACLE · ARCHIV", description, status, publishAt, updatedAt: new Date().toISOString(), chapters: old?.chapters || [] };
  if (previewToken) book.previewToken = previewToken;
  return book;
}
function validateChapter(input, old = null) {
  const number = Number(input.number); const title = safeText(input.title, 160); const tldr = safeText(input.tldr, 3000);
  if (!Number.isInteger(number) || number < 0 || !title) throw new Error("Kapitelnummer (ab 0) und Kapitelname sind Pflichtfelder.");
  return { id: old?.id || `chapter-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, number, title, tldr, order: old?.order ?? 0, parts: old?.parts || [] };
}
function validatePart(input, old = null) {
  const chapterId = safeText(input.chapterId, 200); const partNumber = Number(input.part); const title = safeText(input.partTitle, 160); const tldr = safeText(input.tldr, 3000); const content = String(input.content || "").trim().slice(0, 5_000_000);
  if (!chapterId || !Number.isInteger(partNumber) || partNumber < 1 || !title || !content) throw new Error("Kapitel, Teilnummer (ab 1), Teilname und Text sind Pflichtfelder.");
  return { chapterId, part: { id: old?.id || `part-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, number: partNumber, title, tldr, content } };
}
function findPart(book, partId) { for (const chapter of book.chapters) { const index = chapter.parts.findIndex((part) => part.id === partId); if (index >= 0) return { chapter, index, part: chapter.parts[index] }; } return null; }
function sortContent(book) { book.chapters.sort((a,b) => (a.order ?? a.number) - (b.order ?? b.number) || a.number - b.number); for (const chapter of book.chapters) chapter.parts.sort((a,b) => a.number - b.number); }
const hasContent = (book) => book.chapters.some((chapter) => chapter.parts.length > 0);
const partCountAfter = (book, removed) => book.chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0) - removed;
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { const host = req.headers["x-forwarded-host"] || req.headers.host; return new URL(origin).host === host; } catch { return false; } }

async function api(req, res, url) {
  if (["POST", "PUT", "DELETE"].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: "Ungültige Anfrage." });
  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown"; const entry = attempts.get(ip) || { count: 0, until: 0 };
    if (entry.until > Date.now()) return json(res, 429, { error: "Zu viele Versuche. Bitte kurz warten." });
    const input = await requestBody(req); const salt = "oracle-reader-login"; const given = scryptSync(String(input.password || ""), salt, 64); const expected = scryptSync(adminSecret, salt, 64);
    if (!timingSafeEqual(given, expected)) { entry.count += 1; if (entry.count >= 5) { entry.until = Date.now() + 60_000; entry.count = 0; } attempts.set(ip, entry); return json(res, 401, { error: "Anmeldung fehlgeschlagen." }); }
    attempts.delete(ip); const token = randomBytes(32).toString("hex"); sessions.set(token, Date.now() + 43_200_000);
    const flags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie ? "; Secure" : ""}`;
    return json(res, 200, { ok: true }, { "Set-Cookie": `oracle_reader_session=${token}; ${flags}` });
  }
  if (req.method === "POST" && url.pathname === "/api/logout") { sessions.delete(parseCookies(req).oracle_reader_session); return json(res, 200, { ok: true }, { "Set-Cookie": "oracle_reader_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" }); }
  if (req.method === "GET" && url.pathname === "/api/session") return json(res, 200, { admin: isAdmin(req) });
  const library = await loadLibrary();
  if (req.method === "GET" && url.pathname === "/api/library") { const admin = isAdmin(req); return json(res, 200, { books: library.books.filter(isPublished).map(publicBook), ...(admin ? { adminBooks: library.books } : {}), links: library.links || [], settings: library.settings || { numberDigits: 4 }, admin, version: appVersion }); }
  const previewMatch = url.pathname.match(/^\/api\/preview\/([a-zA-Z0-9_-]{24,80})$/);
  if (req.method === "GET" && previewMatch) { const book = library.books.find((item) => !isPublished(item) && item.previewToken === previewMatch[1]); return book ? json(res, 200, { book: publicBook(book) }) : json(res, 404, { error: "Vorschau nicht gefunden." }); }
  if (url.pathname.startsWith("/api/admin/") && !isAdmin(req)) return json(res, 401, { error: "Admin-Anmeldung erforderlich." });

  if (req.method === "POST" && url.pathname === "/api/admin/books") { const book = validateBook(await requestBody(req)); if (book.status !== "draft") return json(res, 409, { error: "Ein neuer Archiveintrag muss vor dem Veröffentlichen mindestens einen Teil enthalten." }); if (library.books.some((item) => item.number === book.number)) return json(res, 409, { error: "Diese offizielle Nummer ist bereits vergeben." }); library.books.unshift(book); await saveLibrary(library); return json(res, 201, book); }
  const bookMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)$/); const book = bookMatch ? library.books.find((item) => item.id === decodeURIComponent(bookMatch[1])) : null;
  if (bookMatch && !book) return json(res, 404, { error: "Archiveintrag nicht gefunden." });
  if (req.method === "PUT" && bookMatch) { const updated = validateBook(await requestBody(req), book); if (library.books.some((item) => item !== book && item.number === updated.number)) return json(res, 409, { error: "Diese offizielle Nummer ist bereits vergeben." }); if (updated.status !== "draft" && !hasContent(updated)) return json(res, 409, { error: "Ein leerer Archiveintrag kann nicht veröffentlicht werden." }); if (updated.status === "published") delete book.previewToken; Object.assign(book, updated); await saveLibrary(library); return json(res, 200, book); }
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
  if (req.method === "PUT" && url.pathname === "/api/admin/links") { const input = await requestBody(req); library.links = (input.links || []).slice(0,8).map((link) => ({ label: safeText(link.label,60), url: safeText(link.url,500) })).filter((link) => link.label && (/^https?:\/\/\S+$/i.test(link.url) || /^discord:\/\/\S+$/i.test(link.url))); await saveLibrary(library); return json(res, 200, library.links); }
  if (req.method === "PUT" && url.pathname === "/api/admin/settings") { const input = await requestBody(req); const numberDigits = Number(input.numberDigits); if (![1,2,3,4].includes(numberDigits)) return json(res, 400, { error: "Ungültiges Nummernformat." }); library.settings = { ...(library.settings || {}), numberDigits }; await saveLibrary(library); return json(res, 200, library.settings); }
  return json(res, 404, { error: "Nicht gefunden." });
}

await ensureData();
await migrateLibrary();
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1); const file = normalize(join(publicRoot, requested)); if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return send(res, 403, "Nicht erlaubt"); await stat(file);
    const extension = extname(file); const cacheControl = [".html", ".css", ".js", ".json"].includes(extension) ? "no-cache, must-revalidate" : "public, max-age=86400"; let payload = await readFile(file);
    if ([".html", ".js"].includes(extension)) payload = payload.toString("utf8").replaceAll("__APP_VERSION__", encodeURIComponent(appVersion));
    return send(res, 200, payload, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": cacheControl });
  } catch (error) { if (error?.code === "ENOENT") return send(res, 404, "Nicht gefunden", { "Content-Type": "text/plain; charset=utf-8" }); console.error(error); return json(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || "Interner Fehler." }); }
}).listen(port, "0.0.0.0", () => console.log(`ORACLE Reader läuft auf Port ${port}`));
