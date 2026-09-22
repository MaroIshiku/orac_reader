import PDFDocument from "pdfkit";
import JSZip from "jszip";
import sharp from "sharp";
import { marked } from "marked";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureMarkdown } from "./public/markdown-config.js";

const root = fileURLToPath(new URL(".", import.meta.url));
// PDFKit/fontkit can embed the WOFF variants reliably; the matching WOFF2
// subsets currently fail while being finalized on text containing umlauts.
const regularFont = join(root, "node_modules", "@fontsource", "literata", "files", "literata-latin-400-normal.woff");
const boldFont = join(root, "node_modules", "@fontsource", "literata", "files", "literata-latin-600-normal.woff");
const italicFont = join(root, "node_modules", "@fontsource", "literata", "files", "literata-latin-400-italic.woff");
const boldItalicFont = join(root, "node_modules", "@fontsource", "literata", "files", "literata-latin-600-italic.woff");
const renderMarkdown = configureMarkdown(marked);
const mediaTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

const xml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
const safeName = (value) => String(value || "download").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "download";
const statusDate = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(date) : ""; };
const namedEntities = { nbsp: 160, copy: 169, reg: 174, trade: 8482, hellip: 8230, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, laquo: 171, raquo: 187, bull: 8226, middot: 183, euro: 8364, pound: 163, yen: 165, cent: 162, sect: 167, para: 182, deg: 176, plusmn: 177, times: 215, divide: 247, auml: 228, ouml: 246, uuml: 252, Auml: 196, Ouml: 214, Uuml: 220, szlig: 223 };
const xmlSafeEntities = (value) => value.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => ["amp", "lt", "gt", "quot", "apos"].includes(name) ? match : namedEntities[name] ? `&#${namedEntities[name]};` : `&amp;${name};`);
const xhtmlMarkdown = (source) => xmlSafeEntities(renderMarkdown(source)
  .replace(/<input[^>]*checked[^>]*>/gi, "☑")
  .replace(/<input[^>]*>/gi, "☐")
  .replace(/<(br|hr)([^>]*?)(?:\s*\/)?\s*>/gi, "<$1$2 />")
  .replace(/<img([^>]*?)(?:\s*\/)?\s*>/gi, "<img$1 />"));

function display(book, singular, plural, count = 1) { return book.display?.[count === 1 ? singular : plural] || (singular === "bookSingular" ? "Buch" : singular === "chapterSingular" ? "Kapitel" : "Teil"); }
function formatNumber(book, level, number) {
  const format = book.display?.[`${level}NumberFormat`] || "decimal"; const value = Number(number) || 0;
  if (format.startsWith("pad")) return String(value).padStart(Number(format.slice(3)), "0");
  if ((format === "roman-upper" || format === "roman-lower") && value > 0 && value <= 3999) { let rest = value; let result = ""; for (const [amount, glyph] of [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]]) while (rest >= amount) { result += glyph; rest -= amount; } return format === "roman-lower" ? result.toLowerCase() : result; }
  return String(value);
}

export function selectExport(book, scope, contentId = "") {
  if (!book?.chapters) return null;
  if (scope === "book") return { book, scope, title: book.title, chapters: book.chapters.filter((chapter) => chapter.parts.length) };
  if (scope === "chapter") { const chapter = book.chapters.find((item) => item.id === contentId && item.parts.length); return chapter ? { book, scope, title: chapter.title, chapters: [chapter] } : null; }
  if (scope === "part") {
    for (const chapter of book.chapters) { const part = chapter.parts.find((item) => item.id === contentId); if (part) return { book, scope, title: part.title, chapters: [{ ...chapter, parts: [part] }] }; }
  }
  return null;
}

export function exportFilename(selection, extension) {
  const suffix = selection.scope === "book" ? "" : `-${selection.title}`;
  return `${safeName(`${selection.book.title}${suffix}`)}.${extension}`;
}

async function mediaAsset(path, readMedia) {
  const match = String(path || "").match(/^\/media\/([a-f0-9]{32}\.(png|jpg|gif|webp|avif))$/); if (!match || !readMedia) return null;
  try { return { path: `media/${match[1]}`, type: mediaTypes[match[2]], bytes: await readMedia(match[1]), extension: match[2] }; } catch { return null; }
}

