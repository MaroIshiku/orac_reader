import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Updates behalten Sitzungen und parallele Schreibzugriffe verlieren keine Daten", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "oracreader-hardening-"));
  await cp(join(root, "data"), dataDir, { recursive: true });
  const port = 44000 + Math.floor(Math.random() * 1000); const origin = `http://127.0.0.1:${port}`; let server;
  const start = async (version) => {
    server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: "hardening-test", COOKIE_SECURE: "true", APP_VERSION: version }, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => { server.once("exit", (code) => reject(new Error(`Testserver endete mit ${code}`))); server.stdout.once("data", resolve); });
  };
  const stop = async () => { if (server.exitCode !== null) return; await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGTERM"); }); };
  try {
    await start("hardening-a");
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    const redirect = await fetch(`${origin}/`, { headers: { "X-Forwarded-Proto": "http", "X-Forwarded-Host": "reader.example" }, redirect: "manual" });
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get("location"), "https://reader.example/");
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: "hardening-test" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0]; const headers = { "Content-Type": "application/json", Origin: origin, Cookie: cookie };
    await stop(); await start("hardening-b");
    assert.deepEqual(await (await fetch(`${origin}/api/session`, { headers })).json(), { admin: true });
    const invalid = await fetch(`${origin}/api/admin/books`, { method: "POST", headers, body: "{}" }); assert.equal(invalid.status, 400);
    const [links, settings] = await Promise.all([
      fetch(`${origin}/api/admin/links`, { method: "PUT", headers, body: JSON.stringify({ links: [{ label: "Test", url: "https://example.com" }] }) }),
      fetch(`${origin}/api/admin/settings`, { method: "PUT", headers, body: JSON.stringify({ numberDigits: 3 }) }),
    ]);
    assert.equal(links.status, 200); assert.equal(settings.status, 200);
    const compressed = await fetch(`${origin}/app.js`, { headers: { "Accept-Encoding": "gzip" } }); assert.equal(compressed.headers.get("content-encoding"), "gzip");
    const libraryResponse = await fetch(`${origin}/api/library`, { headers }); const library = await libraryResponse.json();
    assert.deepEqual(library.links, [{ label: "Test", url: "https://example.com" }]); assert.equal(library.settings.numberDigits, 3);
    const backups = await (await fetch(`${origin}/api/admin/backups`, { headers })).json(); assert.ok(backups.length >= 2);
  } finally { if (server) await stop(); await rm(dataDir, { recursive: true, force: true }); }
});
