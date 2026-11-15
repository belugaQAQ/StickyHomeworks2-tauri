import type { HomeworkRecord } from "../types/app-data.ts";
import type { SnapshotPayload } from "../types/time-machine.ts";
import { toHomeworkMarkupText } from "../utils/homework-content.ts";

export type DiffLineKind = "context" | "remove" | "add";

export type DiffLine = {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
  startsHomework?: boolean;
  separated?: boolean;
};

export type DiffSection = {
  key: string;
  title: string;
  lines: DiffLine[];
  truncated?: boolean;
};

export type RestoreDiff = {
  homeworkLines: DiffLine[];
  homeworkTruncated: boolean;
  vocabularySections: DiffSection[];
  orderSection: DiffSection | null;
};

export const MAX_SECTION_LINES = 2000;
export const MAX_LINE_LENGTH = 1000;

type DiffOp = { kind: DiffLineKind | "equal"; text: string };

export function buildRestoreDiff(before: SnapshotPayload, after: SnapshotPayload): RestoreDiff {
  const afterById = new Map(after.homeworks.map((homework) => [homework.id, homework]));
  const beforeById = new Map(before.homeworks.map((homework) => [homework.id, homework]));

  const homework = buildHomeworkDiff(before.homeworks, after.homeworks, afterById, beforeById);

  const vocabularySections = [
    vocabularySection("subjects", "科目词库", before.subjects, after.subjects),
    vocabularySection("tags", "标签词库", before.tags, after.tags),
  ].filter((section): section is DiffSection => section !== null);

  const homeworkChanged = homework.lines.some((line) => line.kind !== "context");

  return {
    homeworkLines: homeworkChanged ? homework.lines : [],
    homeworkTruncated: homeworkChanged && homework.truncated,
    vocabularySections,
    orderSection: orderSection(before.homeworks, after.homeworks),
  };
}

/** 正文按 Markdown 标记渲染：加粗 `**x**`、删除线 `~~x~~`、图片 `[图片]`、链接 `[URL:地址]`。 */
function bodyText(homework: HomeworkRecord): string {
  return toHomeworkMarkupText(homework.content).replace(/\r\n?/g, "\n");
}

function homeworkLines(homework: HomeworkRecord): string[] {
  return [
    `科目: ${homework.subject}`,
    `截止日期: ${homework.dueTime}`,
    `标签: ${JSON.stringify(homework.tags)}`,
    `首次过期展示: ${homework.firstExpiredShowTime ?? "无"}`,
    "正文:",
    ...bodyText(homework).split("\n"),
  ];
}

function vocabularySection(
  key: string,
  title: string,
  before: readonly string[],
  after: readonly string[],
): DiffSection | null {
  const beforeLines = before.map((value) => `"${value}"`);
  const afterLines = after.map((value) => `"${value}"`);
  if (beforeLines.length === afterLines.length && beforeLines.every((line, index) => line === afterLines[index])) {
    return null;
  }
  const { lines, truncated } = diffLines(beforeLines, afterLines);
  return {
    key: `vocabulary:${key}`,
    title,
    lines: onlyChanges(lines),
    ...(truncated ? { truncated } : {}),
  };
}

function orderSection(before: readonly HomeworkRecord[], after: readonly HomeworkRecord[]): DiffSection | null {
  if (before.length !== after.length || before.length === 0) return null;
  const beforeIds = before.map((homework) => homework.id);
  const afterIds = after.map((homework) => homework.id);
  const sameSet = beforeIds.every((id) => afterIds.includes(id));
  if (!sameSet) return null;
  if (beforeIds.every((id, index) => id === afterIds[index])) return null;

  const beforeLines = before.map((homework) => `${homework.id} ${homework.subject}`);
  const afterLines = after.map((homework) => `${homework.id} ${homework.subject}`);
  const { lines, truncated } = diffLines(beforeLines, afterLines);
  return {
    key: "order",
    title: "作业顺序",
    lines: onlyChanges(lines),
    ...(truncated ? { truncated } : {}),
  };
}

