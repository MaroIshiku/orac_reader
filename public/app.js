import { cardDestination, readerHash } from "/navigation.js?v=__APP_VERSION__";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { books: [], links: [], settings: { numberDigits: 4 }, version: "development", admin: false, book: null, part: null, fontSize: Number(localStorage.getItem("oracle-font-size")) || 19, view: localStorage.getItem("oracle-view") || "scroll", theme: localStorage.getItem("oracle-theme") || "paper" };
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
const formatNumber = (number) => String(Number(number) || 0).padStart(state.settings.numberDigits || 4, "0");
const formatDate = (date) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Anfrage fehlgeschlagen."); return result;
};
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2200); }

async function load() {
  const data = await api("/api/library"); state.books = data.books; state.links = data.links; state.settings = data.settings || { numberDigits: 4 }; state.version = data.version || "development"; state.admin = data.admin;
  renderLinks(); renderLibrary(); renderHomeShelves(); renderAdmin(); route();
}
function renderLinks() { $("#customLinks").innerHTML = state.links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener"><span>${escapeHtml(link.label)}</span>${iconSvg("external")}</a>`).join(""); }
function renderLibrary(query = "") {
  const search = query.toLocaleLowerCase("de");
  const books = state.books.filter((book) => !search || [book.title, book.description, book.tldr, ...allParts(book).flatMap(({chapter, part}) => [chapter.title, part.title, part.content])].join(" ").toLocaleLowerCase("de").includes(search)).sort((a,b) => a.number - b.number);
  $("#emptyLibrary").hidden = books.length > 0;
  $("#archiveStats").textContent = `${state.books.length} AKTEN // ${state.books.reduce((sum, book) => sum + partCount(book), 0)} TEILE`;
  $("#bookGrid").innerHTML = books.map((book, index) => {
    const displayNumber = formatNumber(book.number); const parts = allParts(book); const target = cardDestination(book, getHistory()); const allRead = parts.length && parts.every(({part}) => isRead(book.id, part.id)); const status = book.status !== "published" ? `<span class="status-badge">${book.status === "draft" ? "ENTWURF" : "GEPLANT"}</span>` : "";
    return `<article class="book-card" tabindex="0" role="link" data-card-book="${escapeHtml(book.id)}" data-card-part="${escapeHtml(target?.part.id || "")}" data-index="${displayNumber}"><div class="generated-cover"><img src="/oracle-logo.png" alt=""><span>ARCHIVAKTE</span><strong>${displayNumber}</strong></div><div class="book-number">KAPITEL ${displayNumber} ${status}</div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.description)}</p><footer><span>${partCount(book)} ${partCount(book) === 1 ? "Teil" : "Teile"} · ${formatDate(book.updatedAt)}</span>${target ? `<button data-toggle-book-read="${escapeHtml(book.id)}">${iconSvg(allRead ? "read" : "unread")}<span>${allRead ? "Gelesen" : "Ungelesen"}</span></button>` : ""}</footer></article>`;
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
function openPart(book, chapter, part) {
  state.book = book; state.part = part; $("#homeView").hidden = true; $("#readerView").hidden = false; $("#chapterDrawer").classList.remove("open"); document.body.classList.add("reading");
  $("#drawerBookTitle").textContent = book.title; $("#storyKicker").textContent = book.kicker; $("#storyTitle").textContent = part.title;
  $("#storyDescription").textContent = book.description; $("#storyPart").textContent = `Kapitel ${formatNumber(chapter.number)} · Teil ${part.number}`;
  const words = part.content.trim().split(/\s+/).length; $("#readingTime").textContent = `${Math.max(1, Math.ceil(words / 220))} Min. Lesezeit`;
  $("#storyContent").innerHTML = markdown(part.content); $("#storyTldr").hidden = !book.tldr; $("#storyTldr p").textContent = `Spoilerwarnung — ${book.tldr}`;
  const entries = allParts(book); const currentIndex = entries.findIndex((item) => item.part.id === part.id);
  $("#chapterList").innerHTML = book.chapters.map((item) => `<li><small class="chapter-group">KAPITEL ${formatNumber(item.number)} · ${escapeHtml(item.title)}</small>${item.parts.map((candidate) => `<button class="${candidate.id === part.id ? "active" : ""} ${isRead(book.id, candidate.id) ? "read" : ""}" data-chapter-part="${escapeHtml(candidate.id)}"><small>${formatNumber(item.number)}.${candidate.number}</small><span>${escapeHtml(candidate.title)}</span></button>`).join("")}</li>`).join("");
  $$('#chapterList [data-chapter-part]').forEach((button) => button.onclick = () => location.hash = readerHash(book.id, button.dataset.chapterPart));
  const next = entries[currentIndex + 1]; $("#nextChapter").hidden = !next; if (next) $("#nextChapter").onclick = () => location.hash = readerHash(book.id, next.part.id);
  const history = getHistory().filter((item) => !(item.bookId === book.id && item.partId === part.id)); history.unshift({ bookId: book.id, partId: part.id, at: Date.now() }); localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 20)));
  updateReadToggle(); requestAnimationFrame(() => { restoreProgress(book.id, part.id); updatePageControls(); }); document.title = `${part.title} — ORACLE`;
}
function progressPosition() { const viewport = $("#readingViewport"); if (state.view === "pages") return viewport.querySelector(".reading-page")?.scrollLeft || 0; return window.scrollY; }
function progressMaximum() { const page = $("#readingPage"); if (state.view === "pages") return Math.max(1, page.scrollWidth - page.clientWidth); return Math.max(1, document.documentElement.scrollHeight - innerHeight); }
function updateProgress() {
  if (!state.book || !state.part || $("#readerView").hidden) return; const ratio = Math.min(1, Math.max(0, progressPosition() / progressMaximum())); const percent = Math.round(ratio * 100);
  $("#progressLabel").textContent = `${percent}%`; $("#progressBar").style.width = `${percent}%`; const progress = getProgress(); progress[`${state.book.id}:${state.part.id}:${state.view}`] = { position: progressPosition(), percent, read: percent >= 90 }; localStorage.setItem(progressKey, JSON.stringify(progress)); updatePageControls(); updateReadToggle();
}
function restoreProgress(bookId, partId) { const saved = getProgress()[`${bookId}:${partId}:${state.view}`]; if (state.view === "pages") $("#readingPage").scrollLeft = saved?.position || 0; else scrollTo(0, saved?.position || 0); updateProgress(); }
function applyPreferences() {
  document.body.dataset.theme = state.theme; document.body.dataset.view = state.view; document.documentElement.style.setProperty("--reader-size", `${state.fontSize}px`); $("#viewLabel").textContent = state.view === "pages" ? "Seiten" : "Scrollen";
  $("#viewToggle use").setAttribute("href", state.view === "pages" ? "#i-pages" : "#i-scroll");
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  $$("[data-theme-choice]").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === state.theme));
}
function updateReadToggle() { if (!state.book || !state.part) return; const read = isRead(state.book.id, state.part.id); $("#readToggle").innerHTML = `${iconSvg(read ? "read" : "unread")}<span>${read ? "Gelesen" : "Ungelesen"}</span>`; $("#readToggle").setAttribute("aria-label", read ? "Als ungelesen markieren" : "Als gelesen markieren"); }
function pageMetrics() { const page = $("#readingPage"); const width = Math.max(1, page.clientWidth); const count = Math.max(1, Math.ceil(page.scrollWidth / width)); const current = Math.min(count - 1, Math.round(page.scrollLeft / width)); return { page, width, count, current }; }
function updatePageControls() { if (state.view !== "pages") return; const { count, current } = pageMetrics(); $("#pageCounter").textContent = `${current + 1} / ${count}`; $("#pagePrev").disabled = current === 0; $("#pageNext").disabled = current >= count - 1; }
function turnPage(direction) { const { page, width, count, current } = pageMetrics(); const target = Math.max(0, Math.min(count - 1, current + direction)); page.scrollTo({ left: target * width, behavior: "smooth" }); }
async function shareCurrent() {
  const data = { title: `${state.part.title} — ${state.book.title}`, text: `ORACLE · Kapitel/Teil teilen`, url: location.href };
  if (navigator.share) { try { await navigator.share(data); return; } catch (error) { if (error.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(location.href); toast("Link kopiert"); } catch { const input = document.createElement("textarea"); input.value = location.href; document.body.append(input); input.select(); document.execCommand("copy"); input.remove(); toast("Link kopiert"); }
}

function renderAdmin() {
  $("#loginPanel").hidden = state.admin; $("#adminPanel").hidden = !state.admin; if (!state.admin) return;
  $("#adminBookList").innerHTML = [...state.books].sort((a,b) => a.number - b.number).map((book) => `<article class="admin-book"><div><b>${formatNumber(book.number)} · ${escapeHtml(book.title)}</b><small>${book.status === "published" ? "Veröffentlicht" : book.status === "scheduled" ? `Geplant · ${formatDate(book.publishAt)}` : "Entwurf"} · ${partCount(book)} Teile</small></div><button data-add-part="${escapeHtml(book.id)}">${iconSvg("add")}<span>Teil</span></button><button data-delete-book="${escapeHtml(book.id)}">${iconSvg("trash")}<span>Löschen</span></button></article>${allParts(book).map(({chapter,part}) => `<div class="admin-part"><span>${formatNumber(chapter.number)}.${part.number} · ${escapeHtml(part.title)}</span><button data-edit-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}">Bearbeiten</button><button class="icon-button" data-delete-part="${escapeHtml(book.id)}:${escapeHtml(part.id)}" aria-label="Teil löschen">${iconSvg("trash")}</button></div>`).join("")}`).join("");
  $$('[data-add-part]').forEach((button) => button.onclick = () => editPart(button.dataset.addPart));
  $$('[data-edit-part]').forEach((button) => button.onclick = () => { const [bookId, partId] = button.dataset.editPart.split(":"); editPart(bookId, partId); });
  $$('[data-delete-book]').forEach((button) => button.onclick = async () => { const book = state.books.find((item) => item.id === button.dataset.deleteBook); if (confirm(`„${book.title}“ endgültig löschen?`)) { await api(`/api/admin/books/${encodeURIComponent(book.id)}`, { method: "DELETE" }); await load(); toast("Archiveintrag gelöscht"); } });
  $$('[data-delete-part]').forEach((button) => button.onclick = async () => { const [bookId, partId] = button.dataset.deletePart.split(":"); if (confirm("Diesen Teil endgültig löschen?")) { await api(`/api/admin/books/${encodeURIComponent(bookId)}/parts/${encodeURIComponent(partId)}`, { method: "DELETE" }); await load(); toast("Teil gelöscht"); } });
  $("#adminVersion").textContent = `BUILD // ${state.version.slice(0, 12)}`; field($("#displayAdmin"), "numberDigits").value = String(state.settings.numberDigits || 4); renderLinkRows();
}
function field(form, name) { return form.elements.namedItem(name); }
function fillBook(form, book) { field(form,"number").value = book?.number ?? Math.max(-1, ...state.books.map((item) => item.number)) + 1; field(form,"title").value = book?.title || ""; field(form,"description").value = book?.description || ""; field(form,"tldr").value = book?.tldr || ""; field(form,"status").value = book?.status || "draft"; field(form,"publishAt").value = book?.publishAt ? new Date(book.publishAt).toISOString().slice(0,16) : ""; }
function editPart(bookId = "", partId = "") {
  const form = $("#bookForm"); form.reset(); form.hidden = false; form.dataset.bookId = bookId; form.dataset.partId = partId; const book = state.books.find((item) => item.id === bookId); fillBook(form, book);
  let found; if (book && partId) found = allParts(book).find((item) => item.part.id === partId);
  field(form,"chapter").value = found?.chapter.number ?? book?.chapters.at(-1)?.number ?? Number(field(form,"number").value); field(form,"chapterTitle").value = found?.chapter.title || (book?.chapters.at(-1)?.title || ""); field(form,"part").value = found?.part.number || ((book?.chapters.at(-1)?.parts.at(-1)?.number || 0) + 1); field(form,"partTitle").value = found?.part.title || ""; field(form,"content").value = found?.part.content || "";
  $("#formTitle").textContent = !book ? "Neuer Archiveintrag" : found ? "Teil bearbeiten" : `Neuer Teil · ${book.title}`; form.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderLinkRows() { $("#linkRows").innerHTML = state.links.map((link) => linkRow(link)).join(""); $$("[data-remove-link]").forEach((button) => button.onclick = () => button.closest(".link-row").remove()); }
const linkRow = (link = {}) => `<div class="link-row"><input name="label" value="${escapeHtml(link.label || "")}" placeholder="Bezeichnung"><input name="url" type="url" value="${escapeHtml(link.url || "")}" placeholder="https://…"><button type="button" class="text-button icon-button" data-remove-link aria-label="Link entfernen">${iconSvg("trash")}</button></div>`;

function openCard(card) { if (card?.dataset.cardPart) location.hash = readerHash(card.dataset.cardBook, card.dataset.cardPart); }
function toggleBookRead(bookId) { const book = state.books.find((item) => item.id === bookId); if (!book) return; const next = !allParts(book).every(({part}) => isRead(book.id, part.id)); allParts(book).forEach(({part}) => setRead(book.id, part.id, next)); renderLibrary($("#bookSearch").value); renderHomeShelves(); toast(next ? "Archiv als gelesen markiert" : "Archiv als ungelesen markiert"); }

$("#bookSearch").oninput = (event) => renderLibrary(event.target.value); window.addEventListener("hashchange", route); window.addEventListener("resize", updatePageControls); window.addEventListener("scroll", updateProgress, { passive: true }); $("#readingPage").addEventListener("scroll", updateProgress, { passive: true });
$("#bookGrid").addEventListener("click", (event) => { const readButton = event.target.closest("[data-toggle-book-read]"); if (readButton) return toggleBookRead(readButton.dataset.toggleBookRead); openCard(event.target.closest("[data-card-book]")); });
$("#bookGrid").addEventListener("keydown", (event) => { if (!["Enter", " "].includes(event.key) || event.target.closest("button")) return; const card = event.target.closest("[data-card-book]"); if (card) { event.preventDefault(); openCard(card); } });
$("#fontDown").onclick = () => { state.fontSize = Math.max(15, state.fontSize - 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); };
$("#fontUp").onclick = () => { state.fontSize = Math.min(26, state.fontSize + 1); localStorage.setItem("oracle-font-size", state.fontSize); applyPreferences(); };
$("#themePicker").onclick = (event) => { const choice = event.target.dataset.themeChoice; if (choice) { state.theme = choice; localStorage.setItem("oracle-theme", choice); applyPreferences(); } };
$("#viewToggle").onclick = () => { state.view = state.view === "scroll" ? "pages" : "scroll"; localStorage.setItem("oracle-view", state.view); applyPreferences(); requestAnimationFrame(() => restoreProgress(state.book.id, state.part.id)); };
$("#chapterToggle").onclick = () => $("#chapterDrawer").classList.toggle("open"); $("#chapterClose").onclick = () => $("#chapterDrawer").classList.remove("open");
$("#pagePrev").onclick = () => turnPage(-1); $("#pageNext").onclick = () => turnPage(1); $("#pageEdgePrev").onclick = () => turnPage(-1); $("#pageEdgeNext").onclick = () => turnPage(1); $("#shareButton").onclick = shareCurrent;
$("#readToggle").onclick = () => { const next = !isRead(state.book.id, state.part.id); setRead(state.book.id, state.part.id, next); updateReadToggle(); openPart(state.book, allParts(state.book).find(({part}) => part.id === state.part.id).chapter, state.part); toast(next ? "Als gelesen markiert" : "Als ungelesen markiert"); };
window.addEventListener("keydown", (event) => { if (state.view !== "pages" || $("#readerView").hidden || !["ArrowLeft","ArrowRight"].includes(event.key)) return; event.preventDefault(); turnPage(event.key === "ArrowRight" ? 1 : -1); });
$("#readingPage").addEventListener("wheel", (event) => { if (state.view !== "pages" || Math.abs(event.deltaY) < 12) return; event.preventDefault(); if (Date.now() - (turnPage.lastWheel || 0) < 450) return; turnPage.lastWheel = Date.now(); turnPage(event.deltaY > 0 ? 1 : -1); }, { passive: false });
let touchStartX = 0; $("#readingViewport").addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive: true }); $("#readingViewport").addEventListener("touchend", (event) => { if (state.view !== "pages") return; const distance = touchStartX - event.changedTouches[0].clientX; if (Math.abs(distance) > 45) turnPage(distance > 0 ? 1 : -1); }, { passive: true });
$("#adminOpen").onclick = () => $("#adminDialog").showModal(); $("#adminClose").onclick = () => $("#adminDialog").close();
$("#loginForm").onsubmit = async (event) => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); await load(); } catch (error) { $("#loginError").textContent = error.message; } };
$("#logoutButton").onclick = async () => { await api("/api/logout", { method: "POST" }); await load(); };
$("#newBookButton").onclick = () => editPart(); $("#cancelEdit").onclick = () => $("#bookForm").hidden = true;
$("#storyFile").onchange = async (event) => { const file = event.target.files[0]; if (file) field($("#bookForm"),"content").value = await file.text(); };
$("#bookForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form)); const bookPayload = { number: Number(data.number), title: data.title, description: data.description, tldr: data.tldr, status: data.status, publishAt: data.publishAt };
  const partPayload = { chapter: Number(data.chapter), chapterTitle: data.chapterTitle, part: Number(data.part), partTitle: data.partTitle, content: data.content };
  let createdBookId = null;
  try {
    let bookId = form.dataset.bookId; const isNew = !bookId;
    if (isNew) { const created = await api("/api/admin/books", { method: "POST", body: JSON.stringify({ ...bookPayload, status: "draft" }) }); bookId = created.id; createdBookId = bookId; }
    const partId = form.dataset.partId; await api(`/api/admin/books/${encodeURIComponent(bookId)}/parts${partId ? `/${encodeURIComponent(partId)}` : ""}`, { method: partId ? "PUT" : "POST", body: JSON.stringify(partPayload) });
    await api(`/api/admin/books/${encodeURIComponent(bookId)}`, { method: "PUT", body: JSON.stringify(bookPayload) }); form.hidden = true; await load(); toast("Archiveintrag gespeichert");
  } catch (error) { if (createdBookId) await api(`/api/admin/books/${encodeURIComponent(createdBookId)}`, { method: "DELETE" }).catch(() => {}); $("#bookFormError").textContent = error.message; }
};
$$('[data-admin-tab]').forEach((button) => button.onclick = () => { $$('[data-admin-tab]').forEach((item) => item.classList.toggle("active", item === button)); $("#booksAdmin").hidden = button.dataset.adminTab !== "books"; $("#displayAdmin").hidden = button.dataset.adminTab !== "display"; $("#linksAdmin").hidden = button.dataset.adminTab !== "links"; });
$("#displayAdmin").onsubmit = async (event) => { event.preventDefault(); const numberDigits = Number(new FormData(event.target).get("numberDigits")); await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ numberDigits }) }); await load(); toast("Nummernformat gespeichert"); };
$("#addLink").onclick = () => { $("#linkRows").insertAdjacentHTML("beforeend", linkRow()); const button = $("#linkRows .link-row:last-child [data-remove-link]"); button.onclick = () => button.closest(".link-row").remove(); };
$("#linksAdmin").onsubmit = async (event) => { event.preventDefault(); const links = $$("#linkRows .link-row").map((row) => ({ label: row.querySelector('[name="label"]').value, url: row.querySelector('[name="url"]').value })); await api("/api/admin/links", { method: "PUT", body: JSON.stringify({ links }) }); await load(); toast("Links gespeichert"); };

applyPreferences(); load().catch((error) => { $("#bookGrid").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; });
