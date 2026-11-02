import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import { UAF_PAYLOAD_FILENAME, uafAssignmentErrors, type UafAssignment } from "./uaf";

const CSV_HEADER = "subject,date,content,tags";

/** 从用户选中的 PDF 里读出 UAF 载荷。 */
export async function readUafAssignmentsFromFile(file: File): Promise<UafAssignment[]> {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("只能导入 UAF 的 PDF 文件。");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseUafCsv(await readUafPayloadFromPdf(bytes));
}

export async function readUafPayloadFromPdf(bytes: Uint8Array): Promise<string> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("无法解析这个 PDF 文件。");
  }

  const attachments = collectEmbeddedFiles(document);
  if (attachments.size === 0) throw new Error("这个 PDF 不是 UAF 文件。");

  const entry =
    attachments.get(UAF_PAYLOAD_FILENAME) ??
    [...attachments.entries()].find(([key]) => key.toLowerCase() === UAF_PAYLOAD_FILENAME.toLowerCase())?.[1];
  if (!entry) throw new Error(`这个 PDF 不是 UAF 文件。`);

  const data = await readAttachmentBytes(document, entry);
  return new TextDecoder("utf-8").decode(data);
}

export function parseUafCsv(csv: string): UafAssignment[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) throw new Error("作业数据是空的。");

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  if (header.length !== 4 || header.join(",") !== CSV_HEADER) {
    throw new Error(`作业数据表头不正确，应为 ${CSV_HEADER}。`);
  }
  if (rows.length === 1) throw new Error("作业数据里没有任何作业。");

  const records: UafAssignment[] = rows.slice(1).map((row, index) => {
    if (row.length !== 4) throw new Error(`第 ${index + 2} 行的列数不是 4 列。`);
    const [subject, date, content, tags] = row;
    if (Number.isNaN(Date.parse(date.trim()))) throw new Error(`第 ${index + 2} 行的日期不是有效的 ISO 8601 时间。`);
    return {
      subject: subject.trim(),
      date: date.trim(),
      content,
      tags: tags
        .split(";")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    };
  });

  const errors = uafAssignmentErrors(records);
  if (errors.length > 0) throw new Error(errors.join("；"));

  // 正文里的换行在这里拆成多条作业，导入后一项一条。
  return records.flatMap((record) =>
    splitImportLines(record.content).map((line) => ({ ...record, content: line })),
  );
}

function splitImportLines(content: string): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : [content];
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let hasField = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += character;
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      hasField = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      hasField = true;
      continue;
    }
    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      hasField = false;
      continue;
    }
    field += character;
    hasField = true;
  }

  if (hasField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function collectEmbeddedFiles(document: PDFDocument): Map<string, PDFObject> {
  const result = new Map<string, PDFObject>();
  const names = document.context.lookup(document.catalog.get(PDFName.of("Names")));
  if (!(names instanceof PDFDict)) return result;
  const tree = document.context.lookup(names.get(PDFName.of("EmbeddedFiles")));
  if (tree instanceof PDFDict) walkNameTree(document, tree, result);
  return result;
}

function walkNameTree(document: PDFDocument, node: PDFDict, out: Map<string, PDFObject>): void {
  const names = document.context.lookup(node.get(PDFName.of("Names")));
  if (names instanceof PDFArray) {
    const array = names.asArray();
    for (let index = 0; index + 1 < array.length; index += 2) {
      const key = decodePdfText(document, array[index]);
      if (key) out.set(key, array[index + 1]);
    }
  }

  const kids = document.context.lookup(node.get(PDFName.of("Kids")));
  if (kids instanceof PDFArray) {
    for (const kid of kids.asArray()) {
      const child = document.context.lookup(kid);
      if (child instanceof PDFDict) walkNameTree(document, child, out);
    }
  }
}

function decodePdfText(document: PDFDocument, value: PDFObject | undefined): string | null {
  if (!value) return null;
  const resolved = document.context.lookup(value);
  if (resolved instanceof PDFHexString || resolved instanceof PDFString) return resolved.decodeText();
  if (resolved instanceof PDFName) return resolved.decodeText();
  return null;
}

async function readAttachmentBytes(document: PDFDocument, fileSpec: PDFObject): Promise<Uint8Array> {
  const spec = document.context.lookup(fileSpec);
  if (!(spec instanceof PDFDict)) throw new Error("PDF 附件结构损坏。");

  const embeddedFile = document.context.lookup(spec.get(PDFName.of("EF")));
  if (!(embeddedFile instanceof PDFDict)) throw new Error("PDF 附件缺少数据流。");

  const stream = document.context.lookup(embeddedFile.get(PDFName.of("F")) ?? embeddedFile.get(PDFName.of("UF")));
  if (!(stream instanceof PDFRawStream)) throw new Error("PDF 附件数据流无法读取。");

  const filter = document.context.lookup(stream.dict.get(PDFName.of("Filter")));
  const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
  let data = stream.contents;
  for (const item of filters) {
    const name = decodePdfText(document, item) ?? "";
    if (name === "FlateDecode" || name === "Fl") data = await inflate(data);
    else throw new Error(`不支持的 PDF 附件编码：${name || "未知"}`);
  }
  return data;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("当前环境不支持解压 PDF 附件。");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
