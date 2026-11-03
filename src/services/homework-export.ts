import { domToBlob } from "modern-screenshot";
import { distributeMasonry, type MasonryItem } from "../composables/masonryDistribution";
import { saveHomeworkExportToFile } from "./platform-adapter";
import {
  UAF_PAGE_CONTENT_HEIGHT_PT,
  UAF_PAGE_HEIGHT_PT,
  UAF_PAGE_MARGIN_PT,
  UAF_PAGE_WIDTH_PT,
  UAF_WATERMARK_GAP_PT,
  UAF_WATERMARK_TEXT,
  buildUafAssignments,
  createUafPdf,
  serializeUafCsv,
} from "./uaf";
import type { UafPdfPageImage } from "./uaf";
import type { SubjectGroup } from "../types/homework-board";
import type { HomeworkExportOptions, HomeworkExportResult, HomeworkUafPdfResult } from "../types/homework-export";
import "../styles/homework-export.css";

const BOARD_PADDING = 32;
const BOARD_COLUMN_GAP = 24;
const BOARD_GROUP_GAP = 36;
const BOARD_BASE_WIDTH = 1344;
const BOARD_BASE_HEIGHT = 756;
const MAX_CANVAS_DIMENSION = 16384;
const MAX_CANVAS_AREA = 268_435_456;
const IMAGE_DECODE_TIMEOUT_MS = 5_000;
const MIN_PAGE_SEGMENT_PX = 72;
const MIN_PAGE_PROGRESS_RATIO = 0.3;
const BREAK_SELECTOR = [
  ".homework-export-header",
  ".homework-export-group",
  ".homework-export-group-list",
  ".homework-export-item",
  ".homework-export-content",
  ".homework-export-tags",
  ".homework-export-text > *",
  ".homework-export-text :is(p, li, h1, h2, h3, h4, blockquote, pre, img)",
].join(",");
const FAILURE_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='96' viewBox='0 0 160 96'%3E%3Crect width='160' height='96' fill='%23d9d9d9'/%3E%3Cpath d='m38 68 25-25 18 18 12-12 29 29H38Z' fill='%23808080'/%3E%3Ccircle cx='98' cy='34' r='8' fill='%23808080'/%3E%3C/svg%3E";

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

type RenderedExport = {
  blob: Blob;
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  background: string;
  breakCandidates: number[];
};

export async function exportHomeworkImage(options: HomeworkExportOptions): Promise<HomeworkExportResult> {
  if (typeof document === "undefined") throw new Error("当前环境不支持图片导出。");
  if (options.layout === "uaf-pdf") throw new Error("UAF PDF 不支持导出为图片。");

  const rendered = await renderExportImage(options);
  return { blob: rendered.blob, width: rendered.pixelWidth, height: rendered.pixelHeight };
}

export async function exportHomeworkUafPdf(options: HomeworkExportOptions): Promise<HomeworkUafPdfResult> {
  if (typeof document === "undefined") throw new Error("当前环境不支持 PDF 导出。");

  const csv = serializeUafCsv(buildUafAssignments(options.groups));
  const rendered = await renderExportImage(options, { collectBreakCandidates: true });
  const breaks = computePageBreaks(rendered.breakCandidates, rendered.cssHeight, UAF_PAGE_CONTENT_HEIGHT_PT);
  const pages = await sliceRenderedPages(rendered, breaks);
  const bytes = await createUafPdf({
    pages,
    csv,
    title: options.title.trim() || "作业",
    backgroundColor: rendered.background,
  });
  return { bytes, pageWidth: UAF_PAGE_WIDTH_PT, pageHeight: UAF_PAGE_HEIGHT_PT, pageCount: pages.length };
}

async function renderExportImage(
  options: HomeworkExportOptions,
  renderOptions: { collectBreakCandidates?: boolean } = {},
): Promise<RenderedExport> {
  const colors = readExportColors();
  const root = createExportRoot(options, colors);
  document.body.append(root);

  try {
    await waitForFonts();
    await buildLayout(root, options);
    await prepareImages(root);
    await waitForM3eComponents(root);

    const cssWidth = Math.ceil(root.getBoundingClientRect().width || root.offsetWidth);
    const cssHeight = Math.ceil(root.getBoundingClientRect().height || root.offsetHeight);
    const scale = resolveRenderScale(options, cssWidth, cssHeight);
    const pixelWidth = Math.ceil(cssWidth * scale);
    const pixelHeight = Math.ceil(cssHeight * scale);
    assertCanvasSize(pixelWidth, pixelHeight);

    const breakCandidates = renderOptions.collectBreakCandidates ? collectBreakCandidates(root, cssHeight) : [];

    const blob = await domToBlob(root, {
      width: cssWidth,
      height: cssHeight,
      scale,
      type: "image/png",
      backgroundColor: colors.background,
      font: false,
      fetch: { placeholderImage: FAILURE_IMAGE_DATA_URL },
    });

    return { blob, cssWidth, cssHeight, pixelWidth, pixelHeight, background: colors.background, breakCandidates };
  } finally {
    root.remove();
  }
}

