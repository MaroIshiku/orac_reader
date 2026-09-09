import test from "node:test";
import assert from "node:assert/strict";
import { aggregateRead, nextGroupRead } from "../public/read-status.js";

test("Teilstatus wird eindeutig zu Kapitel und Archiveintrag zusammengefasst", () => {
  assert.deepEqual(aggregateRead([false, false]), { read: 0, total: 2, percent: 0, state: "unread" });
  assert.deepEqual(aggregateRead([true, false]), { read: 1, total: 2, percent: 50, state: "partial" });
  assert.deepEqual(aggregateRead([true, true]), { read: 2, total: 2, percent: 100, state: "read" });
});

test("Gruppenschalter markiert unvollständige Gruppen gelesen und vollständige ungelesen", () => {
  assert.equal(nextGroupRead([false, false]), true);
  assert.equal(nextGroupRead([true, false]), true);
  assert.equal(nextGroupRead([true, true]), false);
});
