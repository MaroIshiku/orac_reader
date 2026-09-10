import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Kapitel 0 sowie getrennte Kapitel- und Teil-TL;DR bleiben über die Admin-API erhalten", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "oracle-reader-api-"));
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
    const library = await (await fetch(`${origin}/api/library`, { headers })).json();
    const book = library.books.find((item) => item.id === "oracle-0000");
    assert.equal(library.adminBooks.length, library.books.length);
    assert.equal(Object.hasOwn(book, "previewToken"), false);
    const chapter = book.chapters.find((item) => item.id === "oracle-0000-chapter-0");
    const part = chapter.parts[0];

    const chapterResponse = await fetch(`${origin}/api/admin/books/${book.id}/chapters/${chapter.id}`, {
      method: "PUT", headers, body: JSON.stringify({ number: 0, title: chapter.title, tldr: "Kapitelzusammenfassung" }),
    });
    assert.equal(chapterResponse.status, 200);
    assert.equal((await chapterResponse.json()).number, 0);

    const partResponse = await fetch(`${origin}/api/admin/books/${book.id}/parts/${part.id}`, {
      method: "PUT", headers, body: JSON.stringify({ chapterId: chapter.id, part: part.number, partTitle: part.title, tldr: "Teilzusammenfassung", content: part.content }),
    });
    assert.equal(partResponse.status, 200);

    const updated = await (await fetch(`${origin}/api/library`, { headers })).json();
    const updatedChapter = updated.books.find((item) => item.id === book.id).chapters.find((item) => item.id === chapter.id);
    assert.equal(updatedChapter.number, 0);
    assert.equal(updatedChapter.tldr, "Kapitelzusammenfassung");
    assert.equal(updatedChapter.parts[0].tldr, "Teilzusammenfassung");
    assert.equal(Object.hasOwn(updated.books.find((item) => item.id === book.id), "tldr"), false);

    const draftResponse = await fetch(`${origin}/api/admin/books`, { method: "POST", headers, body: JSON.stringify({ number: 999, title: "Testentwurf", description: "Nicht öffentlich", status: "draft" }) });
    assert.equal(draftResponse.status, 201);
    const draft = await draftResponse.json();
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
