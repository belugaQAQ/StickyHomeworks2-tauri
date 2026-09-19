import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppSettings } from "../types/app-data";
import { createRequestId } from "./logging";

export const glycoproteinStatusEvent = "glycoprotein-status-changed";
export const glycoproteinWindowSettingsEvent = "glycoprotein-window-settings-changed";

export type GlycoproteinStatus = {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  nodeId: string;
  socketDirectory: string | null;
  lastError: string | null;
};

export type GlycoproteinWindowSettingsPatch = Partial<Pick<
  AppSettings,
  | "title"
  | "alwaysOnBottom"
  | "windowVisible"
  | "windowTopmost"
  | "windowX"
  | "windowY"
  | "windowWidth"
  | "windowHeight"
>>;

const unsupportedStatus: GlycoproteinStatus = {
  supported: false,
  enabled: false,
  running: false,
  nodeId: "",
  socketDirectory: null,
  lastError: null,
};

export async function initializeGlycoprotein(): Promise<GlycoproteinStatus> {
  if (!isTauri()) return unsupportedStatus;
  return invoke<GlycoproteinStatus>("initialize_glycoprotein", {
    requestId: createRequestId("glycoprotein.initialize"),
  });
}

export async function getGlycoproteinStatus(): Promise<GlycoproteinStatus> {
  if (!isTauri()) return unsupportedStatus;
  return invoke<GlycoproteinStatus>("glycoprotein_status");
}

export async function listenGlycoproteinStatus(
  handler: (status: GlycoproteinStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<GlycoproteinStatus>(glycoproteinStatusEvent, ({ payload }) => handler(payload));
}

export async function listenGlycoproteinWindowSettings(
  handler: (patch: GlycoproteinWindowSettingsPatch) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<GlycoproteinWindowSettingsPatch>(glycoproteinWindowSettingsEvent, ({ payload }) => handler(payload));
}