function epubPage(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="de"><head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="../styles.css"/></head><body>${body}</body></html>`;
}

export async function createEpub(selection, { readMedia } = {}) {
  const zip = new JSZip(); const book = selection.book; const identifier = `urn:oracreader:${book.id}:${selection.scope}:${safeName(selection.title)}`;
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/styles.css", `body{font-family:serif;line-height:1.65;color:#24231f;margin:5%;}h1,h2,h3{line-height:1.2;}h1{font-size:2em;}h2{margin-top:2.5em;}blockquote{border-left:.2em solid #9b6548;margin-left:0;padding-left:1em;color:#555;}pre,code{font-family:monospace;white-space:pre-wrap;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #bbb;padding:.4em;text-align:left;}img{display:block;max-width:100%;max-height:80vh;margin:1.5em auto;}.meta{color:#777;font-size:.85em;}.chapter{break-before:page;}`);

  const manifest = [{ id: "nav", href: "nav.xhtml", type: "application/xhtml+xml", properties: "nav" }, { id: "style", href: "styles.css", type: "text/css" }, { id: "title", href: "text/title.xhtml", type: "application/xhtml+xml" }];
  const spine = ["title"]; const navigation = []; const assets = new Map();
  const cover = await mediaAsset(book.coverImage, readMedia); if (cover) assets.set(cover.path, cover);
  const titleImage = cover ? `<img src="../${xml(cover.path)}" alt="${xml(book.title)}"/>` : "";
  zip.file("OEBPS/text/title.xhtml", epubPage(selection.title, `<main class="title-page">${titleImage}<p class="meta">${xml(book.kicker || "")}</p><h1>${xml(book.title)}</h1>${selection.scope === "book" ? `<p>${xml(book.description || "")}</p>` : `<h2>${xml(selection.title)}</h2>`}</main>`));

  let index = 0;
  for (const chapter of selection.chapters) {
    for (const part of chapter.parts) {
      index += 1; const id = `part-${index}`; const href = `text/${id}.xhtml`; const partImage = await mediaAsset(part.image, readMedia); if (partImage) assets.set(partImage.path, partImage);
      const heading = `${display(book, "chapterSingular", "chapterPlural")} ${formatNumber(book, "chapter", chapter.number)} · ${chapter.title}`;
      const subheading = `${display(book, "partSingular", "partPlural")} ${formatNumber(book, "part", part.number)} · ${part.title}`;
      const image = partImage ? `<img src="../${xml(partImage.path)}" alt="${xml(part.title)}"/>` : ""; let markdown = xhtmlMarkdown(part.content);
      for (const match of String(part.content || "").matchAll(/\/media\/([a-f0-9]{32}\.(?:png|jpg|gif|webp|avif))/gi)) { const asset = await mediaAsset(`/media/${match[1]}`, readMedia); if (asset && !assets.has(asset.path)) assets.set(asset.path, asset); }
      markdown = markdown.replace(/src="\/media\/([a-f0-9]{32}\.(?:png|jpg|gif|webp|avif))"/gi, 'src="../media/$1"');
      zip.file(`OEBPS/${href}`, epubPage(part.title, `<article><p class="meta">${xml(heading)}</p><h1>${xml(subheading)}</h1>${part.releasedAt ? `<p class="meta">Veröffentlicht ${xml(statusDate(part.releasedAt))}</p>` : ""}${image}${markdown}</article>`));
      manifest.push({ id, href, type: "application/xhtml+xml" }); spine.push(id); navigation.push({ href, label: `${heading} — ${subheading}` });
    }
  }
  for (const asset of assets.values()) { zip.file(`OEBPS/${asset.path}`, asset.bytes); manifest.push({ id: `asset-${manifest.length}`, href: asset.path, type: asset.type, properties: asset.path === cover?.path ? "cover-image" : "" }); }
  zip.file("OEBPS/nav.xhtml", epubPage("Inhalt", `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Inhalt</h1><ol>${navigation.map((item) => `<li><a href="${xml(item.href)}">${xml(item.label)}</a></li>`).join("")}</ol></nav>`));
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${xml(identifier)}</dc:identifier><dc:title>${xml(selection.title)}</dc:title><dc:language>de</dc:language><dc:publisher>OracReader</dc:publisher><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata><manifest>${manifest.map((item) => `<item id="${item.id}" href="${xml(item.href)}" media-type="${item.type}"${item.properties ? ` properties="${item.properties}"` : ""}/>`).join("")}</manifest><spine>${spine.map((id) => `<itemref idref="${id}"/>`).join("")}</spine></package>`);
  return zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

function inlineText(tokens = []) { return tokens.map((token) => token.type === "br" ? "\n" : token.type === "image" ? token.text || "Bild" : token.tokens ? inlineText(token.tokens) : token.text || token.raw || "").join(""); }
function inlineImages(tokens = []) { return tokens.flatMap((token) => token.type === "image" ? [token.href] : token.tokens ? inlineImages(token.tokens) : []); }
function inlineRuns(tokens = [], style = {}) { return tokens.flatMap((token) => { if (token.type === "image") return []; if (token.type === "br") return [{ text: "\n", ...style }]; const next = { ...style, bold: style.bold || token.type === "strong", italic: style.italic || token.type === "em", code: style.code || token.type === "codespan", link: style.link || (token.type === "link" ? token.href : "") }; if (token.tokens) return inlineRuns(token.tokens, next); return [{ text: token.text || token.raw || "", ...next }]; }).filter((run) => run.text); }
function writeInline(doc, tokens, options = {}) { const runs = inlineRuns(tokens); if (!runs.length) return; runs.forEach((run, index) => { const font = run.bold && run.italic ? "BookBoldItalic" : run.bold ? "BookBold" : run.italic ? "BookItalic" : "Book"; doc.font(font).fillColor(run.link ? "#76513f" : run.code ? "#5c554e" : options.color || "#24231f").text(run.text, { ...(index ? {} : options), continued: index < runs.length - 1, ...(run.link ? { link: run.link, underline: true } : {}) }); }); }
async function writeBlocks(doc, tokens, depth = 0, readMedia) {
  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "heading") { doc.moveDown(token.depth === 1 ? 1.2 : .8).font("BookBold").fontSize(Math.max(13, 23 - token.depth * 2)).fillColor("#24231f").text(inlineText(token.tokens)); doc.moveDown(.35); continue; }
    if (token.type === "paragraph" || token.type === "text") { const tokens = token.tokens || [{ type: "text", text: token.text || "" }]; if (inlineText(tokens)) { doc.fontSize(11); writeInline(doc, tokens, { lineGap: 4, indent: depth * 14 }); } for (const path of inlineImages(tokens)) { const image = await pdfImage(path, readMedia); if (image) { try { doc.moveDown(.5).image(image, { fit: [doc.page.width - doc.page.margins.left - doc.page.margins.right, 340], align: "center" }); } catch {} } } doc.moveDown(.7); continue; }
    if (token.type === "blockquote") { doc.save().fillColor("#665d55"); await writeBlocks(doc, token.tokens || [], depth + 1, readMedia); doc.restore(); continue; }
    if (token.type === "list") { for (let index = 0; index < token.items.length; index += 1) { const item = token.items[index]; const prefix = token.ordered ? `${Number(token.start || 1) + index}. ` : "• "; const textTokens = (item.tokens || []).filter((child) => child.type !== "list"); doc.font("Book").fontSize(11).fillColor("#24231f").text(prefix, { continued: true, indent: depth * 14 + 12 }); writeInline(doc, textTokens.flatMap((child) => child.tokens || [child]), { lineGap: 4 }); for (const nested of (item.tokens || []).filter((child) => child.type === "list")) await writeBlocks(doc, [nested], depth + 1, readMedia); } doc.moveDown(.6); continue; }
    if (token.type === "code") { doc.font("Book").fontSize(9).fillColor("#5c554e").text(token.text, { lineGap: 3, indent: depth * 14 + 12 }); doc.moveDown(.7); continue; }
    if (token.type === "table") { const rows = [token.header, ...(token.rows || [])].map((row) => row.map((cell) => inlineText(cell.tokens || [])).join("  |  ")); rows.forEach((row, index) => doc.font(index ? "Book" : "BookBold").fontSize(9).fillColor("#24231f").text(row, { lineGap: 3 })); doc.moveDown(.7); continue; }
    if (token.type === "hr") { const y = doc.y + 5; doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor("#aaa49b").stroke(); doc.moveDown(1); continue; }
    if (token.tokens) await writeBlocks(doc, token.tokens, depth, readMedia);
  }
}

async function pdfImage(path, readMedia) { const asset = await mediaAsset(path, readMedia); if (!asset) return null; if (["png", "jpg"].includes(asset.extension)) return asset.bytes; try { return await sharp(asset.bytes, { animated: false }).png().toBuffer(); } catch { return null; } }
export async function createPdf(selection, { readMedia } = {}) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 62, right: 62, bottom: 62, left: 62 }, info: { Title: selection.title, Subject: `Export aus ${selection.book.title}`, Creator: "OracReader" }, bufferPages: true });
  doc.registerFont("Book", regularFont); doc.registerFont("BookBold", boldFont); doc.registerFont("BookItalic", italicFont); doc.registerFont("BookBoldItalic", boldItalicFont);
  const chunks = []; doc.on("data", (chunk) => chunks.push(chunk)); const done = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const cover = await pdfImage(selection.book.coverImage, readMedia); if (cover) { try { doc.image(cover, { fit: [330, 430], align: "center", valign: "center" }); doc.moveDown(2); } catch {} }
  doc.font("Book").fontSize(10).fillColor("#796b60").text(selection.book.kicker || "", { align: "center" });
  doc.moveDown(.8).font("BookBold").fontSize(28).fillColor("#24231f").text(selection.book.title, { align: "center" });
  if (selection.scope !== "book") doc.moveDown(.7).font("Book").fontSize(17).text(selection.title, { align: "center" });
  if (selection.scope === "book" && selection.book.description) doc.moveDown(1.4).font("Book").fontSize(11).text(selection.book.description, { align: "left", lineGap: 4 });
  for (const chapter of selection.chapters) {
    doc.addPage(); doc.font("Book").fontSize(10).fillColor("#796b60").text(`${display(selection.book, "chapterSingular", "chapterPlural").toLocaleUpperCase("de")} ${formatNumber(selection.book, "chapter", chapter.number)}`);
    doc.moveDown(.35).font("BookBold").fontSize(22).fillColor("#24231f").text(chapter.title); doc.moveDown(1);
    for (let index = 0; index < chapter.parts.length; index += 1) {
      const part = chapter.parts[index]; if (index) doc.addPage();
      doc.font("Book").fontSize(9).fillColor("#796b60").text(`${display(selection.book, "partSingular", "partPlural").toLocaleUpperCase("de")} ${formatNumber(selection.book, "part", part.number)}${part.releasedAt ? ` · ${statusDate(part.releasedAt)}` : ""}`);
      doc.moveDown(.35).font("BookBold").fontSize(19).fillColor("#24231f").text(part.title); doc.moveDown(.8);
      const image = await pdfImage(part.image, readMedia); if (image) { try { doc.image(image, { fit: [doc.page.width - 124, 300], align: "center" }); doc.moveDown(1); } catch {} }
      await writeBlocks(doc, marked.lexer(String(part.content || "")), 0, readMedia);
    }
  }
  const range = doc.bufferedPageRange(); for (let index = 0; index < range.count; index += 1) { doc.switchToPage(index); doc.font("Book").fontSize(8).fillColor("#8a8178").text(`${index + 1} / ${range.count}`, 0, doc.page.height - 38, { align: "center", lineBreak: false }); }
  doc.end(); return done;
}

export async function createExport(selection, format, options = {}) {
  if (format === "epub") return { bytes: await createEpub(selection, options), type: "application/epub+zip", filename: exportFilename(selection, "epub") };
  if (format === "pdf") return { bytes: await createPdf(selection, options), type: "application/pdf", filename: exportFilename(selection, "pdf") };
  throw new Error("Unbekanntes Exportformat.");
}
