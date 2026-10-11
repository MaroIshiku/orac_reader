import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushService, validatePushSubscription } from "../push.mjs";

const subscription = (name) => validatePushSubscription({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } });
const part = (id, bookId) => ({ id, bookId, title: `${bookId} · ${id}`, url: `/#read/${bookId}/${id}` });

test("Push-Abos für alle, einzelne Bücher und einzelne Teile bleiben getrennt und werden nur einmal ausgelöst", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "oracreader-push-"));
  const messages = [];
  const deliver = async (target, payload) => { messages.push({ endpoint: target.endpoint, ...JSON.parse(payload) }); };
  try {
    const service = createPushService(dataRoot, deliver);
    await service.init([part("old", "book-a")]);
    const all = subscription("all"); const book = subscription("book"); const once = subscription("once");
    await service.setScope(all, "all", true);
    await service.setScope(all, "book", true, "book-b");
    await service.setScope(all, "part", true, "new-b");
    await service.setScope(book, "book", true, "book-b");
    await service.setScope(once, "part", true, "new-b");
    await service.scan([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b")]);
    assert.equal(messages.filter((message) => message.endpoint === all.endpoint).length, 2);
    assert.equal(messages.filter((message) => message.endpoint === book.endpoint).length, 1);
    assert.equal(messages.filter((message) => message.endpoint === once.endpoint).length, 1);
    assert.equal(service.status(once).parts.length, 0);
    assert.deepEqual(service.status(book).books, ["book-b"]);
    await service.scan([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b")]);
    assert.equal(messages.length, 4);
    const restarted = createPushService(dataRoot, deliver);
    await restarted.init([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b")]);
    await restarted.scan([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b")]);
    assert.equal(messages.length, 4);
    await restarted.setScope(book, "book", false, "book-b");
    await restarted.scan([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b"), part("new-c", "book-b")]);
    assert.equal(messages.length, 5);
    assert.equal(messages.at(-1).endpoint, all.endpoint);
    await restarted.baseline([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b"), part("new-c", "book-b"), part("restored", "book-a")]);
    await restarted.scan([part("old", "book-a"), part("new-a", "book-a"), part("new-b", "book-b"), part("new-c", "book-b"), part("restored", "book-a")]);
    assert.equal(messages.length, 5, "Wiederhergestellte ältere Inhalte dürfen nicht als neue Releases gemeldet werden");
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test("Push-Endpunkte dürfen nicht auf interne oder unbekannte Server zeigen", () => {
  assert.throws(() => validatePushSubscription({ endpoint: "https://127.0.0.1/private", keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } }), /Push-Dienst/);
  assert.throws(() => validatePushSubscription({ endpoint: "http://fcm.googleapis.com/test", keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } }), /Push-Dienst/);
});
