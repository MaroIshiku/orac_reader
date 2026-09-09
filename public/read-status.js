export function aggregateRead(values) {
  const states = values.map(Boolean);
  const read = states.filter(Boolean).length;
  const total = states.length;
  return {
    read,
    total,
    percent: total ? Math.round(read / total * 100) : 0,
    state: !read ? "unread" : read === total ? "read" : "partial",
  };
}

export const nextGroupRead = (values) => !values.every(Boolean);