function buildHomeworkDiff(
  before: readonly HomeworkRecord[],
  after: readonly HomeworkRecord[],
  afterById: Map<string, HomeworkRecord>,
  beforeById: Map<string, HomeworkRecord>,
): { lines: DiffLine[]; truncated: boolean } {
  const beforeStart = new Map<string, number>();
  let cursor = 0;
  for (const homework of before) {
    beforeStart.set(homework.id, cursor);
    cursor += homeworkLines(homework).length;
  }
  const afterStart = new Map<string, number>();
  cursor = 0;
  for (const homework of after) {
    afterStart.set(homework.id, cursor);
    cursor += homeworkLines(homework).length;
  }

  const lines: DiffLine[] = [];
  let truncated = false;
  const append = (chunk: { lines: DiffLine[]; truncated: boolean }) => {
    for (const line of chunk.lines) {
      if (lines.length >= MAX_SECTION_LINES) {
        truncated = true;
        return;
      }
      lines.push(line);
    }
    truncated = truncated || chunk.truncated;
  };
  const markBlockStart = (startIndex: number) => {
    if (startIndex < lines.length) lines[startIndex] = { ...lines[startIndex], startsHomework: true };
  };

  for (const homework of before) {
    if (lines.length >= MAX_SECTION_LINES) {
      truncated = true;
      break;
    }
    const target = afterById.get(homework.id);
    const ownLines = homeworkLines(homework);
    const oldOffset = beforeStart.get(homework.id) ?? 0;
    const blockStart = lines.length;

    if (!target) {
      ownLines.forEach((text, index) => {
        if (lines.length < MAX_SECTION_LINES) {
          lines.push({ kind: "remove", oldLine: oldOffset + index + 1, newLine: null, text: truncateLine(text) });
        } else {
          truncated = true;
        }
      });
      markBlockStart(blockStart);
      continue;
    }

    const targetLines = homeworkLines(target);
    append(diffLines(ownLines, targetLines, oldOffset, afterStart.get(homework.id) ?? 0));
    markBlockStart(blockStart);
  }

  // 按快照顺序补上新增的作业。
  for (const homework of after) {
    if (lines.length >= MAX_SECTION_LINES) {
      truncated = true;
      break;
    }
    if (beforeById.has(homework.id)) continue;
    const newOffset = afterStart.get(homework.id) ?? 0;
    const blockStart = lines.length;
    homeworkLines(homework).forEach((text, index) => {
      if (lines.length < MAX_SECTION_LINES) {
        lines.push({ kind: "add", oldLine: null, newLine: newOffset + index + 1, text: truncateLine(text) });
      } else {
        truncated = true;
      }
    });
    markBlockStart(blockStart);
  }

  return { lines: visibleLines(lines), truncated };
}

function onlyChanges(lines: readonly DiffLine[]): DiffLine[] {
  return lines.filter((line) => line.kind !== "context");
}

function visibleLines(lines: readonly DiffLine[]): DiffLine[] {
  const groups: DiffLine[][] = [];
  let current: DiffLine[] = [];
  for (const line of lines) {
    if (line.startsHomework && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current);

  return groups
    .filter((group) => group.some((line) => line.kind !== "context"))
    .flatMap((group) => group.filter((line) => line.kind !== "context" || line.startsHomework));
}

function diffLines(
  before: readonly string[],
  after: readonly string[],
  oldOffset = 0,
  newOffset = 0,
): { lines: DiffLine[]; truncated: boolean } {
  if (before.length > MAX_SECTION_LINES || after.length > MAX_SECTION_LINES) {
    return replacementLines(before, after, oldOffset, newOffset);
  }
  const ops = normalizeRemovalOrder(computeOps(before, after));
  return toDiffLines(ops, oldOffset, newOffset);
}

function replacementLines(
  before: readonly string[],
  after: readonly string[],
  oldOffset = 0,
  newOffset = 0,
): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  let oldLine = oldOffset;
  let newLine = newOffset;
  for (const text of before) {
    if (lines.length >= MAX_SECTION_LINES) return { lines, truncated: true };
    oldLine += 1;
    lines.push({ kind: "remove", oldLine, newLine: null, text: truncateLine(text) });
  }
  for (const text of after) {
    if (lines.length >= MAX_SECTION_LINES) return { lines, truncated: true };
    newLine += 1;
    lines.push({ kind: "add", oldLine: null, newLine, text: truncateLine(text) });
  }
  return { lines, truncated: false };
}

