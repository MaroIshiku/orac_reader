import test from "node:test";
import assert from "node:assert/strict";
import { findLibraryResults, sortBooks, sortReaderChapters } from "../public/library-view.js";

const books = [
  { id: "b-2", number: 2, title: "Zweiter", updatedAt: "2025-01-01T00:00:00Z", chapters: [] },
  { id: "b-1", number: 1, title: "Alpha", updatedAt: "2026-01-01T00:00:00Z", chapters: [] },
  { id: "b-3", number: 3, title: "Äther", updatedAt: "2024-01-01T00:00:00Z", chapters: [] }
];

test("Bücher lassen sich nach Nummer, Alphabet und Veröffentlichung in beide Richtungen sortieren", () => {
  assert.deepEqual(sortBooks(books, "number", "asc").map(({ id }) => id), ["b-1", "b-2", "b-3"]);
  assert.deepEqual(sortBooks(books, "number", "desc").map(({ id }) => id), ["b-3", "b-2", "b-1"]);
  assert.deepEqual(sortBooks(books, "alphabetical", "asc").map(({ id }) => id), ["b-1", "b-3", "b-2"]);
  assert.deepEqual(sortBooks(books, "alphabetical", "desc").map(({ id }) => id), ["b-2", "b-3", "b-1"]);
  assert.deepEqual(sortBooks(books, "release", "desc").map(({ id }) => id), ["b-1", "b-2", "b-3"]);
});

test("umgekehrte Leseübersicht dreht Kapitel und ihre Teile ohne Quelldaten zu verändern", () => {
  const chapters = [
    { id: "c-1", number: 1, parts: [{ id: "p-1" }, { id: "p-2" }] },
    { id: "c-2", number: 2, parts: [{ id: "p-3" }, { id: "p-4" }] }
  ];
  const sorted = sortReaderChapters(chapters, "desc");
  assert.deepEqual(sorted.map(({ id }) => id), ["c-2", "c-1"]);
  assert.deepEqual(sorted.map(({ parts }) => parts.map(({ id }) => id)), [["p-4", "p-3"], ["p-2", "p-1"]]);
  assert.deepEqual(chapters[0].parts.map(({ id }) => id), ["p-1", "p-2"]);
});

test("Suche liefert jede einzelne Fundstelle mit Kontext und Zielteil", () => {
  const library = [{
    id: "book", number: 1, title: "Roman", description: "",
    chapters: [{ id: "chapter", number: 1, title: "Anfang", tldr: "", parts: [{
      id: "part", number: 1, title: "Begegnung", tldr: "",
      content: "Try trat ein. Niemand sah Try. Später rief Try noch einmal."
    }] }]
  }];
  const results = findLibraryResults(library, "Try");
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.source === "content"));
  assert.ok(results.every((result) => result.book.id === "book" && result.chapter.id === "chapter" && result.part.id === "part"));
  assert.deepEqual(results.map((result) => result.context.match), ["Try", "Try", "Try"]);
  assert.ok(results.every((result) => `${result.context.before}${result.context.match}${result.context.after}`.includes("Try")));
});

test("Suche berücksichtigt auch Titel, Kurzfassungen und Markdown-Text", () => {
  const library = [{
    id: "book", number: 1, title: "Try-Akte", description: "",
    chapters: [{ id: "chapter", number: 1, title: "Try Kapitel", tldr: "", parts: [{
      id: "part", number: 1, title: "Teil", tldr: "Try kurz", content: "**Try** im Fließtext"
    }] }]
  }];
  assert.deepEqual(findLibraryResults(library, "try").map(({ source }) => source), ["book-title", "chapter-title", "part-tldr", "content"]);
});
