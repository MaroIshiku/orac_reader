import { cardDestination, readerHash } from "/navigation.js?v=__APP_VERSION__";
import { aggregateRead, nextGroupRead } from "/read-status.js?v=__APP_VERSION__";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const storedMotion = localStorage.getItem("oracle-motion");
const storedView = localStorage.getItem("oracle-view");
const storedTheme = localStorage.getItem("oracle-theme");
const state = { books: [], adminBooks: [], links: [], settings: { numberDigits: 4 }, version: "development", admin: false, book: null, part: null, previewBook: null, previewToken: "", fontSize: Math.min(26, Math.max(15, Number(localStorage.getItem("oracle-font-size")) || 19)), view: ["scroll", "pages"].includes(storedView) ? storedView : "scroll", theme: ["paper", "sand", "mist", "night"].includes(storedTheme) ? storedTheme : "paper", motion: storedMotion === null ? !matchMedia("(prefers-reduced-motion: reduce)").matches : storedMotion !== "off" };
const historyKey = "oracle-reading-history";
const progressKey = "oracle-reading-progress";
const readStatusKey = "oracle-reading-status";

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const iconSvg = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const inline = (text) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>");
function markdown(source) {
  const lines = String(source || "").replace(/\r/g, "").split("\n"); let html = ""; let paragraph = [];
  const flush = () => { if (paragraph.length) { html += `<p>${inline(paragraph.join(" "))}</p>`; paragraph = []; } };
  for (const line of lines) {
    const value = line.trim();
    if (!value) { flush(); continue; }
    if (/^-{3,}$/.test(value)) { flush(); html += "<hr>"; continue; }
    const heading = value.match(/^(#{1,3})\s+(.+)$/); if (heading) { flush(); const level = Math.min(3, heading[1].length + 1); html += `<h${level}>${inline(heading[2])}</h${level}>`; continue; }
    if (value.startsWith("> ")) { flush(); html += `<blockquote>${inline(value.slice(2))}</blockquote>`; continue; }
    paragraph.push(value);
  }
  flush(); return html;
}
const getHistory = () => { try { return JSON.parse(localStorage.getItem(historyKey)) || []; } catch { return []; } };
const getProgress = () => { try { return JSON.parse(localStorage.getItem(progressKey)) || {}; } catch { return {}; } };
const getReadStatus = () => { try { return JSON.parse(localStorage.getItem(readStatusKey)) || {}; } catch { return {}; } };
const isRead = (bookId, partId) => {
  const manual = getReadStatus()[`${bookId}:${partId}`]; if (manual !== undefined) return manual;
  const progress = getProgress(); return Boolean(progress[`${bookId}:${partId}:scroll`]?.read || progress[`${bookId}:${partId}:pages`]?.read);
};
const setRead = (bookId, partId, value) => { const status = getReadStatus(); status[`${bookId}:${partId}`] = value; localStorage.setItem(readStatusKey, JSON.stringify(status)); };
const partCount = (book) => book.chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0);
const allParts = (book) => book.chapters.flatMap((chapter) => chapter.parts.map((part) => ({ chapter, part })));
const readStats = (book) => aggregateRead(allParts(book).map(({part}) => isRead(book.id, part.id)));
const chapterReadStats = (book, chapter) => aggregateRead(chapter.parts.map((part) => isRead(book.id, part.id)));
const progressPercent = (bookId, partId) => Math.max(0, ...["scroll", "pages"].map((view) => Number(getProgress()[`${bookId}:${partId}:${view}`]?.percent) || 0));
const formatNumber = (number) => String(Number(number) || 0).padStart(state.settings.numberDigits || 4, "0");
const formatDate = (date) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Anfrage fehlgeschlagen."); return result;
};
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2200); }
function resetTldr(node, text) { node.hidden = !text; node.open = false; node._tldr = text || ""; node.querySelector(".tldr-gate").hidden = false; const content = node.querySelector(".tldr-content"); content.hidden = true; content.textContent = ""; }
const sidebarTldr = (chapterId) => `<details class="tldr sidebar-tldr" data-chapter-tldr="${escapeHtml(chapterId)}"><summary>Kapitel-TL;DR</summary><div class="tldr-gate"><p>Dieses Kapitel-TL;DR enthält Spoiler. Trotzdem anzeigen?</p><div><button type="button" data-reveal-tldr>Ja</button><button type="button" data-close-tldr>Nein</button></div></div><p class="tldr-content" hidden></p></details>`;

