import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
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
  assert.match(worker, /url\.pathname === "\/api\/offline-library"/);
  assert.match(worker, /books: full\.books \|\| \[\]/);
  assert.doesNotMatch(worker, /adminBooks: data\.adminBooks/);
  assert.match(worker, /offline: true/);
  assert.match(worker, /\/markdown\.js/);
  assert.match(worker, /\/library-view\.js/);
  assert.match(worker, /\/markdown-config\.js/);
  assert.match(worker, /\/vendor\/marked\.esm\.js/);
  assert.match(app, /Archivstand vom/);
});

test("App-Updates ersetzen nur die Shell und behalten lokale Lesedaten", () => {
  assert.match(app, /register\(`\/sw\.js\?v=\$\{encodeURIComponent\(buildVersion\)\}`/);
  assert.match(app, /registration\.update\(\)/);
  assert.match(app, /controllerchange[\s\S]*?location\.reload\(\)/);
  assert.match(worker, /shellPath\(path\)/);
  assert.match(worker, /new Request\(shellPath\(path\), \{ cache: "reload" \}\)/);
  assert.match(worker, /navigationResponse/);
  assert.match(worker, /cache: "no-store"/);
  assert.match(worker, /cache\.match\(request\)/);
  assert.doesNotMatch(worker, /ignoreSearch: true/);
  assert.match(worker, /key\.startsWith\("oracle-shell-"\) && key !== SHELL_CACHE/);
  assert.doesNotMatch(worker, /client\.navigate\(client\.url\)/);
  assert.doesNotMatch(worker, /localStorage|indexedDB\.deleteDatabase/);
  assert.match(server, /\["index\.html", "sw\.js"\]\.includes\(requested\) \? "no-store"/);
});
