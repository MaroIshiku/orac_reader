import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Kapitel 0 sowie getrennte Kapitel- und Teil-TL;DR bleiben über die Admin-API erhalten", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "oracle-reader-api-"));
  const fixture = {
    schemaVersion: 13,
    settings: { numberDigits: 4 },
    links: [],
    books: [{
      id: "test-book", number: 1, title: "Testbuch", kicker: "TEST", description: "Neutrale API-Testdaten.", status: "published", publishAt: null, updatedAt: "2026-09-19T00:00:00.000Z", coverImage: "", hidden: false,
      display: { bookSingular: "Buch", bookPlural: "Bücher", chapterSingular: "Kapitel", chapterPlural: "Kapitel", partSingular: "Episode", partPlural: "Episoden", bookNumberFormat: "decimal", chapterNumberFormat: "decimal", partNumberFormat: "decimal" },
      chapters: [{ id: "test-chapter", number: 0, title: "Testkapitel", tldr: "", order: 0, hidden: false, parts: [{ id: "test-part", number: 1, title: "Testepisode", tldr: "", content: "Neutraler Testinhalt.", releasedAt: "2026-09-19", status: "published", publishAt: null, image: "", hidden: false }] }, { id: "control-chapter", number: 1, title: "Kontrollkapitel", tldr: "", order: 1, hidden: false, parts: [{ id: "control-part", number: 1, title: "Kontrollepisode", tldr: "", content: "Weiterer neutraler Testinhalt.", releasedAt: "2026-09-19", status: "published", publishAt: null, image: "", hidden: false }] }]
    }]
  };
  await writeFile(join(dataDir, "library.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  const port = 42919;
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: "api-test", COOKIE_SECURE: "false" },
    stdio: "ignore",
  });

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${origin}/api/library`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const login = await fetch(`${origin}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "api-test" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Origin: origin, Cookie: cookie };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const upload = await fetch(`${origin}/api/admin/media`, { method: "POST", headers: { "Content-Type": "image/png", Origin: origin, Cookie: cookie }, body: png });
    assert.equal(upload.status, 201);
    const mediaUrl = (await upload.json()).url;
    assert.match(mediaUrl, /^\/media\/[a-f0-9]{32}\.png$/);
    const media = await fetch(`${origin}${mediaUrl}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    assert.match(media.headers.get("cache-control"), /immutable/);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
    const invalidUpload = await fetch(`${origin}/api/admin/media`, { method: "POST", headers: { "Content-Type": "image/png", Origin: origin, Cookie: cookie }, body: "kein Bild" });
    assert.equal(invalidUpload.status, 415);
    const library = await (await fetch(`${origin}/api/library`, { headers })).json();
    const book = library.books.find((item) => item.id === "test-book");
    assert.equal(library.adminBooks.length, library.books.length);
    assert.equal(Object.hasOwn(book, "previewToken"), false);
    const chapter = book.chapters.find((item) => item.id === "test-chapter");
    const part = chapter.parts[0];

    const chapterResponse = await fetch(`${origin}/api/admin/books/${book.id}/chapters/${chapter.id}`, {
      method: "PUT", headers, body: JSON.stringify({ number: 0, title: chapter.title, tldr: "Kapitelzusammenfassung" }),
    });
    assert.equal(chapterResponse.status, 200);
    assert.equal((await chapterResponse.json()).number, 0);

    const partResponse = await fetch(`${origin}/api/admin/books/${book.id}/parts/${part.id}`, {
      method: "PUT", headers, body: JSON.stringify({ chapterId: chapter.id, part: part.number, releasedAt: "2026-10-15", partTitle: part.title, image: mediaUrl, tldr: "Teilzusammenfassung", content: part.content }),
    });
    assert.equal(partResponse.status, 200);

    const updated = await (await fetch(`${origin}/api/library`, { headers })).json();
    const updatedChapter = updated.books.find((item) => item.id === book.id).chapters.find((item) => item.id === chapter.id);
    assert.equal(updatedChapter.number, 0);
    assert.equal(updatedChapter.tldr, "Kapitelzusammenfassung");
    assert.equal(updatedChapter.parts[0].tldr, "Teilzusammenfassung");
    assert.equal(updatedChapter.parts[0].releasedAt, "2026-10-15");
    assert.equal(updatedChapter.parts[0].image, mediaUrl);
    assert.equal(updatedChapter.releasedAt, "2026-10-15");
    assert.equal(updated.books.find((item) => item.id === book.id).releasedAt, "2026-10-15");
    assert.equal(Object.hasOwn(updated.books.find((item) => item.id === book.id), "tldr"), false);

    const displayResponse = await fetch(`${origin}/api/admin/books/${book.id}/display`, { method: "PUT", headers, body: JSON.stringify({ bookSingular: "Chronik", bookPlural: "Chroniken", chapterSingular: "Band", chapterPlural: "Bände", partSingular: "Szene", partPlural: "Szenen", bookNumberFormat: "roman-upper", chapterNumberFormat: "roman-lower", partNumberFormat: "pad2" }) });
    assert.equal(displayResponse.status, 200);
    assert.deepEqual(await displayResponse.json(), { bookSingular: "Chronik", bookPlural: "Chroniken", chapterSingular: "Band", chapterPlural: "Bände", partSingular: "Szene", partPlural: "Szenen", bookNumberFormat: "roman-upper", chapterNumberFormat: "roman-lower", partNumberFormat: "pad2" });

    const hidePart = await fetch(`${origin}/api/admin/books/${book.id}/parts/${part.id}`, { method: "PUT", headers, body: JSON.stringify({ chapterId: chapter.id, part: part.number, partTitle: part.title, tldr: part.tldr, content: part.content, hidden: true }) });
    assert.equal(hidePart.status, 200);
    let hiddenLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(hiddenLibrary.books.find((item) => item.id === book.id).chapters.find((item) => item.id === chapter.id).parts.some((item) => item.id === part.id), false);
    await fetch(`${origin}/api/admin/books/${book.id}/parts/${part.id}`, { method: "PUT", headers, body: JSON.stringify({ chapterId: chapter.id, part: part.number, partTitle: part.title, tldr: part.tldr, content: part.content, hidden: false }) });

    await fetch(`${origin}/api/admin/books/${book.id}/chapters/${chapter.id}`, { method: "PUT", headers, body: JSON.stringify({ number: chapter.number, title: chapter.title, tldr: chapter.tldr, hidden: true }) });
    hiddenLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(hiddenLibrary.books.find((item) => item.id === book.id).chapters.some((item) => item.id === chapter.id), false);
    await fetch(`${origin}/api/admin/books/${book.id}/chapters/${chapter.id}`, { method: "PUT", headers, body: JSON.stringify({ number: chapter.number, title: chapter.title, tldr: chapter.tldr, hidden: false }) });

    await fetch(`${origin}/api/admin/books/${book.id}`, { method: "PUT", headers, body: JSON.stringify({ number: book.number, title: book.title, description: book.description, status: "published", coverImage: mediaUrl, hidden: true }) });
    hiddenLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(hiddenLibrary.books.some((item) => item.id === book.id), false);
    await fetch(`${origin}/api/admin/books/${book.id}`, { method: "PUT", headers, body: JSON.stringify({ number: book.number, title: book.title, description: book.description, status: "published", coverImage: mediaUrl, hidden: false }) });
    const imageLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(imageLibrary.books.find((item) => item.id === book.id).coverImage, mediaUrl);

    const nextPartNumber = Math.max(...chapter.parts.map((item) => item.number)) + 1;
    const draftPart = await (await fetch(`${origin}/api/admin/books/${book.id}/parts`, { method: "POST", headers, body: JSON.stringify({ chapterId: chapter.id, part: nextPartNumber, releasedAt: "2026-09-19", status: "draft", partTitle: "Teil-Entwurf", content: "Dieser Inhalt bleibt zunächst in der Redaktion." }) })).json();
    const futurePublishAt = new Date(Date.now() + 3_600_000).toISOString();
    const scheduledPart = await (await fetch(`${origin}/api/admin/books/${book.id}/parts`, { method: "POST", headers, body: JSON.stringify({ chapterId: chapter.id, part: nextPartNumber + 1, releasedAt: "2026-09-19", status: "scheduled", publishAt: futurePublishAt, partTitle: "Geplanter Teil", content: "Dieser Inhalt erscheint später." }) })).json();
    const pastPublishAt = new Date(Date.now() - 3_600_000).toISOString();
    const releasedPart = await (await fetch(`${origin}/api/admin/books/${book.id}/parts`, { method: "POST", headers, body: JSON.stringify({ chapterId: chapter.id, part: nextPartNumber + 2, releasedAt: "2026-09-19", status: "scheduled", publishAt: pastPublishAt, partTitle: "Automatisch erschienener Teil", content: "Dieser Inhalt ist bereits freigeschaltet." }) })).json();
    const scheduledLibrary = await (await fetch(`${origin}/api/library`)).json();
    const publicPartIds = scheduledLibrary.books.find((item) => item.id === book.id).chapters.flatMap((item) => item.parts).map((item) => item.id);
    assert.equal(publicPartIds.includes(draftPart.id), false);
    assert.equal(publicPartIds.includes(scheduledPart.id), false);
    assert.equal(publicPartIds.includes(releasedPart.id), true);
    const scheduledAdminLibrary = await (await fetch(`${origin}/api/library`, { headers })).json();
    const editorialPartIds = scheduledAdminLibrary.adminBooks.find((item) => item.id === book.id).chapters.flatMap((item) => item.parts).map((item) => item.id);
    assert.equal(editorialPartIds.includes(draftPart.id), true);
    assert.equal(editorialPartIds.includes(scheduledPart.id), true);

    const draftResponse = await fetch(`${origin}/api/admin/books`, { method: "POST", headers, body: JSON.stringify({ number: 999, title: "Testentwurf", description: "Nicht öffentlich", status: "draft" }) });
    assert.equal(draftResponse.status, 201);
    const draft = await draftResponse.json();
    assert.deepEqual([draft.display.bookSingular, draft.display.chapterSingular, draft.display.partSingular], ["Buch", "Kapitel", "Episode"]);
    assert.match(draft.previewToken, /^[a-zA-Z0-9_-]{24,80}$/);
    const editorialLibrary = await (await fetch(`${origin}/api/library`, { headers })).json();
    assert.equal(editorialLibrary.books.some((item) => item.id === draft.id), false);
    assert.equal(editorialLibrary.adminBooks.some((item) => item.id === draft.id && item.previewToken === draft.previewToken), true);
    const firstChapter = await (await fetch(`${origin}/api/admin/books/${draft.id}/chapters`, { method: "POST", headers, body: JSON.stringify({ number: 0, title: "Erstes Kapitel", tldr: "" }) })).json();
    const secondChapter = await (await fetch(`${origin}/api/admin/books/${draft.id}/chapters`, { method: "POST", headers, body: JSON.stringify({ number: 1, title: "Zweites Kapitel", tldr: "" }) })).json();
    await fetch(`${origin}/api/admin/books/${draft.id}/parts`, { method: "POST", headers, body: JSON.stringify({ chapterId: firstChapter.id, part: 1, partTitle: "Vorschautext", tldr: "", content: "Ein geheimer Entwurf." }) });
    const reorder = await fetch(`${origin}/api/admin/books/${draft.id}/chapters/order`, { method: "PUT", headers, body: JSON.stringify({ chapterIds: [secondChapter.id, firstChapter.id] }) });
    assert.equal(reorder.status, 200);
    assert.deepEqual((await reorder.json()).map((item) => item.id), [secondChapter.id, firstChapter.id]);

    const target = await (await fetch(`${origin}/api/admin/books`, { method: "POST", headers, body: JSON.stringify({ number: 998, title: "Zielakte", description: "Ziel für verschobene Kapitel", status: "draft" }) })).json();
    const move = await fetch(`${origin}/api/admin/chapters/move`, { method: "PUT", headers, body: JSON.stringify({ sourceBookId: draft.id, targetBookId: target.id, chapterId: secondChapter.id }) });
    assert.equal(move.status, 200);
    const moved = await move.json();
    assert.deepEqual(moved.source.chapters.map((item) => item.id), [firstChapter.id]);
    assert.deepEqual(moved.target.chapters.map((item) => item.id), [secondChapter.id]);
    await fetch(`${origin}/api/admin/books/${target.id}/chapters`, { method: "POST", headers, body: JSON.stringify({ number: 0, title: "Kollision", tldr: "" }) });
    const collision = await fetch(`${origin}/api/admin/chapters/move`, { method: "PUT", headers, body: JSON.stringify({ sourceBookId: draft.id, targetBookId: target.id, chapterId: firstChapter.id }) });
    assert.equal(collision.status, 409);

    const publishedMover = await (await fetch(`${origin}/api/admin/books`, { method: "POST", headers, body: JSON.stringify({ number: 997, title: "Veröffentlichte Quelle", description: "Wird nach dem Verschieben automatisch Entwurf", status: "draft" }) })).json();
    const moverChapter = await (await fetch(`${origin}/api/admin/books/${publishedMover.id}/chapters`, { method: "POST", headers, body: JSON.stringify({ number: 7, title: "Wanderkapitel", tldr: "" }) })).json();
    await fetch(`${origin}/api/admin/books/${publishedMover.id}/parts`, { method: "POST", headers, body: JSON.stringify({ chapterId: moverChapter.id, part: 1, partTitle: "Wanderteil", tldr: "", content: "Dieser Teil wird verschoben." }) });
    await fetch(`${origin}/api/admin/books/${publishedMover.id}`, { method: "PUT", headers, body: JSON.stringify({ number: 997, title: "Veröffentlichte Quelle", description: "Wird nach dem Verschieben automatisch Entwurf", status: "published" }) });
    const moveLast = await fetch(`${origin}/api/admin/chapters/move`, { method: "PUT", headers, body: JSON.stringify({ sourceBookId: publishedMover.id, targetBookId: target.id, chapterId: moverChapter.id }) });
    assert.equal(moveLast.status, 200);
    const movedLast = await moveLast.json();
    assert.equal(movedLast.sourceBecameDraft, true);
    assert.equal(movedLast.source.status, "draft");
    assert.match(movedLast.source.previewToken, /^[a-zA-Z0-9_-]{24,80}$/);

    const publicLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(publicLibrary.books.some((item) => item.id === draft.id), false);
    assert.equal(publicLibrary.books.some((item) => Object.hasOwn(item, "previewToken")), false);
    const preview = await fetch(`${origin}/api/preview/${draft.previewToken}`);
    assert.equal(preview.status, 200);
    const previewBook = (await preview.json()).book;
    assert.equal(previewBook.id, draft.id);
    assert.equal(Object.hasOwn(previewBook, "previewToken"), false);

    const publishDraft = await fetch(`${origin}/api/admin/books/${draft.id}`, { method: "PUT", headers, body: JSON.stringify({ number: draft.number, title: draft.title, description: draft.description, status: "published" }) });
    assert.equal(publishDraft.status, 200);
    assert.equal(Object.hasOwn(await publishDraft.json(), "previewToken"), false);
    assert.equal((await fetch(`${origin}/api/preview/${draft.previewToken}`)).status, 404);

    const links = await fetch(`${origin}/api/admin/links`, { method: "PUT", headers, body: JSON.stringify({ links: [{ label: "Discord-App", url: "discord://channels/@me" }, { label: "Web", url: "https://example.com" }, { label: "Blockiert", url: "javascript:alert(1)" }] }) });
    assert.equal(links.status, 200);
    assert.deepEqual(await links.json(), [{ label: "Discord-App", url: "discord://channels/@me" }, { label: "Web", url: "https://example.com" }]);
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
