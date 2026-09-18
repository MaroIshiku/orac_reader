const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const safeUrl = (value, image = false) => {
  const url = String(value || "").trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false;
  if (/^(?:[./?#]|https?:\/\/)/i.test(url)) return true;
  return !image && /^(?:mailto:|tel:)/i.test(url);
};

export function configureMarkdown(marked) {
  const renderer = new marked.Renderer();
  const renderLink = marked.Renderer.prototype.link;
  const renderImage = marked.Renderer.prototype.image;
  const renderTable = marked.Renderer.prototype.table;

  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function (token) {
    if (!safeUrl(token.href)) return this.parser.parseInline(token.tokens);
    return renderLink.call(this, token);
  };
  renderer.image = function (token) {
    if (!safeUrl(token.href, true)) return escapeHtml(token.text);
    return renderImage.call(this, token);
  };
  renderer.table = function (token) { return `<div class="prose-table">${renderTable.call(this, token)}</div>`; };

  marked.use({ async: false, breaks: true, gfm: true, renderer });
  return (source) => marked.parse(String(source || ""));
}
