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

const books = [];
for (const folder of folders) {
  const folderPath = join(storyRoot, folder.name);
  const files = (await readdir(folderPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));

  if (!files.length) continue;
  const folderTitle = folder.name.replace(/^\d{4}\s*[-–]?\s*/, "").trim();
  const id = `oracle-${folder.name.match(/^\d{4}/)?.[0] || books.length}`;
  const chapters = [];

  for (const [index, file] of files.entries()) {
    const raw = await readFile(join(folderPath, file.name), "utf8");
    const readingText = raw.replace(/^#\s+.+\r?\n(?:\r?\n)?/, "");
    const firstHeading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const partTitle = file.name.replace(/\.md$/i, "").replace(/^Teil\s*\d+\s*[-–]?\s*/i, "").trim();
    const chapterNumber = Number(folder.name.match(/^\d{4}/)?.[0]) || 0;
    let chapter = chapters.find((item) => item.number === chapterNumber);
    if (!chapter) {
      chapter = { id: `${id}-chapter-${chapterNumber}`, number: chapterNumber, title: `Kapitel ${chapterNumber}`, parts: [] };
      chapters.push(chapter);
    }
    chapter.parts.push({
      id: `${id}-chapter-${chapterNumber}-part-${index + 1}`,
      number: index + 1,
      title: partTitle || firstHeading || `Teil ${index + 1}`,
      content: readingText
    });
  }

  const importedPartCount = chapters.reduce((sum, chapter) => sum + chapter.parts.length, 0);
  books.push({
    id,
    number: Number(folder.name.match(/^\d{4}/)?.[0]) || 0,
    title: folderTitle || "ORACLE",
    kicker: "ORACLE · ARCHIV",
    description: `Ein Eintrag des ORACLE-Archivs. ${importedPartCount} ${importedPartCount === 1 ? "Teil" : "Teile"}.`,
    tldr: "",
    status: "published",
    publishAt: null,
    updatedAt: new Date().toISOString(),
    chapters
  });
}

const library = {
  schemaVersion: 3,
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
