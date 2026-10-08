import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Redaktionslinks bleiben eindeutig, zeigen geplante Teile nur als Countdown und übernehmen eigene Metadaten", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "reader-share-"));
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const fixture = { schemaVersion: 14, settings: { numberDigits: 4 }, links: [], books: [{
    id: "book", number: 1, title: "Buch", description: "Buchbeschreibung", status: "published", hidden: false,
    chapters: [{ id: "chapter", number: 1, title: "Kapitel", status: "published", hidden: false, parts: [
      { id: "part-a", number: 1, title: "Erster Teil", content: "GEHEIMER ENTWURFSTEXT", status: "scheduled", publishAt: future, releasedAt: "2026-10-08", hidden: false },
      { id: "part-b", number: 2, title: "Zweiter Teil", content: "Anderer Inhalt", status: "published", releasedAt: "2026-10-08", hidden: false },
    ] }],
  }] };
  await writeFile(join(dataDir, "library.json"), `${JSON.stringify(fixture)}\n`);
  const port = 43000 + Math.floor(Math.random() * 1000); const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: "share-test", COOKIE_SECURE: "false" }, stdio: "ignore" });
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: "share-test" }) });
    assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Origin: origin, Cookie: cookie };
    const longDescription = "Ein vollständiger Buchklappentext mit vielen Sätzen. ".repeat(30).trim();
    const create = (partId, path, title = "Eigener <Titel>", description = "Eine individuelle Beschreibung") => fetch(`${origin}/api/admin/share-links`, { method: "POST", headers, body: JSON.stringify({ bookId: "book", partId, path, title, description }) });
    assert.ok(longDescription.length > 500);
    assert.equal((await create("part-a", "/read/buch-1/1-1-erster-teil", "Eigener <Titel>", longDescription)).status, 201);
    const check = await (await fetch(`${origin}/api/admin/share-links/check?path=${encodeURIComponent("/read/buch-1/1-1-erster-teil")}&partId=part-a`, { headers })).json();
    assert.equal(check.available, false); assert.equal(check.samePart, true);
    assert.equal((await create("part-b", "/read/buch-1/1-1-erster-teil")).status, 409);
    assert.equal((await create("part-a", "/admin/anderer-pfad")).status, 400);
    const page = await fetch(`${origin}/read/buch-1/1-1-erster-teil`); const html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /data-state="scheduled"/); assert.match(html, /shareCountdown/);
    assert.match(html, /Eigener &lt;Titel&gt;/); assert.ok(html.includes(`content="${longDescription}"`));
    assert.doesNotMatch(html, /GEHEIMER ENTWURFSTEXT/);
    const publicLibrary = await (await fetch(`${origin}/api/library`)).json();
    assert.equal(publicLibrary.books[0].chapters[0].parts.some((part) => part.id === "part-a"), false);
    assert.equal(Object.hasOwn(publicLibrary, "shareLinks"), false);
    assert.equal((await create("part-a", "/geschichten/erster-teil", "Neuer Titel")).status, 201);
    assert.equal((await create("part-b", "/read/buch-1/1-1-erster-teil")).status, 409);
    assert.equal((await create("part-a", "/geschichten/erster-teil", "Aktueller Titel")).status, 200);
    const stored = JSON.parse(await readFile(join(dataDir, "library.json"), "utf8"));
    assert.equal(stored.shareLinks.length, 2);
    assert.equal(stored.shareLinks[0].description, longDescription);
    const published = await fetch(`${origin}/api/admin/books/book/parts/part-a`, { method: "PUT", headers, body: JSON.stringify({ chapterId: "chapter", part: 1, partTitle: "Erster Teil", content: "GEHEIMER ENTWURFSTEXT", releasedAt: "2026-10-08", status: "published" }) });
    assert.equal(published.status, 200);
    const live = await (await fetch(`${origin}/geschichten/erster-teil`)).text();
    assert.match(live, /data-state="published"/); assert.match(live, /#read\/book\/part-a/); assert.match(live, /Aktueller Titel/);
  } finally { server.kill(); await rm(dataDir, { recursive: true, force: true }); }
});
