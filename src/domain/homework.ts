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

export function saveHomeworkRecord(data: AppData, homework: HomeworkRecord): AppData {
  const normalized = normalizeHomework(homework);
  const position = data.homeworks.findIndex((item) => item.id === normalized.id);
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

export function groupHomeworks(
  homeworks: readonly HomeworkRecord[],
  expiryMarkSettings: ExpiryMarkSettings = { isExpiredMarkEnabled: false, expiredMarkColor: "" },
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const homework of homeworks) {

    const subject = homework.subject.trim() || "其它";
    const group = groups.get(subject) ?? { id: homework.id, name: subject, homeworks: [] };
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
