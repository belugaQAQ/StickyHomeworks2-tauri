import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeAppData, normalizeHomeworkRecord } from "./app-data";
import { createRequestId } from "./logging";
import type { AppData } from "../types/app-data";
import type { SnapshotDetail, SnapshotSummary } from "../types/time-machine";

const UNAVAILABLE_MESSAGE = "时间机器仅可在 Tauri 应用中使用。";

export async function listSnapshots(requestId = createRequestId("time-machine.list")): Promise<SnapshotSummary[]> {
  if (!isTauri()) throw new Error(UNAVAILABLE_MESSAGE);
  return invoke<SnapshotSummary[]>("list_time_machine_snapshots", { requestId });
}

export async function readSnapshot(
  id: string,
  requestId = createRequestId("time-machine.read"),
): Promise<SnapshotDetail> {
  if (!isTauri()) throw new Error(UNAVAILABLE_MESSAGE);
  const detail = await invoke<SnapshotDetail>("read_time_machine_snapshot", { id, requestId });
  return { ...detail, homeworks: detail.homeworks.map((homework, index) => normalizeHomeworkRecord(homework, index)) };
}

export async function restoreSnapshot(
  id: string,
  requestId = createRequestId("time-machine.restore"),
): Promise<AppData> {
  if (!isTauri()) throw new Error(UNAVAILABLE_MESSAGE);
  const data = await invoke<unknown>("restore_time_machine_snapshot", { id, requestId });
  return normalizeAppData(data);
}
