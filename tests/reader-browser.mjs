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
await writeFile(join(dataDir, "library.json"), `${JSON.stringify({ schemaVersion: 14, settings: { numberDigits: 4 }, links: [{ label: "Projekt", url: "https://example.com" }, { label: "Community", url: "https://example.org" }], books: [book] })}\n`);
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
  for (const width of [280, 320, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/#read/browser-book/browser-part`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#readerView:not([hidden])");
      await page.evaluate(() => document.fonts.ready);
      if (width === 390) {
        const leading = await page.locator("#storyContent").evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) }));
        assert.ok(leading.line > leading.size * 1.75, "Normale Schriftgröße muss luftig bleiben");
        await page.evaluate(() => { localStorage.setItem("oracle-font-size", "26"); location.reload(); });
        await page.waitForSelector("#readerView:not([hidden])");
        const largeLeading = await page.locator("#storyContent").evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) }));
        assert.ok(largeLeading.line < largeLeading.size * 1.7, "Große Schrift darf keine überweiten Zeilen erhalten");
        await page.evaluate(() => { localStorage.setItem("oracle-font-size", "19"); location.reload(); });
        await page.waitForSelector("#readerView:not([hidden])");
      }
      if (width === 280) {
        const toolbar = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, settings: document.querySelector("#readerSettingsMenu > summary").getBoundingClientRect().right }));
        assert.ok(toolbar.document <= toolbar.viewport, "280px: Werkzeugleiste darf keinen horizontalen Überlauf erzeugen");
        assert.ok(toolbar.settings <= toolbar.viewport, "280px: Einstellungen müssen erreichbar bleiben");
      }
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
      const edgeWidth = await page.locator("#pageEdgeNext").evaluate((node) => node.getBoundingClientRect().width);
      assert.ok(edgeWidth <= 16, `${width}px: unsichtbare Blätterfläche darf Text nicht überdecken`);
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
      await page.locator("#libraryResultType").selectOption("part");
      assert.equal(await page.locator(".search-result").count(), 0, `${width}px: Suchtypfilter muss Kapitel ausblenden`);
      await page.locator("#libraryResultType").selectOption("chapter");
      assert.ok(await page.locator(".search-result").count(), `${width}px: Suchtypfilter muss Kapitel zeigen`);
      assert.deepEqual(errors, [], `${width}px: keine Laufzeitfehler`);
    } finally { await page.close(); }
  }
  const freshReader = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    await freshReader.goto(`${origin}/#home`, { waitUntil: "domcontentloaded" });
    await freshReader.locator(".card-details-show").click();
    await freshReader.locator("#bookDetailsActions [data-toggle-book-read]").click();
    assert.equal((await freshReader.locator("#bookDetailsActions .book-details-read").textContent()).trim(), "Lesen", "Manuell gelesenes, nie geöffnetes Buch darf nicht Weiterlesen versprechen");
    assert.ok((await freshReader.locator("#bookDetailsActions [data-toggle-book-read]").textContent()).includes("Ganzes Buch"), "Sammelaktion muss sichtbar als solche beschriftet sein");
  } finally { await freshReader.close(); }
  const admin = await browser.newPage({ viewport: { width: 1440, height: 844 }, serviceWorkers: "block" });
  try {
    await admin.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await admin.locator('#loginForm input[name="password"]').fill("browser-test");
    await admin.locator('#loginForm button[type="submit"]').click();
    await admin.waitForSelector("#adminPanel:not([hidden])");
    const titleWidth = await admin.locator(".admin-book-summary b").evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(titleWidth > 100, "Desktop-Buchtitel muss neben den Aktionen sichtbar bleiben");
    await admin.locator("[data-edit-book]").first().click();
    await admin.waitForFunction(() => document.activeElement?.id === "archiveFormTitle");
    assert.equal(await admin.evaluate(() => document.activeElement?.id), "archiveFormTitle", "Editorüberschrift muss Fokus erhalten");
    assert.equal(await admin.locator("#newBookHint").isHidden(), true, "Neuanlagehinweis darf beim Bearbeiten nicht erscheinen");
    await admin.locator('#archiveForm [data-cancel-editor]').click();
    await admin.locator("#newBookButton").click();
    assert.equal(await admin.locator("#archiveEditorContext").isHidden(), true, "Neues Buch darf keinen alten Buchkontext zeigen");
    assert.equal(await admin.locator("#newBookHint").isVisible(), true, "Neuanlagehinweis muss bei neuem Buch erscheinen");
    await admin.locator('#archiveForm [data-cancel-editor]').click();
    await admin.waitForFunction(() => document.activeElement?.id === "newBookButton");
    assert.equal(await admin.evaluate(() => document.activeElement?.id), "newBookButton", "Abbrechen muss Fokus zum Auslöser zurückbringen");
    await admin.setViewportSize({ width: 1280, height: 844 });
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "1280px: Redaktionsspalten dürfen nicht horizontal überlaufen");
    assert.equal(await admin.locator("#adminEditorEmpty").isVisible(), false, "Einspaltig darf der leere Editor nicht hinter der langen Liste stehen");
    await admin.locator('[data-admin-tab="links"]').click();
    assert.deepEqual(await admin.locator("[data-remove-link]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))), ["Link Projekt entfernen", "Link Community entfernen"], "Link-Entfernen muss Ziele zugänglich unterscheiden");
  } finally { await admin.close(); }
  const mobileAdmin = await browser.newPage({ viewport: { width: 280, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  try {
    await mobileAdmin.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await mobileAdmin.locator('#loginForm input[name="password"]').fill("browser-test");
    await mobileAdmin.locator('#loginForm button[type="submit"]').click();
    await mobileAdmin.waitForSelector("#adminPanel:not([hidden])");
    const layout = await mobileAdmin.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, logoutRight: document.querySelector("#logoutButton").getBoundingClientRect().right }));
    assert.ok(layout.document <= layout.viewport, "280px: Redaktion darf nicht horizontal überlaufen");
    assert.ok(layout.logoutRight <= layout.viewport, "280px: Abmelden muss vollständig sichtbar sein");
    assert.equal(await mobileAdmin.locator("#adminSummaryToggle").isVisible(), true, "280px: Archivbestand muss abrufbar sein");
    assert.equal(await mobileAdmin.locator("#adminSummaryCounts").isVisible(), false, "280px: Archivbestand muss zunächst kompakt bleiben");
    await mobileAdmin.locator("#adminSummaryToggle").click();
    assert.equal(await mobileAdmin.locator("#adminSummaryToggle").getAttribute("aria-expanded"), "true");
    assert.equal((await mobileAdmin.locator("#adminPartCount").textContent()).trim(), "2", "Mobile Bestandszahlen müssen aktuell sein");
    await mobileAdmin.locator("#adminSummaryToggle").click();
    const firstBookTop = await mobileAdmin.locator(".admin-entry").first().evaluate((node) => node.getBoundingClientRect().top);
    assert.ok(firstBookTop < 630, `280px: Inhaltsliste muss früh genug beginnen (${Math.round(firstBookTop)}px)`);
    const editPart = mobileAdmin.locator("[data-edit-part]").first();
    await editPart.scrollIntoViewIfNeeded();
    const previousY = await mobileAdmin.evaluate(() => scrollY);
    await editPart.click();
    await mobileAdmin.waitForFunction(() => document.activeElement?.id === "partFormTitle");
    const titleTop = await mobileAdmin.locator("#partFormTitle").evaluate((node) => node.getBoundingClientRect().top);
    assert.ok(titleTop >= 60 && titleTop < 400, "280px: Formulartitel muss unter der Kopfzeile sichtbar sein");
    await mobileAdmin.locator('#partForm [data-cancel-editor]').click();
    await mobileAdmin.waitForFunction(() => document.activeElement?.hasAttribute("data-edit-part"));
    assert.ok(Math.abs((await mobileAdmin.evaluate(() => scrollY)) - previousY) < 20, "280px: Abbrechen muss zur vorherigen Listenposition zurückkehren");
    await mobileAdmin.locator('[data-admin-tab="links"]').click();
    const removeWidth = await mobileAdmin.locator("[data-remove-link]").first().evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(removeWidth <= 44, "280px: Link-Entfernen darf keine unsichtbar breite Tippfläche haben");
  } finally { await mobileAdmin.close(); }
  const scheduleAdmin = await browser.newPage({ viewport: { width: 1440, height: 844 }, serviceWorkers: "block" });
  try {
    await scheduleAdmin.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await scheduleAdmin.locator('#loginForm input[name="password"]').fill("browser-test");
    await scheduleAdmin.locator('#loginForm button[type="submit"]').click();
    await scheduleAdmin.waitForSelector("#adminPanel:not([hidden])");
    await scheduleAdmin.locator('[data-edit-part="browser-book:browser-part-2"]').click();
    await scheduleAdmin.locator('#partForm [name="status"]').selectOption("scheduled");
    assert.equal(await scheduleAdmin.locator("#partPublishField").isVisible(), true, "Geplante Veröffentlichung muss deutsche Datums- und Uhrzeitfelder zeigen");
    await scheduleAdmin.locator('#partForm [name="publishDate"]').fill("26.09.2030");
    await scheduleAdmin.locator('#partForm [name="publishTime"]').fill("13:45");
    await scheduleAdmin.locator('#partForm button[type="submit"]').click();
    await scheduleAdmin.locator("#partForm").waitFor({ state: "hidden" });
    await scheduleAdmin.waitForFunction(() => document.activeElement?.dataset?.editPart === "browser-book:browser-part-2");
    await scheduleAdmin.locator('[data-edit-part="browser-book:browser-part-2"]').click();
    assert.equal(await scheduleAdmin.locator('#partForm [name="publishDate"]').inputValue(), "26.09.2030", "Planungsdatum muss nach Speichern unverändert sein");
    assert.equal(await scheduleAdmin.locator('#partForm [name="publishTime"]').inputValue(), "13:45", "Planungszeit muss nach Speichern unverändert sein");
    await scheduleAdmin.setViewportSize({ width: 390, height: 844 });
    assert.ok(await scheduleAdmin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390px: Planungsfelder dürfen mobilen Editor nicht verbreitern");
  } finally { await scheduleAdmin.close(); }
  console.log("Browser-Regressionsprüfung: Leser bei 280/320/390/768 px, Admin-Editor und Planungs-Roundtrip bestanden.");
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}
