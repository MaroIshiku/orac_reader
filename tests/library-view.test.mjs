import test from "node:test";
import assert from "node:assert/strict";
import { findStructureResults, findTextResults, sortBooks, sortReaderChapters } from "../public/library-view.js";

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

test("Releasedatum hat bei der Buchsortierung Vorrang vor der letzten Bearbeitung", () => {
  const withReleases = books.map((book, index) => ({ ...book, releasedAt: [`2026-02-01`, `2024-02-01`, `2025-02-01`][index] }));
  assert.deepEqual(sortBooks(withReleases, "release", "desc").map(({ id }) => id), ["b-2", "b-3", "b-1"]);
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

test("Bibliothekssuche findet Bücher, Kapitel und Teile anhand von Namen und Nummern", () => {
  const library = [{
    id: "book", number: 1, title: "Äther-Chronik", description: "",
    display: { bookSingular: "Archiv", chapterSingular: "Akte", partSingular: "Fragment" },
    chapters: [{ id: "chapter", number: 7, title: "Anfang", tldr: "", parts: [{
      id: "part", number: 3, title: "Begegnung", tldr: "", content: "Try steht nur im Fließtext."
    }] }]
  }];
  const format = (_book, kind, value) => kind === "book" || kind === "chapter" ? String(value).padStart(4, "0") : String(value);
  assert.deepEqual(findStructureResults(library, "ather", format).map(({ kind }) => kind), ["book"]);
  assert.deepEqual(findStructureResults(library, "Akte 0007", format).map(({ kind }) => kind), ["chapter"]);
  assert.deepEqual(findStructureResults(library, "0007.3", format).map(({ kind }) => kind), ["part"]);
  assert.deepEqual(findStructureResults(library, "Begegnung", format).map(({ kind }) => kind), ["part"]);
});

test("Bibliothekssuche ignoriert Lesetexte, während die Adminsuche alle Textstellen findet", () => {
  const library = [{
    id: "book", number: 1, title: "Roman", description: "Try Beschreibung",
    chapters: [{ id: "chapter", number: 1, title: "Kapitel", tldr: "Try kurz", parts: [{
      id: "part", number: 1, title: "Teil", tldr: "Try kurz", content: "**Try** im Fließtext"
    }] }]
  }];
  assert.deepEqual(findStructureResults(library, "try"), []);
  assert.deepEqual(findTextResults(library, "try").map(({ source }) => source), ["book-description", "chapter-tldr", "part-tldr", "content"]);
});

test("Admin-Volltextsuche liefert jede einzelne Fundstelle mit Kontext", () => {
  const library = [{ id: "book", number: 1, title: "Roman", description: "", chapters: [{ id: "chapter", number: 1, title: "Anfang", tldr: "", parts: [{ id: "part", number: 1, title: "Begegnung", tldr: "", content: "Try trat ein. Niemand sah Try. Später rief Try noch einmal." }] }] }];
  const results = findTextResults(library, "Try");
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.source === "content"));
  assert.deepEqual(results.map((result) => result.context.match), ["Try", "Try", "Try"]);
});
