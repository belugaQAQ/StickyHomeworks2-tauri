import { invoke, isTauri } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  level: LogLevel;
  operation: string;
  message: string;
  requestId?: string;
};

type LogEntry = LogEvent & { timestamp: string };

const MAX_BROWSER_LOG_ENTRIES = 80;
const browserLogEntries: LogEntry[] = [];
let globalErrorHandlersInstalled = false;

export function getBrowserLogEntries(): readonly LogEntry[] {
  return browserLogEntries;
}

export function installGlobalErrorHandlers(): void {
  if (globalErrorHandlersInstalled || typeof window === "undefined") return;
  globalErrorHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    logError("frontend.unhandled-error", event.error ?? `${event.message}${location}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logError("frontend.unhandled-rejection", event.reason);
  });
}

export function createRequestId(operation: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${operation}-${Date.now().toString(36)}-${suffix}`;
}

export function logError(operation: string, error: unknown, requestId = createRequestId(operation)): string {
  void logEvent({ level: "error", operation, message: errorMessage(error), requestId });
  return requestId;
}

export function logWarn(operation: string, message: string, requestId?: string): void {
  void logEvent({ level: "warn", operation, message, requestId });
}

export function logInfo(operation: string, message: string, requestId?: string): void {
  void logEvent({ level: "info", operation, message, requestId });
}

async function logEvent(event: LogEvent): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("log_event", { event });
    } catch (error) {
      if (import.meta.env.DEV) console.warn("日志持久化失败", error);
    }
    return;
  }

  browserLogEntries.push({ ...event, timestamp: new Date().toISOString() });
  if (browserLogEntries.length > MAX_BROWSER_LOG_ENTRIES) browserLogEntries.shift();
  const consoleMethod = event.level === "error" ? console.error : event.level === "warn" ? console.warn : event.level === "debug" ? console.debug : console.info;
  consoleMethod(`[${event.operation}] ${event.message}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown error"; }
}
