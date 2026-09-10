import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/library.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("Oracle wird als ein Buch mit vier geordneten Kapiteln ausgeliefert", () => {
  assert.equal(data.schemaVersion, 7);
  assert.equal(data.books.length, 1);
  const book = data.books[0];
  assert.equal(book.id, "oracle-0000");
  assert.equal(book.title, "Oracle");
  assert.deepEqual(book.chapters.map((chapter) => chapter.number), [0, 1, 2, 3]);
  assert.deepEqual(book.chapters.map((chapter) => chapter.order), [0, 1, 2, 3]);
  assert.equal(book.chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0), 23);
  assert.equal(new Set(book.chapters.flatMap((chapter) => chapter.parts.map((part) => part.id))).size, 23);
});

test("Buchkarten zeigen den Titel nur auf dem Cover und keine Kapiteldaten", () => {
  assert.doesNotMatch(source, /chapterTitle|coverNumber/);
  assert.match(source, /<div class="book-card-copy"><div class="book-number">[\s\S]*?<\/div><p>/);
  assert.match(source, /migrateConsolidatedBookStorage/);
  assert.match(source, /history\.replaceState/);
});

test("Buchkarten bleiben auch am Desktop vertikal und Leseteile wiederholen die Buchbeschreibung nicht", () => {
  assert.match(styles, /\.book-card\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(html, /storyDescription/);
  assert.doesNotMatch(source, /storyDescription/);
  assert.match(source, /chapterClose[\s\S]*?pointerup[\s\S]*?closeChapterDrawer/);
});
