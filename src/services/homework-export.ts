import { domToBlob } from "modern-screenshot";
import { distributeMasonry, type MasonryItem } from "../composables/masonryDistribution";
import { saveHomeworkExportToFile } from "./platform-adapter";
import type { SubjectGroup } from "../types/homework-board";
import type {
  HomeworkExportOptions,
  HomeworkExportResult,
} from "../types/homework-export";
import "../styles/homework-export.css";

const BOARD_PADDING = 48;
const BOARD_COLUMN_GAP = 24;
const BOARD_GROUP_GAP = 36;
const BOARD_COLUMN_WIDTH = 480;
const BOARD_MIN_HEIGHT = 270;
const MAX_CANVAS_DIMENSION = 16384;
const MAX_CANVAS_AREA = 268_435_456;
const IMAGE_DECODE_TIMEOUT_MS = 5_000;
const FAILURE_IMAGE_DATA_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='96' viewBox='0 0 160 96'%3E%3Crect width='160' height='96' fill='%23d9d9d9'/%3E%3Cpath d='m38 68 25-25 18 18 12-12 29 29H38Z' fill='%23808080'/%3E%3Ccircle cx='98' cy='34' r='8' fill='%23808080'/%3E%3C/svg%3E";

type ExportColors = {
  background: string;
  surface: string;
  onBackground: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  expired: string;
};

type MeasuredGroup = MasonryItem & {
  group: SubjectGroup;
  element: HTMLElement;
};

export async function exportHomeworkImage(options: HomeworkExportOptions): Promise<HomeworkExportResult> {
  if (typeof document === "undefined") throw new Error("当前环境不支持图片导出。");

  const colors = readExportColors();
  const root = createExportRoot(options, colors);
  document.body.append(root);

  try {
    await waitForFonts();
    await prepareImages(root);
    await buildLayout(root, options);

    const cssWidth = Math.ceil(root.getBoundingClientRect().width || root.offsetWidth);
    const cssHeight = Math.ceil(root.getBoundingClientRect().height || root.offsetHeight);
    const pixelWidth = Math.ceil(cssWidth * options.pixelRatio);
    const pixelHeight = Math.ceil(cssHeight * options.pixelRatio);
    assertCanvasSize(pixelWidth, pixelHeight);

    const blob = await domToBlob(root, {
      width: cssWidth,
      height: cssHeight,
      scale: options.pixelRatio,
      type: "image/png",
      backgroundColor: colors.background,
      font: false,
      fetch: { placeholderImage: FAILURE_IMAGE_DATA_URL },
    });

    return { blob, width: pixelWidth, height: pixelHeight };
  } finally {
    root.remove();
  }
}

