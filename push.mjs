import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import webpush from "web-push";

const allowedHosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const entryId = (endpoint) => createHash("sha256").update(endpoint).digest("hex");

export function validatePushSubscription(value) {
  if (!value || typeof value !== "object" || typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw new Error("Ungültiges Push-Abo.");
  let url;
  try { url = new URL(value.endpoint); } catch { throw new Error("Ungültiges Push-Abo."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !(allowedHosts.has(host) || host.endsWith(".notify.windows.com"))) throw new Error("Dieser Push-Dienst wird nicht unterstützt.");
  const keys = value.keys;
  if (!keys || !/^[A-Za-z0-9_-]{80,120}$/.test(keys.p256dh || "") || !/^[A-Za-z0-9_-]{16,40}$/.test(keys.auth || "")) throw new Error("Ungültige Push-Schlüssel.");
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function createPushService(dataRoot, deliver = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options), subject = process.env.PUSH_VAPID_SUBJECT || "https://github.com/MaroIshiku/orac_reader") {
  const keysFile = join(dataRoot, "push-keys.json");
  const stateFile = join(dataRoot, "push-subscriptions.json");
  let keys;
  let state;
  let writes = Promise.resolve();
  let sending = false;

  async function save() {
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, stateFile);
  }
  function mutate(action) {
    const next = writes.then(async () => { const result = action(); await save(); return result; });
    writes = next.catch(() => undefined);
    return next;
  }
  async function init(initialParts) {
    try { keys = JSON.parse(await readFile(keysFile, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      keys = webpush.generateVAPIDKeys();
      try { await writeFile(keysFile, `${JSON.stringify(keys)}\n`, { flag: "wx", mode: 0o600 }); }
      catch (writeError) { if (writeError.code !== "EEXIST") throw writeError; keys = JSON.parse(await readFile(keysFile, "utf8")); }
    }
    try { state = JSON.parse(await readFile(stateFile, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = { knownParts: initialParts.map((part) => part.id), subscriptions: [] };
      await save();
    }
    if (!Array.isArray(state.knownParts) || !Array.isArray(state.subscriptions)) throw new Error("Push-Abo-Speicher ist beschädigt.");
    for (const item of state.subscriptions) { item.books ||= []; item.parts ||= []; item.pending ||= []; }
  }
  function status(subscription) {
    const existing = state.subscriptions.find((item) => item.id === entryId(subscription.endpoint));
    return { all: existing?.all === true, books: existing?.books || [], parts: existing?.parts || [] };
  }
  async function setScope(subscription, scope, enabled, targetId = "") {
    return mutate(() => {
      const id = entryId(subscription.endpoint);
      let existing = state.subscriptions.find((item) => item.id === id);
      if (enabled && !existing) {
        if (state.subscriptions.length >= 5000) throw new Error("Der Benachrichtigungsdienst ist voll.");
        existing = { id, subscription, all: false, books: [], parts: [], pending: [] };
        state.subscriptions.push(existing);
      }
      if (!existing) return { all: false, books: [], parts: [] };
      if (enabled) existing.subscription = subscription;
      if (scope === "all") existing.all = enabled;
      else {
        const list = scope === "book" ? existing.books : existing.parts;
        if (enabled && !list.includes(targetId)) {
          if (list.length >= 30) throw new Error("Zu viele einzelne Benachrichtigungs-Abos auf diesem Gerät.");
          list.push(targetId);
        } else if (!enabled) existing[scope === "book" ? "books" : "parts"] = list.filter((id) => id !== targetId);
      }
      existing.pending = existing.pending.filter((item) => existing.all || existing.books.includes(item.bookId) || existing.parts.includes(item.partId));
      if (!existing.all && !existing.books.length && !existing.parts.length) { state.subscriptions = state.subscriptions.filter((item) => item !== existing); }
      return status(subscription);
    });
  }
  async function scan(visibleParts) {
    const visible = new Set(visibleParts.map((part) => part.id));
    const knownBefore = new Set(state.knownParts);
    const changed = visibleParts.some((part) => !knownBefore.has(part.id)) || state.subscriptions.some((item) => item.pending.some((pending) => !visible.has(pending.partId)));
    if (changed) await mutate(() => {
      const known = new Set(state.knownParts);
      const added = visibleParts.filter((part) => !known.has(part.id));
      for (const part of added) known.add(part.id);
      state.knownParts = [...known];
      for (const subscription of state.subscriptions) {
        subscription.pending = subscription.pending.filter((pending) => visible.has(pending.partId));
        for (const part of added) {
          if (!subscription.all && !subscription.books.includes(part.bookId) && !subscription.parts.includes(part.id)) continue;
          if (subscription.pending.length >= 100) break;
          subscription.pending.push({ partId: part.id, bookId: part.bookId, title: part.title, url: part.url, attempts: 0, retryAt: 0 });
        }
      }
    });
    await drain();
  }
  async function baseline(visibleParts) {
    await mutate(() => {
      const visible = new Set(visibleParts.map((part) => part.id));
      state.knownParts = [...new Set([...state.knownParts, ...visible])];
      for (const item of state.subscriptions) item.pending = item.pending.filter((pending) => visible.has(pending.partId));
    });
  }
  async function drain() {
    if (sending) return;
    sending = true;
    try {
      const ready = state.subscriptions.flatMap((item) => (item.pending || []).filter((pending) => pending.retryAt <= Date.now()).map((pending) => ({ id: item.id, pending })));
      for (const { id, pending } of ready) {
        const item = state.subscriptions.find((entry) => entry.id === id);
        if (!item?.pending.includes(pending)) continue;
        let remove = false;
        let expired = false;
        try {
          await deliver(item.subscription, JSON.stringify({ title: "Neuer Leseteil verfügbar", body: pending.title, url: pending.url, tag: `release-${pending.partId}` }), { TTL: 86_400, vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey } });
          remove = true;
        } catch (error) {
          expired = [404, 410].includes(error.statusCode);
          if (!expired) console.error("Push-Versand fehlgeschlagen:", error);
        }
        await mutate(() => {
          const current = state.subscriptions.find((entry) => entry.id === id);
          if (!current) return;
          if (expired) { state.subscriptions = state.subscriptions.filter((entry) => entry !== current); return; }
          if (remove) { current.pending = current.pending.filter((entry) => entry !== pending); current.parts = current.parts.filter((partId) => partId !== pending.partId); }
          else { pending.attempts += 1; pending.retryAt = Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(pending.attempts, 7)); }
          if (!current.all && !current.books.length && !current.parts.length && !current.pending.length) state.subscriptions = state.subscriptions.filter((entry) => entry !== current);
        });
      }
    } finally { sending = false; }
  }
  return { init, publicKey: () => keys.publicKey, status, setScope, scan, baseline, drain };
}
