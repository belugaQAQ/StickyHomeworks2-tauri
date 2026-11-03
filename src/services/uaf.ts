import { PDFDocument, rgb } from "pdf-lib";
import { formatLocalDate } from "../domain/homework";
import { uniqueVocabulary } from "../domain/vocabulary";
import type { SubjectGroup } from "../types/homework-board";

export const UAF_PAYLOAD_FILENAME = "uaf_payload.csv";
export const UAF_WATERMARK_TEXT = "本文件符合 UAF v1.0";
export const UAF_PAGE_WIDTH_PT = 595.28;
export const UAF_PAGE_HEIGHT_PT = 841.89;
export const UAF_PAGE_MARGIN_PT = 40;
export const UAF_PAGE_CONTENT_HEIGHT_PT = UAF_PAGE_HEIGHT_PT - UAF_PAGE_MARGIN_PT * 2;
export const UAF_WATERMARK_GAP_PT = 56;
export const UAF_MAX_PAGES = 80;

const CSV_HEADER = "subject,date,content,tags";
const SUBJECT_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 2000;
const TAG_MAX_COUNT = 20;
const TAG_MAX_LENGTH = 50;

export type UafAssignment = {
  subject: string;
  date: string;
  content: string;
  tags: string[];
};

export type UafPdfPageImage = {
  png: Uint8Array;
  height: number;
};

export function buildUafAssignments(groups: readonly SubjectGroup[], date = new Date()): UafAssignment[] {
  const value = formatLocalDate(date);
  const assignments: UafAssignment[] = [];
  for (const group of groups) {
    if (group.homeworks.length === 0) continue;
    const content = group.homeworks
      .map((homework) => homework.text.trim())
      .filter((text) => text.length > 0)
      .join("\n");
    assignments.push({
      subject: group.name,
      date: value,
      content,
      tags: uniqueVocabulary(group.homeworks.flatMap((homework) => homework.tags)),
    });
  }
  return assignments;
}

export function uafAssignmentErrors(assignments: readonly UafAssignment[]): string[] {
  const errors: string[] = [];
  assignments.forEach((assignment) => {
    const label = `科目「${assignment.subject.trim() || "无科目"}」`;
    const subject = assignment.subject.trim();
    if (!subject) errors.push(`${label}：科目为空。`);
    else if (subject.length > SUBJECT_MAX_LENGTH) errors.push(`${label}：科目超过 ${SUBJECT_MAX_LENGTH} 字符。`);

    if (!assignment.content.trim()) errors.push(`${label}：正文为空，请修改。`);
    else if (assignment.content.length > CONTENT_MAX_LENGTH)
      errors.push(`${label}：正文 ${assignment.content.length} 字符，超过 ${CONTENT_MAX_LENGTH} 字符上限。`);

    if (assignment.tags.length > TAG_MAX_COUNT)
      errors.push(`${label}：标签 ${assignment.tags.length} 个，超过 ${TAG_MAX_COUNT} 个上限。`);
    for (const tag of assignment.tags) {
      if (!tag.trim()) errors.push(`${label}：存在空标签。`);
      else if (tag.includes(";")) errors.push(`${label}：标签「${tag}」含分号，请修改。`);
      else if (tag.length > TAG_MAX_LENGTH) errors.push(`${label}：标签「${tag}」超过 ${TAG_MAX_LENGTH} 字符。`);
    }
  });
  return errors;
}

export function serializeUafCsv(assignments: readonly UafAssignment[]): string {
  const errors = uafAssignmentErrors(assignments);
  if (errors.length > 0) throw new Error(errors.join("；"));

  const rows = assignments.map((assignment) =>
    [assignment.subject, assignment.date, assignment.content, assignment.tags.join(";")]
      .map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
      .join(","),
  );
  return `${[CSV_HEADER, ...rows].join("\n")}\n`;
}

//把已经切好的多段长图拼成 PDF
export async function createUafPdf(options: {
  pages: readonly UafPdfPageImage[];
  csv: string;
  title: string;
  backgroundColor?: string | null;
}): Promise<Uint8Array> {
  if (options.pages.length === 0) throw new Error("没有可导出的作业内容。");
  if (options.pages.length > UAF_MAX_PAGES)
    throw new Error(`作业内容过多，最多导出 ${UAF_MAX_PAGES} 页，请分批导出。`);

  const document = await PDFDocument.create();
  document.setTitle(options.title);
  document.setProducer("StickyHomeworks2");
  document.setCreator("StickyHomeworks2");

  const background = parseCssColor(options.backgroundColor ?? null);
  const maxImageHeight = UAF_PAGE_CONTENT_HEIGHT_PT + UAF_WATERMARK_GAP_PT;

  for (const entry of options.pages) {
    const page = document.addPage([UAF_PAGE_WIDTH_PT, UAF_PAGE_HEIGHT_PT]);
    if (background) {
      page.drawRectangle({ x: 0, y: 0, width: UAF_PAGE_WIDTH_PT, height: UAF_PAGE_HEIGHT_PT, color: background });
    }
    const image = await document.embedPng(entry.png);
    const height = Math.max(1, Math.min(entry.height, maxImageHeight));
    page.drawImage(image, {
      x: 0,
      y: UAF_PAGE_HEIGHT_PT - UAF_PAGE_MARGIN_PT - height,
      width: UAF_PAGE_WIDTH_PT,
      height,
    });
  }

  await document.attach(new TextEncoder().encode(options.csv), UAF_PAYLOAD_FILENAME, {
    mimeType: "text/csv",
    description: "UAF v1.0 payload",
  });

  return document.save();
}

function parseCssColor(value: string | null): ReturnType<typeof rgb> | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((digit) => digit + digit).join("");
    if (digits.length !== 6 && digits.length !== 8) return null;
    return rgb(
      Number.parseInt(digits.slice(0, 2), 16) / 255,
      Number.parseInt(digits.slice(2, 4), 16) / 255,
      Number.parseInt(digits.slice(4, 6), 16) / 255,
    );
  }

  const functional = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!functional) return null;
  const channels = functional[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => (part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)));
  if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
  return rgb(clamp01(channels[0] / 255), clamp01(channels[1] / 255), clamp01(channels[2] / 255));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
