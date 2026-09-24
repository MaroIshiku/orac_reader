import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const markup = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const form = (id) => markup.match(new RegExp(`<form[^>]+id="${id}"[\\s\\S]*?<\\/form>`))?.[0] || "";

test("Buch, Kapitel und Episode besitzen getrennte Bearbeitungsmasken", () => {
  assert.match(form("archiveForm"), /name="description"/);
  assert.doesNotMatch(form("archiveForm"), /name="tldr"|name="chapterId"|name="content"/);
  assert.match(form("chapterForm"), /Kapitel-TL;DR/);
  assert.doesNotMatch(form("chapterForm"), /name="part"|name="content"|name="description"/);
  assert.match(form("partForm"), /name="chapterId"/);
  assert.match(form("partForm"), /name="status"[\s\S]*?value="draft"[\s\S]*?value="scheduled"/);
  assert.match(form("partForm"), /id="partPublishField"[\s\S]*?name="publishDate" type="text"[\s\S]*?TT\.MM\.JJJJ[\s\S]*?name="publishTime" type="time"/);
  assert.match(source, /scheduledInstantFromFields/);
  assert.match(form("partForm"), /name="releasedAt" type="text"[\s\S]*?TT\.MM\.JJJJ/);
  assert.match(source, /germanDate\(found\?\.part\.releasedAt \|\| localToday\(\)\)/);
  assert.match(source, /releasedAt = isoDate\(data\.releasedAt\)/);
  assert.match(source, /releasedAt"\)\.oninput/);
  assert.match(form("partForm"), /Episoden-TL;DR/);
  assert.doesNotMatch(form("partForm"), /chapterTitle|name="description"/);
  assert.match(source, /syncPartPublishField/);
  assert.match(server, /part\.hidden && isPublished\(part\)/);
  assert.match(server, /const chapterMatch = url\.pathname\.match/);
  assert.match(server, /chapters\\\/order/);
  assert.match(server, /api\/admin\/chapters\/move/);
  assert.match(source, /data-preview-book/);
  assert.match(source, /ondragstart/);
  assert.match(source, /data-transfer-chapter/);
  assert.match(source, /collapseKey\("admin-book", book\.id\)/);
  assert.match(source, /collapseKey\("admin-chapter", book\.id, chapter\.id\)/);
  assert.match(source, /class="admin-book-summary collapse-toggle"/);
  assert.match(source, /class="admin-chapter-title"/);
  assert.match(source, /class="chapter-visibility-button collapse-toggle"/);
  assert.match(source, /data-collapse-label/);
  assert.match(source, /Teile anzeigen/);
  assert.match(source, /Teile ausblenden/);
  assert.match(source, /title="Nach oben"/);
  assert.match(source, /title="Nach unten"/);
  assert.match(source, /saveChapterMove/);
  assert.match(server, /discord:\\\/\\\//);
  assert.doesNotMatch(markup + source + server, /contentWarning|Inhaltswarnung/i);
  assert.match(source, /activeReaderHash/);
  assert.match(form("archiveForm"), /name="hidden"/);
  assert.match(form("archiveForm"), /id="bookCoverFile"[^>]+type="file"[^>]+image\/webp/);
  assert.match(form("chapterForm"), /name="hidden"/);
  assert.match(form("partForm"), /name="hidden"/);
  assert.match(form("partForm"), /id="partImageFile"[^>]+type="file"[^>]+image\/avif/);
  assert.match(form("partForm"), /id="partCharacterCount"[^>]*>0 Zeichen/);
  assert.match(form("displayAdmin"), /bookSingular/);
  assert.match(source, /roman-upper/);
  assert.match(source, /uploadImage/);
  assert.match(source, /updatePartCharacterCount/);
  assert.match(server, /\/api\/admin\/media/);
  assert.match(server, /max-age=31536000, immutable/);
});

test("Administration ist eine eigenständige Vollbildseite mit gegliedertem Arbeitsbereich", () => {
  assert.match(markup, /id="adminOpen" href="\/admin"/);
  assert.match(markup, /<main class="admin-page" id="adminPage"/);
  assert.doesNotMatch(markup, /id="adminDialog"/);
  assert.match(markup, /class="admin-dashboard"/);
  assert.match(markup, /class="admin-rail"/);
  assert.match(markup, /class="admin-workspace"/);
  assert.match(markup, /id="adminBookCount"/);
  assert.match(source, /adminRoute = location\.pathname/);
  assert.match(server, /"\/admin", "\/admin\/"/);
});

test("TL;DR wird erst nach einer eigenen Spoilerbestätigung eingesetzt", () => {
  assert.match(markup, /Dieses Episoden-TL;DR enthält Spoiler/);
  assert.doesNotMatch(markup, /id="chapterTldr"/);
  assert.match(markup, /data-reveal-tldr/);
  assert.match(source, /content\.textContent = details\._tldr/);
  assert.match(source, /data-chapter-tldr/);
  assert.match(source, /Dieses TL;DR enthält Spoiler/);
});

test("veröffentlichte Bücher, Kapitel und Teile lassen sich als EPUB oder PDF herunterladen", () => {
  assert.match(markup, /id="downloadMenu"/);
  assert.match(markup, /data-export-scope="book" data-export-format="epub"/);
  assert.match(markup, /data-export-scope="chapter" data-export-format="pdf"/);
  assert.match(markup, /data-export-scope="part" data-export-format="epub"/);
  assert.match(source, /exportUrl\("epub", "book", book\.id\)/);
  assert.match(source, /state\.chapter = chapter/);
  assert.match(server, /const exportMatch = url\.pathname\.match/);
  assert.match(server, /createExport\(selection, format/);
});

test("Leseeinstellungen liegen sichtbar in der Reader-Werkzeugleiste", () => {
  const drawer = markup.match(/<aside class="chapter-drawer"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.doesNotMatch(drawer, /readerSettingsMenu|fontFamily|themePicker/);
  assert.match(markup, /id="readToggle"[\s\S]*?id="downloadMenu"[\s\S]*?id="bookmarkToggle"[\s\S]*?id="shareButton"[\s\S]*?id="readerSettingsMenu"/);
  assert.match(markup, /id="fontFamily"[\s\S]*?value="serif"[\s\S]*?value="sans"/);
  assert.match(source, /oracle-reader-font/);
  assert.match(source, /dataset\.readerFont = state\.fontFamily/);
  assert.match(markup, /class="reader-progress"[\s\S]*?id="progressBar"/);
});

test("Reader-Werkzeugleiste hält in jedem Format nur den Lesestatus beschriftet", () => {
  for (const id of ["bookmarkToggle", "shareButton"]) {
    const button = markup.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /aria-label=/);
    assert.doesNotMatch(button, /<span>/);
  }
  for (const id of ["downloadMenu", "readerSettingsMenu"]) {
    const summary = markup.match(new RegExp(`<details[^>]*id="${id}"[\\s\\S]*?<summary[\\s\\S]*?<\\/summary>`))?.[0] || "";
    assert.match(summary, /class="tool-button icon-only"/);
    assert.doesNotMatch(summary, /<span>/);
  }
  assert.match(markup, /class="tool-button read-status-control" id="readToggle"[\s\S]*?<span>Ungelesen<\/span>/);
  assert.match(styles, /\.reader-toolbar \.read-status-control > span \{ display: inline; \}/);
});
