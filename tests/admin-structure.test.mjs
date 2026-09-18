import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const markup = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const form = (id) => markup.match(new RegExp(`<form[^>]+id="${id}"[\\s\\S]*?<\\/form>`))?.[0] || "";

test("Buch, Kapitel und Episode besitzen getrennte Bearbeitungsmasken", () => {
  assert.match(form("archiveForm"), /name="description"/);
  assert.doesNotMatch(form("archiveForm"), /name="tldr"|name="chapterId"|name="content"/);
  assert.match(form("chapterForm"), /Kapitel-TL;DR/);
  assert.doesNotMatch(form("chapterForm"), /name="part"|name="content"|name="description"/);
  assert.match(form("partForm"), /name="chapterId"/);
  assert.match(form("partForm"), /name="releasedAt" type="text"[\s\S]*?TT\.MM\.JJJJ/);
  assert.match(source, /germanDate\(found\?\.part\.releasedAt \|\| localToday\(\)\)/);
  assert.match(source, /releasedAt = isoDate\(data\.releasedAt\)/);
  assert.match(source, /releasedAt"\)\.oninput/);
  assert.match(form("partForm"), /Episoden-TL;DR/);
  assert.doesNotMatch(form("partForm"), /chapterTitle|name="description"|name="status"/);
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
