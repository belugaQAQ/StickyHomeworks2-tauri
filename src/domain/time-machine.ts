import type { SnapshotSource, SnapshotSummary } from "../types/time-machine.ts";

export type SnapshotDayGroup = {
  key: string;
  label: string;
  snapshots: SnapshotSummary[];
};

const SOURCE_LABELS: Record<SnapshotSource, string> = {
  "homework-create": "添加作业",
  "homework-update": "修改作业",
  "homework-delete": "删除作业",
  "homework-cleanup": "清理过期作业",
  "expiry-mark": "记录过期展示时间",
  "cleanup-undo": "撤回清理",
  "uaf-import": "UAF 导入",
  "legacy-import": "旧版导入",
  "vocabulary-update": "修改词库",
  "snapshot-restore": "时间机器恢复",
};

export function snapshotSourceLabel(source: SnapshotSource): string {
  return SOURCE_LABELS[source];
}

export function formatSnapshotTime(timestamp: number, withDate = false): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "";
  const clock = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return withDate ? `${formatLocalDay(value)} ${clock}` : clock;
}

export function groupSnapshotsByDay(snapshots: readonly SnapshotSummary[], now = new Date()): SnapshotDayGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = new Map<string, SnapshotDayGroup>();
  for (const snapshot of snapshots) {
    const date = new Date(snapshot.createdAt);
    const key = Number.isNaN(date.getTime()) ? "" : formatLocalDay(date);
    const existing = groups.get(key);
    if (existing) {
      existing.snapshots.push(snapshot);
      continue;
    }
    groups.set(key, { key, label: dayLabel(date, today, yesterday), snapshots: [snapshot] });
  }
  return [...groups.values()];
}

function dayLabel(date: Date, today: Date, yesterday: Date): string {
  if (Number.isNaN(date.getTime())) return "未知时间";
  if (date.getTime() >= today.getTime()) return "今天";
  if (date.getTime() >= yesterday.getTime()) return "昨天";
  return formatLocalDay(date);
}

export function formatLocalDay(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
