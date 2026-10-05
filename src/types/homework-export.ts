import type { SubjectGroup } from "./homework-board";

export type HomeworkExportLayout = "board" | "long-image";

export type HomeworkExportPixelRatio = 2 | 4 | 8;

export type HomeworkExportOptions = {
  layout: HomeworkExportLayout;
  pixelRatio: HomeworkExportPixelRatio;
  title: string;
  groups: readonly SubjectGroup[];
  maxPanelWidth: number;
};

export type HomeworkExportResult = {
  blob: Blob;
  width: number;
  height: number;
};
