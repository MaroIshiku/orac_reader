import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), "oracreader-browser-"));
const port = 43000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const story = Array.from({ length: 45 }, (_, index) => `Absatz ${index + 1}. Die Reisenden gingen weiter, während sich die Landschaft vor ihnen veränderte. Der Weg führte durch Wälder und über offene Felder; niemand wusste, was hinter der nächsten Biegung auf sie wartete.`).join("\n\n");
const book = {
  id: "browser-book", number: 1, title: "Ein Testbuch mit langem Titel", kicker: "TEST", description: "Eine längere Beschreibung für den Buchdialog und die Lesestatusaktion. ".repeat(8),
  status: "published", publishAt: null, updatedAt: "2026-09-20T00:00:00.000Z", releasedAt: "2026-09-20", coverImage: "", hidden: false,
  chapters: [{ id: "browser-chapter", number: 1, order: 0, title: "Ein langes Testkapitel", tldr: "", status: "published", publishAt: null, releasedAt: "2026-09-20", hidden: false, parts: [
    { id: "browser-part", number: 1, title: "Die erste Episode", tldr: "", content: story, releasedAt: "2026-09-20", status: "published", publishAt: null, image: "", hidden: false },
    { id: "browser-part-2", number: 2, title: "Eine zweite Episode", tldr: "", content: "Kurzer Testtext.", releasedAt: "2026-09-20", status: "published", publishAt: null, image: "", hidden: false }
  ] }]
};
await writeFile(join(dataDir, "library.json"), `${JSON.stringify({ schemaVersion: 13, settings: { numberDigits: 4 }, links: [], books: [book] })}\n`);
const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: "browser-test", COOKIE_SECURE: "false", APP_VERSION: "browser-test" }, stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Der lokale Testserver wurde beendet.");
    try { ready = (await fetch(`${origin}/api/library`)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Der lokale Testserver muss erreichbar sein");
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/#read/browser-book/browser-part`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#readerView:not([hidden])");
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) / 2, behavior: "instant" }));
      await page.waitForTimeout(250);
      const before = await page.evaluate(() => ({ y: scrollY, percent: document.querySelector("#progressLabel").textContent }));
      assert.ok(before.y > 0, `${width}px: Text muss scrollbar sein`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#readerView:not([hidden])");
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ y: scrollY, percent: document.querySelector("#progressLabel").textContent }));
      assert.ok(Math.abs(after.y - before.y) <= 2, `${width}px: Lesestelle muss erhalten bleiben`);
      assert.equal(after.percent, before.percent, `${width}px: Fortschritt darf nicht überschrieben werden`);
      await page.locator("#readerSettingsMenu > summary").click();
      await page.locator("#fontUp").click();
      await page.waitForTimeout(120);
      const resized = await page.evaluate(() => { const record = JSON.parse(localStorage.getItem("oracle-reading-progress"))["browser-book:browser-part:scroll"]; return { percent: record.percent, anchor: record.anchor, height: innerHeight }; });
      assert.ok(resized.percent > 20 && resized.percent < 80, `${width}px: Schriftwechsel darf die Lesestelle nicht verlieren`);
      assert.equal(resized.anchor?.coordinate, "viewport", `${width}px: Textanker muss Bildschirmkoordinaten verwenden`);
      assert.ok(resized.anchor.y <= resized.height, `${width}px: Textanker muss im sichtbaren Bereich liegen`);
      await page.locator("#fontDown").click();
      await page.locator("#motionToggle").click();
      await page.locator("#viewToggle").click();
      await page.locator("#readerSettingsMenu > summary").click();
      await page.evaluate(() => { document.querySelector("#storyContent").innerHTML = "<p>Kurzer Text.</p>"; document.querySelector("#storyContent").style.breakAfter = "column"; });
      await page.waitForTimeout(100);
      await page.evaluate(() => { const page = document.querySelector("#readingPage"); page.scrollTo({ left: page.scrollWidth, behavior: "instant" }); });
      await page.waitForTimeout(220);
      const end = await page.evaluate(() => {
        const bookPage = document.querySelector("#readingPage").getBoundingClientRect();
        const walker = document.createTreeWalker(document.querySelector("#storyContent"), NodeFilter.SHOW_TEXT);
        let textVisible = false; let node;
        while ((node = walker.nextNode())) { const range = document.createRange(); range.selectNodeContents(node); if ([...range.getClientRects()].some((rect) => rect.right > bookPage.left && rect.left < bookPage.right && rect.bottom > bookPage.top && rect.top < bookPage.bottom)) textVisible = true; }
        return { page: document.querySelector("#pageNumber").value, total: document.querySelector("#pageTotal").value, percent: document.querySelector("#progressLabel").textContent, read: document.querySelector("#readToggle").getAttribute("aria-pressed"), textVisible };
      });
      assert.equal(end.page, end.total, `${width}px: Seitenzähler muss die letzte Seite anzeigen`);
      assert.equal(end.percent, "100%", `${width}px: Schlussseite muss 100 % erreichen`);
      assert.equal(end.read, "true", `${width}px: Textleere Schlussseite muss als gelesen gelten`);
      assert.equal(end.textVisible, false, `${width}px: Schlussseite darf keinen Werktext enthalten`);
      await page.locator("#readToggle").click();
      assert.equal(await page.locator("#readToggle").getAttribute("aria-pressed"), "false", `${width}px: manuelle Markierung muss Vorrang haben`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#readerView:not([hidden])");
      assert.equal(await page.locator("#readToggle").getAttribute("aria-pressed"), "false", `${width}px: manuell ungelesen muss Neuladen überstehen`);
      await page.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".card-details-show");
      await page.locator(".card-details-show").click();
      await page.locator("#bookDetailsActions [data-toggle-book-read]").click();
      assert.ok((await page.locator("#bookDetailsActions [data-toggle-book-read]").textContent()).includes("Gelesen"), `${width}px: Buchstatus muss im Dialog aktualisiert werden`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".book-card");
      assert.ok((await page.locator(".book-card").getAttribute("class")).includes("is-read"), `${width}px: Buchstatus muss Neuladen überstehen`);
      await page.locator("#bookSearch").fill("Testkapitel");
      assert.equal(await page.locator("#homeShelves").isHidden(), true, `${width}px: Regale dürfen Suchtreffer nicht verdrängen`);
      assert.equal(await page.locator("#searchResultCount").isHidden(), true, `${width}px: keine doppelte Ergebniszahl`);
      assert.ok(await page.locator(".search-result").count(), `${width}px: strukturierte Suche muss Treffer zeigen`);
      assert.deepEqual(errors, [], `${width}px: keine Laufzeitfehler`);
    } finally { await page.close(); }
  }
  const admin = await browser.newPage({ viewport: { width: 1440, height: 844 }, serviceWorkers: "block" });
  try {
    await admin.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await admin.locator('#loginForm input[name="password"]').fill("browser-test");
    await admin.locator('#loginForm button[type="submit"]').click();
    await admin.waitForSelector("#adminPanel:not([hidden])");
    const titleWidth = await admin.locator(".admin-book-summary b").evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(titleWidth > 100, "Desktop-Buchtitel muss neben den Aktionen sichtbar bleiben");
  } finally { await admin.close(); }
  console.log("Browser-Regressionsprüfung: Lesestelle, Schlussseite und Gelesenstatus bei 320/390/768 px bestanden.");
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
