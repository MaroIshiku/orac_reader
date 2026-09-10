import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

test("PWA besitzt Manifest, Installationsoberfläche und passende App-Symbole", () => {
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /id="installButton"/);
  assert.match(app, /beforeinstallprompt/);
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("Offline-Synchronisation speichert ausschließlich die öffentliche Bibliothek", () => {
  assert.match(worker, /url\.pathname === "\/api\/library"/);
  assert.match(worker, /books: data\.books \|\| \[\]/);
  assert.doesNotMatch(worker, /adminBooks: data\.adminBooks/);
  assert.match(worker, /offline: true/);
  assert.match(app, /Archivstand vom/);
});
