import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/library.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("Oracle wird als ein Buch mit vier geordneten Kapiteln ausgeliefert", () => {
  assert.equal(data.schemaVersion, 11);
  assert.equal(data.books.length, 1);
  const book = data.books[0];
  assert.equal(book.id, "oracle-0000");
  assert.equal(book.title, "Oracle");
  assert.equal(book.coverImage, "");
  assert.deepEqual([book.display.bookSingular, book.display.chapterSingular, book.display.partSingular], ["Archiv", "Akte", "Fragment"]);
  assert.deepEqual([book.display.bookNumberFormat, book.display.chapterNumberFormat, book.display.partNumberFormat], ["pad4", "pad4", "decimal"]);
  assert.deepEqual(book.chapters.map((chapter) => chapter.number), [0, 1, 2, 3]);
  assert.deepEqual(book.chapters.map((chapter) => chapter.order), [0, 1, 2, 3]);
  assert.equal(book.chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0), 23);
  assert.equal(new Set(book.chapters.flatMap((chapter) => chapter.parts.map((part) => part.id))).size, 23);
  assert.equal(book.releasedAt, "2026-09-09");
  assert.ok(book.chapters.every((chapter) => chapter.releasedAt === "2026-09-09"));
  assert.ok(book.chapters.flatMap((chapter) => chapter.parts).every((part) => part.releasedAt === "2026-09-09"));
  assert.ok(book.chapters.flatMap((chapter) => chapter.parts).every((part) => part.image === ""));
});

test("Bezeichnungen und Nummerierung sind pro Buch konfigurierbar", () => {
  assert.match(source, /bookSingular: "Buch"[\s\S]*?chapterSingular: "Kapitel"[\s\S]*?partSingular: "Episode"/);
  assert.match(source, /roman-upper/);
  assert.match(source, /api\/admin\/books\/\$\{encodeURIComponent\(bookId\)\}\/display/);
});

test("eigene Buchcover bleiben unverfälscht und alle Metadaten stehen im Klappentext", () => {
  assert.doesNotMatch(source, /chapterTitle|coverNumber/);
  assert.match(source, /<div class="book-card-copy"><div class="book-copy-heading">[\s\S]*?<\/div><h3>[\s\S]*?book-copy-meta/);
  assert.match(source, /data-toggle-card-details="show"/);
  assert.match(styles, /\.generated-cover\.has-image :is\(\.cover-brand, \.cover-copy\) \{ display: none; \}/);
  assert.match(styles, /object-position: center center/);
  assert.match(styles, /\.generated-cover\.has-image \.cover-number[\s\S]*?background: rgba/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(styles, /@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(source, /migrateConsolidatedBookStorage/);
  assert.match(source, /history\.replaceState/);
});

test("Buchkarten bleiben auch am Desktop vertikal und Leseteile wiederholen die Buchbeschreibung nicht", () => {
  assert.match(styles, /\.book-card\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(html, /storyDescription/);
  assert.doesNotMatch(source, /storyDescription/);
  assert.match(source, /chapterClose[\s\S]*?pointerup[\s\S]*?closeChapterDrawer/);
});
