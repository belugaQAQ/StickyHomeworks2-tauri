import type { AppData, AppSettings, HomeworkRecord } from "../types/app-data";
import { isHomeworkExpired, toTiptapHtml } from "../utils/homework-content.ts";
import { parseHomeworkContent } from "../types/homework-content";
import { uniqueVocabulary } from "./vocabulary.ts";
import type { SubjectGroup } from "../types/homework-board";

export { uniqueVocabulary } from "./vocabulary.ts";

export function localDateValue(value = new Date()) {
  return formatLocalDate(value);
}

export function toDateInputValue(value: string) {
  return value.slice(0, 10);
}

export function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeHomework(homework: HomeworkRecord): HomeworkRecord {
  return {
    ...homework,
    content: parseHomeworkContent(homework.content),
    subject: homework.subject.trim() || "其它",
    dueTime: `${toDateInputValue(homework.dueTime)}T00:00:00`,
    tags: uniqueVocabulary(homework.tags),
  };
}

export function saveHomeworkRecord(
  data: AppData,
  homework: HomeworkRecord,
  mode: "create" | "update" = "update",
): AppData {
  const normalized = normalizeHomework(homework);
  const position = data.homeworks.findIndex((item) => item.id === normalized.id);

  if (position === -1 && mode === "update") return data;

  const homeworks = [...data.homeworks];

  if (position === -1) homeworks.push(normalized);
  else homeworks.splice(position, 1, normalized);

  return {
    ...data,
    homeworks,
    settings: {
      ...data.settings,
      subjects: uniqueVocabulary([...data.settings.subjects, normalized.subject]),
      tags: uniqueVocabulary([...data.settings.tags, ...normalized.tags]),
    },
  };
}

export function removeHomeworkRecord(data: AppData, homeworkId: string): AppData {
  return {
    ...data,
    homeworks: data.homeworks.filter((homework) => homework.id !== homeworkId),
  };
}

type ExpiryMarkSettings = Pick<AppSettings, "isExpiredMarkEnabled" | "expiredMarkColor">;

/** 自动清理额外保留的天数：开启「延迟清理」时，过期作业再留一天。 */
export function expiredCleanupExtraKeepDays(settings: Pick<AppSettings, "delayedCleanupEnabled">): number {
  return settings.delayedCleanupEnabled ? 1 : 0;
}

export type RemovedHomework = {
  homework: HomeworkRecord;
  /** 清理前在 `homeworks` 里的下标，撤回时按它插回原位。 */
  index: number;
};

export type ExpiredCleanupResult = {
  /** 无需清理时返回入参本身（引用相同），便于上游判定 noop。 */
  data: AppData;
  removed: RemovedHomework[];
};

/**
 * 删掉所有已过期（按「延迟清理」设置顺延）的作业。
 * 纯前端、纯函数：不读时钟以外的外部状态，方便测试与在任意时机调用。
 */
export function pruneExpiredHomeworks(data: AppData, now = new Date()): ExpiredCleanupResult {
  const extraKeepDays = expiredCleanupExtraKeepDays(data.settings);
  const removed: RemovedHomework[] = [];
  const homeworks: HomeworkRecord[] = [];

  data.homeworks.forEach((homework, index) => {
    if (isHomeworkExpired(homework.dueTime, extraKeepDays, now)) removed.push({ homework, index });
    else homeworks.push(homework);
  });

  if (removed.length === 0) return { data, removed };
  return { data: { ...data, homeworks }, removed };
}

/** 把自动清理掉的作业按原下标插回；同 id 已存在就跳过，避免撤回后出现两份。 */
export function restoreRemovedHomeworks(data: AppData, removed: readonly RemovedHomework[]): AppData {
  if (removed.length === 0) return data;

  const existingIds = new Set(data.homeworks.map((homework) => homework.id));
  const pending = removed
    .filter((entry) => !existingIds.has(entry.homework.id))
    .sort((left, right) => left.index - right.index);
  if (pending.length === 0) return data;

  const homeworks = [...data.homeworks];
  for (const entry of pending) homeworks.splice(Math.min(entry.index, homeworks.length), 0, entry.homework);
  return { ...data, homeworks };
}

export function groupHomeworks(
  homeworks: readonly HomeworkRecord[],
  expiryMarkSettings: ExpiryMarkSettings = { isExpiredMarkEnabled: false, expiredMarkColor: "" },
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const homework of homeworks) {
    const subject = homework.subject.trim() || "其它";
    const group = groups.get(subject) ?? { id: subject, name: subject, homeworks: [] };
    group.homeworks.push({
      id: homework.id,
      content: toTiptapHtml(homework.content),
      tags: homework.tags,
      expired: expiryMarkSettings.isExpiredMarkEnabled && isHomeworkExpired(homework.dueTime),
      expiredMarkColor: expiryMarkSettings.expiredMarkColor,
    });
    groups.set(subject, group);
  }

  return [...groups.values()];
}
