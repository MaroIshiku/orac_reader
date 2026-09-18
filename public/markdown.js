import { marked } from "/vendor/marked.esm.js?v=__APP_VERSION__";
import { configureMarkdown } from "/markdown-config.js?v=__APP_VERSION__";

export const renderMarkdown = configureMarkdown(marked);
