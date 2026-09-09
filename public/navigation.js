export function readerHash(bookId, partId) {
  return `read/${encodeURIComponent(bookId)}/${encodeURIComponent(partId)}`;
}

export function cardDestination(book, history = []) {
  const parts = book.chapters.flatMap((chapter) => chapter.parts.map((part) => ({ chapter, part })));
  const recentPartId = history.find((entry) => entry.bookId === book.id)?.partId;
  return parts.find(({ part }) => part.id === recentPartId) || parts[0] || null;
}