function toDiffLines(ops: readonly DiffOp[], oldOffset = 0, newOffset = 0): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  let oldLine = oldOffset;
  let newLine = newOffset;
  for (const op of ops) {
    if (lines.length >= MAX_SECTION_LINES) return { lines, truncated: true };
    if (op.kind === "equal") {
      oldLine += 1;
      newLine += 1;
      lines.push({ kind: "context", oldLine, newLine, text: truncateLine(op.text) });
    } else if (op.kind === "remove") {
      oldLine += 1;
      lines.push({ kind: "remove", oldLine, newLine: null, text: truncateLine(op.text) });
    } else {
      newLine += 1;
      lines.push({ kind: "add", oldLine: null, newLine, text: truncateLine(op.text) });
    }
  }
  return { lines, truncated: false };
}

function truncateLine(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;
}

function normalizeRemovalOrder(ops: readonly DiffOp[]): DiffOp[] {
  const result: DiffOp[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind !== "add") {
      result.push(ops[index]);
      index += 1;
      continue;
    }
    const adds: DiffOp[] = [];
    while (index < ops.length && ops[index].kind === "add") adds.push(ops[index++]);
    const removes: DiffOp[] = [];
    while (index < ops.length && ops[index].kind === "remove") removes.push(ops[index++]);
    result.push(...removes, ...adds);
  }
  return result;
}

function computeOps(before: readonly string[], after: readonly string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  collect(before, after, 0, before.length, 0, after.length, ops);
  return ops;
}

function collect(
  before: readonly string[],
  after: readonly string[],
  beforeOffset: number,
  beforeLength: number,
  afterOffset: number,
  afterLength: number,
  ops: DiffOp[],
): void {
  let prefix = 0;
  while (
    prefix < beforeLength &&
    prefix < afterLength &&
    before[beforeOffset + prefix] === after[afterOffset + prefix]
  ) {
    prefix += 1;
  }
  for (let index = 0; index < prefix; index += 1) ops.push({ kind: "equal", text: before[beforeOffset + index] });
  beforeOffset += prefix;
  beforeLength -= prefix;
  afterOffset += prefix;
  afterLength -= prefix;

  let suffix = 0;
  while (
    suffix < beforeLength &&
    suffix < afterLength &&
    before[beforeOffset + beforeLength - 1 - suffix] === after[afterOffset + afterLength - 1 - suffix]
  ) {
    suffix += 1;
  }
  const suffixStart = beforeOffset + beforeLength - suffix;
  beforeLength -= suffix;
  afterLength -= suffix;

  if (beforeLength === 0) {
    for (let index = 0; index < afterLength; index += 1) ops.push({ kind: "add", text: after[afterOffset + index] });
  } else if (afterLength === 0) {
    for (let index = 0; index < beforeLength; index += 1)
      ops.push({ kind: "remove", text: before[beforeOffset + index] });
  } else {
    const snake = middleSnake(before, after, beforeOffset, beforeLength, afterOffset, afterLength);
    const leftBefore = snake ? snake.beforeMid - beforeOffset : 0;
    const leftAfter = snake ? snake.afterMid - afterOffset : 0;
    const rightBefore = snake ? beforeOffset + beforeLength - snake.beforeMid : 0;
    const rightAfter = snake ? afterOffset + afterLength - snake.afterMid : 0;
    if (
      !snake ||
      (leftBefore === 0 && leftAfter === 0) ||
      (rightBefore === 0 && rightAfter === 0) ||
      (leftBefore === beforeLength && leftAfter === afterLength)
    ) {
      for (let index = 0; index < beforeLength; index += 1) {
        ops.push({ kind: "remove", text: before[beforeOffset + index] });
      }
      for (let index = 0; index < afterLength; index += 1) {
        ops.push({ kind: "add", text: after[afterOffset + index] });
      }
    } else {
      collect(before, after, beforeOffset, leftBefore, afterOffset, leftAfter, ops);
      collect(before, after, snake.beforeMid, rightBefore, snake.afterMid, rightAfter, ops);
    }
  }

  for (let index = 0; index < suffix; index += 1) ops.push({ kind: "equal", text: before[suffixStart + index] });
}