function resolveRenderScale(options: HomeworkExportOptions, cssWidth: number, cssHeight: number): number {
  const desired = options.pixelRatio;
  if (options.layout !== "uaf-pdf") return desired;
  for (let scale = desired; scale > 1; scale -= 1) {
    if (isCanvasWithinLimits(cssWidth * scale, cssHeight * scale)) return scale;
  }
  return 1;
}

function isCanvasWithinLimits(width: number, height: number): boolean {
  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  return (
    pixelWidth > 0 &&
    pixelHeight > 0 &&
    pixelWidth <= MAX_CANVAS_DIMENSION &&
    pixelHeight <= MAX_CANVAS_DIMENSION &&
    pixelWidth * pixelHeight <= MAX_CANVAS_AREA
  );
}

function collectBreakCandidates(root: HTMLElement, cssHeight: number): number[] {
  const rootRect = root.getBoundingClientRect();
  const candidates = new Set<number>();
  for (const element of root.querySelectorAll<HTMLElement>(BREAK_SELECTOR)) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const top = Math.round(rect.top - rootRect.top);
    const bottom = Math.round(rect.bottom - rootRect.top);
    if (top > 0 && top < cssHeight) candidates.add(top);
    if (bottom > 0 && bottom < cssHeight) candidates.add(bottom);
  }
  return [...candidates].sort((left, right) => left - right);
}

function computePageBreaks(candidates: readonly number[], cssHeight: number, maxSegment: number): number[] {
  const segmentLimit = Math.max(1, maxSegment);
  const points = [...new Set([0, ...candidates, cssHeight])]
    .filter((value) => value >= 0 && value <= cssHeight)
    .sort((left, right) => left - right);

  const breaks: number[] = [0];
  let cursor = 0;
  let guard = 0;
  // 留给水印的空白
  const tailAllowance = segmentLimit + UAF_WATERMARK_GAP_PT;
  while (cssHeight - cursor > tailAllowance) {
    const limit = cursor + segmentLimit;
    let next = -1;
    for (const point of points) {
      if (point <= cursor) continue;
      if (point > limit) break;
      next = point;
    }
    // 没找到安全切点时，退回硬切。
    if (next <= cursor || next < cursor + segmentLimit * MIN_PAGE_PROGRESS_RATIO) next = limit;
    breaks.push(next);
    cursor = next;
    guard += 1;
    if (guard > 500) throw new Error("作业内容过多，无法自动分页。");
  }

  const last = breaks[breaks.length - 1];
  if (cssHeight - last > 0) {
    const previous = breaks.length > 1 ? breaks[breaks.length - 2] : 0;
    const merged = cssHeight - previous;
    const canMerge = breaks.length > 1 && cssHeight - last < MIN_PAGE_SEGMENT_PX && merged <= tailAllowance;
    if (canMerge) breaks[breaks.length - 1] = cssHeight;
    else breaks.push(cssHeight);
  }

  return breaks;
}

async function sliceRenderedPages(
  rendered: RenderedExport,
  breaks: readonly number[],
): Promise<UafPdfPageImage[]> {
  const png = new Uint8Array(await rendered.blob.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
  try {
    const scaleY = bitmap.height / rendered.cssHeight;
    const pages: UafPdfPageImage[] = [];
    for (let index = 0; index < breaks.length - 1; index += 1) {
      const top = Math.max(0, Math.min(bitmap.height, Math.round(breaks[index] * scaleY)));
      const bottom = Math.max(top, Math.min(bitmap.height, Math.round(breaks[index + 1] * scaleY)));
      const pixelHeight = bottom - top;
      if (pixelHeight <= 0) continue;

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = pixelHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前环境不支持 PDF 导出。");
      context.drawImage(bitmap, 0, top, bitmap.width, pixelHeight, 0, 0, bitmap.width, pixelHeight);
      const blob = await canvasToBlob(canvas);
      pages.push({ png: new Uint8Array(await blob.arrayBuffer()), height: pixelHeight / scaleY });
    }
    return pages;
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("生成 PDF 页面失败，请重试。"));
    }, "image/png");
  });
}

export async function saveHomeworkExport(result: HomeworkExportResult, filename: string): Promise<boolean> {
  const safeFilename = sanitizeFilename(filename);
  const tauriSaved = await saveHomeworkExportToFile(result.blob, safeFilename);
  if (tauriSaved !== null) return tauriSaved;

  downloadBlob(result.blob, safeFilename);
  return true;
}

