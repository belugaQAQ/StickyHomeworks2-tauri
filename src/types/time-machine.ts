import type { HomeworkRecord } from "./app-data";

export type SnapshotSource =
  | "homework-create"
  | "homework-update"
  | "homework-delete"
  | "homework-cleanup"
  | "expiry-mark"
  | "cleanup-undo"
  | "uaf-import"
  | "legacy-import"
  | "vocabulary-update"
  | "snapshot-restore";

export type SnapshotSummary = {
  id: string;
  createdAt: number;
  source: SnapshotSource;
  homeworkCount: number;
  subjectCount: number;
  tagCount: number;
  subjects?: string[];
  tags?: string[];
  searchText?: string;
};

export type SnapshotDetail = {
  summary: SnapshotSummary;
  homeworks: HomeworkRecord[];
  subjects: string[];
  tags: string[];
};

export type SnapshotPayload = Pick<SnapshotDetail, "homeworks" | "subjects" | "tags">;
