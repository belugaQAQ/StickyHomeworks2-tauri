import { parseHomeworkContent, type HomeworkContent, type TiptapNode } from "../types/homework-content";

export const ALLOWED_HOMEWORK_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function toHomeworkDisplayText(content: HomeworkContent | string): string {
  const parsed = parseHomeworkContent(content);
  if (parsed.kind === "plain-text") return parsed.text;
  if (parsed.kind === "legacy-flowdocument-xaml") return flowDocumentText(parsed.xaml);
  return tiptapText(parsed.document.content);
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
  if (typeof DOMParser === "undefined") return xaml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const document = new DOMParser().parseFromString(xaml, "application/xml");
  if (document.querySelector("parsererror")) return xaml;
  return document.documentElement.textContent?.replace(/\s+/g, " ").trim() || "";
}

function tiptapText(nodes: TiptapNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return node.text ?? "";
    const text = tiptapText(node.content ?? []);
    return node.type === "paragraph" || node.type === "heading" ? `${text}\n` : text;
  }).join("").trim();
}

function renderTiptapNode(node: TiptapNode): string {
  if (node.type === "text") {
    let html = escapeHtml(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") html = `<strong>${html}</strong>`;
      else if (mark.type === "italic") html = `<em>${html}</em>`;
      else if (mark.type === "underline") html = `<u>${html}</u>`;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string" && isSafeHomeworkLink(mark.attrs.href)) html = `<a href="${escapeHtml(mark.attrs.href)}" rel="noopener noreferrer">${html}</a>`;
    }
    return html;
  }
  const inner = (node.content ?? []).map(renderTiptapNode).join("");
  if (node.type === "paragraph") return `<p>${inner}</p>`;
  if (node.type === "heading") return `<p>${inner}</p>`;
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "image" && typeof node.attrs?.src === "string" && isAllowedHomeworkImageSource(node.attrs.src)) return `<img src="${escapeHtml(node.attrs.src)}" alt="${escapeHtml(String(node.attrs.alt ?? "图片"))}">`;
  return inner;
}

function isAllowedHomeworkImageSource(value: string): boolean {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value);
  return match !== null && (ALLOWED_HOMEWORK_IMAGE_MIME_TYPES as readonly string[]).includes(match[1].toLowerCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function isHomeworkExpired(dueTime: string): boolean {
  const dueDate = new Date(dueTime);
  if (Number.isNaN(dueDate.getTime())) return false;

  const today = new Date();
  dueDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
}
