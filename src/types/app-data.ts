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
  alwaysOnBottom: boolean;
  autoStart: boolean;
  backgroundOpacity: number;
  homeworkScale: number;
  glycoproteinEnabled: boolean;
  glycoproteinNodeId: string;
  windowVisible: boolean;
  windowTopmost: boolean;
  windowX: number | null;
  windowY: number | null;
  windowWidth: number | null;
  windowHeight: number | null;
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
      alwaysOnBottom: false,
      autoStart: false,
      backgroundOpacity: 100,
      homeworkScale: 100,
      glycoproteinEnabled: false,
      glycoproteinNodeId: createGlycoproteinNodeId(),
      windowVisible: true,
      windowTopmost: false,
      windowX: null,
      windowY: null,
      windowWidth: null,
      windowHeight: null,
    },
  };
}

export function createGlycoproteinNodeId(): string {
  const randomSegment = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().split("-")[1]
    : Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `stickyHomeworks-${randomSegment}`;
}