async function load() {
  const data = await api("/api/library"); state.books = data.books; state.adminBooks = data.adminBooks || []; state.links = data.links; state.settings = data.settings || { numberDigits: 4 }; state.version = data.version || "development"; state.admin = data.admin;
  state.previewBook = null; state.previewToken = ""; const preview = location.hash.match(/^#?preview\/([a-zA-Z0-9_-]{24,80})\//); if (preview) { try { state.previewBook = (await api(`/api/preview/${preview[1]}`)).book; state.previewToken = preview[1]; } catch {} }
  renderLinks(); renderLibrary(); renderHomeShelves(); renderAdmin(); route();
}
function renderLinks() {
  const markup = state.links.filter((link) => /^https?:\/\/\S+$/i.test(link.url) || /^discord:\/\/\S+$/i.test(link.url)).map((link) => { const discord = /^discord:\/\//i.test(link.url); return `<a href="${escapeHtml(link.url)}"${discord ? "" : ' target="_blank" rel="noopener"'}><span>${escapeHtml(link.label)}</span>${iconSvg(discord ? "link" : "external")}</a>`; }).join("");
  $("#customLinks").innerHTML = markup; $("#mobileLinks").innerHTML = markup;
  $$("#mobileLinks a").forEach((link) => link.addEventListener("click", () => { $("#mobileLinkMenu").open = false; }));
}
function renderLibrary(query = "") {
  const search = query.toLocaleLowerCase("de");
  const books = state.books.filter((book) => !search || [book.title, book.description, ...allParts(book).flatMap(({chapter, part}) => [chapter.title, chapter.tldr, part.title, part.tldr, part.content])].join(" ").toLocaleLowerCase("de").includes(search)).sort((a,b) => a.number - b.number);
  $("#emptyLibrary").hidden = books.length > 0;
  $("#archiveStats").textContent = `${state.books.length} AKTEN // ${state.books.reduce((sum, book) => sum + partCount(book), 0)} TEILE`;
  $("#bookGrid").innerHTML = books.map((book) => {
    const displayNumber = formatNumber(book.number); const target = cardDestination(book, getHistory()); const progress = readStats(book); const status = book.status !== "published" ? `<span class="status-badge is-${book.status}">${book.status === "draft" ? "ENTWURF" : "GEPLANT"}</span>` : "";
    const readLabel = progress.state === "read" ? "Gelesen" : progress.state === "partial" ? `${progress.read} von ${progress.total} gelesen` : "Ungelesen";
    const chapterTitle = target?.chapter.title || "Noch ohne Kapitel"; const coverNumber = target ? `${formatNumber(target.chapter.number)}.${target.part.number}` : displayNumber;
    const destination = target ? readerHash(book.id, target.part.id) : "home";
    return `<article class="book-card is-${progress.state}" data-card-book="${escapeHtml(book.id)}" data-card-part="${escapeHtml(target?.part.id || "")}"><a class="card-main-link" href="#${destination}" data-card-link aria-label="${escapeHtml(book.title)} öffnen"></a><div class="generated-cover"><div class="cover-brand"><img src="/oracle-logo.png" alt=""><span>ORACLE · ARCHIV</span></div><div class="cover-copy"><small>AKTE ${displayNumber}</small><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(chapterTitle)}</span></div><b class="cover-number">${coverNumber}</b></div><div class="book-card-copy"><div class="book-number">ARCHIVEINTRAG ${displayNumber}${status}</div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.description)}</p><div class="card-progress" role="progressbar" aria-label="Lesefortschritt ${progress.percent} Prozent" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><div><i style="width:${progress.percent}%"></i></div><span>${progress.percent}%</span></div><footer><span>${partCount(book)} ${partCount(book) === 1 ? "Teil" : "Teile"} · ${formatDate(book.updatedAt)}</span>${target ? `<button data-toggle-book-read="${escapeHtml(book.id)}" aria-label="Archiv als ${progress.state === "read" ? "ungelesen" : "gelesen"} markieren">${iconSvg(progress.state)}<span>${readLabel}</span></button>` : ""}</footer></div></article>`;
  }).join("");
  // Card navigation is delegated once on #bookGrid below. Re-rendering cannot overwrite another book's destination.
  $("#continueButton").innerHTML = `<span>Archiv entdecken</span>${iconSvg("arrow-down")}`; $("#continueButton").onclick = () => $("#libraryHeading").scrollIntoView({ behavior: state.motion ? "smooth" : "auto" });
}
function renderHomeShelves() {
  const history = getHistory(); const resolved = history.map((entry) => { const book = state.books.find((item) => item.id === entry.bookId); const found = book && allParts(book).find(({part}) => part.id === entry.partId); return book && found ? { book, ...found } : null; }).filter(Boolean);
  const continuing = resolved.find(({book, part}) => !isRead(book.id, part.id)) || resolved[0]; const recent = resolved.filter((entry) => entry !== continuing).slice(0,3);
  const shelfItem = ({book,chapter,part}, extra = "") => `<button class="shelf-item ${extra}" data-shelf="${escapeHtml(book.id)}:${escapeHtml(part.id)}"><span class="shelf-number">${formatNumber(chapter.number)}.${part.number}</span><span><b>${escapeHtml(part.title)}</b><small>${escapeHtml(book.title)}</small></span>${extra ? `<em>${progressPercent(book.id, part.id)}%</em>` : ""}</button>`;
  $("#continueShelf").hidden = !continuing; $("#continueBook").innerHTML = continuing ? shelfItem(continuing, "continue-item") : "";
  $("#recentShelf").hidden = !recent.length; $("#recentBooks").innerHTML = recent.map((entry) => shelfItem(entry)).join("");
  const newest = state.books.filter((book) => (book.status === "published" || (book.status === "scheduled" && new Date(book.publishAt) <= new Date())) && allParts(book).length).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0,3);
  $("#newBooks").innerHTML = newest.map((book) => { const {chapter,part} = allParts(book)[0]; return `<button class="shelf-item" data-shelf="${escapeHtml(book.id)}:${escapeHtml(part.id)}"><span class="shelf-number">${formatNumber(chapter.number)}.${part.number}</span><span><b>${escapeHtml(book.title)}</b><small>${escapeHtml(part.title)}</small></span></button>`; }).join("");
  $("#homeShelves").dataset.columns = String([continuing, recent.length, newest.length].filter(Boolean).length);
  $$('.home-shelves [data-shelf]').forEach((button) => button.onclick = () => { const [bookId,partId] = button.dataset.shelf.split(":"); location.hash = readerHash(bookId, partId); });
}
function setDrawer(open) { $("#chapterDrawer").classList.toggle("open", open); $("#drawerBackdrop").classList.toggle("open", open); $("#chapterToggle").setAttribute("aria-expanded", String(open)); if (open) requestAnimationFrame(() => $("#chapterClose").focus()); }
const activeReaderHash = (bookId, partId) => state.previewBook?.id === bookId && state.previewToken ? `preview/${state.previewToken}/${encodeURIComponent(partId)}` : readerHash(bookId, partId);
function route() {
  const preview = location.hash.match(/^#?preview\/([a-zA-Z0-9_-]{24,80})\/([^/]+)/); const match = location.hash.match(/^#?read\/([^/]+)\/([^/]+)/);
  if (preview) { let partId; try { partId = decodeURIComponent(preview[2]); } catch { location.hash = "home"; return; } const entry = state.previewBook && allParts(state.previewBook).find(({part}) => part.id === partId); if (!entry) { location.hash = "home"; return; } openPart(state.previewBook, entry.chapter, entry.part); return; }
  if (!match) { const wasReading = !$("#readerView").hidden; $("#homeView").hidden = false; $("#readerView").hidden = true; setDrawer(false); document.body.classList.remove("reading"); document.title = "ORACLE — Archiv"; if (wasReading) requestAnimationFrame(() => scrollTo(0, 0)); return; }
  let bookId; let partId; try { bookId = decodeURIComponent(match[1]); partId = decodeURIComponent(match[2]); } catch { location.hash = "home"; return; }
  const book = state.books.find((item) => item.id === bookId); if (!book) return location.hash = "home";
  const entry = allParts(book).find(({part}) => part.id === partId) || allParts(book)[0]; if (!entry) return location.hash = "home";
  openPart(book, entry.chapter, entry.part);
}
function renderChapterList(book, activePartId) {
  $("#chapterList").innerHTML = book.chapters.map((item) => {
    const progress = chapterReadStats(book, item); const label = progress.state === "read" ? "Kapitel als ungelesen markieren" : "Kapitel als gelesen markieren";
    const parts = item.parts.map((candidate) => `<button class="${candidate.id === activePartId ? "active" : ""} ${isRead(book.id, candidate.id) ? "read" : ""}" data-chapter-part="${escapeHtml(candidate.id)}"><small>${formatNumber(item.number)}.${candidate.number}</small><span>${escapeHtml(candidate.title)}</span></button>`).join("");
    const status = progress.total ? `<button data-toggle-chapter-read="${escapeHtml(item.id)}" aria-label="${label}" title="${label}">${iconSvg(progress.state)}<span>${progress.read}/${progress.total}</span></button>` : "";
    return `<li><div class="chapter-group-row"><small class="chapter-group">KAPITEL ${formatNumber(item.number)} · ${escapeHtml(item.title)}</small>${status}</div>${item.tldr ? sidebarTldr(item.id) : ""}${parts}</li>`;
  }).join("");
  $$('[data-chapter-tldr]').forEach((node) => { const chapter = book.chapters.find((item) => item.id === node.dataset.chapterTldr); resetTldr(node, chapter?.tldr); });
  $$('#chapterList [data-chapter-part]').forEach((button) => button.onclick = () => location.hash = activeReaderHash(book.id, button.dataset.chapterPart));
  $$('#chapterList [data-toggle-chapter-read]').forEach((button) => button.onclick = () => toggleChapterRead(book.id, button.dataset.toggleChapterRead));
}
function openPart(book, chapter, part) {
  state.book = book; state.part = part; $("#homeView").hidden = true; $("#readerView").hidden = false; setDrawer(false); document.body.classList.add("reading");
  $("#readerStatusBadge").hidden = book.status === "published"; $("#readerStatusBadge").textContent = book.status === "scheduled" ? "GEPLANTE VORSCHAU" : "ENTWURFSVORSCHAU";
  $("#drawerBookTitle").textContent = book.title; $("#storyKicker").textContent = book.kicker; $("#storyTitle").textContent = part.title;
  $("#storyDescription").textContent = book.description; $("#storyPart").textContent = `Kapitel ${formatNumber(chapter.number)} · Teil ${part.number}`;
  const words = part.content.trim().split(/\s+/).length; $("#readingTime").textContent = `${Math.max(1, Math.ceil(words / 220))} Min. Lesezeit`;
  $("#storyContent").innerHTML = markdown(part.content); resetTldr($("#partTldr"), part.tldr);
  const entries = allParts(book); const currentIndex = entries.findIndex((item) => item.part.id === part.id);
  renderChapterList(book, part.id);
  const next = entries[currentIndex + 1]; $("#nextChapter").hidden = !next; if (next) $("#nextChapter").onclick = () => location.hash = activeReaderHash(book.id, next.part.id);
  const history = getHistory().filter((item) => !(item.bookId === book.id && item.partId === part.id)); history.unshift({ bookId: book.id, partId: part.id, at: Date.now() }); localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 20)));
  if (state.view === "pages") $("#readingPage").scrollLeft = 0; else scrollTo(0, 0);
  updateReadToggle(); requestAnimationFrame(() => { restoreProgress(book.id, part.id); updatePageControls(); }); document.title = `${part.title} — ORACLE`;
}
function progressPosition() { const viewport = $("#readingViewport"); if (state.view === "pages") return viewport.querySelector(".reading-page")?.scrollLeft || 0; return window.scrollY; }
function progressMaximum() { const page = $("#readingPage"); if (state.view === "pages") return Math.max(1, page.scrollWidth - page.clientWidth); return Math.max(1, document.documentElement.scrollHeight - innerHeight); }
function updateProgress() {
  if (!state.book || !state.part || $("#readerView").hidden) return; const wasRead = isRead(state.book.id, state.part.id); const ratio = Math.min(1, Math.max(0, progressPosition() / progressMaximum())); const percent = Math.round(ratio * 100);
  $("#progressLabel").textContent = `${percent}%`; $("#progressBar").style.width = `${percent}%`; const progress = getProgress(); const key = `${state.book.id}:${state.part.id}:${state.view}`; progress[key] = { position: progressPosition(), percent, read: Boolean(progress[key]?.read || percent >= 90) }; localStorage.setItem(progressKey, JSON.stringify(progress)); updatePageControls(); updateReadToggle();
  if (wasRead !== isRead(state.book.id, state.part.id)) { renderChapterList(state.book, state.part.id); renderLibrary($("#bookSearch").value); renderHomeShelves(); }
}
function restoreProgress(bookId, partId) { const saved = getProgress()[`${bookId}:${partId}:${state.view}`]; if (state.view === "pages") $("#readingPage").scrollLeft = saved?.position || 0; else scrollTo(0, saved?.position || 0); updateProgress(); }
function applyPreferences() {
  document.body.dataset.theme = state.theme; document.body.dataset.view = state.view; document.body.dataset.motion = state.motion ? "on" : "off"; document.documentElement.style.setProperty("--reader-size", `${state.fontSize}px`); $("#viewLabel").textContent = state.view === "pages" ? "Seiten" : "Scrollen";
  $("#viewToggle use").setAttribute("href", state.view === "pages" ? "#i-pages" : "#i-scroll");
  $("#motionLabel").textContent = state.motion ? "Animationen an" : "Animationen aus"; $("#motionToggle use").setAttribute("href", state.motion ? "#i-motion" : "#i-motion-off"); $("#motionToggle").setAttribute("aria-pressed", String(state.motion)); $("#motionToggle").setAttribute("aria-label", state.motion ? "Animationen ausschalten" : "Animationen einschalten");
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  $$("[data-theme-choice]").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === state.theme));
}
function updateReadToggle() { if (!state.book || !state.part) return; const read = isRead(state.book.id, state.part.id); $("#readToggle").innerHTML = `${iconSvg(read ? "read" : "unread")}<span>${read ? "Gelesen" : "Ungelesen"}</span>`; $("#readToggle").setAttribute("aria-label", read ? "Als ungelesen markieren" : "Als gelesen markieren"); }
function pageMetrics() { const page = $("#readingPage"); const width = Math.max(1, page.clientWidth); const count = Math.max(1, Math.ceil(page.scrollWidth / width)); const current = Math.min(count - 1, Math.round(page.scrollLeft / width)); return { page, width, count, current }; }
function updatePageControls() { if (state.view !== "pages") return; const { count, current } = pageMetrics(); $("#pageCounter").textContent = `${current + 1} / ${count}`; $("#pagePrev").disabled = current === 0; $("#pageNext").disabled = current >= count - 1; }
function turnPage(direction) { const { page, width, count, current } = pageMetrics(); const target = Math.max(0, Math.min(count - 1, current + direction)); page.scrollTo({ left: target * width, behavior: state.motion ? "smooth" : "auto" }); }
function realignPages() { if (state.view !== "pages" || !state.book || $("#readerView").hidden) return; const key = `${state.book.id}:${state.part.id}:pages`; const percent = Number(getProgress()[key]?.percent) || 0; requestAnimationFrame(() => { const { page, width } = pageMetrics(); const target = Math.round((percent / 100 * progressMaximum()) / width) * width; page.scrollLeft = Math.max(0, target); updatePageControls(); }); }
async function shareCurrent() {
  const data = { title: `${state.part.title} — ${state.book.title}`, text: `ORACLE · Kapitel/Teil teilen`, url: location.href };
  if (navigator.share) { try { await navigator.share(data); return; } catch (error) { if (error.name === "AbortError") return; } }
  await copyText(location.href); toast("Link kopiert");
}
async function copyText(value) { try { await navigator.clipboard.writeText(value); } catch { const input = document.createElement("textarea"); input.value = value; document.body.append(input); input.select(); document.execCommand("copy"); input.remove(); } }
async function copyPreviewLink(bookId) { const book = state.adminBooks.find((item) => item.id === bookId); const first = book && allParts(book)[0]; if (!book?.previewToken || !first) return toast("Für die Vorschau fehlt noch ein Teil."); const url = new URL(location.href); url.search = ""; url.hash = `preview/${book.previewToken}/${encodeURIComponent(first.part.id)}`; await copyText(url.href); toast("Kryptischen Vorschau-Link kopiert"); }
async function saveChapterOrder(bookId, chapterIds) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/chapters/order`, { method: "PUT", body: JSON.stringify({ chapterIds }) }); await load(); toast("Kapitelreihenfolge gespeichert"); }

function renderAdmin() {
  $("#loginPanel").hidden = state.admin; $("#adminPanel").hidden = !state.admin; if (!state.admin) return;
  const list = $("#adminBookList");
  list.innerHTML = [...state.adminBooks].sort((a,b) => a.number - b.number).map((book) => {
    const chapters = book.chapters.map((chapter, index) => `<section class="admin-chapter" draggable="true" data-admin-chapter="${escapeHtml(chapter.id)}" data-admin-chapter-book="${escapeHtml(book.id)}"><div class="admin-chapter-head"><span class="drag-handle" title="Kapitel ziehen" aria-hidden="true">${iconSvg("grip")}</span><div class="admin-chapter-title"><b>KAPITEL ${formatNumber(chapter.number)} · ${escapeHtml(chapter.title)}</b><small>${chapter.parts.length} ${chapter.parts.length === 1 ? "Teil" : "Teile"}${chapter.tldr ? " · TL;DR" : ""}</small></div><div class="reorder-buttons"><button class="icon-button" data-move-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}:-1" aria-label="Kapitel nach oben" ${index === 0 ? "disabled" : ""}>${iconSvg("arrow-up")}</button><button class="icon-button" data-move-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}:1" aria-label="Kapitel nach unten" ${index === book.chapters.length - 1 ? "disabled" : ""}>${iconSvg("arrow-down")}</button></div><div class="admin-row-actions"><button data-edit-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}">Bearbeiten</button><button data-add-part="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}">${iconSvg("add")}<span>Teil</span></button><button class="icon-button danger-action" data-delete-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}" aria-label="Kapitel löschen">${iconSvg("trash")}</button></div></div>${chapter.parts.map((part) => `<div class="admin-part"><span>${formatNumber(chapter.number)}.${part.number} · ${escapeHtml(part.title)}${part.tldr ? " · TL;DR" : ""}</span><div class="admin-row-actions"><button data-edit-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}">Bearbeiten</button><button class="icon-button danger-action" data-delete-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}" aria-label="Teil löschen">${iconSvg("trash")}</button></div></div>`).join("")}</section>`).join("");
    const preview = book.status === "published" || !partCount(book) ? "" : `<button data-preview-book="${escapeHtml(book.id)}">${iconSvg("eye")}<span>Vorschau-Link</span></button>`;
    return `<article class="admin-entry" data-admin-book="${escapeHtml(book.id)}"><header class="admin-book"><div><span class="admin-status is-${book.status}">${book.status === "published" ? "Veröffentlicht" : book.status === "scheduled" ? "Geplant" : "Entwurf"}</span><b>${formatNumber(book.number)} · ${escapeHtml(book.title)}</b><small>${book.status === "scheduled" ? `${formatDate(book.publishAt)} · ` : ""}${book.chapters.length} Kapitel · ${partCount(book)} Teile</small></div><div class="admin-row-actions">${preview}<button data-edit-book="${escapeHtml(book.id)}">Bearbeiten</button><button data-add-chapter="${escapeHtml(book.id)}">${iconSvg("add")}<span>Kapitel</span></button><button class="icon-button danger-action" data-delete-book="${escapeHtml(book.id)}" aria-label="Archiveintrag löschen">${iconSvg("trash")}</button></div></header><div class="admin-chapters">${chapters || `<p class="admin-empty">Noch keine Kapitel angelegt.</p>`}</div></article>`;
  }).join("");
  list.onclick = async (event) => {
    const button = event.target.closest("button"); if (!button) return;
    try {
      if (button.dataset.editBook) return editArchive(button.dataset.editBook);
      if (button.dataset.previewBook) return copyPreviewLink(button.dataset.previewBook);
      if (button.dataset.addChapter) return editChapter(button.dataset.addChapter);
      if (button.dataset.moveChapter) { const [bookId, chapterId, direction] = button.dataset.moveChapter.split(":"); const book = state.adminBooks.find((item) => item.id === bookId); const ids = book.chapters.map((chapter) => chapter.id); const from = ids.indexOf(chapterId); const to = from + Number(direction); if (from >= 0 && to >= 0 && to < ids.length) { ids.splice(to, 0, ids.splice(from, 1)[0]); return saveChapterOrder(bookId, ids); } }
      if (button.dataset.editChapter) { const [bookId, chapterId] = button.dataset.editChapter.split(":"); return editChapter(bookId, chapterId); }
      if (button.dataset.addPart) { const [bookId, chapterId] = button.dataset.addPart.split(":"); return editPart(bookId, "", chapterId); }
      if (button.dataset.editPart) { const [bookId, partId] = button.dataset.editPart.split(":"); return editPart(bookId, partId); }
      if (button.dataset.deleteBook) { const book = state.books.find((item) => item.id === button.dataset.deleteBook); if (confirm(`„${book.title}“ samt Kapiteln und Teilen endgültig löschen?`)) { await api(`/api/admin/books/${encodeURIComponent(book.id)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Archiveintrag gelöscht"); } }
      if (button.dataset.deleteChapter) { const [bookId, chapterId] = button.dataset.deleteChapter.split(":"); if (confirm("Dieses Kapitel samt aller Teile endgültig löschen?")) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Kapitel gelöscht"); } }
      if (button.dataset.deletePart) { const [bookId, partId] = button.dataset.deletePart.split(":"); if (confirm("Diesen Teil endgültig löschen?")) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/parts/${encodeURIComponent(partId)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Teil gelöscht"); } }
    } catch (error) { toast(error.message); }
  };
  let draggedChapter = null;
  list.ondragstart = (event) => { const chapter = event.target.closest("[data-admin-chapter]"); if (!chapter) return; draggedChapter = { bookId: chapter.dataset.adminChapterBook, chapterId: chapter.dataset.adminChapter }; chapter.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", draggedChapter.chapterId); };
  list.ondragover = (event) => { const chapter = event.target.closest("[data-admin-chapter]"); if (!chapter || chapter.dataset.adminChapterBook !== draggedChapter?.bookId) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; chapter.classList.add("is-drop-target"); };
  list.ondragleave = (event) => { event.target.closest("[data-admin-chapter]")?.classList.remove("is-drop-target"); };
  list.ondragend = () => { $$(".admin-chapter.is-dragging, .admin-chapter.is-drop-target").forEach((chapter) => chapter.classList.remove("is-dragging", "is-drop-target")); draggedChapter = null; };
  list.ondrop = async (event) => { const target = event.target.closest("[data-admin-chapter]"); if (!target || target.dataset.adminChapterBook !== draggedChapter?.bookId) return; event.preventDefault(); const book = state.adminBooks.find((item) => item.id === draggedChapter.bookId); const ids = book.chapters.map((chapter) => chapter.id); const from = ids.indexOf(draggedChapter.chapterId); let to = ids.indexOf(target.dataset.adminChapter); if (event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2) to += 1; ids.splice(from, 1); if (from < to) to -= 1; ids.splice(to, 0, draggedChapter.chapterId); try { await saveChapterOrder(book.id, ids); } catch (error) { toast(error.message); } };
  $("#adminVersion").textContent = `BUILD // ${state.version.slice(0, 12)}`; field($("#displayAdmin"), "numberDigits").value = String(state.settings.numberDigits || 4); renderLinkRows();
}
function field(form, name) { return form.elements.namedItem(name); }
const editorForms = () => [$("#archiveForm"), $("#chapterForm"), $("#partForm")];
function closeEditors() { editorForms().forEach((form) => { form.hidden = true; form.removeAttribute("data-book-id"); form.removeAttribute("data-chapter-id"); form.removeAttribute("data-part-id"); }); }
function showEditor(form) { editorForms().forEach((item) => { if (item !== form) { item.hidden = true; item.removeAttribute("data-book-id"); item.removeAttribute("data-chapter-id"); item.removeAttribute("data-part-id"); } }); form.hidden = false; form.scrollIntoView({ behavior: state.motion ? "smooth" : "auto", block: "start" }); }
function editArchive(bookId = "") {
  const form = $("#archiveForm"); const book = state.adminBooks.find((item) => item.id === bookId); form.reset(); $("#archiveFormError").textContent = ""; form.dataset.bookId = bookId; field(form,"number").value = book?.number ?? Math.max(-1, ...state.adminBooks.map((item) => item.number)) + 1; field(form,"title").value = book?.title || ""; field(form,"description").value = book?.description || ""; field(form,"status").value = book?.status || "draft"; field(form,"status").disabled = !book; field(form,"publishAt").value = book?.publishAt ? new Date(book.publishAt).toISOString().slice(0,16) : ""; $("#archiveFormTitle").textContent = book ? "Archiveintrag bearbeiten" : "Neuer Archiveintrag"; syncPublishField(); showEditor(form);
}
function syncPublishField() { const scheduled = field($("#archiveForm"), "status").value === "scheduled"; $("#archivePublishField").hidden = !scheduled; field($("#archiveForm"), "publishAt").required = scheduled; }
function editChapter(bookId, chapterId = "") {
  const form = $("#chapterForm"); const book = state.adminBooks.find((item) => item.id === bookId); const chapter = book?.chapters.find((item) => item.id === chapterId); if (!book) return; form.reset(); $("#chapterFormError").textContent = ""; form.dataset.bookId = bookId; form.dataset.chapterId = chapterId; field(form,"number").value = chapter?.number ?? (book.chapters.length ? Math.max(...book.chapters.map((item) => item.number)) + 1 : book.number); field(form,"title").value = chapter?.title || ""; field(form,"tldr").value = chapter?.tldr || ""; $("#chapterFormTitle").textContent = chapter ? "Kapitel bearbeiten" : `Neues Kapitel · ${book.title}`; showEditor(form);
}
function editPart(bookId, partId = "", chapterId = "") {
  const form = $("#partForm"); const book = state.adminBooks.find((item) => item.id === bookId); const found = book && partId ? allParts(book).find((item) => item.part.id === partId) : null; if (!book?.chapters.length) return toast("Lege zuerst ein Kapitel an."); form.reset(); $("#partFormError").textContent = ""; form.dataset.bookId = bookId; form.dataset.partId = partId; const selectedChapterId = found?.chapter.id || chapterId || book.chapters[0].id; field(form,"chapterId").innerHTML = [...book.chapters].sort((a,b) => a.number - b.number).map((item) => `<option value="${escapeHtml(item.id)}">${formatNumber(item.number)} · ${escapeHtml(item.title)}</option>`).join(""); field(form,"chapterId").value = selectedChapterId; const selectedChapter = book.chapters.find((item) => item.id === selectedChapterId); field(form,"part").value = found?.part.number ?? Math.max(0, ...selectedChapter.parts.map((item) => item.number)) + 1; field(form,"partTitle").value = found?.part.title || ""; field(form,"tldr").value = found?.part.tldr || ""; field(form,"content").value = found?.part.content || ""; $("#partFormTitle").textContent = found ? "Teil bearbeiten" : `Neuer Teil · ${selectedChapter.title}`; showEditor(form);
}
function renderLinkRows() { $("#linkRows").innerHTML = state.links.map((link) => linkRow(link)).join(""); $$("[data-remove-link]").forEach((button) => button.onclick = () => button.closest(".link-row").remove()); }
const linkRow = (link = {}) => `<div class="link-row"><input name="label" value="${escapeHtml(link.label || "")}" placeholder="Bezeichnung"><input name="url" type="text" inputmode="url" value="${escapeHtml(link.url || "")}" placeholder="https://… oder discord://…"><button type="button" class="text-button icon-button" data-remove-link aria-label="Link entfernen">${iconSvg("trash")}</button></div>`;

function openCard(card) { if (card?.dataset.cardPart) location.hash = readerHash(card.dataset.cardBook, card.dataset.cardPart); }
function toggleBookRead(bookId) { const book = state.books.find((item) => item.id === bookId); if (!book) return; const parts = allParts(book); const next = nextGroupRead(parts.map(({part}) => isRead(book.id, part.id))); parts.forEach(({part}) => setRead(book.id, part.id, next)); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Archiv als gelesen markiert" : "Archiv als ungelesen markiert"); }
function toggleChapterRead(bookId, chapterId) { const book = state.books.find((item) => item.id === bookId); const chapter = book?.chapters.find((item) => item.id === chapterId); if (!book || !chapter) return; const next = nextGroupRead(chapter.parts.map((part) => isRead(book.id, part.id))); chapter.parts.forEach((part) => setRead(book.id, part.id, next)); renderChapterList(book, state.part?.id); updateReadToggle(); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Kapitel als gelesen markiert" : "Kapitel als ungelesen markiert"); }

document.addEventListener("click", (event) => {
  const reveal = event.target.closest("[data-reveal-tldr]"); const close = event.target.closest("[data-close-tldr]"); if (!reveal && !close) return;
  const details = event.target.closest("details.tldr"); if (!details) return;
  if (close) { details.open = false; return; }
  details.querySelector(".tldr-gate").hidden = true; const content = details.querySelector(".tldr-content"); content.textContent = details._tldr; content.hidden = false;
});
$("#bookSearch").oninput = (event) => renderLibrary(event.target.value); window.addEventListener("hashchange", () => { if (/^#preview\//.test(location.hash) && !state.previewBook) load(); else route(); }); window.addEventListener("resize", realignPages); window.addEventListener("scroll", updateProgress, { passive: true }); $("#readingPage").addEventListener("scroll", updateProgress, { passive: true });
$("#bookGrid").addEventListener("click", (event) => { const readButton = event.target.closest("[data-toggle-book-read]"); if (readButton) { event.preventDefault(); return toggleBookRead(readButton.dataset.toggleBookRead); } if (!event.target.closest("[data-card-link]")) openCard(event.target.closest("[data-card-book]")); });
$("#fontDown").onclick = () => { state.fontSize = Math.max(15, state.fontSize - 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); realignPages(); };
$("#fontUp").onclick = () => { state.fontSize = Math.min(26, state.fontSize + 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); realignPages(); };
$("#themePicker").onclick = (event) => { const choice = event.target.closest("[data-theme-choice]")?.dataset.themeChoice; if (choice) { state.theme = choice; localStorage.setItem("oracle-theme", choice); applyPreferences(); } };
$("#viewToggle").onclick = () => { state.view = state.view === "scroll" ? "pages" : "scroll"; localStorage.setItem("oracle-view", state.view); applyPreferences(); if (state.view === "pages") scrollTo(0, 0); requestAnimationFrame(() => restoreProgress(state.book.id, state.part.id)); };
$("#motionToggle").onclick = () => { state.motion = !state.motion; localStorage.setItem("oracle-motion", state.motion ? "on" : "off"); applyPreferences(); toast(state.motion ? "Animationen eingeschaltet" : "Animationen ausgeschaltet"); };
$("#chapterToggle").onclick = () => setDrawer(!$("#chapterDrawer").classList.contains("open")); $("#chapterClose").onclick = () => { setDrawer(false); $("#chapterToggle").focus(); }; $("#drawerBackdrop").onclick = () => setDrawer(false);
$("#pagePrev").onclick = () => turnPage(-1); $("#pageNext").onclick = () => turnPage(1); $("#pageEdgePrev").onclick = () => turnPage(-1); $("#pageEdgeNext").onclick = () => turnPage(1); $("#shareButton").onclick = shareCurrent;
for (const [selector, direction] of [["#pageEdgePrev", -1], ["#pageEdgeNext", 1]]) $(selector).addEventListener("touchend", (event) => { event.preventDefault(); event.stopPropagation(); turnPage(direction); }, { passive: false });
$("#readToggle").onclick = () => { const next = !isRead(state.book.id, state.part.id); setRead(state.book.id, state.part.id, next); updateReadToggle(); renderChapterList(state.book, state.part.id); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Als gelesen markiert" : "Als ungelesen markiert"); };
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && $("#chapterDrawer").classList.contains("open")) { setDrawer(false); $("#chapterToggle").focus(); return; } if (state.view !== "pages" || $("#readerView").hidden || !["ArrowLeft","ArrowRight"].includes(event.key) || ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) return; event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); });
$("#readingPage").addEventListener("wheel", (event) => { if (state.view !== "pages" || Math.abs(event.deltaY) < 12) return; event.preventDefault(); if (Date.now() - (turnPage.lastWheel || 0) < 450) return; turnPage.lastWheel = Date.now(); turnPage(event.deltaY > 0 ? 1 : -1); }, { passive: false });
let touchStartX = 0; $("#readingViewport").addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive: true }); $("#readingViewport").addEventListener("touchend", (event) => { if (state.view !== "pages") return; const distance = touchStartX - event.changedTouches[0].clientX; if (Math.abs(distance) > 45) turnPage(distance > 0 ? 1 : -1); }, { passive: true });
$("#adminOpen").onclick = () => { $("#mobileLinkMenu").open = false; $("#adminDialog").showModal(); }; $("#adminClose").onclick = () => $("#adminDialog").close();
$("#loginForm").onsubmit = async (event) => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); await load(); } catch (error) { $("#loginError").textContent = error.message; } };
$("#logoutButton").onclick = async () => { await api("/api/logout", { method: "POST" }); await load(); };
$("#newBookButton").onclick = () => editArchive(); $$('[data-cancel-editor]').forEach((button) => button.onclick = closeEditors);
field($("#archiveForm"), "status").onchange = syncPublishField;
$("#storyFile").onchange = async (event) => { const file = event.target.files[0]; if (file) field($("#partForm"),"content").value = await file.text(); };
field($("#partForm"), "chapterId").onchange = (event) => { const form = $("#partForm"); if (form.dataset.partId) return; const book = state.adminBooks.find((item) => item.id === form.dataset.bookId); const chapter = book?.chapters.find((item) => item.id === event.target.value); if (chapter) field(form,"part").value = Math.max(0, ...chapter.parts.map((item) => item.number)) + 1; };
$("#archiveForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const payload = { number: Number(data.number), title: data.title, description: data.description, status: data.status || "draft", publishAt: data.publishAt };
  try { const isNew = !form.dataset.bookId; const saved = await api(isNew ? "/api/admin/books" : `/api/admin/books/${encodeURIComponent(form.dataset.bookId)}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) }); closeEditors(); await load(); toast("Archiveintrag gespeichert"); if (isNew) editChapter(saved.id); } catch (error) { $("#archiveFormError").textContent = error.message; }
};
$("#chapterForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const payload = { number: Number(data.number), title: data.title, tldr: data.tldr }; const isNew = !form.dataset.chapterId;
  try { const saved = await api(`/api/admin/books/${encodeURIComponent(form.dataset.bookId)}/chapters${isNew ? "" : `/${encodeURIComponent(form.dataset.chapterId)}`}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) }); const bookId = form.dataset.bookId; closeEditors(); await load(); toast("Kapitel gespeichert"); if (isNew) editPart(bookId, "", saved.id); } catch (error) { $("#chapterFormError").textContent = error.message; }
};
$("#partForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const payload = { chapterId: data.chapterId, part: Number(data.part), partTitle: data.partTitle, tldr: data.tldr, content: data.content }; const isNew = !form.dataset.partId;
  try { await api(`/api/admin/books/${encodeURIComponent(form.dataset.bookId)}/parts${isNew ? "" : `/${encodeURIComponent(form.dataset.partId)}`}`, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) }); closeEditors(); await load(); toast("Teil gespeichert"); } catch (error) { $("#partFormError").textContent = error.message; }
};
$$('[data-admin-tab]').forEach((button) => button.onclick = () => { $$('[data-admin-tab]').forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); }); $("#booksAdmin").hidden = button.dataset.adminTab !== "books"; $("#displayAdmin").hidden = button.dataset.adminTab !== "display"; $("#linksAdmin").hidden = button.dataset.adminTab !== "links"; closeEditors(); });
$("#displayAdmin").onsubmit = async (event) => { event.preventDefault(); const numberDigits = Number(new FormData(event.target).get("numberDigits")); await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ numberDigits }) }); await load(); toast("Nummernformat gespeichert"); };
$("#addLink").onclick = () => { $("#linkRows").insertAdjacentHTML("beforeend", linkRow()); const button = $("#linkRows .link-row:last-child [data-remove-link]"); button.onclick = () => button.closest(".link-row").remove(); };
$("#linksAdmin").onsubmit = async (event) => { event.preventDefault(); const links = $$("#linkRows .link-row").map((row) => ({ label: row.querySelector('[name="label"]').value, url: row.querySelector('[name="url"]').value })); await api("/api/admin/links", { method: "PUT", body: JSON.stringify({ links }) }); await load(); toast("Links gespeichert"); };

applyPreferences(); load().catch((error) => { $("#bookGrid").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; });
