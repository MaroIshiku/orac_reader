import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("die vier ursprünglichen Oracle-Akten werden verlustfrei zu einem Buch migriert", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "oracle-reader-migration-"));
  const now = "2026-09-10T00:00:00.000Z";
  const legacyBooks = [0, 1, 2, 3].map((number) => ({
    id: `oracle-${String(number).padStart(4, "0")}`,
    number,
    title: number === 0 ? "Prolog" : `Kapitel ${number}`,
    kicker: "ORACLE · ARCHIV",
    description: "Ein Eintrag des ORACLE-Archivs. Testtext.",
    status: "published",
    publishAt: null,
    updatedAt: now,
    chapters: [{ id: `oracle-${String(number).padStart(4, "0")}-chapter-${number}`, number, title: `Kapitel ${number}`, tldr: "", order: 0, parts: [{ id: `part-${number}`, number: 1, title: `Teil ${number}`, tldr: "", content: `Inhalt ${number}` }] }],
  }));
  legacyBooks[0].chapters.push({ id: "manual-test-chapter", number: 1, title: "Test", tldr: "", order: 1, parts: [{ id: "manual-test-part", number: 1, title: "Testteil", tldr: "", content: "Manueller Inhalt" }] });
  const manual = { id: "manual-book", number: 99, title: "Eigene Akte", kicker: "ORACLE · ARCHIV", description: "Bleibt erhalten.", status: "draft", publishAt: null, updatedAt: now, previewToken: "abcdefghijklmnopqrstuvwxyz123456", chapters: [] };
  await writeFile(join(dataDir, "library.json"), `${JSON.stringify({ schemaVersion: 6, settings: { numberDigits: 4 }, links: [], books: [...legacyBooks, manual] }, null, 2)}\n`);
  const port = 43000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: "migration-test" }, stdio: "ignore" });

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${origin}/api/library`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const migrated = JSON.parse(await readFile(join(dataDir, "library.json"), "utf8"));
    assert.equal(migrated.schemaVersion, 7);
    assert.deepEqual(migrated.books.map((book) => book.id), ["oracle-0000", "manual-book"]);
    const oracle = migrated.books[0];
    assert.equal(oracle.title, "Oracle");
    assert.deepEqual(oracle.chapters.map((chapter) => chapter.number), [0, 1, 2, 3, 4]);
    assert.deepEqual(oracle.chapters.map((chapter) => chapter.parts[0].content), ["Inhalt 0", "Inhalt 1", "Inhalt 2", "Inhalt 3", "Manueller Inhalt"]);
    assert.equal(migrated.books[1].title, "Eigene Akte");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
