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

export type RemovedHomework = {
  homework: HomeworkRecord;
  index: number;
};

export type ExpiredCleanupPlan = {
  data: AppData;
  removed: RemovedHomework[];
  markedCount: number;
};

/**
 * 计算过期清理
 * 作业过期后先记录firstExpiredShowTime
 */
export function pruneExpiredHomeworks(
  data: AppData,
  now = new Date(),
  protectedId: string | null = null,
): ExpiredCleanupPlan {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const delayed = data.settings.delayedCleanupEnabled;
  const removed: RemovedHomework[] = [];
  const homeworks: HomeworkRecord[] = [];
  let markedCount = 0;

  data.homeworks.forEach((homework, index) => {
    if (homework.id === protectedId || !isHomeworkExpired(homework.dueTime, now)) {
      homeworks.push(homework);
      return;
    }
    if (!delayed) {
      removed.push({ homework, index });
      return;
    }

    const firstShownAt = homework.firstExpiredShowTime ? Date.parse(homework.firstExpiredShowTime) : Number.NaN;
    const firstShown = Number.isFinite(firstShownAt) ? new Date(firstShownAt) : null;
    const firstShownDay =
      firstShown === null
        ? Number.NaN
        : new Date(firstShown.getFullYear(), firstShown.getMonth(), firstShown.getDate()).getTime();
    if (Number.isFinite(firstShownDay) && firstShownDay < todayStart) {
      removed.push({ homework, index });
      return;
    }
    if (firstShown === null) {
      markedCount += 1;
      homeworks.push({ ...homework, firstExpiredShowTime: now.toISOString() });
      return;
    }
    homeworks.push(homework);
  });

  if (removed.length === 0 && markedCount === 0) return { data, removed, markedCount };
  return { data: { ...data, homeworks }, removed, markedCount };
}

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
