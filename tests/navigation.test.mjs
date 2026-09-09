import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cardDestination, readerHash } from "../public/navigation.js";

const makeBook = (id, partIds) => ({
  id,
  chapters: [{ id: `${id}-chapter`, number: 1, title: "Kapitel", parts: partIds.map((partId, index) => ({ id: partId, number: index + 1, title: partId })) }]
});

test("jede Bibliothekskarte behält ihr eigenes Ziel nach Chronikwechseln", () => {
  const firstBook = makeBook("book-a", ["a-1", "a-2"]);
  const secondBook = makeBook("book-b", ["b-1", "b-2"]);
  const history = [{ bookId: "book-a", partId: "a-2" }, { bookId: "book-b", partId: "b-2" }];

  assert.equal(cardDestination(firstBook, history).part.id, "a-2");
  assert.equal(cardDestination(secondBook, history).part.id, "b-2");
  assert.equal(readerHash(secondBook.id, cardDestination(secondBook, history).part.id), "read/book-b/b-2");
});

test("Kapitelhandler sind auf die Inhaltsnavigation begrenzt", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /#chapterList \[data-chapter-part\]/);
  assert.doesNotMatch(source, /\$\$\('\[data-chapter-part\]'\)/);
  assert.match(source, /#bookGrid \[data-card-book\]/);
});
