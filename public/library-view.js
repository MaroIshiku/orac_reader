const normalizedText = (value) => String(value || "")
  .replace(/```[^\n]*\n|~~~[^\n]*\n|```|~~~/g, " ")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/(^|\s)[#>*+-]+\s+/gm, "$1")
  .replace(/[`*_~]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const directionFactor = (direction) => direction === "desc" ? -1 : 1;
const releaseTime = (book) => Date.parse(book.publishedAt || book.publishAt || book.updatedAt || "") || 0;

export function sortBooks(books, criterion = "number", direction = "asc") {
  const factor = directionFactor(direction);
  return [...books].sort((a, b) => {
    let difference = 0;
    if (criterion === "alphabetical") difference = String(a.title || "").localeCompare(String(b.title || ""), "de", { numeric: true, sensitivity: "base" });
    else if (criterion === "release") difference = releaseTime(a) - releaseTime(b);
    else difference = (Number(a.number) || 0) - (Number(b.number) || 0);
    return difference * factor || (Number(a.number) || 0) - (Number(b.number) || 0) || String(a.id).localeCompare(String(b.id));
  });
}

export function sortReaderChapters(chapters, direction = "asc") {
  const factor = directionFactor(direction);
  return [...chapters]
    .sort((a, b) => (((Number(a.number) || 0) - (Number(b.number) || 0)) || ((Number(a.order) || 0) - (Number(b.order) || 0))) * factor)
    .map((chapter) => direction === "desc" ? { ...chapter, parts: [...chapter.parts].reverse() } : chapter);
}

function excerpts(value, query, radius = 90) {
  const text = normalizedText(value); const lower = text.toLocaleLowerCase("de"); const needle = query.toLocaleLowerCase("de"); const matches = [];
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + Math.max(1, needle.length))) {
    const start = Math.max(0, index - radius); const end = Math.min(text.length, index + query.length + radius);
    matches.push({ prefix: start > 0, before: text.slice(start, index), match: text.slice(index, index + query.length), after: text.slice(index + query.length, end), suffix: end < text.length });
  }
  return matches;
}

export function findLibraryResults(books, query) {
  const needle = String(query || "").trim(); if (!needle) return [];
  return books.flatMap((book) => {
    const firstBookEntry = book.chapters.flatMap((chapter) => chapter.parts.map((part) => ({ chapter, part })))[0];
    const bookResults = firstBookEntry ? [["book-title", book.title], ["book-description", book.description]].flatMap(([source, value]) => excerpts(value, needle).map((context) => ({ book, ...firstBookEntry, source, context }))) : [];
    const chapterResults = book.chapters.flatMap((chapter) => {
      const firstPart = chapter.parts[0];
      const metadata = firstPart ? [["chapter-title", chapter.title], ["chapter-tldr", chapter.tldr]].flatMap(([source, value]) => excerpts(value, needle).map((context) => ({ book, chapter, part: firstPart, source, context }))) : [];
      const parts = chapter.parts.flatMap((part) => [["part-title", part.title], ["part-tldr", part.tldr], ["content", part.content]].flatMap(([source, value]) => excerpts(value, needle).map((context) => ({ book, chapter, part, source, context }))));
      return [...metadata, ...parts];
    });
    return [...bookResults, ...chapterResults];
  });
}
