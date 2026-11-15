import { parseHomeworkContent, type HomeworkContent, type TiptapNode } from "../types/homework-content";

export function clampHomeworkImageWidthPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(10, Math.round(value)));
}

export const ALLOWED_HOMEWORK_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function toHomeworkDisplayText(content: HomeworkContent | string): string {
  const parsed = parseHomeworkContent(content);
  if (parsed.kind === "plain-text") return parsed.text;
  if (parsed.kind === "legacy-flowdocument-xaml") return flowDocumentText(parsed.xaml);
  return tiptapText(parsed.document.content);
}

/**
 * 渲染成类似 Markdown 的纯文本：加粗 `**x**`、斜体 `*x*`、删除线 `~~x~~`、
 * 下划线 `<u>x</u>`、代码 `` `x` ``，图片 `[图片]`，超链接 `[URL:地址]`。
 */
export function toHomeworkMarkupText(content: HomeworkContent | string): string {
  const parsed = parseHomeworkContent(content);
  if (parsed.kind === "plain-text") return normalizeMarkup(parsed.text);
  if (parsed.kind === "legacy-flowdocument-xaml") return normalizeMarkup(flowDocumentText(parsed.xaml));
  return markupText(parsed.document.content);
}

function normalizeMarkup(text: string): string {
  return text.replace(/ {2,}/g, " ").replace(/ +$/gm, "").trim();
}

function markupText(nodes: TiptapNode[]): string {
  return normalizeMarkup(nodes.map(markupNode).join(""));
}

function markupNode(node: TiptapNode): string {
  if (node.type === "image") return " [图片] ";
  if (node.type === "text") {
    const marks = node.marks ?? [];
    const link = marks.find((mark) => mark.type === "link");
    if (link) {
      const href = typeof link.attrs?.href === "string" ? link.attrs.href : "";
      return ` [URL:${href}] `;
    }
    let text = node.text ?? "";
    for (const mark of marks) {
      if (mark.type === "bold") text = `**${text}**`;
      else if (mark.type === "italic") text = `*${text}*`;
      else if (mark.type === "underline") text = `<u>${text}</u>`;
      else if (mark.type === "strike") text = `~~${text}~~`;
      else if (mark.type === "code") text = `\`${text}\``;
    }
    return marks.length > 0 ? ` ${text} ` : text;
  }
  if (node.type === "hardBreak") return "\n";
  const inner = markupText(node.content ?? []);
  if (node.type === "paragraph" || node.type === "heading") return `${inner}\n`;
  return inner;
}

export function toTiptapHtml(content: HomeworkContent | string): string {
  const parsed = parseHomeworkContent(content);
  if (parsed.kind === "plain-text") return escapeHtml(parsed.text).replace(/\n/g, "<br>");
  if (parsed.kind === "legacy-flowdocument-xaml") return `<p>${escapeHtml(flowDocumentText(parsed.xaml))}</p>`;
  return parsed.document.content.map(renderTiptapNode).join("");
}

export function isSafeHomeworkLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return Boolean(url.hostname);
    if (url.protocol === "mailto:") return Boolean(url.pathname || url.username || url.hostname);
    return false;
  } catch {
    return false;
  }
}

function flowDocumentText(xaml: string): string {
  if (typeof DOMParser === "undefined")
    return xaml
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const document = new DOMParser().parseFromString(xaml, "application/xml");
  if (document.querySelector("parsererror")) return xaml;
  return document.documentElement.textContent?.replace(/\s+/g, " ").trim() || "";
}

function tiptapText(nodes: TiptapNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      const text = tiptapText(node.content ?? []);
      return node.type === "paragraph" || node.type === "heading" ? `${text}\n` : text;
    })
    .join("")
    .trim();
}

function renderTiptapNode(node: TiptapNode): string {
  if (node.type === "text") {
    let html = escapeHtml(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") html = `<strong>${html}</strong>`;
      else if (mark.type === "italic") html = `<em>${html}</em>`;
      else if (mark.type === "underline") html = `<u>${html}</u>`;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string" && isSafeHomeworkLink(mark.attrs.href))
        html = `<a href="${escapeHtml(mark.attrs.href)}" rel="noopener noreferrer">${html}</a>`;
    }
    return html;
  }
  const inner = (node.content ?? []).map(renderTiptapNode).join("");
  if (node.type === "paragraph") return `<p>${inner}</p>`;
  if (node.type === "heading") return `<p>${inner}</p>`;
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "image" && typeof node.attrs?.src === "string" && isAllowedHomeworkImageSource(node.attrs.src)) {
    const widthPercent = clampHomeworkImageWidthPercent(Number(node.attrs.widthPercent));
    return `<img src="${escapeHtml(node.attrs.src)}" alt="${escapeHtml(String(node.attrs.alt ?? "图片"))}" style="width: ${widthPercent}%">`;
  }
  return inner;
}

function isAllowedHomeworkImageSource(value: string): boolean {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value);
  return match !== null && (ALLOWED_HOMEWORK_IMAGE_MIME_TYPES as readonly string[]).includes(match[1].toLowerCase());
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>\"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

export function isHomeworkExpired(dueTime: string, now = new Date()): boolean {
  const dueDate = new Date(dueTime);
  if (Number.isNaN(dueDate.getTime())) return false;

  const todayStart = new Date(now);
  dueDate.setHours(0, 0, 0, 0);
  todayStart.setHours(0, 0, 0, 0);
  return dueDate < todayStart;
}