export async function saveHomeworkExport(
  result: HomeworkExportResult,
  filename: string,
): Promise<boolean> {
  const safeFilename = sanitizeFilename(filename);
  const tauriSaved = await saveHomeworkExportToFile(result.blob, safeFilename);
  if (tauriSaved !== null) return tauriSaved;

  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

export function createHomeworkExportFilename(title: string, date = new Date()): string {
  const safeTitle = sanitizeFilename(title.trim() || "作业").replace(/\.png$/i, "") || "作业";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${safeTitle}-${year}-${month}-${day}.png`;
}

function createExportRoot(options: HomeworkExportOptions, colors: ExportColors): HTMLDivElement {
  const root = document.createElement("div");
  const outerWidth = options.layout === "board" ? BOARD_COLUMN_WIDTH : normalizePanelWidth(options.maxPanelWidth);
  const contentWidth = options.layout === "board"
    ? Math.max(1, BOARD_COLUMN_WIDTH - BOARD_PADDING * 2)
    : Math.max(1, outerWidth - BOARD_PADDING * 2);
  root.className = `homework-export-root homework-export-root--${options.layout}`;
  root.style.width = `${outerWidth}px`;
  root.style.minHeight = options.layout === "board" ? `${BOARD_MIN_HEIGHT}px` : "0";
  root.style.setProperty("--export-panel-width", `${contentWidth}px`);
  root.style.setProperty("--export-column-count", "1");
  root.style.setProperty("--export-background", colors.background);
  root.style.setProperty("--export-surface", colors.surface);
  root.style.setProperty("--export-on-background", colors.onBackground);
  root.style.setProperty("--export-on-surface", colors.onSurface);
  root.style.setProperty("--export-on-surface-variant", colors.onSurfaceVariant);
  root.style.setProperty("--export-outline", colors.outline);
  root.style.setProperty("--export-expired-color", colors.expired);

  const header = document.createElement("header");
  header.className = "homework-export-header";
  const title = document.createElement("h1");
  title.className = "homework-export-title";
  title.textContent = options.title.trim() || "作业";
  const date = document.createElement("time");
  date.className = "homework-export-date";
  date.dateTime = formatLocalDate(new Date());
  date.textContent = date.dateTime;
  header.append(title, date);

  const board = document.createElement("div");
  board.className = "homework-export-board";
  root.append(header, board);
  return root;
}

async function buildLayout(root: HTMLDivElement, options: HomeworkExportOptions): Promise<void> {
  const board = root.querySelector<HTMLElement>(".homework-export-board");
  if (!board) throw new Error("无法创建作业图片布局。");

  const panelWidth = options.layout === "board"
    ? Math.max(1, BOARD_COLUMN_WIDTH - BOARD_PADDING * 2)
    : Math.max(1, normalizePanelWidth(options.maxPanelWidth) - 48);
  root.style.setProperty("--export-panel-width", `${panelWidth}px`);

  if (options.layout === "long-image") {
    const column = document.createElement("div");
    column.className = "homework-export-column";
    for (const group of options.groups) column.append(createGroupElement(group));
    board.append(column);
    await waitForLayout();
    return;
  }

  const measure = document.createElement("div");
  measure.className = "homework-export-measure";
  const measuredGroups: MeasuredGroup[] = options.groups.map((group) => {
    const element = createGroupElement(group);
    measure.append(element);
    return { key: group.id, height: 0, group, element };
  });
  root.append(measure);
  await waitForLayout();
  for (const item of measuredGroups) item.height = item.element.offsetHeight;

  const tallestGroupHeight = measuredGroups.reduce((height, item) => Math.max(height, item.height), 0);
  const header = root.querySelector<HTMLElement>(".homework-export-header");
  const headerStyles = header ? getComputedStyle(header) : null;
  const headerHeight = (header?.offsetHeight ?? 0) + (headerStyles ? Number.parseFloat(headerStyles.marginBottom) || 0 : 0);
  const boardHeight = Math.max(BOARD_MIN_HEIGHT, BOARD_PADDING * 2 + headerHeight + tallestGroupHeight);
  root.style.minHeight = `${boardHeight}px`;
  root.style.height = `${boardHeight}px`;
  const distribution = distributeMasonry(measuredGroups, Math.max(1, tallestGroupHeight), BOARD_GROUP_GAP);
  const columnCount = Math.max(1, distribution.columns.length);
  root.style.setProperty("--export-column-count", String(columnCount));
  root.style.width = `${BOARD_PADDING * 2 + columnCount * Math.max(1, BOARD_COLUMN_WIDTH - BOARD_PADDING * 2) + Math.max(0, columnCount - 1) * BOARD_COLUMN_GAP}px`;
  measure.remove();

  for (const distributedColumn of distribution.columns) {
    const column = document.createElement("div");
    column.className = "homework-export-column";
    for (const item of distributedColumn) column.append(item.element);
    board.append(column);
  }
  await waitForLayout();
}

function createGroupElement(group: SubjectGroup): HTMLElement {
  const section = document.createElement("section");
  section.className = "homework-export-group";
  section.dataset.groupId = group.id;

  const heading = document.createElement("h2");
  heading.className = "homework-export-group-title";
  heading.textContent = group.name;

  const list = document.createElement("div");
  list.className = "homework-export-group-list";
  for (const homework of group.homeworks) list.append(createHomeworkElement(homework));
  section.append(heading, list);
  return section;
}

function createHomeworkElement(homework: SubjectGroup["homeworks"][number]): HTMLElement {
  const item = document.createElement("article");
  item.className = `homework-export-item${homework.expired ? " homework-export-item--expired" : ""}`;
  if (homework.expired && homework.expiredMarkColor) {
    item.style.setProperty("--export-expired-color", homework.expiredMarkColor);
  }

  const content = document.createElement("div");
  content.className = "homework-export-content";
  const marker = document.createElement("span");
  marker.className = "homework-export-marker";
  marker.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "homework-export-text";
  text.innerHTML = homework.content;
  content.append(marker, text);
  item.append(content);

  if (homework.tags.length) {
    const tags = document.createElement("div");
    tags.className = "homework-export-tags";
    for (const tag of homework.tags) {
      const tagElement = document.createElement("span");
      tagElement.className = "homework-export-tag";
      tagElement.textContent = tag;
      tags.append(tagElement);
    }
    item.append(tags);
  }
  return item;
}

async function prepareImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>("img")];
  for (const image of images) {
    const source = image.getAttribute("src") ?? "";
    if (!isAllowedImageSource(source) || !(await decodeImage(image))) {
      replaceWithFailureImage(image);
    }
  }
}

async function decodeImage(image: HTMLImageElement): Promise<boolean> {
  try {
    if (typeof image.decode === "function") {
      await Promise.race([
        image.decode(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("图片解码超时")), IMAGE_DECODE_TIMEOUT_MS)),
      ]);
    } else if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("图片加载失败")), { once: true });
      });
    }
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  } catch {
    return false;
  }
}

function replaceWithFailureImage(image: HTMLImageElement): void {
  image.src = FAILURE_IMAGE_DATA_URL;
  image.alt = "图片加载失败";
  image.removeAttribute("srcset");
}

function isAllowedImageSource(source: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source);
}

function readExportColors(): ExportColors {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: readColor(styles, "--md-sys-color-background", "#1c1b1f"),
    surface: readColor(styles, "--md-sys-color-surface-container-low", "#211f26"),
    onBackground: readColor(styles, "--md-sys-color-on-background", "#e6e1e5"),
    onSurface: readColor(styles, "--md-sys-color-on-surface", "#e6e1e5"),
    onSurfaceVariant: readColor(styles, "--md-sys-color-on-surface-variant", "#cac4d0"),
    outline: readColor(styles, "--md-sys-color-outline-variant", "#49454f"),
    expired: readColor(styles, "--md-sys-color-error", "#ffb4ab"),
  };
}

function readColor(styles: CSSStyleDeclaration, property: string, fallback: string): string {
  const value = styles.getPropertyValue(property).trim();
  return value && value !== "transparent" ? value : fallback;
}

async function waitForFonts(): Promise<void> {
  if (typeof document.fonts !== "undefined") await document.fonts.ready;
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function assertCanvasSize(width: number, height: number): void {
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_CANVAS_AREA
  ) {
    throw new Error("图片尺寸过大，请降低导出倍率或减少作业数量");
  }
}

function normalizePanelWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 350;
}

function sanitizeFilename(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  return sanitized || "作业.png";
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
