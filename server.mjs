import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, mkdir, copyFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const bundledData = join(root, "data", "library.json");
const dataRoot = process.env.DATA_DIR || join(root, "data");
const dataFile = join(dataRoot, "library.json");
const port = Number(process.env.PORT || 4180);
const adminSecret = process.env.ADMIN_PASSWORD;
const secureCookie = process.env.COOKIE_SECURE === "true";
const sessions = new Map();
const attempts = new Map();

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

async function ensureData() { await mkdir(dataRoot, { recursive: true }); try { await stat(dataFile); } catch { await copyFile(bundledData, dataFile); } }
const loadLibrary = async () => JSON.parse(await readFile(dataFile, "utf8"));
const saveLibrary = async (library) => { const temp = `${dataFile}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(library, null, 2)}\n`, "utf8"); await rename(temp, dataFile); };
async function migrateLibrary() {
  const library = await loadLibrary(); let changed = false;
  if (!library.settings) { library.settings = { numberDigits: 4 }; changed = true; }
  library.books.forEach((book, index) => { if (!Number.isInteger(book.number)) { const stored = book.id?.match(/oracle-(\d+)/)?.[1]; book.number = stored !== undefined ? Number(stored) : index; changed = true; } });
  if (changed) await saveLibrary(library);
}

function validateBook(input, old = null) {
  const title = safeText(input.title, 160); const description = safeText(input.description, 2000);
  const number = Number(input.number);
  if (!title || !description || !Number.isInteger(number) || number < 0) throw new Error("Offizielle Nummer, Name und Beschreibung sind Pflichtfelder.");
  const status = ["draft", "scheduled", "published"].includes(input.status) ? input.status : "draft";
  let publishAt = null;
  if (status === "scheduled") { const timestamp = new Date(input.publishAt).getTime(); if (!Number.isFinite(timestamp)) throw new Error("Für eine geplante Veröffentlichung wird ein Datum benötigt."); publishAt = new Date(timestamp).toISOString(); }
  return { id: old?.id || `${slug(title)}-${Date.now().toString(36)}`, number, title, kicker: safeText(input.kicker, 80) || "ORACLE · CHRONIK", description, tldr: safeText(input.tldr, 3000), status, publishAt, updatedAt: new Date().toISOString(), chapters: old?.chapters || [] };
}
function validatePart(input, old = null) {
  const chapterNumber = Number(input.chapter); const partNumber = Number(input.part); const chapterTitle = safeText(input.chapterTitle, 160); const title = safeText(input.partTitle, 160); const content = String(input.content || "").trim().slice(0, 5_000_000);
  if (!Number.isInteger(chapterNumber) || chapterNumber < 0 || !Number.isInteger(partNumber) || partNumber < 1 || !chapterTitle || !title || !content) throw new Error("Kapitel (ab 0), Teil (ab 1), beide Namen und Text sind Pflichtfelder.");
  return { chapterNumber, chapterTitle, part: { id: old?.id || `part-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, number: partNumber, title, content } };
}
function findPart(book, partId) { for (const chapter of book.chapters) { const index = chapter.parts.findIndex((part) => part.id === partId); if (index >= 0) return { chapter, index, part: chapter.parts[index] }; } return null; }
function sortContent(book) { book.chapters.sort((a,b) => a.number - b.number); for (const chapter of book.chapters) chapter.parts.sort((a,b) => a.number - b.number); }
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; const host = req.headers["x-forwarded-host"] || req.headers.host; return new URL(origin).host === host; }

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
  if (req.method === "GET" && url.pathname === "/api/library") return json(res, 200, { books: library.books.filter((book) => isAdmin(req) || isPublished(book)), links: library.links || [], settings: library.settings || { numberDigits: 4 }, admin: isAdmin(req) });
  if (url.pathname.startsWith("/api/admin/") && !isAdmin(req)) return json(res, 401, { error: "Admin-Anmeldung erforderlich." });

  if (req.method === "POST" && url.pathname === "/api/admin/books") { const book = validateBook(await requestBody(req)); library.books.unshift(book); await saveLibrary(library); return json(res, 201, book); }
  const bookMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)$/); const book = bookMatch ? library.books.find((item) => item.id === decodeURIComponent(bookMatch[1])) : null;
  if (bookMatch && !book) return json(res, 404, { error: "Chronik nicht gefunden." });
  if (req.method === "PUT" && bookMatch) { Object.assign(book, validateBook(await requestBody(req), book)); await saveLibrary(library); return json(res, 200, book); }
  if (req.method === "DELETE" && bookMatch) { library.books.splice(library.books.indexOf(book), 1); await saveLibrary(library); return json(res, 200, { ok: true }); }

  const partCollection = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/parts$/);
  if (req.method === "POST" && partCollection) {
    const target = library.books.find((item) => item.id === decodeURIComponent(partCollection[1])); if (!target) return json(res, 404, { error: "Chronik nicht gefunden." });
    const valid = validatePart(await requestBody(req)); let chapter = target.chapters.find((item) => item.number === valid.chapterNumber);
    if (!chapter) { chapter = { id: `chapter-${Date.now().toString(36)}`, number: valid.chapterNumber, title: valid.chapterTitle, parts: [] }; target.chapters.push(chapter); }
    chapter.title = valid.chapterTitle; chapter.parts.push(valid.part); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 201, target);
  }
  const partMatch = url.pathname.match(/^\/api\/admin\/books\/([^/]+)\/parts\/([^/]+)$/);
  if (partMatch) {
    const target = library.books.find((item) => item.id === decodeURIComponent(partMatch[1])); const found = target && findPart(target, decodeURIComponent(partMatch[2])); if (!found) return json(res, 404, { error: "Teil nicht gefunden." });
    if (req.method === "PUT") { const valid = validatePart(await requestBody(req), found.part); found.chapter.parts.splice(found.index, 1); if (!found.chapter.parts.length) target.chapters.splice(target.chapters.indexOf(found.chapter), 1); let chapter = target.chapters.find((item) => item.number === valid.chapterNumber); if (!chapter) { chapter = { id: `chapter-${Date.now().toString(36)}`, number: valid.chapterNumber, title: valid.chapterTitle, parts: [] }; target.chapters.push(chapter); } chapter.title = valid.chapterTitle; chapter.parts.push(valid.part); sortContent(target); target.updatedAt = new Date().toISOString(); await saveLibrary(library); return json(res, 200, target); }
    if (req.method === "DELETE") { found.chapter.parts.splice(found.index, 1); if (!found.chapter.parts.length) target.chapters.splice(target.chapters.indexOf(found.chapter), 1); await saveLibrary(library); return json(res, 200, { ok: true }); }
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/links") { const input = await requestBody(req); library.links = (input.links || []).slice(0,8).map((link) => ({ label: safeText(link.label,60), url: safeText(link.url,500) })).filter((link) => link.label && /^https?:\/\//.test(link.url)); await saveLibrary(library); return json(res, 200, library.links); }
  if (req.method === "PUT" && url.pathname === "/api/admin/settings") { const input = await requestBody(req); const numberDigits = Number(input.numberDigits); if (![1,2,3,4].includes(numberDigits)) return json(res, 400, { error: "Ungültiges Nummernformat." }); library.settings = { ...(library.settings || {}), numberDigits }; await saveLibrary(library); return json(res, 200, library.settings); }
  return json(res, 404, { error: "Nicht gefunden." });
}

await ensureData();
await migrateLibrary();
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1); const file = normalize(join(publicRoot, requested)); if (!file.startsWith(publicRoot)) return send(res, 403, "Nicht erlaubt"); await stat(file);
    return send(res, 200, await readFile(file), { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=300" });
  } catch (error) { if (error?.code === "ENOENT") return send(res, 404, "Nicht gefunden", { "Content-Type": "text/plain; charset=utf-8" }); console.error(error); return json(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || "Interner Fehler." }); }
}).listen(port, "0.0.0.0", () => console.log(`ORACLE Reader läuft auf Port ${port}`));
