import type { HomeworkContent } from "./homework-content";

export type HomeworkRecord = {
  id: string;
  content: HomeworkContent | string;
  subject: string;
  dueTime: string;
  tags: string[];
  firstExpiredShowTime: string | null;
};

export type LegacyHomeworkRecord = Omit<HomeworkRecord, "content"> & { content: string | HomeworkContent };

export type AppSettings = {
  title: string;
  subjects: string[];
  tags: string[];
  autoOutwork: boolean;
  delayedCleanupEnabled: boolean;
  isExpiredMarkEnabled: boolean;
  expiredMarkColor: string;
  maxPanelWidth: number;
};

export type AppData = {
  schemaVersion: 1;
  homeworks: HomeworkRecord[];
  settings: AppSettings;
};

export type LegacyImportResult = {
  data: AppData;
  legacyRichTextCount: number;
  removedTagReferenceCount: number;
  replacedSubjectCount: number;
};

export function createDefaultAppData(): AppData {
  return {
    schemaVersion: 1,
    homeworks: [],
    settings: {
      title: "作业",
      subjects: [],
      tags: [],
      autoOutwork: true,
      delayedCleanupEnabled: false,
      isExpiredMarkEnabled: false,
      expiredMarkColor: "#333333",
      maxPanelWidth: 350,
    },
  };
}