export async function saveHomeworkUafPdf(result: HomeworkUafPdfResult, filename: string): Promise<boolean> {
  const safeFilename = sanitizeFilename(filename);
  const buffer = new ArrayBuffer(result.bytes.byteLength);
  new Uint8Array(buffer).set(result.bytes);
  const blob = new Blob([buffer], { type: "application/pdf" });

  const tauriSaved = await saveHomeworkExportToFile(blob, safeFilename, "pdf");
  if (tauriSaved !== null) return tauriSaved;

  downloadBlob(blob, safeFilename);
  return true;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createHomeworkExportFilename(
  title: string,
  date = new Date(),
  extension: "png" | "pdf" | "uaf.pdf" = "png",
): string {
  const safeTitle = sanitizeFilename(title.trim() || "作业").replace(/\.(?:uaf\.)?(?:png|pdf)$/i, "") || "作业";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${safeTitle}-${year}-${month}-${day}.${extension}`;
}

function createExportRoot(options: HomeworkExportOptions, colors: ExportColors): HTMLDivElement {
  const root = document.createElement("div");
  const configuredWidth = normalizePanelWidth(options.maxPanelWidth);
  const isUaf = options.layout === "uaf-pdf";
  const outerWidth = isUaf ? UAF_PAGE_WIDTH_PT : options.layout === "board" ? BOARD_BASE_WIDTH : configuredWidth;
  const contentWidth = isUaf
    ? UAF_PAGE_WIDTH_PT - UAF_PAGE_MARGIN_PT * 2
    : options.layout === "board"
      ? configuredWidth
      : Math.max(1, outerWidth - BOARD_PADDING * 2);
  root.className = `homework-export-root homework-export-root--${options.layout}`;
  root.style.width = `${outerWidth}px`;
  root.style.minHeight = options.layout === "board" ? `${BOARD_BASE_HEIGHT}px` : "0";
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
  if (options.layout === "long-image") {
    title.style.width = "max-content";
    const minimumWidth = Math.ceil(title.getBoundingClientRect().width + date.getBoundingClientRect().width + 24 + 48);
    const longImageWidth = Math.max(configuredWidth, minimumWidth);
    root.style.width = `${longImageWidth}px`;
    root.style.setProperty("--export-panel-width", `${Math.max(1, longImageWidth - 48)}px`);
  }
  if (isUaf) {
    // 水印
    const watermark = document.createElement("div");
    watermark.className = "homework-export-watermark";
    watermark.textContent = UAF_WATERMARK_TEXT;
    root.append(watermark);
  }
  return root;
}

async function buildLayout(root: HTMLDivElement, options: HomeworkExportOptions): Promise<void> {
  const board = root.querySelector<HTMLElement>(".homework-export-board");
  if (!board) throw new Error("无法创建作业图片布局。");

  const panelWidth =
    options.layout === "board"
      ? normalizePanelWidth(options.maxPanelWidth)
      : options.layout === "uaf-pdf"
        ? UAF_PAGE_WIDTH_PT - UAF_PAGE_MARGIN_PT * 2
        : Math.max(1, normalizePanelWidth(options.maxPanelWidth) - BOARD_PADDING * 2);
  root.style.setProperty("--export-panel-width", `${panelWidth}px`);

  if (options.layout !== "board") {
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
  const headerHeight =
    (header?.offsetHeight ?? 0) + (headerStyles ? Number.parseFloat(headerStyles.marginBottom) || 0 : 0);
  const baseContentHeight = BOARD_BASE_HEIGHT - BOARD_PADDING * 2 - headerHeight;
  const boardHeight = Math.max(BOARD_BASE_HEIGHT, BOARD_PADDING * 2 + headerHeight + tallestGroupHeight);
  root.style.minHeight = `${boardHeight}px`;
  root.style.height = `${boardHeight}px`;
  const distribution = distributeMasonry(
    measuredGroups,
    Math.max(1, Math.max(baseContentHeight, tallestGroupHeight)),
    BOARD_GROUP_GAP,
  );
  const columnCount = Math.max(1, distribution.columns.length);
  root.style.setProperty("--export-column-count", String(columnCount));
  const naturalWidth = BOARD_PADDING * 2 + columnCount * panelWidth + Math.max(0, columnCount - 1) * BOARD_COLUMN_GAP;
  root.style.width = `${Math.max(BOARD_BASE_WIDTH, naturalWidth)}px`;
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
      const tagElement = document.createElement("m3e-chip");
      tagElement.setAttribute("variant", "outlined");
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
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("图片解码超时")), IMAGE_DECODE_TIMEOUT_MS),
        ),
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

async function waitForM3eComponents(root: HTMLElement): Promise<void> {
  const components = [...root.querySelectorAll<HTMLElement>("m3e-chip")];
  await Promise.all(
    components.map((component) => {
      const updateComplete = (component as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
      return updateComplete ?? Promise.resolve();
    }),
  );
  await waitForLayout();
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
