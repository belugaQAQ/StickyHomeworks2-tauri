export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};

export type PlainTextHomeworkContent = {
  kind: "plain-text";
  text: string;
};

export type TiptapHomeworkContent = {
  kind: "tiptap-json";
  version: 1;
  document: TiptapDocument;
};

export type LegacyFlowDocumentXamlContent = {
  kind: "legacy-flowdocument-xaml";
  xaml: string;
};

export type HomeworkContent =
  | PlainTextHomeworkContent
  | TiptapHomeworkContent
  | LegacyFlowDocumentXamlContent;

export function isHomeworkContent(value: unknown): value is HomeworkContent {
  if (!isRecord(value)) return false;

  const kind = contentKind(value);
  if (kind === "plain-text") return typeof value.text === "string";
  if (kind === "legacy-flowdocument-xaml") return typeof value.xaml === "string";
  if (kind !== "tiptap-json") return false;

  return value.version === undefined || value.version === 1
    ? isTiptapDocument(value.document)
    : false;
}

/** Reads frontend content, Rust DTO content, and pre-migration strings. */
export function parseHomeworkContent(value: unknown): HomeworkContent {
  if (typeof value === "string") {
    const text = value.trim();
    if (isFlowDocumentXaml(text)) return { kind: "legacy-flowdocument-xaml", xaml: value };
    if (text.startsWith("{")) {
      try {
        return parseHomeworkContent(JSON.parse(text));
      } catch {
        // 保留普通文本内容；只有结构化 JSON 才进入版本化解析。
      }
    }
    return { kind: "plain-text", text: value };
  }

  if (!isHomeworkContent(value)) throw new Error("作业内容格式无效");
  const record = value as Record<string, any>;
  const kind = contentKind(record);
  if (kind === "plain-text") return { kind, text: record.text };
  if (kind === "legacy-flowdocument-xaml") return { kind, xaml: record.xaml };
  if (kind === "tiptap-json") return { kind, version: 1, document: record.document };
  throw new Error("作业内容格式无效");
}

/** Serializes the internal model using the Rust DTO discriminator. */
export function serializeHomeworkContent(content: HomeworkContent): string {
  const parsed = parseHomeworkContent(content);
  if (parsed.kind === "plain-text") return JSON.stringify({ type: "plain-text", text: parsed.text });
  if (parsed.kind === "legacy-flowdocument-xaml") return JSON.stringify({ type: "legacy-flowdocument-xaml", xaml: parsed.xaml });
  return JSON.stringify({ type: "tiptap-json@1", document: parsed.document });
}

function contentKind(value: Record<string, any>): HomeworkContent["kind"] | null {
  if (value.kind === "plain-text" || value.type === "plain-text") return "plain-text";
  if (value.kind === "legacy-flowdocument-xaml" || value.type === "legacy-flowdocument-xaml") return "legacy-flowdocument-xaml";
  if (value.kind === "tiptap-json" || value.type === "tiptap-json@1") return "tiptap-json";
  return null;
}

function isTiptapDocument(value: unknown): value is TiptapDocument {
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content)) return false;
  return value.content.every(isTiptapNode);
}

function isTiptapNode(value: unknown): value is TiptapNode {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.text !== undefined && typeof value.text !== "string") return false;
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every(isTiptapMark))) return false;
  return value.content === undefined || (Array.isArray(value.content) && value.content.every(isTiptapNode));
}

function isTiptapMark(value: unknown): value is TiptapMark {
  return isRecord(value) && typeof value.type === "string" && (value.attrs === undefined || isRecord(value.attrs));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlowDocumentXaml(value: string): boolean {
  return /^\s*<FlowDocument(?:\s|>)/i.test(value);
}
