import { PDFDocument } from "pdf-lib";
import { formatLocalDate } from "../domain/homework";
import { uniqueVocabulary } from "../domain/vocabulary";
import type { SubjectGroup } from "../types/homework-board";

export const UAF_PAYLOAD_FILENAME = "uaf_payload.csv";
export const UAF_WATERMARK_TEXT = "本文件符合UAF标准规范";
export const UAF_PAGE_WIDTH_PT = 595.28;
export const UAF_PAGE_MARGIN_PT = 40;
export const UAF_MAX_PAGE_HEIGHT_PT = 14400;

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

    if (!assignment.content.trim()) errors.push(`${label}：正文为空，UAF 要求正文非空。`);
    else if (assignment.content.length > CONTENT_MAX_LENGTH)
      errors.push(`${label}：正文 ${assignment.content.length} 字符，超过 ${CONTENT_MAX_LENGTH} 字符上限。`);

    if (assignment.tags.length > TAG_MAX_COUNT)
      errors.push(`${label}：标签 ${assignment.tags.length} 个，超过 ${TAG_MAX_COUNT} 个上限。`);
    for (const tag of assignment.tags) {
      if (!tag.trim()) errors.push(`${label}：存在空标签。`);
      else if (tag.includes(";")) errors.push(`${label}：标签「${tag}」含分号，UAF 用它分隔标签。`);
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

export async function createUafPdf(options: {
  png: Uint8Array;
  pageHeight: number;
  csv: string;
  title: string;
}): Promise<Uint8Array> {
  if (!(options.pageHeight > 0) || options.pageHeight > UAF_MAX_PAGE_HEIGHT_PT) {
    throw new Error(`作业内容过长，UAF 单页高度上限为 ${UAF_MAX_PAGE_HEIGHT_PT}pt，请减少作业数量后分次导出。`);
  }

  const document = await PDFDocument.create();
  document.setTitle(options.title);
  document.setProducer("StickyHomeworks2");
  document.setCreator("StickyHomeworks2");

  const image = await document.embedPng(options.png);
  const page = document.addPage([UAF_PAGE_WIDTH_PT, options.pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: UAF_PAGE_WIDTH_PT, height: options.pageHeight });

  await document.attach(new TextEncoder().encode(options.csv), UAF_PAYLOAD_FILENAME, {
    mimeType: "text/csv",
    description: "UAF v1.0 payload",
  });

  return document.save();
}
