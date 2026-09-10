import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readerRoot = resolve(here, "..");
const storyRoot = resolve(readerRoot, "..", "..", "Story");
const output = join(readerRoot, "data", "library.json");

const folders = (await readdir(storyRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{4}/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));

const chapters = [];
for (const folder of folders) {
  const folderPath = join(storyRoot, folder.name);
  const files = (await readdir(folderPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));

  if (!files.length) continue;
  const official = folder.name.match(/^\d{4}/)?.[0] || String(chapters.length).padStart(4, "0");
  const chapterNumber = Number(official) || 0;
  const chapterId = `oracle-${official}-chapter-${chapterNumber}`;
  const chapter = { id: chapterId, number: chapterNumber, title: `Kapitel ${chapterNumber}`, tldr: "", order: chapters.length, parts: [] };

  for (const [index, file] of files.entries()) {
    const raw = await readFile(join(folderPath, file.name), "utf8");
    const readingText = raw.replace(/^#\s+.+\r?\n(?:\r?\n)?/, "");
    const firstHeading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const partTitle = file.name.replace(/\.md$/i, "").replace(/^Teil\s*\d+\s*[-–]?\s*/i, "").trim();
    chapter.parts.push({
      id: `${chapterId}-part-${index + 1}`,
      number: index + 1,
      title: partTitle || firstHeading || `Teil ${index + 1}`,
      tldr: "",
      content: readingText
    });
  }
  chapters.push(chapter);
}

const books = [{
  id: "oracle-0000",
  number: 0,
  title: "Oracle",
  kicker: "ORACLE · ARCHIV",
  description: "ORACLE ist eine geheime Organisation für Fälle, die außerhalb jeder bekannten Ordnung liegen. Ihre Mitglieder besitzen ungewöhnliche Fähigkeiten – und tragen ebenso ungewöhnliche Lasten. Als sich übernatürliche Vorfälle häufen und längst vergessene Wesen zurückkehren, gerät das Team in einen Kampf um Kontrolle, Vertrauen und die Frage, wie viel Menschlichkeit im Angesicht des Unbegreiflichen bestehen bleibt. Eine düstere Mystery-Geschichte über gefundene Familie, uralte Legenden und die Dinge, die besser im Verborgenen geblieben wären.",
  status: "published",
  publishAt: null,
  updatedAt: new Date().toISOString(),
  chapters
}];

const library = {
  schemaVersion: 7,
  books,
  settings: { "numberDigits": 4 },
  links: [
    { "label": "OracleDB", "url": "https://oracledb.ishiku.de", "kind": "database" },
    { "label": "Discord", "url": "https://discord.com", "kind": "community" }
  ]
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(library, null, 2)}\n`, "utf8");
console.log(`${books.length} Bücher und ${books.reduce((sum, book) => sum + book.chapters.reduce((count, chapter) => count + chapter.parts.length, 0), 0)} Teile importiert: ${relative(process.cwd(), output)}`);
