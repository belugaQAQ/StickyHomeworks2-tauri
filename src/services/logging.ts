import { reactive } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogDetails = Record<string, unknown>;
export type LogEvent = { level: LogLevel; operation: string; message: string; requestId?: string; details?: LogDetails };
export type LogEntry = LogEvent & { timestamp: string };
export type LoggingStatus = { persistenceAvailable: boolean; lastError: string; failedCount: number };

const MAX_BROWSER_LOG_ENTRIES = 80;
const BROWSER_LOG_STORAGE_KEY = "stickyhomeworks2.browser-logs.v1";
const browserLogEntries: LogEntry[] = loadBrowserLogEntries();
const loggingStatus = reactive<LoggingStatus>({ persistenceAvailable: true, lastError: "", failedCount: 0 });
let globalErrorHandlersInstalled = false;
let pendingLogs: Promise<void> = Promise.resolve();

export function getBrowserLogEntries(): readonly LogEntry[] { return browserLogEntries; }
export function getLoggingStatus(): Readonly<LoggingStatus> { return loggingStatus; }
export function clearBrowserLogEntries(): void {
  browserLogEntries.length = 0;
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(BROWSER_LOG_STORAGE_KEY); } catch (error) { console.error("浏览器日志清理失败", error); }
}

export function installGlobalErrorHandlers(): void {
  if (globalErrorHandlersInstalled || typeof window === "undefined") return;
  globalErrorHandlersInstalled = true;
  window.addEventListener("error", (event) => { const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ""; void logError("frontend.error.unhandled", event.error ?? `${event.message}${location}`); });
  window.addEventListener("unhandledrejection", (event) => { void logError("frontend.rejection.unhandled", event.reason); });
}

export function createRequestId(operation: string): string { return `${operation}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
export function logError(operation: string, error: unknown, requestId = createRequestId(operation), details?: LogDetails): Promise<void> { return enqueueLog({ level: "error", operation, message: errorMessage(error), requestId, details }); }
export function logWarn(operation: string, message: string, requestId?: string, details?: LogDetails): Promise<void> { return enqueueLog({ level: "warn", operation, message, requestId, details }); }
export function logInfo(operation: string, message: string, requestId?: string, details?: LogDetails): Promise<void> { return enqueueLog({ level: "info", operation, message, requestId, details }); }
export function flushLogs(): Promise<void> { return pendingLogs; }

function enqueueLog(event: LogEvent): Promise<void> {
  pendingLogs = pendingLogs.catch(() => undefined).then(() => persistLog(event));
  return pendingLogs;
}

async function persistLog(event: LogEvent): Promise<void> {
  if (isTauri()) {
    try { await invoke("log_event", { event }); loggingStatus.persistenceAvailable = true; return; }
    catch (error) {
      loggingStatus.persistenceAvailable = false;
      loggingStatus.lastError = errorMessage(error);
      loggingStatus.failedCount += 1;
      appendBrowserEntry({ ...event, operation: "logging.persistence-failed", message: `日志持久化失败：${loggingStatus.lastError}`, details: { failedOperation: event.operation } });
      console.error("日志持久化失败", error);
      return;
    }
  }
  appendBrowserEntry(event);
  const consoleMethod = event.level === "error" ? console.error : event.level === "warn" ? console.warn : event.level === "debug" ? console.debug : console.info;
  consoleMethod(`[${event.operation}] ${event.message}`);
}

function appendBrowserEntry(event: LogEvent): void {
  browserLogEntries.push({ ...event, timestamp: new Date().toISOString() });
  while (browserLogEntries.length > MAX_BROWSER_LOG_ENTRIES) browserLogEntries.shift();
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(BROWSER_LOG_STORAGE_KEY, JSON.stringify(browserLogEntries));
  } catch (error) {
    loggingStatus.persistenceAvailable = false;
    loggingStatus.lastError = errorMessage(error);
    loggingStatus.failedCount += 1;
    console.error("浏览器日志持久化失败", error);
  }
}
function loadBrowserLogEntries(): LogEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_LOG_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.slice(-MAX_BROWSER_LOG_ENTRIES) : [];
  } catch (error) {
    console.error("浏览器日志恢复失败", error);
    return [];
  }
}
function errorMessage(error: unknown): string { if (error instanceof Error) return error.message; if (typeof error === "string") return error; try { return JSON.stringify(error); } catch { return "Unknown error"; } }