function middleSnake(
  before: readonly string[],
  after: readonly string[],
  beforeOffset: number,
  beforeLength: number,
  afterOffset: number,
  afterLength: number,
): { beforeMid: number; afterMid: number } | null {
  const maxDistance = Math.ceil((beforeLength + afterLength) / 2);
  const offset = maxDistance + 1;
  const size = 2 * maxDistance + 3;
  const forward = new Int32Array(size).fill(-1);
  const backward = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  backward[offset + 1] = 0;
  const delta = beforeLength - afterLength;
  const forwardIsFront = delta % 2 !== 0;
  let forwardStart = 0;
  let forwardEnd = 0;
  let backwardStart = 0;
  let backwardEnd = 0;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let diagonal = -distance + forwardStart; diagonal <= distance - forwardEnd; diagonal += 2) {
      const slot = offset + diagonal;
      let x: number;
      if (diagonal === -distance || (diagonal !== distance && forward[slot - 1] < forward[slot + 1])) {
        x = forward[slot + 1];
      } else {
        x = forward[slot - 1] + 1;
      }
      let y = x - diagonal;
      while (x < beforeLength && y < afterLength && before[beforeOffset + x] === after[afterOffset + y]) {
        x += 1;
        y += 1;
      }
      forward[slot] = x;
      if (x > beforeLength) {
        forwardEnd += 2;
      } else if (y > afterLength) {
        forwardStart += 2;
      } else if (forwardIsFront) {
        const mirror = offset + delta - diagonal;
        if (mirror >= 0 && mirror < size && backward[mirror] !== -1) {
          const mirroredX = beforeLength - backward[mirror];
          if (x >= mirroredX) return { beforeMid: beforeOffset + x, afterMid: afterOffset + y };
        }
      }
    }

    for (let diagonal = -distance + backwardStart; diagonal <= distance - backwardEnd; diagonal += 2) {
      const slot = offset + diagonal;
      let x: number;
      if (diagonal === -distance || (diagonal !== distance && backward[slot - 1] < backward[slot + 1])) {
        x = backward[slot + 1];
      } else {
        x = backward[slot - 1] + 1;
      }
      let y = x - diagonal;
      while (
        x < beforeLength &&
        y < afterLength &&
        before[beforeOffset + beforeLength - x - 1] === after[afterOffset + afterLength - y - 1]
      ) {
        x += 1;
        y += 1;
      }
      backward[slot] = x;
      if (x > beforeLength) {
        backwardEnd += 2;
      } else if (y > afterLength) {
        backwardStart += 2;
      } else if (!forwardIsFront) {
        const mirror = offset + delta - diagonal;
        if (mirror >= 0 && mirror < size && forward[mirror] !== -1) {
          const forwardX = forward[mirror];
          const forwardY = offset + forwardX - mirror;
          const mirroredX = beforeLength - x;
          if (forwardX >= mirroredX) return { beforeMid: beforeOffset + forwardX, afterMid: afterOffset + forwardY };
        }
      }
    }
  }
  return null;
}
