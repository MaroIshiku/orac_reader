import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createEpub, createPdf, exportFilename, selectExport } from "../exports.mjs";

const book = {
  id: "neutral-book", number: 4, title: "Äther & Wege", kicker: "ARCHIV", description: "Eine neutrale Testbeschreibung.",
  display: { chapterSingular: "Kapitel", chapterPlural: "Kapitel", partSingular: "Episode", partPlural: "Episoden", chapterNumberFormat: "decimal", partNumberFormat: "decimal" },
  chapters: [{ id: "chapter-1", number: 1, title: "Anfang", parts: [{ id: "part-1", number: 1, title: "Die Tür", releasedAt: "2026-09-21", content: "## Szene\n\n> Ein Zitat.\n\n- Erster Punkt\n- Zweiter Punkt mit **Nachdruck**." }] }]
};

test("Bücher, Kapitel und Teile werden als EPUB und PDF exportiert", async () => {
  const bookSelection = selectExport(book, "book"); const chapterSelection = selectExport(book, "chapter", "chapter-1"); const partSelection = selectExport(book, "part", "part-1");
  assert.equal(bookSelection.chapters.length, 1);
  assert.equal(chapterSelection.title, "Anfang");
  assert.equal(partSelection.title, "Die Tür");
  assert.equal(exportFilename(partSelection, "epub"), "Ather-Wege-Die-Tur.epub");

  const epub = await createEpub(bookSelection); const archive = await JSZip.loadAsync(epub);
  assert.equal(await archive.file("mimetype").async("string"), "application/epub+zip");
  assert.ok(archive.file("META-INF/container.xml"));
  assert.match(await archive.file("OEBPS/nav.xhtml").async("string"), /Die Tür/);
  assert.match(await archive.file("OEBPS/text/part-1.xhtml").async("string"), /<blockquote>[\s\S]*Ein Zitat/);
  assert.match(await archive.file("OEBPS/text/part-1.xhtml").async("string"), /<ul>[\s\S]*Erster Punkt/);

  const pdf = await createPdf(partSelection);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 2_000);
});

test("unbekannte Exportziele werden abgewiesen", () => {
  assert.equal(selectExport(book, "chapter", "missing"), null);
  assert.equal(selectExport(book, "part", "missing"), null);
});
