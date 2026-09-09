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
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
