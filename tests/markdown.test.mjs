import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { configureMarkdown } from "../public/markdown-config.js";

const markdown = configureMarkdown(marked);

test("Buch-Markdown rendert Dialoge, Gliederung und umfangreiche Blockelemente", () => {
  const html = markdown(`## Szene

Erste Zeile
Zweite Zeile mit *Betonung* und **Nachdruck**.

> Erste Liedzeile
> Zweite Liedzeile

1. Erster Weg
2. Zweiter Weg

- [x] Gefunden
- [ ] Offen

| Ort | Status |
| --- | --- |
| Nest | sicher |

~~~text
Ein abgesetzter Aktenauszug
~~~`);

  assert.match(html, /<h2>Szene<\/h2>/);
  assert.match(html, /Erste Zeile<br>Zweite Zeile/);
  assert.match(html, /<em>Betonung<\/em>.*<strong>Nachdruck<\/strong>/s);
  assert.match(html, /<blockquote>[\s\S]*Erste Liedzeile<br>Zweite Liedzeile/);
  assert.match(html, /<ol>[\s\S]*Erster Weg[\s\S]*Zweiter Weg/);
  assert.match(html, /<input checked="" disabled="" type="checkbox">/);
  assert.match(html, /class="prose-table"[\s\S]*<table>/);
  assert.match(html, /<pre><code class="language-text">Ein abgesetzter Aktenauszug/);
});

test("Buch-Markdown führt weder Roh-HTML noch gefährliche URLs aus", () => {
  const html = markdown(`<script>alert(1)</script>

[harmlos](https://example.com) [gefährlich](javascript:alert(1))

![Bild](javascript:alert(2))`);

  assert.doesNotMatch(html, /<script>|href="javascript:|src="javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, / gefährlich<\/p>/);
});
