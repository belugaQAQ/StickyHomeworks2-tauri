import { Editor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import type { HomeworkContent, TiptapDocument } from "../types/homework-content";
import { ALLOWED_HOMEWORK_IMAGE_MIME_TYPES, clampHomeworkImageWidthPercent, isSafeHomeworkLink } from "../utils/homework-content";

export { clampHomeworkImageWidthPercent } from "../utils/homework-content";
export const MAX_HOMEWORK_IMAGE_BYTES = 2 * 1024 * 1024;

export function findHomeworkImagePosition(editor: Editor): number | null {
  const { $from, from, to } = editor.state.selection;
  if (editor.isActive("image")) return from;
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === "image") return from;
  let found: number | null = null;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "image" || found !== null) return found === null;
    found = pos;
    return false;
  });
  return found;
}

export function updateHomeworkImageWidthPercent(editor: Editor, value: number, position = findHomeworkImagePosition(editor)): number | null {
  if (position === null) return null;
  const image = editor.state.doc.nodeAt(position);
  if (image?.type.name !== "image") return null;
  const widthPercent = clampHomeworkImageWidthPercent(value);
  if (image.attrs.widthPercent === widthPercent) return widthPercent;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...image.attrs, widthPercent }));
  return widthPercent;
}

const HomeworkImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: {
        default: 100,
        parseHTML: (element: HTMLElement) => {
          const styleWidth = element.style.width.trim();
          const match = /^(\d+(?:\.\d+)?)%$/.exec(styleWidth);
          return clampHomeworkImageWidthPercent(match ? Number(match[1]) : Number.NaN);
        },
        renderHTML: (attributes: { widthPercent?: number }) => ({
          style: `width: ${clampHomeworkImageWidthPercent(Number(attributes.widthPercent))}%`,
        }),
      },
    };
  },
});

export function createHomeworkEditor(onChange: (content: HomeworkContent) => void, onLinkRequest: (href: string, text: string) => void, mobileLayout = false): Editor {
  function interceptLink(event: MouseEvent): boolean {
    if (!(event.target instanceof Element)) return false;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (mobileLayout) {
      if (isSafeHomeworkLink(link.href)) onLinkRequest(link.href, link.textContent?.trim() ?? "");
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && isSafeHomeworkLink(link.href)) onLinkRequest(link.href, link.textContent?.trim() ?? "");
    return true;
  }

  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      HomeworkImage.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: false, validate: isSafeHomeworkLink }),
    ],
    editorProps: {
      handleClick: (_view, _pos, event) => interceptLink(event),
      handleDOMEvents: {
        click: (_view, event) => interceptLink(event as MouseEvent),
      },
    },
    content: { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor }) => onChange({ kind: "tiptap-json", version: 1, document: editor.getJSON() as TiptapDocument }),
  });
}

export function loadHomeworkEditor(editor: Editor, content: HomeworkContent): void {
  if (content.kind === "tiptap-json") editor.commands.setContent(content.document, { emitUpdate: false });
  else if (content.kind === "plain-text") editor.commands.setContent({ type: "doc", content: content.text.split("\n").map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : undefined })) }, { emitUpdate: false });
  else editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content.xaml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() }] }] }, { emitUpdate: false });
}

export function validateHomeworkImage(file: File): string | null {
  if (!(ALLOWED_HOMEWORK_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "仅支持 PNG、JPEG、GIF 或 WebP 图片。";
  if (file.size > MAX_HOMEWORK_IMAGE_BYTES) return "图片大小不能超过 2 MB。";
  return null;
}

export function insertHomeworkImage(editor: Editor, file: File): Promise<string | null> {
  const error = validateHomeworkImage(file);
  if (error) return Promise.resolve(error);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: String(reader.result) }).run();
      resolve(null);
    };
    reader.onerror = () => resolve("图片读取失败，请重试。");
    reader.readAsDataURL(file);
  });
}

export function insertHomeworkLink(editor: Editor, href: string, displayText: string, range = editor.state.selection): string | null {
  const value = href.trim();
  if (!value || !isSafeHomeworkLink(value)) return "链接必须是有效的 HTTP(S) 或 mailto 地址。";
  const text = displayText.trim() || value;
  const inserted = editor.chain().focus().insertContentAt(
    { from: range.from, to: range.to },
    { type: "text", text, marks: [{ type: "link", attrs: { href: value } }] },
  ).run();
  return inserted ? null : "链接插入失败，请重试。";
}
