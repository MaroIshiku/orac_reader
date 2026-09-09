import { cardDestination, readerHash } from "/navigation.js?v=__APP_VERSION__";
import { aggregateRead, nextGroupRead } from "/read-status.js?v=__APP_VERSION__";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const storedMotion = localStorage.getItem("oracle-motion");
const state = { books: [], links: [], settings: { numberDigits: 4 }, version: "development", admin: false, book: null, part: null, fontSize: Number(localStorage.getItem("oracle-font-size")) || 19, view: localStorage.getItem("oracle-view") || "scroll", theme: localStorage.getItem("oracle-theme") || "paper", motion: storedMotion === null ? !matchMedia("(prefers-reduced-motion: reduce)").matches : storedMotion !== "off" };
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
  const data = await api("/api/library"); state.books = data.books; state.links = data.links; state.settings = data.settings || { numberDigits: 4 }; state.version = data.version || "development"; state.admin = data.admin;
  renderLinks(); renderLibrary(); renderHomeShelves(); renderAdmin(); route();
}
function renderLinks() { $("#customLinks").innerHTML = state.links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener"><span>${escapeHtml(link.label)}</span>${iconSvg("external")}</a>`).join(""); }
function renderLibrary(query = "") {
  const search = query.toLocaleLowerCase("de");
  const books = state.books.filter((book) => !search || [book.title, book.description, ...allParts(book).flatMap(({chapter, part}) => [chapter.title, chapter.tldr, part.title, part.tldr, part.content])].join(" ").toLocaleLowerCase("de").includes(search)).sort((a,b) => a.number - b.number);
  $("#emptyLibrary").hidden = books.length > 0;
  $("#archiveStats").textContent = `${state.books.length} AKTEN // ${state.books.reduce((sum, book) => sum + partCount(book), 0)} TEILE`;
  $("#bookGrid").innerHTML = books.map((book, index) => {
    const displayNumber = formatNumber(book.number); const target = cardDestination(book, getHistory()); const progress = readStats(book); const status = book.status !== "published" ? `<span class="status-badge">${book.status === "draft" ? "ENTWURF" : "GEPLANT"}</span>` : "";
    const readLabel = progress.state === "read" ? "Gelesen" : progress.state === "partial" ? `${progress.read} von ${progress.total} gelesen` : "Ungelesen";
    return `<article class="book-card is-${progress.state}" tabindex="0" role="link" data-card-book="${escapeHtml(book.id)}" data-card-part="${escapeHtml(target?.part.id || "")}" data-index="${displayNumber}"><div class="generated-cover"><img src="/oracle-logo.png" alt=""><span>ARCHIVAKTE</span><strong>${displayNumber}</strong></div><div class="book-number">KAPITEL ${displayNumber} ${status}</div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.description)}</p><div class="card-progress" role="progressbar" aria-label="Lesefortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><div><i style="width:${progress.percent}%"></i></div><span>${progress.percent}%</span></div><footer><span>${partCount(book)} ${partCount(book) === 1 ? "Teil" : "Teile"} · ${formatDate(book.updatedAt)}</span>${target ? `<button data-toggle-book-read="${escapeHtml(book.id)}" aria-label="Archiv als ${progress.state === "read" ? "ungelesen" : "gelesen"} markieren">${iconSvg(progress.state)}<span>${readLabel}</span></button>` : ""}</footer></article>`;
  }).join("");
  // Card navigation is delegated once on #bookGrid below. Re-rendering cannot overwrite another book's destination.
  $("#continueButton").innerHTML = `<span>Archiv entdecken</span>${iconSvg("arrow-down")}`; $("#continueButton").onclick = () => $("#libraryHeading").scrollIntoView({ behavior: "smooth" });
}
function renderHomeShelves() {
  const history = getHistory(); const recent = history.map((entry) => { const book = state.books.find((item) => item.id === entry.bookId); const found = book && allParts(book).find(({part}) => part.id === entry.partId); return book && found ? { book, ...found } : null; }).filter(Boolean).slice(0,3);
  $("#recentShelf").hidden = !recent.length; $("#recentBooks").innerHTML = recent.map(({book,chapter,part}) => `<button class="shelf-item" data-shelf="${escapeHtml(book.id)}:${escapeHtml(part.id)}"><span class="shelf-number">${formatNumber(chapter.number)}.${part.number}</span><span><b>${escapeHtml(part.title)}</b><small>${escapeHtml(book.title)}</small></span></button>`).join("");
  const newest = state.books.filter((book) => (book.status === "published" || (book.status === "scheduled" && new Date(book.publishAt) <= new Date())) && allParts(book).length).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0,3);
  $("#newBooks").innerHTML = newest.map((book) => { const {chapter,part} = allParts(book)[0]; return `<button class="shelf-item" data-shelf="${escapeHtml(book.id)}:${escapeHtml(part.id)}"><span class="shelf-number">${formatNumber(chapter.number)}.${part.number}</span><span><b>${escapeHtml(book.title)}</b><small>${escapeHtml(part.title)}</small></span></button>`; }).join("");
  $$('.home-shelves [data-shelf]').forEach((button) => button.onclick = () => { const [bookId,partId] = button.dataset.shelf.split(":"); location.hash = readerHash(bookId, partId); });
}
function route() {
  const match = location.hash.match(/^#?read\/([^/]+)\/([^/]+)/);
  if (!match) { const wasReading = !$("#readerView").hidden; $("#homeView").hidden = false; $("#readerView").hidden = true; $("#chapterDrawer").classList.remove("open"); document.body.classList.remove("reading"); document.title = "ORACLE — Archiv"; if (wasReading) requestAnimationFrame(() => scrollTo(0, 0)); return; }
  const book = state.books.find((item) => item.id === decodeURIComponent(match[1])); if (!book) return location.hash = "home";
  const entry = allParts(book).find(({part}) => part.id === decodeURIComponent(match[2])) || allParts(book)[0]; if (!entry) return location.hash = "home";
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
  $$('#chapterList [data-chapter-part]').forEach((button) => button.onclick = () => location.hash = readerHash(book.id, button.dataset.chapterPart));
  $$('#chapterList [data-toggle-chapter-read]').forEach((button) => button.onclick = () => toggleChapterRead(book.id, button.dataset.toggleChapterRead));
}
function openPart(book, chapter, part) {
  state.book = book; state.part = part; $("#homeView").hidden = true; $("#readerView").hidden = false; $("#chapterDrawer").classList.remove("open"); document.body.classList.add("reading");
  $("#drawerBookTitle").textContent = book.title; $("#storyKicker").textContent = book.kicker; $("#storyTitle").textContent = part.title;
  $("#storyDescription").textContent = book.description; $("#storyPart").textContent = `Kapitel ${formatNumber(chapter.number)} · Teil ${part.number}`;
  const words = part.content.trim().split(/\s+/).length; $("#readingTime").textContent = `${Math.max(1, Math.ceil(words / 220))} Min. Lesezeit`;
  $("#storyContent").innerHTML = markdown(part.content); resetTldr($("#partTldr"), part.tldr);
  const entries = allParts(book); const currentIndex = entries.findIndex((item) => item.part.id === part.id);
  renderChapterList(book, part.id);
  const next = entries[currentIndex + 1]; $("#nextChapter").hidden = !next; if (next) $("#nextChapter").onclick = () => location.hash = readerHash(book.id, next.part.id);
  const history = getHistory().filter((item) => !(item.bookId === book.id && item.partId === part.id)); history.unshift({ bookId: book.id, partId: part.id, at: Date.now() }); localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 20)));
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
async function shareCurrent() {
  const data = { title: `${state.part.title} — ${state.book.title}`, text: `ORACLE · Kapitel/Teil teilen`, url: location.href };
  if (navigator.share) { try { await navigator.share(data); return; } catch (error) { if (error.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(location.href); toast("Link kopiert"); } catch { const input = document.createElement("textarea"); input.value = location.href; document.body.append(input); input.select(); document.execCommand("copy"); input.remove(); toast("Link kopiert"); }
}

function renderAdmin() {
  $("#loginPanel").hidden = state.admin; $("#adminPanel").hidden = !state.admin; if (!state.admin) return;
  const list = $("#adminBookList");
  list.innerHTML = [...state.books].sort((a,b) => a.number - b.number).map((book) => {
    const chapters = book.chapters.map((chapter) => `<section class="admin-chapter"><div class="admin-chapter-head"><div><b>KAPITEL ${formatNumber(chapter.number)} · ${escapeHtml(chapter.title)}</b><small>${chapter.parts.length} ${chapter.parts.length === 1 ? "Teil" : "Teile"}${chapter.tldr ? " · TL;DR" : ""}</small></div><button data-edit-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}">Bearbeiten</button><button data-add-part="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}">${iconSvg("add")}<span>Teil</span></button><button class="icon-button" data-delete-chapter="${escapeHtml(book.id)}:${escapeHtml(chapter.id)}" aria-label="Kapitel löschen">${iconSvg("trash")}</button></div>${chapter.parts.map((part) => `<div class="admin-part"><span>${formatNumber(chapter.number)}.${part.number} · ${escapeHtml(part.title)}${part.tldr ? " · TL;DR" : ""}</span><button data-edit-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}">Bearbeiten</button><button class="icon-button" data-delete-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}" aria-label="Teil löschen">${iconSvg("trash")}</button></div>`).join("")}</section>`).join("");
    return `<article class="admin-book"><div><b>${formatNumber(book.number)} · ${escapeHtml(book.title)}</b><small>${book.status === "published" ? "Veröffentlicht" : book.status === "scheduled" ? `Geplant · ${formatDate(book.publishAt)}` : "Entwurf"} · ${book.chapters.length} Kapitel · ${partCount(book)} Teile</small></div><button data-edit-book="${escapeHtml(book.id)}">Bearbeiten</button><button data-add-chapter="${escapeHtml(book.id)}">${iconSvg("add")}<span>Kapitel</span></button><button class="icon-button" data-delete-book="${escapeHtml(book.id)}" aria-label="Archiveintrag löschen">${iconSvg("trash")}</button></article>${chapters}`;
  }).join("");
  list.onclick = async (event) => {
    const button = event.target.closest("button"); if (!button) return;
    try {
      if (button.dataset.editBook) return editArchive(button.dataset.editBook);
      if (button.dataset.addChapter) return editChapter(button.dataset.addChapter);
      if (button.dataset.editChapter) { const [bookId, chapterId] = button.dataset.editChapter.split(":"); return editChapter(bookId, chapterId); }
      if (button.dataset.addPart) { const [bookId, chapterId] = button.dataset.addPart.split(":"); return editPart(bookId, "", chapterId); }
      if (button.dataset.editPart) { const [bookId, partId] = button.dataset.editPart.split(":"); return editPart(bookId, partId); }
      if (button.dataset.deleteBook) { const book = state.books.find((item) => item.id === button.dataset.deleteBook); if (confirm(`„${book.title}“ samt Kapiteln und Teilen endgültig löschen?`)) { await api(`/api/admin/books/${encodeURIComponent(book.id)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Archiveintrag gelöscht"); } }
      if (button.dataset.deleteChapter) { const [bookId, chapterId] = button.dataset.deleteChapter.split(":"); if (confirm("Dieses Kapitel samt aller Teile endgültig löschen?")) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Kapitel gelöscht"); } }
      if (button.dataset.deletePart) { const [bookId, partId] = button.dataset.deletePart.split(":"); if (confirm("Diesen Teil endgültig löschen?")) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/parts/${encodeURIComponent(partId)}`, { method: "DELETE" }); closeEditors(); await load(); toast("Teil gelöscht"); } }
    } catch (error) { toast(error.message); }
  };
  $("#adminVersion").textContent = `BUILD // ${state.version.slice(0, 12)}`; field($("#displayAdmin"), "numberDigits").value = String(state.settings.numberDigits || 4); renderLinkRows();
}
function field(form, name) { return form.elements.namedItem(name); }
const editorForms = () => [$("#archiveForm"), $("#chapterForm"), $("#partForm")];
function closeEditors() { editorForms().forEach((form) => { form.hidden = true; form.removeAttribute("data-book-id"); form.removeAttribute("data-chapter-id"); form.removeAttribute("data-part-id"); }); }
function showEditor(form) { editorForms().forEach((item) => { if (item !== form) { item.hidden = true; item.removeAttribute("data-book-id"); item.removeAttribute("data-chapter-id"); item.removeAttribute("data-part-id"); } }); form.hidden = false; form.scrollIntoView({ behavior: state.motion ? "smooth" : "auto", block: "start" }); }
function editArchive(bookId = "") {
  const form = $("#archiveForm"); const book = state.books.find((item) => item.id === bookId); form.reset(); $("#archiveFormError").textContent = ""; form.dataset.bookId = bookId; field(form,"number").value = book?.number ?? Math.max(-1, ...state.books.map((item) => item.number)) + 1; field(form,"title").value = book?.title || ""; field(form,"description").value = book?.description || ""; field(form,"status").value = book?.status || "draft"; field(form,"status").disabled = !book; field(form,"publishAt").value = book?.publishAt ? new Date(book.publishAt).toISOString().slice(0,16) : ""; $("#archiveFormTitle").textContent = book ? "Archiveintrag bearbeiten" : "Neuer Archiveintrag"; showEditor(form);
}
function editChapter(bookId, chapterId = "") {
  const form = $("#chapterForm"); const book = state.books.find((item) => item.id === bookId); const chapter = book?.chapters.find((item) => item.id === chapterId); if (!book) return; form.reset(); $("#chapterFormError").textContent = ""; form.dataset.bookId = bookId; form.dataset.chapterId = chapterId; field(form,"number").value = chapter?.number ?? (book.chapters.length ? Math.max(...book.chapters.map((item) => item.number)) + 1 : book.number); field(form,"title").value = chapter?.title || ""; field(form,"tldr").value = chapter?.tldr || ""; $("#chapterFormTitle").textContent = chapter ? "Kapitel bearbeiten" : `Neues Kapitel · ${book.title}`; showEditor(form);
}
function editPart(bookId, partId = "", chapterId = "") {
  const form = $("#partForm"); const book = state.books.find((item) => item.id === bookId); const found = book && partId ? allParts(book).find((item) => item.part.id === partId) : null; if (!book?.chapters.length) return toast("Lege zuerst ein Kapitel an."); form.reset(); $("#partFormError").textContent = ""; form.dataset.bookId = bookId; form.dataset.partId = partId; const selectedChapterId = found?.chapter.id || chapterId || book.chapters[0].id; field(form,"chapterId").innerHTML = [...book.chapters].sort((a,b) => a.number - b.number).map((item) => `<option value="${escapeHtml(item.id)}">${formatNumber(item.number)} · ${escapeHtml(item.title)}</option>`).join(""); field(form,"chapterId").value = selectedChapterId; const selectedChapter = book.chapters.find((item) => item.id === selectedChapterId); field(form,"part").value = found?.part.number ?? Math.max(0, ...selectedChapter.parts.map((item) => item.number)) + 1; field(form,"partTitle").value = found?.part.title || ""; field(form,"tldr").value = found?.part.tldr || ""; field(form,"content").value = found?.part.content || ""; $("#partFormTitle").textContent = found ? "Teil bearbeiten" : `Neuer Teil · ${selectedChapter.title}`; showEditor(form);
}
function renderLinkRows() { $("#linkRows").innerHTML = state.links.map((link) => linkRow(link)).join(""); $$("[data-remove-link]").forEach((button) => button.onclick = () => button.closest(".link-row").remove()); }
const linkRow = (link = {}) => `<div class="link-row"><input name="label" value="${escapeHtml(link.label || "")}" placeholder="Bezeichnung"><input name="url" type="url" value="${escapeHtml(link.url || "")}" placeholder="https://…"><button type="button" class="text-button icon-button" data-remove-link aria-label="Link entfernen">${iconSvg("trash")}</button></div>`;

function openCard(card) { if (card?.dataset.cardPart) location.hash = readerHash(card.dataset.cardBook, card.dataset.cardPart); }
function toggleBookRead(bookId) { const book = state.books.find((item) => item.id === bookId); if (!book) return; const parts = allParts(book); const next = nextGroupRead(parts.map(({part}) => isRead(book.id, part.id))); parts.forEach(({part}) => setRead(book.id, part.id, next)); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Archiv als gelesen markiert" : "Archiv als ungelesen markiert"); }
function toggleChapterRead(bookId, chapterId) { const book = state.books.find((item) => item.id === bookId); const chapter = book?.chapters.find((item) => item.id === chapterId); if (!book || !chapter) return; const next = nextGroupRead(chapter.parts.map((part) => isRead(book.id, part.id))); chapter.parts.forEach((part) => setRead(book.id, part.id, next)); renderChapterList(book, state.part?.id); updateReadToggle(); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Kapitel als gelesen markiert" : "Kapitel als ungelesen markiert"); }

document.addEventListener("click", (event) => {
  const reveal = event.target.closest("[data-reveal-tldr]"); const close = event.target.closest("[data-close-tldr]"); if (!reveal && !close) return;
  const details = event.target.closest("details.tldr"); if (!details) return;
  if (close) { details.open = false; return; }
  details.querySelector(".tldr-gate").hidden = true; const content = details.querySelector(".tldr-content"); content.textContent = details._tldr; content.hidden = false;
});
$("#bookSearch").oninput = (event) => renderLibrary(event.target.value); window.addEventListener("hashchange", route); window.addEventListener("resize", updatePageControls); window.addEventListener("scroll", updateProgress, { passive: true }); $("#readingPage").addEventListener("scroll", updateProgress, { passive: true });
$("#bookGrid").addEventListener("click", (event) => { const readButton = event.target.closest("[data-toggle-book-read]"); if (readButton) return toggleBookRead(readButton.dataset.toggleBookRead); openCard(event.target.closest("[data-card-book]")); });
$("#bookGrid").addEventListener("keydown", (event) => { if (!["Enter", " "].includes(event.key) || event.target.closest("button")) return; const card = event.target.closest("[data-card-book]"); if (card) { event.preventDefault(); openCard(card); } });
$("#fontDown").onclick = () => { state.fontSize = Math.max(15, state.fontSize - 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); };
$("#fontUp").onclick = () => { state.fontSize = Math.min(26, state.fontSize + 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); };
$("#themePicker").onclick = (event) => { const choice = event.target.dataset.themeChoice; if (choice) { state.theme = choice; localStorage.setItem("oracle-theme", choice); applyPreferences(); } };
$("#viewToggle").onclick = () => { state.view = state.view === "scroll" ? "pages" : "scroll"; localStorage.setItem("oracle-view", state.view); applyPreferences(); if (state.view === "pages") scrollTo(0, 0); requestAnimationFrame(() => restoreProgress(state.book.id, state.part.id)); };
$("#motionToggle").onclick = () => { state.motion = !state.motion; localStorage.setItem("oracle-motion", state.motion ? "on" : "off"); applyPreferences(); toast(state.motion ? "Animationen eingeschaltet" : "Animationen ausgeschaltet"); };
$("#chapterToggle").onclick = () => $("#chapterDrawer").classList.toggle("open"); $("#chapterClose").onclick = () => $("#chapterDrawer").classList.remove("open");
$("#pagePrev").onclick = () => turnPage(-1); $("#pageNext").onclick = () => turnPage(1); $("#pageEdgePrev").onclick = () => turnPage(-1); $("#pageEdgeNext").onclick = () => turnPage(1); $("#shareButton").onclick = shareCurrent;
for (const [selector, direction] of [["#pageEdgePrev", -1], ["#pageEdgeNext", 1]]) $(selector).addEventListener("touchend", (event) => { event.preventDefault(); event.stopPropagation(); turnPage(direction); }, { passive: false });
$("#readToggle").onclick = () => { const next = !isRead(state.book.id, state.part.id); setRead(state.book.id, state.part.id, next); openPart(state.book, allParts(state.book).find(({part}) => part.id === state.part.id).chapter, state.part); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Als gelesen markiert" : "Als ungelesen markiert"); };
window.addEventListener("keydown", (event) => { if (state.view !== "pages" || $("#readerView").hidden || !["ArrowLeft","ArrowRight"].includes(event.key)) return; event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); });
$("#readingPage").addEventListener("wheel", (event) => { if (state.view !== "pages" || Math.abs(event.deltaY) < 12) return; event.preventDefault(); if (Date.now() - (turnPage.lastWheel || 0) < 450) return; turnPage.lastWheel = Date.now(); turnPage(event.deltaY > 0 ? 1 : -1); }, { passive: false });
let touchStartX = 0; $("#readingViewport").addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive: true }); $("#readingViewport").addEventListener("touchend", (event) => { if (state.view !== "pages") return; const distance = touchStartX - event.changedTouches[0].clientX; if (Math.abs(distance) > 45) turnPage(distance > 0 ? 1 : -1); }, { passive: true });
$("#adminOpen").onclick = () => $("#adminDialog").showModal(); $("#adminClose").onclick = () => $("#adminDialog").close();
$("#loginForm").onsubmit = async (event) => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); await load(); } catch (error) { $("#loginError").textContent = error.message; } };
$("#logoutButton").onclick = async () => { await api("/api/logout", { method: "POST" }); await load(); };
$("#newBookButton").onclick = () => editArchive(); $$('[data-cancel-editor]').forEach((button) => button.onclick = closeEditors);
$("#storyFile").onchange = async (event) => { const file = event.target.files[0]; if (file) field($("#partForm"),"content").value = await file.text(); };
field($("#partForm"), "chapterId").onchange = (event) => { const form = $("#partForm"); if (form.dataset.partId) return; const book = state.books.find((item) => item.id === form.dataset.bookId); const chapter = book?.chapters.find((item) => item.id === event.target.value); if (chapter) field(form,"part").value = Math.max(0, ...chapter.parts.map((item) => item.number)) + 1; };
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
$$('[data-admin-tab]').forEach((button) => button.onclick = () => { $$('[data-admin-tab]').forEach((item) => item.classList.toggle("active", item === button)); $("#booksAdmin").hidden = button.dataset.adminTab !== "books"; $("#displayAdmin").hidden = button.dataset.adminTab !== "display"; $("#linksAdmin").hidden = button.dataset.adminTab !== "links"; });
$("#displayAdmin").onsubmit = async (event) => { event.preventDefault(); const numberDigits = Number(new FormData(event.target).get("numberDigits")); await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ numberDigits }) }); await load(); toast("Nummernformat gespeichert"); };
$("#addLink").onclick = () => { $("#linkRows").insertAdjacentHTML("beforeend", linkRow()); const button = $("#linkRows .link-row:last-child [data-remove-link]"); button.onclick = () => button.closest(".link-row").remove(); };
$("#linksAdmin").onsubmit = async (event) => { event.preventDefault(); const links = $$("#linkRows .link-row").map((row) => ({ label: row.querySelector('[name="label"]').value, url: row.querySelector('[name="url"]').value })); await api("/api/admin/links", { method: "PUT", body: JSON.stringify({ links }) }); await load(); toast("Links gespeichert"); };

applyPreferences(); load().catch((error) => { $("#bookGrid").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; });
