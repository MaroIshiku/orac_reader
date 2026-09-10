import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const markup = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const form = (id) => markup.match(new RegExp(`<form[^>]+id="${id}"[\\s\\S]*?<\\/form>`))?.[0] || "";

test("Archiveintrag, Kapitel und Teil besitzen getrennte Bearbeitungsmasken", () => {
  assert.match(form("archiveForm"), /name="description"/);
  assert.doesNotMatch(form("archiveForm"), /name="tldr"|name="chapterId"|name="content"/);
  assert.match(form("chapterForm"), /Kapitel-TL;DR/);
  assert.doesNotMatch(form("chapterForm"), /name="part"|name="content"|name="description"/);
  assert.match(form("partForm"), /name="chapterId"/);
  assert.match(form("partForm"), /Teil-TL;DR/);
  assert.doesNotMatch(form("partForm"), /chapterTitle|name="description"|name="status"/);
  assert.match(server, /const chapterMatch = url\.pathname\.match/);
  assert.match(server, /chapters\\\/order/);
  assert.match(source, /data-preview-book/);
  assert.match(source, /ondragstart/);
  assert.match(server, /discord:\\\/\\\//);
  assert.doesNotMatch(markup + source + server, /contentWarning|Inhaltswarnung/i);
  assert.match(source, /activeReaderHash/);
});

test("TL;DR wird erst nach einer eigenen Spoilerbestätigung eingesetzt", () => {
  assert.match(markup, /Dieses Teil-TL;DR enthält Spoiler/);
  assert.doesNotMatch(markup, /id="chapterTldr"/);
  assert.match(markup, /data-reveal-tldr/);
  assert.match(source, /content\.textContent = details\._tldr/);
  assert.match(source, /data-chapter-tldr/);
  assert.match(source, /Dieses Kapitel-TL;DR enthält Spoiler/);
});
