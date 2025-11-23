import { BACKLOG_AUTH_KEY, BACKLOG_ISSUES_REVISION_KEY, getBacklogAuthConfig } from "@shared/backlogConfig";
import type { BacklogAuthConfig } from "@shared/backlogConfig";
import type { BacklogIssueBuckets, BacklogIssueLite, BacklogStatusLite } from "@shared/backlogTypes";
import { storageGet, storageSet, storageRemove } from "@shared/storage";

type TopBarTask = BacklogIssueLite;

const SHADOW_HOST_ID = "backlog-manager-topbar-host";
const SPACER_ID = "backlog-manager-topbar-spacer";
const DATA_ORIGINAL_PADDING = "backlogManagerOriginalPaddingTop";
const DATA_ORIGINAL_SCROLL_PADDING = "backlogManagerOriginalScrollPaddingTop";
const DATA_OBSERVER_ACTIVE = "backlogManagerObserverActive";
const DATA_ORIGINAL_TOP = "backlogManagerOriginalTopPx";
const DATA_ORIGINAL_BODY_HEIGHT = "backlogManagerOriginalBodyHeight";
const DATA_ORIGINAL_ROOT_HEIGHT = "backlogManagerOriginalRootHeight";
const DATA_ORIGINAL_BODY_MIN_HEIGHT = "backlogManagerOriginalBodyMinHeight";
const DATA_ORIGINAL_ROOT_MIN_HEIGHT = "backlogManagerOriginalRootMinHeight";
const DATA_HEIGHT_COMPENSATED = "backlogManagerHeightCompensated";
const VIEWPORT_SHIM_EVENT = "backlogManagerViewportShim";
const STORAGE_MINIMIZED_KEY = "backlogManagerTopbarMinimized";
const STORAGE_FOCUSED_TASK_KEY = "backlogManagerFocusedTaskId";

let layoutCheckScheduled = false;
const MAX_SCAN_ELEMENTS = 1200;
const HEIGHT_OVERSIZE_TOLERANCE_PX = 4;
const SECTION_LABEL_MARGIN_TOP = 1;
const SECTION_LABEL_MARGIN_BOTTOM = 1;
const BADGE_ROW_MARGIN_TOP = 0;
const BADGE_ROW_MARGIN_BOTTOM = 2;
const BAR_ACCENT_HEIGHT_PX = 5;
const LABEL_FONT_SIZE_PX = 11;
const LABEL_LINE_HEIGHT = 1.4;
const BADGE_HEIGHT_PX = 20;
const BADGE_BORDER_RADIUS_PX = 10;
const BADGE_FONT_SIZE_PX = 10;
const FOCUSED_BADGE_HEIGHT_PX = 24;
const FOCUSED_BADGE_RADIUS_PX = 12;
const FOCUSED_BADGE_FONT_SIZE_PX = BADGE_FONT_SIZE_PX + Math.round((2 * 96) / 72);
const ESTIMATED_BAR_HEIGHT = Math.round(
  SECTION_LABEL_MARGIN_TOP +
    LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT +
    SECTION_LABEL_MARGIN_BOTTOM +
    BADGE_ROW_MARGIN_TOP +
    BADGE_HEIGHT_PX +
    BADGE_ROW_MARGIN_BOTTOM +
    BAR_ACCENT_HEIGHT_PX
);
const MINIMIZED_HEIGHT = 12;
let expandedBarHeight = ESTIMATED_BAR_HEIGHT;
let currentBarHeight = ESTIMATED_BAR_HEIGHT;
let isMinimized = false;
const STATUS_COLOR_MAP: Record<string, string> = {
  未対応: "#ed8077",
  処理中: "#4487c5",
  処理済み: "#5eb5a6",
  完了: "#a1b030"
};
const DEFAULT_STATUS_COLOR = "#dc9926";
const FOCUS_DIM_BACKGROUND = "#d4d4d8";
const FOCUS_DIM_TEXT_COLOR = "#475569";
const CAKE_EMOJI = "🎂";
const CONFETTI_COLORS = ["#f97316", "#22d3ee", "#facc15", "#a855f7", "#38bdf8", "#fb7185"] as const;
const CRACKER_CONFETTI_COLORS = ["#facc15", "#f97316", "#38bdf8", "#fb7185"] as const;
const STORAGE_LEVEL_KEY = "backlogManagerLevel";
type SectionKey = "past" | "today" | "week" | "noDue";
const SECTION_SEQUENCE: SectionKey[] = ["past", "today", "week", "noDue"];

type InteractionContext = {
  tooltip: HTMLDivElement;
  statusMenu: HTMLDivElement;
  taskRegistry: WeakMap<HTMLElement, TopBarTask>;
  shadowRoot: ShadowRoot;
  sections: Record<SectionKey, HTMLDivElement>;
  sectionContainers: Record<SectionKey, HTMLElement>;
  sectionsContainer: HTMLDivElement;
  statuses: Map<number, BacklogStatusLite[]>;
  bar: HTMLDivElement;
  preferences: {
    showTomorrowSection: boolean;
    showNoDueSection: boolean;
  };
  celebration: CelebrationElements;
  levelBadge: HTMLDivElement;
};

type CelebrationElements = {
  overlay: HTMLDivElement;
  card: HTMLDivElement;
  title: HTMLHeadingElement;
  message: HTMLParagraphElement;
  close: HTMLButtonElement;
  confettiLayer: HTMLDivElement;
  sparklesLayer: HTMLDivElement;
  confettiPieces: HTMLSpanElement[];
  sparkles: HTMLSpanElement[];
  crackerLeft: HTMLDivElement;
  crackerRight: HTMLDivElement;
  crackerPiecesLeft: HTMLSpanElement[];
  crackerPiecesRight: HTMLSpanElement[];
};

let tooltipHideTimer: number | undefined;
let tooltipShowTimer: number | undefined;
let menuHideTimer: number | undefined;
let menuCurrentBadge: HTMLButtonElement | null = null;
let menuCurrentTask: TopBarTask | null = null;
let documentClickHandlerAttached = false;
let activeStatusMenuRef: HTMLDivElement | null = null;
let latestIssueBuckets: BacklogIssueBuckets | null = null;
let issuesRefreshTimer: number | undefined;
const ISSUES_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let minimizedIndicator: HTMLDivElement | null = null;
let minimizedIndicatorContext: InteractionContext | null = null;
let pendingBarMeasurementFrame = 0;
let focusedTaskId: number | null = null;
let celebrationHideTimer: number | undefined;
let celebrationArmed = false;
let currentLevel = 1;

function isSheetsPage(): boolean {
  return location.hostname === "docs.google.com" && location.pathname.startsWith("/spreadsheets");
}

function getIndicatorHeight(): number {
  if (!minimizedIndicator || minimizedIndicator.style.display === "none") {
    return 0;
  }
  const height = minimizedIndicator.offsetHeight;
  return Number.isFinite(height) ? height : 0;
}

async function loadMinimizedState(): Promise<boolean> {
  try {
    const result = await storageGet<boolean>([STORAGE_MINIMIZED_KEY]);
    return Boolean(result[STORAGE_MINIMIZED_KEY]);
  } catch (error) {
    console.warn("Failed to load minimized state:", error);
    return false;
  }
}

async function saveMinimizedState(minimized: boolean): Promise<void> {
  try {
    await storageSet({ [STORAGE_MINIMIZED_KEY]: minimized });
  } catch (error) {
    console.warn("Failed to persist minimized state:", error);
  }
}

async function sendMessageWithRetry<T = unknown>(payload: unknown, retries = 1, backoffMs = 300): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return (await chrome.runtime.sendMessage(payload)) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canRetry = message.includes("Extension context invalidated") && attempt < retries;
      if (!canRetry) {
        throw error instanceof Error ? error : new Error(message);
      }
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
    }
  }
}

async function loadStoredLevel(): Promise<number> {
  try {
    const result = await storageGet<number | null>([STORAGE_LEVEL_KEY]);
    const stored = result[STORAGE_LEVEL_KEY];
    if (typeof stored === "number" && Number.isFinite(stored) && stored >= 1) {
      return Math.floor(stored);
    }
  } catch (error) {
    console.warn("Failed to load stored level:", error);
  }
  return 1;
}

async function saveCurrentLevel(level: number): Promise<void> {
  try {
    await storageSet({ [STORAGE_LEVEL_KEY]: level });
  } catch (error) {
    console.warn("Failed to persist level:", error);
  }
}

function parseFocusedTaskId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return null;
}

async function loadFocusedTaskId(): Promise<number | null> {
  try {
    const result = await storageGet<number | null>([STORAGE_FOCUSED_TASK_KEY]);
    return parseFocusedTaskId(result[STORAGE_FOCUSED_TASK_KEY] ?? null);
  } catch (error) {
    console.warn("Failed to load focused task id:", error);
    return null;
  }
}

function persistFocusedTaskId(taskId: number | null): void {
  if (taskId && Number.isFinite(taskId) && taskId > 0) {
    void storageSet({ [STORAGE_FOCUSED_TASK_KEY]: taskId });
  } else {
    void storageRemove([STORAGE_FOCUSED_TASK_KEY]);
  }
}

function setFocusedTask(
  context: InteractionContext | null,
  taskId: number | null,
  options: { persist?: boolean } = {}
): void {
  const shouldPersist = options.persist ?? true;
  const nextId = taskId && Number.isFinite(taskId) && taskId > 0 ? taskId : null;
  const changed = focusedTaskId !== nextId;
  focusedTaskId = nextId;
  if (shouldPersist && changed) {
    persistFocusedTaskId(nextId);
  }
  if (context) {
    applyFocusModeAppearance(context);
    scheduleBarMeasurement(context);
  }
}

function ensureShadowHost(): ShadowRoot | null {
  let host = document.getElementById(SHADOW_HOST_ID);

  if (!host) {
    host = document.createElement("div");
    host.id = SHADOW_HOST_ID;
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.right = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "auto";
    const shadowRoot = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    host.style.height = `${currentBarHeight}px`;
    host.style.display = isMinimized ? "none" : "block";
    return shadowRoot;
  }

  if (!host.shadowRoot) {
    try {
      const shadowRoot = host.attachShadow({ mode: "open" });
      host.style.height = `${currentBarHeight}px`;
      host.style.display = isMinimized ? "none" : "block";
      host.style.position = "fixed";
      host.style.top = "0";
      host.style.left = "0";
      host.style.right = "0";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "auto";
      return shadowRoot;
    } catch (error) {
      console.warn("Failed to attach shadow to existing host", error);
      return null;
    }
  }

  host.style.height = `${currentBarHeight}px`;
  host.style.display = isMinimized ? "none" : "block";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";
  return host.shadowRoot;
}

function ensurePageSpacing() {
  applyPaddingTop();
  ensureSpacer();
  observeBodyMutations();
  scheduleLayoutCheck();
}

function applyPaddingTop() {
  const body = document.body;
  const root = document.documentElement;
  const indicatorHeight = getIndicatorHeight();

  const bodyComputed = window.getComputedStyle(body);
  const rootComputed = window.getComputedStyle(root);

  const baseBodyPadding = ensureBasePadding(body, DATA_ORIGINAL_PADDING, bodyComputed.paddingTop);
  const baseScrollPadding = ensureBasePadding(root, DATA_ORIGINAL_SCROLL_PADDING, rootComputed.scrollPaddingTop);

  const effectiveHeight = isMinimized ? indicatorHeight : currentBarHeight;
  if (isSheetsPage()) {
    body.style.paddingTop = `${baseBodyPadding + effectiveHeight}px`;
    root.style.scrollPaddingTop = `${baseScrollPadding + effectiveHeight}px`;
    applyViewportShim(0);
    restoreViewportHeight(body, root);
    return;
  }

  body.style.paddingTop = `${baseBodyPadding + effectiveHeight}px`;
  root.style.scrollPaddingTop = `${baseScrollPadding + effectiveHeight}px`;

  applyViewportHeightCompensation(effectiveHeight, isMinimized, body, root, bodyComputed, rootComputed);
  applyViewportShim(effectiveHeight);
}

function ensureBasePadding(element: HTMLElement, key: string, computedValue: string): number {
  if (!element.dataset[key]) {
    element.dataset[key] = parseCssLength(computedValue).toString();
  }
  const parsed = Number(element.dataset[key] ?? "0");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCssLength(value: string): number {
  if (!value) {
    return 0;
  }
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isOverflowHidden(value: string): boolean {
  return value === "hidden" || value === "clip";
}

function applyViewportHeightCompensation(
  effectiveHeight: number,
  minimized: boolean,
  body: HTMLElement,
  root: HTMLElement,
  bodyComputed: CSSStyleDeclaration,
  rootComputed: CSSStyleDeclaration
): void {
  if (minimized) {
    restoreViewportHeight(body, root);
    return;
  }

  if (effectiveHeight <= 0) {
    restoreViewportHeight(body, root);
    return;
  }

  const rootOverflowHidden = isOverflowHidden(rootComputed.overflowY) || isOverflowHidden(rootComputed.overflow);
  const bodyOverflowHidden = isOverflowHidden(bodyComputed.overflowY) || isOverflowHidden(bodyComputed.overflow);
  if (!rootOverflowHidden && !bodyOverflowHidden) {
    restoreViewportHeight(body, root);
    return;
  }

  rememberOriginalHeight(body, DATA_ORIGINAL_BODY_HEIGHT, DATA_ORIGINAL_BODY_MIN_HEIGHT);
  rememberOriginalHeight(root, DATA_ORIGINAL_ROOT_HEIGHT, DATA_ORIGINAL_ROOT_MIN_HEIGHT);

  const heightValue = `calc(100vh - ${effectiveHeight}px)`;
  setHeightWithPriority(body, "height", heightValue);
  setHeightWithPriority(body, "minHeight", heightValue);
  setHeightWithPriority(root, "height", heightValue);
  setHeightWithPriority(root, "minHeight", heightValue);
  body.dataset[DATA_HEIGHT_COMPENSATED] = "true";
  root.dataset[DATA_HEIGHT_COMPENSATED] = "true";
}

function rememberOriginalHeight(element: HTMLElement, heightKey: string, minHeightKey: string): void {
  if (!element.dataset[DATA_HEIGHT_COMPENSATED]) {
    element.dataset[heightKey] = element.style.height || "";
    element.dataset[minHeightKey] = element.style.minHeight || "";
  }
}

function restoreViewportHeight(body: HTMLElement, root: HTMLElement): void {
  if (body.dataset[DATA_HEIGHT_COMPENSATED]) {
    restoreHeightWithPriority(body, "height", body.dataset[DATA_ORIGINAL_BODY_HEIGHT]);
    restoreHeightWithPriority(body, "minHeight", body.dataset[DATA_ORIGINAL_BODY_MIN_HEIGHT]);
    delete body.dataset[DATA_HEIGHT_COMPENSATED];
    delete body.dataset[DATA_ORIGINAL_BODY_HEIGHT];
    delete body.dataset[DATA_ORIGINAL_BODY_MIN_HEIGHT];
  }
  if (root.dataset[DATA_HEIGHT_COMPENSATED]) {
    restoreHeightWithPriority(root, "height", root.dataset[DATA_ORIGINAL_ROOT_HEIGHT]);
    restoreHeightWithPriority(root, "minHeight", root.dataset[DATA_ORIGINAL_ROOT_MIN_HEIGHT]);
    delete root.dataset[DATA_HEIGHT_COMPENSATED];
    delete root.dataset[DATA_ORIGINAL_ROOT_HEIGHT];
    delete root.dataset[DATA_ORIGINAL_ROOT_MIN_HEIGHT];
  }
}

function setHeightWithPriority(element: HTMLElement, property: "height" | "minHeight", value: string): void {
  element.style.setProperty(property, value, "important");
}

function restoreHeightWithPriority(
  element: HTMLElement,
  property: "height" | "minHeight",
  stored: string | undefined
): void {
  if (!stored) {
    element.style.removeProperty(property);
  } else {
    element.style.setProperty(property, stored);
  }
}

function applyViewportShim(effectiveHeight: number): void {
  if (effectiveHeight < 0) {
    effectiveHeight = 0;
  }
  dispatchViewportShimEvent(effectiveHeight);
}

function dispatchViewportShimEvent(offset: number): void {
  try {
    const event = new CustomEvent(VIEWPORT_SHIM_EVENT, { detail: { offset } });
    window.dispatchEvent(event);
  } catch (error) {
    console.warn("Failed to dispatch viewport shim event", error);
  }
}

function getTodayTaskCount(context: InteractionContext): number {
  const section = context.sections.today;
  if (!section) {
    return latestIssueBuckets?.today?.length ?? 0;
  }
  const badges = section.querySelectorAll<HTMLButtonElement>(".badge");
  let count = 0;
  badges.forEach((badge) => {
    const task = context.taskRegistry.get(badge);
    if (task && isTaskDueToday(task)) {
      count += 1;
    }
  });
  if (count > 0) {
    return count;
  }
  return latestIssueBuckets?.today?.length ?? 0;
}

function toLocalDateKey(date: Date): string {
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const tzAdjusted = new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().split("T")[0];
}

function getTodayDateKey(): string {
  return toLocalDateKey(new Date());
}

function isTaskDueToday(task: TopBarTask): boolean {
  if (!task.dueDate) {
    return false;
  }
  return task.dueDate === getTodayDateKey();
}

function isCompletionStatusName(name: string): boolean {
  if (!name) {
    return false;
  }
  const normalized = name.trim();
  if (!normalized) {
    return false;
  }
  return ["完了", "終了", "クローズ", "処理済"].some((keyword) => normalized.includes(keyword));
}

function ensureSpacer() {
  let spacer = document.getElementById(SPACER_ID);
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.id = SPACER_ID;
    spacer.style.width = "100%";
    spacer.style.pointerEvents = "none";
    spacer.style.background = "transparent";
    spacer.setAttribute("aria-hidden", "true");

    if (document.body.firstChild) {
      document.body.insertBefore(spacer, document.body.firstChild);
    } else {
      document.body.appendChild(spacer);
    }
  }
  spacer.style.height = "0px";
}

function observeBodyMutations() {
  const body = document.body;
  if (!body) {
    return;
  }
  if (body.dataset[DATA_OBSERVER_ACTIVE]) {
    return;
  }
  body.dataset[DATA_OBSERVER_ACTIVE] = "true";

  const observer = new MutationObserver(() => {
    ensureSpacer();
    ensurePaddingConsistency();
    scheduleLayoutCheck();
  });

  observer.observe(body, {
    childList: true,
    attributes: true,
    attributeFilter: ["style"],
    subtree: true
  });

  window.addEventListener("beforeunload", () => {
    observer.disconnect();
  });
}

function ensurePaddingConsistency() {
  const body = document.body;
  if (!body) {
    return;
  }
  applyPaddingTop();
}

function scheduleLayoutCheck() {
  if (layoutCheckScheduled) {
    return;
  }
  layoutCheckScheduled = true;
  window.requestAnimationFrame(() => {
    layoutCheckScheduled = false;
    adjustFixedAndStickyHeaders();
  });
}

function adjustFixedAndStickyHeaders() {
  if (isSheetsPage()) {
    return;
  }
  const body = document.body;
  if (!body) {
    return;
  }

  const elements = body.getElementsByTagName("*");
  const viewportWidth = window.innerWidth;

  const max = Math.min(elements.length, MAX_SCAN_ELEMENTS);
  for (let index = 0; index < max; index += 1) {
    const el = elements.item(index);
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (!el.isConnected || el.id === SHADOW_HOST_ID || el.id === SPACER_ID) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0) {
      continue;
    }
    const referenceHeight = isMinimized ? getIndicatorHeight() : currentBarHeight;
    if (rect.top > referenceHeight * 2 + 80 && !el.dataset[DATA_ORIGINAL_TOP]) {
      continue;
    }

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      continue;
    }
    if (style.position !== "fixed" && style.position !== "sticky") {
      continue;
    }

    const topValue = parseCssLength(style.top);
    if (Number.isNaN(topValue)) {
      continue;
    }
    if (!el.dataset[DATA_ORIGINAL_TOP] && !isMinimized && topValue > referenceHeight * 2 + 20) {
      continue;
    }

    if (rect.width < viewportWidth * 0.5 || rect.height < 32) {
      continue;
    }

    applyTopOffset(el, topValue);
  }
}

function applyTopOffset(element: HTMLElement, computedTop: number) {
  if (!element.dataset[DATA_ORIGINAL_TOP]) {
    element.dataset[DATA_ORIGINAL_TOP] = computedTop.toString();
  }

  const baseline = Number(element.dataset[DATA_ORIGINAL_TOP]) || 0;
  const desiredTop = baseline + (isMinimized ? getIndicatorHeight() : currentBarHeight);

  if (Math.abs(computedTop - desiredTop) > 0.5) {
    element.style.setProperty("top", `${desiredTop}px`, "important");
  }
}

function renderTopBar(
  shadowRoot: ShadowRoot,
  preferences: { showTomorrowSection: boolean; showNoDueSection: boolean }
): InteractionContext {
  shadowRoot.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    * {
      box-sizing: border-box;
    }

    .bar {
      font-family: "Inter", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      background: #333333;
      color: #f8fafc;
      padding: 0 18px ${BAR_ACCENT_HEIGHT_PX}px;
      display: flex;
      gap: 16px;
      pointer-events: auto;
      align-items: center;
      position: relative;
      transition: padding 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, height 0.2s ease;
      box-shadow: inset 0 -5px 0 0 #2c9a7a;
      width: 100%;
    }

    .bar[data-minimized="true"] {
      height: ${MINIMIZED_HEIGHT}px;
      padding: 0;
      background: #2c9a7a;
      box-shadow: none;
      gap: 0;
      cursor: pointer;
    }

    .bar[data-minimized="true"] .sections-container,
    .bar[data-minimized="true"] .actions {
      display: none;
    }

    .sections-container {
      display: flex;
      flex: 1 1 auto;
      gap: 24px;
      align-items: flex-start;
      min-width: 0;
      overflow-x: auto;
      padding-right: 4px;
      scrollbar-width: none;
    }

    .sections-container::-webkit-scrollbar {
      display: none;
    }

    .section {
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      min-width: max-content;
    }

    .section__label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #cbd5f5;
      margin: ${SECTION_LABEL_MARGIN_TOP}px 0 ${SECTION_LABEL_MARGIN_BOTTOM}px;
    }

    .badge-row {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      margin: ${BADGE_ROW_MARGIN_TOP}px 0 ${BADGE_ROW_MARGIN_BOTTOM}px;
      scrollbar-width: none;
    }

    .badge-row::-webkit-scrollbar {
      display: none;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      border-radius: ${BADGE_BORDER_RADIUS_PX}px;
      border: none;
      padding: 0 10px;
      height: ${BADGE_HEIGHT_PX}px;
      min-width: 72px;
      background: ${DEFAULT_STATUS_COLOR};
      color: #ffffff;
      font-weight: 600;
      font-size: ${BADGE_FONT_SIZE_PX}px;
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease, height 0.2s ease, font-size 0.2s ease, padding 0.2s ease, border-radius 0.2s ease;
      box-shadow: none;
    }

    .badge--focused {
      height: ${FOCUSED_BADGE_HEIGHT_PX}px;
      border-radius: ${FOCUSED_BADGE_RADIUS_PX}px;
      font-size: ${FOCUSED_BADGE_FONT_SIZE_PX}px;
      padding: 0 12px;
    }

    .badge:hover {
      filter: brightness(1.05);
      transform: translateY(-1px);
    }

    .badge[data-status="未対応"] {
      background: ${STATUS_COLOR_MAP["未対応"]};
    }

    .badge[data-status="処理中"] {
      background: ${STATUS_COLOR_MAP["処理中"]};
    }

    .badge[data-status="処理済み"] {
      background: ${STATUS_COLOR_MAP["処理済み"]};
    }

    .badge:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    .tooltip {
      position: fixed;
      z-index: 10;
      min-width: 220px;
      max-width: 320px;
      background: #1f2933;
      color: #f8fafc;
      border-radius: 12px;
      padding: 12px 14px 18px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.4);
      font-size: 12px;
      line-height: 1.5;
      display: none;
    }

    .tooltip::after {
      content: "";
      position: absolute;
      top: -8px;
      left: var(--tooltip-arrow-left, 32px);
      width: 14px;
      height: 14px;
      background: #1f2933;
      transform: rotate(45deg);
      box-shadow: -2px -2px 4px rgba(15, 23, 42, 0.25);
    }

    .tooltip__title {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 6px;
      color: #e2e8f0;
    }

    .tooltip__meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #94a3b8;
    }

    .tooltip__body {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: #f8fafc;
    }

    .status-menu {
      position: fixed;
      z-index: 11;
      background: #ffffff;
      color: #111827;
      border-radius: 12px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16);
      padding: 8px;
      min-width: 180px;
      display: none;
      font-size: 13px;
    }

    .status-menu__item {
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      color: inherit;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .status-menu__item:hover {
      background: rgba(148, 163, 184, 0.16);
    }

    .status-menu__swatch {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      margin-left: 12px;
    }

    .status-menu__item.is-active {
      background: #edf5f1;
      color: #2c997a;
      font-weight: 600;
    }

    .status-menu__action {
      font-weight: 600;
      color: #2c997a;
      justify-content: center;
    }

    .status-menu__action:hover {
      background: rgba(44, 153, 122, 0.18);
      color: #2c997a;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      margin-left: auto;
      padding: 0;
      margin: 0;
      min-height: 26px;
      align-self: center;
    }

    .actions__status {
      display: inline-flex;
      align-items: center;
      height: 26px;
      font-size: 11px;
      color: #e2e8f0;
      margin-right: 8px;
      letter-spacing: 0.04em;
    }

    .actions__level {
      margin-left: 6px;
      margin-right: 0;
      color: #34d399;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      display: inline-flex;
      flex-direction: column;
      align-items: flex-end;
      text-align: right;
      line-height: 1.3;
    }

    .actions__level-top {
      margin-top: 0;
      padding-top: 0;
      margin-bottom: 2px;
    }

    .actions__level-bottom {
      margin-top: 2px;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .actions__icon {
      border: 1px solid #e2e8f0;
      background: transparent;
      color: #e2e8f0;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
      font-size: 14px;
      line-height: 1;
    }

    .actions__icon:hover {
      background: rgba(226, 232, 240, 0.18);
      color: #ffffff;
      border-color: #a3e635;
    }

    .actions__icon:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }

    .actions__icon[data-loading="true"] {
      cursor: progress;
      opacity: 0.65;
      pointer-events: none;
    }

    .actions__icon--refresh,
    .actions__icon--minimize {
      font-size: 21px;
    }

    .actions__icon--panel {
      font-size: 0;
      position: relative;
    }

    .actions__icon-hamburger {
      display: inline-flex;
      flex-direction: column;
      gap: 3px;
      align-items: center;
      justify-content: center;
    }

    .actions__icon-hamburger-line {
      width: 12px;
      height: 2px;
      border-radius: 2px;
      background: currentColor;
      transition: background 0.2s ease;
    }

    .actions__status[data-error="true"] {
      color: #dc2626;
    }

    .section-message {
      font-size: 11px;
      color: #e2e8f0;
      padding: 4px 0;
    }

    .section-message.section-message--error {
      color: #dc2626;
    }

    .celebration {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.55);
      z-index: 2147483647;
      pointer-events: none;
    }

    .celebration[data-open="true"] {
      display: flex;
      pointer-events: auto;
    }

    .celebration__card {
      background: #ffffff;
      color: #0f172a;
      border-radius: 18px;
      padding: 36px 48px;
      max-width: 540px;
      width: calc(100% - 48px);
      text-align: center;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.35);
      animation: popIn 360ms ease forwards;
      position: relative;
      z-index: 3;
      overflow: hidden;
    }

    .celebration__title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin-bottom: 12px;
      color: #0f172a;
    }

    .celebration__message {
      font-size: 17px;
      color: #334155;
      line-height: 1.6;
      margin-bottom: 24px;
      white-space: pre-line;
    }

    .celebration__cake {
      font-size: 132px;
      margin-bottom: 16px;
      display: inline-block;
      animation: bounce 900ms ease-in-out infinite;
    }

    .celebration__close {
      border: none;
      background: #22c55e;
      color: #ffffff;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 10px 28px;
      border-radius: 999px;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(34, 197, 94, 0.45);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .celebration__close:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 24px rgba(34, 197, 94, 0.5);
    }

    .celebration__confetti,
    .celebration__sparkles {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
    }

    .celebration__confetti {
      z-index: 1;
    }

    .celebration__sparkles {
      z-index: 2;
    }

    .celebration__confetti-piece {
      position: absolute;
      width: 10px;
      height: 18px;
      border-radius: 2px;
      opacity: 0;
      animation: confettiFall 1.4s ease-out infinite;
    }

    .celebration__sparkle {
      position: absolute;
      width: 16px;
      height: 16px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0) 72%);
      filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.85));
      opacity: 0;
      animation: sparkleTwinkle 1.8s ease-in-out infinite;
    }

    @keyframes popIn {
      from {
        transform: scale(0.88);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    @keyframes bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-15px);
      }
    }

    @keyframes confettiFall {
      0% {
        transform: translate3d(var(--confetti-x, 0), -140px, 0) rotate(0deg);
        opacity: 0;
      }
      20% {
        opacity: 1;
      }
      100% {
        transform: translate3d(calc(var(--confetti-x, 0) * 1.3), 240px, 0) rotate(310deg);
        opacity: 0;
      }
    }

    @keyframes sparkleTwinkle {
      0% {
        transform: scale(0.4) translateY(0);
        opacity: 0;
      }
      30% {
        opacity: 1;
      }
      100% {
        transform: scale(1.6) translateY(48px);
        opacity: 0;
      }
    }

    .celebration__cracker {
      position: absolute;
      bottom: 16px;
      width: 120px;
      height: 160px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      pointer-events: none;
      z-index: 4;
      transform-origin: center bottom;
      animation: crackerShake 0.6s ease-in-out infinite;
      --cracker-angle: 0deg;
    }

    .celebration__cracker-body {
      font-size: 192px;
      filter: drop-shadow(0 6px 12px rgba(15, 23, 42, 0.25));
    }

    .celebration__cracker--left {
      left: 174px;
      --cracker-angle: -18deg;
    }

    .celebration__cracker--right {
      right: -26px;
      bottom: 116px;
      --cracker-angle: -75deg;
    }

    .celebration__cracker-piece {
      position: absolute;
      bottom: 32px;
      width: 8px;
      height: 14px;
      border-radius: 3px;
      opacity: 0;
      animation: crackerBurst 0.85s ease-out forwards;
    }

    @keyframes crackerShake {
      0%, 100% {
        transform: rotate(var(--cracker-angle, 0deg)) translateY(0);
      }
      50% {
        transform: rotate(calc(var(--cracker-angle, 0deg) + 6deg)) translateY(-4px);
      }
    }

    @keyframes crackerBurst {
      0% {
        transform: translate3d(0, 0, 0) rotate(0deg);
        opacity: 0;
      }
      25% {
        opacity: 1;
      }
      100% {
        transform: translate3d(var(--burst-x, 0), -140px, 0) rotate(300deg);
        opacity: 0;
      }
    }

  `;

  const bar = document.createElement("div");
  bar.className = "bar";

  const tooltip = createTooltipElement();
  const statusMenu = createStatusMenuElement();
  activeStatusMenuRef = statusMenu;
  const taskRegistry = new WeakMap<HTMLElement, TopBarTask>();
  const sections: Record<SectionKey, HTMLDivElement> = Object.create(null);
  const sectionContainers: Record<SectionKey, HTMLElement> = Object.create(null);
  const statusMap = new Map<number, BacklogStatusLite[]>();

  const sectionsContainer = document.createElement("div");
  sectionsContainer.className = "sections-container";

  const celebration = createCelebrationPopup();
  const actions = createActions();
  const refreshButton = actions.refreshButton;
  const togglePanelButton = actions.togglePanelButton;
  const minimizeButton = actions.minimizeButton;
  const levelBadge = createLevelIndicator();

  const context: InteractionContext = {
    tooltip,
    statusMenu,
    taskRegistry,
    shadowRoot,
    sections,
    sectionContainers,
    sectionsContainer,
    statuses: statusMap,
    bar,
    preferences: {
      showTomorrowSection: preferences.showTomorrowSection,
      showNoDueSection: preferences.showNoDueSection
    },
    celebration,
    levelBadge
  };
  currentContextRef = context;
  updateLevelBadge(context);

  const pastSection = createSection("期限日：過去", "past", context);
  const todaySection = createSection("期限日：今日", "today", context);
  const weekSection = createSection("期限日：今週", "week", context);
  const noDueSection = createSection("期限日：空欄", "noDue", context);

  SECTION_SEQUENCE.forEach((key) => {
    if (key === "week" && !context.preferences.showTomorrowSection) {
      return;
    }
    if (key === "noDue" && !context.preferences.showNoDueSection) {
      return;
    }
    const container = context.sectionContainers[key];
    if (container) {
      sectionsContainer.append(container);
    }
  });
  actions.container.append(levelBadge);
  bar.append(sectionsContainer, actions.container);
  shadowRoot.append(style, bar, tooltip, statusMenu, celebration.overlay);

  context.bar.dataset.minimized = isMinimized ? "true" : "false";
  updateHostHeight(currentBarHeight, isMinimized);
  scheduleBarMeasurement(context);

  enableWheelScroll(sectionsContainer);
  enableWheelScroll(pastSection.list);
  enableWheelScroll(todaySection.list);
  enableWheelScroll(weekSection.list);
  enableWheelScroll(noDueSection.list);

  refreshButton.addEventListener("click", () => {
    if (refreshButton.dataset.loading === "true") {
      return;
    }
    refreshButton.dataset.loading = "true";
    refreshButton.disabled = true;
    const result = refreshIssues(context, { showLoading: true });
    void result.finally(() => {
      delete refreshButton.dataset.loading;
      refreshButton.disabled = false;
    });
  });

  togglePanelButton.addEventListener("click", async () => {
    if (togglePanelButton.dataset.loading === "true") {
      return;
    }
    togglePanelButton.dataset.loading = "true";
    togglePanelButton.disabled = true;
    try {
      await toggleSidePanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Failed to toggle side panel:", message);
  } finally {
    delete togglePanelButton.dataset.loading;
    togglePanelButton.disabled = false;
  }
  });

  minimizeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setBarMinimized(context, true);
  });

  bar.addEventListener("click", () => {
    if (isMinimized) {
      setBarMinimized(context, false);
    }
  });

  shadowRoot.addEventListener("click", (event) => {
    const menu = activeStatusMenuRef;
    if (!menu) {
      return;
    }
    if (menu.contains(event.target as Node)) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target?.classList.contains("badge")) {
      return;
    }
    hideStatusMenu(menu);
  });

  if (!documentClickHandlerAttached) {
    document.addEventListener(
      "click",
      (event) => {
        const path = event.composedPath();
        const menu = activeStatusMenuRef;
        if (
          menu &&
          (path.includes(menu) ||
            path.some((node) => node instanceof HTMLElement && node.classList?.contains("badge"))
          )
        ) {
          return;
        }
        if (menu) {
          hideStatusMenu(menu);
        }
      },
      true
    );
    documentClickHandlerAttached = true;
  }

  return context;
}

type SectionElements = {
  container: HTMLElement;
  list: HTMLDivElement;
};

function createSection(label: string, key: SectionKey, context: InteractionContext): SectionElements {
  const container = document.createElement("section");
  container.className = "section";

  const heading = document.createElement("div");
  heading.className = "section__label";
  heading.textContent = label;

  const list = document.createElement("div");
  list.className = "badge-row";

  context.sections[key] = list;
  context.sectionContainers[key] = container;

  container.append(heading, list);
  return { container, list };
}

type ActionsElements = {
  container: HTMLDivElement;
  refreshButton: HTMLButtonElement;
  togglePanelButton: HTMLButtonElement;
  minimizeButton: HTMLButtonElement;
};

function createActions(): ActionsElements {
  const container = document.createElement("div");
  container.className = "actions";

  const refreshButton = document.createElement("button");
  refreshButton.className = "actions__icon actions__icon--refresh";
  refreshButton.type = "button";
  refreshButton.title = "課題を再取得";
  refreshButton.setAttribute("aria-label", "課題を再取得");
  refreshButton.textContent = "↻";

  const togglePanelButton = document.createElement("button");
  togglePanelButton.className = "actions__icon actions__icon--panel";
  togglePanelButton.type = "button";
  togglePanelButton.title = "サイドパネルを表示";
  togglePanelButton.setAttribute("aria-label", "サイドパネルを表示");
  const togglePanelIcon = document.createElement("span");
  togglePanelIcon.className = "actions__icon-hamburger";
  togglePanelIcon.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i += 1) {
    const line = document.createElement("span");
    line.className = "actions__icon-hamburger-line";
    togglePanelIcon.append(line);
  }
  togglePanelButton.append(togglePanelIcon);

  const minimizeButton = document.createElement("button");
  minimizeButton.className = "actions__icon actions__icon--minimize";
  minimizeButton.type = "button";
  minimizeButton.title = "バーを最小化";
  minimizeButton.setAttribute("aria-label", "バーを最小化");
  minimizeButton.textContent = "×";

  container.append(refreshButton, togglePanelButton, minimizeButton);
  return { container, refreshButton, togglePanelButton, minimizeButton };
}

function createLevelIndicator(): HTMLDivElement {
  const badge = document.createElement("div");
  badge.className = "actions__level";
  badge.innerHTML = `<span class="actions__level-top">Backlog</span><span class="actions__level-bottom">Lv.${currentLevel}</span>`;
  return badge;
}

function createTooltipElement(): HTMLDivElement {
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.setAttribute("role", "tooltip");

  const title = document.createElement("h3");
  title.className = "tooltip__title";
  const meta = document.createElement("div");
  meta.className = "tooltip__meta";
  const body = document.createElement("p");
  body.className = "tooltip__body";

  tooltip.append(title, meta, body);
  return tooltip;
}

let menuCurrentContext: InteractionContext | null = null;

function createCelebrationPopup(): CelebrationElements {
  const overlay = document.createElement("div");
  overlay.className = "celebration";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-live", "assertive");

  const confettiLayer = document.createElement("div");
  confettiLayer.className = "celebration__confetti";

  const sparklesLayer = document.createElement("div");
  sparklesLayer.className = "celebration__sparkles";

  const card = document.createElement("div");
  card.className = "celebration__card";

  const cake = document.createElement("div");
  cake.className = "celebration__cake";
  cake.textContent = CAKE_EMOJI;

  const title = document.createElement("h2");
  title.className = "celebration__title";
  title.textContent = "Congratulations!!";

  const message = document.createElement("p");
  message.className = "celebration__message";
  message.textContent = `本日のタスクを全て処理し、Lv.${currentLevel}に上がりました！\nこの調子でがんばりましょう！！`;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "celebration__close";
  close.textContent = "閉じる";

  close.addEventListener("click", () => {
    hideCelebrationPopup(currentContextRef ?? null);
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      hideCelebrationPopup(currentContextRef ?? null);
    }
  });

  const randomizeConfetti = (piece: HTMLSpanElement, index: number) => {
    const left = Math.random() * 100;
    const duration = 1.2 + Math.random() * 0.6;
    const delay = Math.random() * 0.6;
    const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    piece.style.left = `${left}%`;
    piece.style.setProperty("--confetti-x", `${left - 50}px`);
    piece.style.backgroundColor = color;
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;
  };

  const confettiPiecesList: HTMLSpanElement[] = [];
  for (let index = 0; index < 28; index += 1) {
    const piece = document.createElement("span");
    piece.className = "celebration__confetti-piece";
    confettiLayer.append(piece);
    confettiPiecesList.push(piece);
    randomizeConfetti(piece, index);
    piece.addEventListener("animationiteration", () => {
      randomizeConfetti(piece, index);
    });
  }

  const sparkles: HTMLSpanElement[] = [];
  const randomizeSparkle = (sparkle: HTMLSpanElement, index: number) => {
    const left = Math.random() * 100;
    const top = Math.random() * 60;
    const duration = 1.6 + Math.random() * 1.1;
    const delay = (index % 2 === 0 ? 0 : 0.4) + Math.random() * 0.8;
    sparkle.style.left = `${left}%`;
    sparkle.style.top = `${top}%`;
    sparkle.style.animationDuration = `${duration}s`;
    sparkle.style.animationDelay = `${delay}s`;
  };

  for (let index = 0; index < 28; index += 1) {
    const sparkle = document.createElement("span");
    sparkle.className = "celebration__sparkle";
    sparklesLayer.append(sparkle);
    randomizeSparkle(sparkle, index);
    sparkle.addEventListener("animationiteration", () => {
      randomizeSparkle(sparkle, index);
    });
    sparkles.push(sparkle);
  }

  const crackerLeft = document.createElement("div");
  crackerLeft.className = "celebration__cracker celebration__cracker--left";
  const crackerRight = document.createElement("div");
  crackerRight.className = "celebration__cracker celebration__cracker--right";

  const crackerBodyLeft = document.createElement("div");
  crackerBodyLeft.className = "celebration__cracker-body";
  crackerBodyLeft.textContent = "🎉";
  const crackerBodyRight = document.createElement("div");
  crackerBodyRight.className = "celebration__cracker-body";
  crackerBodyRight.textContent = "🎉";

  const crackerPiecesLeft: HTMLSpanElement[] = [];
  const crackerPiecesRight: HTMLSpanElement[] = [];

  for (let index = 0; index < 12; index += 1) {
    const piece = document.createElement("span");
    piece.className = "celebration__cracker-piece";
    piece.style.backgroundColor = CRACKER_CONFETTI_COLORS[index % CRACKER_CONFETTI_COLORS.length];
    piece.style.left = `${24 + Math.random() * 40}px`;
    piece.style.setProperty("--burst-x", `${24 + Math.random() * 60}px`);
    crackerPiecesLeft.push(piece);
    crackerLeft.append(piece);
  }

  for (let index = 0; index < 12; index += 1) {
    const piece = document.createElement("span");
    piece.className = "celebration__cracker-piece";
    piece.style.backgroundColor = CRACKER_CONFETTI_COLORS[index % CRACKER_CONFETTI_COLORS.length];
    piece.style.right = `${24 + Math.random() * 40}px`;
    piece.style.setProperty("--burst-x", `${-24 - Math.random() * 60}px`);
    crackerPiecesRight.push(piece);
    crackerRight.append(piece);
  }

  crackerLeft.append(crackerBodyLeft);
  crackerRight.append(crackerBodyRight);

  card.append(cake, title, message, close);
  overlay.append(confettiLayer, sparklesLayer, card, crackerLeft, crackerRight);

  return {
    overlay,
    card,
    title,
    message,
    close,
    confettiLayer,
    sparklesLayer,
    confettiPieces: confettiPiecesList,
    sparkles,
    crackerLeft,
    crackerRight,
    crackerPiecesLeft,
    crackerPiecesRight
  };
}

let currentContextRef: InteractionContext | null = null;

function createStatusMenuElement(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "status-menu";

  menu.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!button || button.disabled) {
      return;
    }
    const action = button.dataset.action;
    if (action === "status") {
      const nextStatus = button.dataset.status ?? "";
      const statusIdValue = Number(button.dataset.statusId ?? "");
      if (!nextStatus || Number.isNaN(statusIdValue) || statusIdValue <= 0) {
        return;
      }
      if (!menuCurrentBadge || !menuCurrentTask || !menuCurrentContext) {
        return;
      }

      const todayCountBeforeChange = getTodayTaskCount(menuCurrentContext);
      if (
        todayCountBeforeChange === 1 &&
        isTaskDueToday(menuCurrentTask) &&
        isCompletionStatusName(nextStatus)
      ) {
        celebrationArmed = true;
      }

      const previousStatus = menuCurrentTask.status;
      const previousStatusId = menuCurrentTask.statusId ?? null;

      menuCurrentTask.status = nextStatus;
      menuCurrentTask.statusId = statusIdValue;
      updateBadgeAppearance(menuCurrentBadge, menuCurrentTask, focusedTaskId === menuCurrentTask.id ? 40 : undefined);
      if (menuCurrentContext) {
        applyFocusModeAppearance(menuCurrentContext);
      }
      hideStatusMenu(menu);

      void applyStatusChange(menuCurrentContext, menuCurrentTask, statusIdValue, nextStatus).catch((error) => {
        console.warn("Failed to update issue status", error);
        menuCurrentTask.status = previousStatus;
        menuCurrentTask.statusId = previousStatusId;
        updateBadgeAppearance(menuCurrentBadge as HTMLButtonElement, menuCurrentTask, focusedTaskId === menuCurrentTask.id ? 40 : undefined);
        if (menuCurrentContext) {
          applyFocusModeAppearance(menuCurrentContext);
        }
      });
    } else if (action === "due-today" || action === "due-tomorrow") {
      if (!menuCurrentTask || !menuCurrentContext) {
        return;
      }
      const desiredDate = new Date();
      if (action === "due-tomorrow") {
        desiredDate.setDate(desiredDate.getDate() + 1);
      }
      desiredDate.setHours(0, 0, 0, 0);
      if (action === "due-tomorrow") {
        const todayCountBeforeChange = getTodayTaskCount(menuCurrentContext);
        if (todayCountBeforeChange === 1 && isTaskDueToday(menuCurrentTask)) {
          celebrationArmed = true;
        }
      }
      void applyDueDateChange(menuCurrentContext, menuCurrentTask, desiredDate).catch((error) => {
        console.warn("Failed to update due date", error);
      });
      hideStatusMenu(menu);
    } else if (action === "focus-task") {
      if (!menuCurrentTask || !menuCurrentContext) {
        return;
      }
      const nextId = focusedTaskId === menuCurrentTask.id ? null : menuCurrentTask.id;
      setFocusedTask(menuCurrentContext, nextId);
      hideStatusMenu(menu);
    }
  });

  return menu;
}

function closeActiveStatusMenu(immediate = false) {
  if (activeStatusMenuRef) {
    hideStatusMenu(activeStatusMenuRef, immediate);
  }
}

function getProjectStatuses(context: InteractionContext, projectId: number): BacklogStatusLite[] {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.warn("Invalid project id for statuses", projectId);
    return [];
  }
  const list = context.statuses.get(projectId) ?? [];
  return list.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
}

function renderStatusMenuOptions(
  context: InteractionContext,
  menu: HTMLDivElement,
  task: TopBarTask
) {
  const statuses = getProjectStatuses(context, task.projectId);
  menu.innerHTML = "";

  if (!statuses.length) {
    const message = document.createElement("div");
    message.textContent = `ステータス情報を取得できません（projectId=${task.projectId}）`;
    message.style.padding = "8px 10px";
    message.style.fontSize = "12px";
    message.style.color = "#64748b";
    menu.append(message);
    menu.dataset.hasOptions = "false";
    console.warn("No statuses cached for project", task.projectId, context.statuses);
    return false;
  }

  statuses.forEach((status) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "status-menu__item";
    item.dataset.action = "status";
    item.dataset.status = status.name;
    item.dataset.statusId = `${status.id}`;
    item.textContent = status.name;

    const swatch = document.createElement("span");
    swatch.className = "status-menu__swatch";
    swatch.style.background = getStatusColor(status.name);
    item.append(swatch);

    menu.append(item);
  });

  menu.dataset.hasOptions = "true";

  const divider = document.createElement("hr");
  divider.style.margin = "8px 0";
  divider.style.border = "none";
  divider.style.borderTop = "1px solid rgba(148, 163, 184, 0.25)";
  menu.append(divider);

  const dueTodayButton = document.createElement("button");
  dueTodayButton.type = "button";
  dueTodayButton.className = "status-menu__item status-menu__action";
  dueTodayButton.dataset.action = "due-today";
  dueTodayButton.innerHTML = "期限日を<strong>今日</strong>に変更";
  menu.append(dueTodayButton);

  const dueTomorrowButton = document.createElement("button");
  dueTomorrowButton.type = "button";
  dueTomorrowButton.className = "status-menu__item status-menu__action";
  dueTomorrowButton.dataset.action = "due-tomorrow";
  dueTomorrowButton.innerHTML = "期限日を<strong>明日</strong>に変更";
  menu.append(dueTomorrowButton);

  const focusDivider = document.createElement("hr");
  focusDivider.style.margin = "8px 0";
  focusDivider.style.border = "none";
  focusDivider.style.borderTop = "1px solid rgba(148, 163, 184, 0.25)";
  menu.append(focusDivider);

  const focusButton = document.createElement("button");
  focusButton.type = "button";
  focusButton.className = "status-menu__item status-menu__action";
  focusButton.dataset.action = "focus-task";
  const isFocused = focusedTaskId === task.id;
  focusButton.textContent = isFocused ? "集中モードを解除" : "このタスクに集中！";
  focusButton.dataset.focusActive = isFocused ? "true" : "false";
  menu.append(focusButton);

  return true;
}

async function ensureStatusMenuOptions(
  context: InteractionContext,
  menu: HTMLDivElement,
  task: TopBarTask
): Promise<boolean> {
  renderStatusMenuOptions(context, menu, task);
  if (menu.dataset.hasOptions === "true") {
    return true;
  }

  try {
    const response = await sendMessageWithRetry({
      type: "backlog:project:statuses",
      projectId: task.projectId
    }, 2);
    const statuses = response?.data?.statuses as BacklogStatusLite[] | undefined;
    if (Array.isArray(statuses) && statuses.length) {
      context.statuses.set(task.projectId, statuses);
      renderStatusMenuOptions(context, menu, task);
      return menu.dataset.hasOptions === "true";
    }
  } catch (error) {
    console.warn("Failed to load project statuses", error);
  }
  renderStatusMenuOptions(context, menu, task);
  return menu.dataset.hasOptions === "true";
}

async function applyStatusChange(
  context: InteractionContext,
  task: TopBarTask,
  statusId: number,
  statusName: string
): Promise<void> {
  try {
    const response = await sendMessageWithRetry({
      type: "backlog:issue:updateStatus",
      issueId: task.id,
      statusId
    }, 2);
    if (response?.error) {
      throw new Error(response.error);
    }
    updateCachedIssueStatus(task.id, statusName, statusId);
    void refreshIssues(context);
  } catch (error) {
    celebrationArmed = false;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function updateCachedIssueStatus(issueId: number, statusName: string, statusId: number): void {
  const buckets = latestIssueBuckets;
  if (!buckets) {
    return;
  }
  SECTION_SEQUENCE.forEach((key) => {
    const list = getBucketForKey(buckets, key);
    const target = list.find((item) => item.id === issueId);
    if (target) {
      target.status = statusName;
      target.statusId = statusId;
    }
  });
}

async function applyDueDateChange(context: InteractionContext, task: TopBarTask, desiredDate: Date): Promise<void> {
  const projectId = task.projectId;
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.warn("Cannot update due date without valid projectId", projectId);
    return;
  }
  const normalized = new Date(
    desiredDate.getFullYear(),
    desiredDate.getMonth(),
    desiredDate.getDate(),
    0,
    0,
    0,
    0
  );
  const timezoneSafeDate = new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60000);
  const isoDate = timezoneSafeDate.toISOString().split("T")[0];

  try {
    const response = await sendMessageWithRetry({
      type: "backlog:issue:updateDueDate",
      issueId: task.id,
      dueDate: isoDate
    }, 2);
    if (response?.error) {
      throw new Error(response.error);
    }
    task.dueDate = isoDate;
    updateCachedIssueDueDate(task.id, isoDate);
    void refreshIssues(context);
  } catch (error) {
    console.warn("Failed to update due date", error);
    celebrationArmed = false;
  }
}

function updateCachedIssueDueDate(issueId: number, dueDate: string): void {
  const buckets = latestIssueBuckets;
  if (!buckets) {
    return;
  }
  SECTION_SEQUENCE.forEach((key) => {
    const list = getBucketForKey(buckets, key);
    const target = list.find((item) => item.id === issueId);
    if (target) {
      target.dueDate = dueDate;
    }
  });
}

function setSectionMessage(list: HTMLDivElement, message: string, variant: "default" | "error" = "default") {
  list.innerHTML = "";
  const span = document.createElement("span");
  span.className = "section-message";
  if (variant === "error") {
    span.classList.add("section-message--error");
  }
  span.textContent = message;
  list.append(span);
}

function setSectionsMessage(context: InteractionContext, message: string, variant: "default" | "error" = "default") {
  SECTION_SEQUENCE.forEach((key) => {
    const list = context.sections[key];
    if (list) {
      setSectionMessage(list, message, variant);
    }
  });
  hideCelebrationPopup(context);
  scheduleBarMeasurement(context);
}

function scheduleBarMeasurement(context: InteractionContext) {
  if (isMinimized) {
    return;
  }
  if (pendingBarMeasurementFrame) {
    return;
  }
  pendingBarMeasurementFrame = window.requestAnimationFrame(() => {
    pendingBarMeasurementFrame = 0;
    if (isMinimized) {
      return;
    }
    const rect = context.bar.getBoundingClientRect();
    const measuredHeight = Math.round(rect.height);
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
      return;
    }
    expandedBarHeight = measuredHeight;
    currentBarHeight = measuredHeight;
    updateHostHeight(measuredHeight, false);
    applyPaddingTop();
    scheduleLayoutCheck();
  });
}

function renderIssueBuckets(context: InteractionContext, buckets: BacklogIssueBuckets) {
  ensureFocusedTaskVisible(buckets);
  if (Array.isArray(buckets.statuses)) {
    context.statuses.clear();
    buckets.statuses.forEach((bundle) => {
      context.statuses.set(bundle.projectId, bundle.statuses.slice());
    });
  }
  renderSectionTasks(context, "past", buckets.past);
  renderSectionTasks(context, "today", buckets.today);
  if (context.preferences.showTomorrowSection) {
    renderSectionTasks(context, "week", buckets.thisWeek);
  } else {
    context.sections.week.innerHTML = "";
  }
  if (context.preferences.showNoDueSection) {
    renderSectionTasks(context, "noDue", buckets.noDue);
  } else {
    context.sections.noDue.innerHTML = "";
  }
  applyFocusModeAppearance(context);
  handleTodayCompletionCelebration(context, buckets.today.length);
  scheduleBarMeasurement(context);
}

function updateSectionVisibility(
  context: InteractionContext,
  key: SectionKey,
  shouldShow: boolean,
  buckets: BacklogIssueBuckets | null = null
): void {
  const container = context.sectionContainers[key];
  const parent = context.sectionsContainer;
  const list = context.sections[key];
  if (!container || !parent || !list) {
    return;
  }

  const isAttached = parent.contains(container);

  if (shouldShow) {
    if (!isAttached) {
      let inserted = false;
      const currentIndex = SECTION_SEQUENCE.indexOf(key);
      for (let idx = currentIndex + 1; idx < SECTION_SEQUENCE.length; idx += 1) {
        const nextKey = SECTION_SEQUENCE[idx];
        const nextContainer = context.sectionContainers[nextKey];
        if (nextContainer && parent.contains(nextContainer)) {
          parent.insertBefore(container, nextContainer);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        parent.append(container);
      }

      const source = buckets ?? latestIssueBuckets;
      if (source) {
        renderSectionTasks(context, key, source[key]);
      } else {
        list.innerHTML = "";
        setSectionMessage(list, "なし");
      }
      scheduleBarMeasurement(context);
    }
  } else if (isAttached) {
    parent.removeChild(container);
    scheduleBarMeasurement(context);
  }
  applyFocusModeAppearance(context);
}

function renderSectionTasks(context: InteractionContext, key: SectionKey, tasks: TopBarTask[]) {
  const list = context.sections[key];
  if (!list) {
    return;
  }

  closeActiveStatusMenu(true);
  hideTooltip(context.tooltip, 0);

  list.innerHTML = "";

  if (!tasks.length) {
    setSectionMessage(list, "なし");
    return;
  }

  tasks.forEach((task) => {
    const badge = createBadgeElement(task, context);
    list.append(badge);
  });
}

function setBarMinimized(context: InteractionContext, minimized: boolean) {
  if (isMinimized === minimized) {
    return;
  }
  isMinimized = minimized;
  context.bar.dataset.minimized = minimized ? "true" : "false";
  if (minimized) {
    if (currentBarHeight > 0) {
      expandedBarHeight = currentBarHeight;
    }
    currentBarHeight = 0;
    updateHostHeight(0, true);
  } else {
    currentBarHeight = expandedBarHeight;
    updateHostHeight(currentBarHeight, false);
  }
  applyPaddingTop();
  scheduleLayoutCheck();
  void saveMinimizedState(minimized);
  if (minimized) {
    closeActiveStatusMenu(true);
    hideTooltip(context.tooltip, 0);
    showMinimizedIndicator(context, true);
  } else {
    showMinimizedIndicator(context, false);
    scheduleBarMeasurement(context);
  }
}

function updateHostHeight(height: number, minimized = false) {
  const host = document.getElementById(SHADOW_HOST_ID);
  if (host) {
    host.style.display = minimized ? "none" : "block";
    host.style.height = minimized ? "0px" : `${height}px`;
  }
}

function showMinimizedIndicator(context: InteractionContext, visible: boolean) {
  const host = document.getElementById(SHADOW_HOST_ID);
  if (!visible) {
    if (host) {
      host.style.display = "block";
    }
  }

  if (!visible) {
    if (minimizedIndicator) {
      minimizedIndicator.style.display = "none";
    }
    minimizedIndicatorContext = null;
    applyPaddingTop();
    return;
  }

  minimizedIndicatorContext = context;
  if (!minimizedIndicator) {
    minimizedIndicator = document.createElement("div");
    minimizedIndicator.style.position = "fixed";
    minimizedIndicator.style.top = "0";
    minimizedIndicator.style.left = "0";
    minimizedIndicator.style.right = "0";
    minimizedIndicator.style.height = `${MINIMIZED_HEIGHT}px`;
    minimizedIndicator.style.background = "#2c9a7a";
    minimizedIndicator.style.zIndex = "2147483646";
    minimizedIndicator.style.cursor = "pointer";
    minimizedIndicator.style.boxShadow = "0 0 12px rgba(44, 154, 122, 0.45)";
    minimizedIndicator.style.transition = "opacity 0.15s ease";
    minimizedIndicator.title = "バーを展開";
    minimizedIndicator.setAttribute("role", "button");
    minimizedIndicator.setAttribute("aria-label", "バーを展開");
    minimizedIndicator.addEventListener("click", () => {
      if (minimizedIndicatorContext) {
        setBarMinimized(minimizedIndicatorContext, false);
      }
    });
    document.body.append(minimizedIndicator);
  }

  minimizedIndicator.style.display = "block";
  minimizedIndicator.style.opacity = "1";
  applyPaddingTop();
}

function createBadgeElement(task: TopBarTask, context: InteractionContext): HTMLButtonElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "badge";
  badge.dataset.issueKey = task.issueKey;
  badge.dataset.status = task.status;
  context.taskRegistry.set(badge, task);
  updateBadgeAppearance(badge, task);

  badge.addEventListener("mouseenter", () => {
    scheduleTooltipForBadge(badge, task, context.tooltip);
  });

  badge.addEventListener("mouseleave", () => {
    hideTooltip(context.tooltip, 120);
  });

  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    void toggleStatusMenuForBadge(badge, task, context);
  });

  badge.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      window.open(task.url, "_blank", "noopener");
    }
  });

  badge.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.metaKey) {
      window.open(task.url, "_blank", "noopener");
    }
  });

  return badge;
}

async function refreshIssues(context: InteractionContext, options: { showLoading?: boolean } = {}) {
  if (options.showLoading) {
    setSectionsMessage(context, "課題を同期中…");
  }

  try {
    const response = await sendMessageWithRetry({ type: "backlog:issues:list", force: options.showLoading }, 2);
    const payload: BacklogIssueBuckets | undefined = response?.data ?? response;
    if (!payload) {
      throw new Error("Backlog API からの応答が不正です");
    }

    latestIssueBuckets = payload;
    renderIssueBuckets(context, payload);

    if (payload.errorCode) {
      const fallbackNote = payload.stale ? "（前回のキャッシュを表示中）" : "";
      const messageText = resolveErrorMessage(payload.errorCode, payload.errorMessage);
      if (!payload.past.length && !payload.today.length && !payload.thisWeek.length && !payload.noDue.length) {
        setSectionsMessage(context, messageText, payload.errorCode === "missing-config" ? "error" : "default");
      }
    } else {
      // no-op: status label removed
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Extension context invalidated")) {
      window.setTimeout(() => {
        void refreshIssues(context, options);
      }, 400);
      return;
    }
    if (latestIssueBuckets) {
      renderIssueBuckets(context, latestIssueBuckets);
    } else {
      setSectionsMessage(context, "課題の取得に失敗しました", "error");
    }
    console.warn("Failed to refresh issues:", message);
  }
}

function formatLastUpdated(timestamp: string, stale?: boolean): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return stale ? "前回のデータを表示" : "同期未実施";
  }
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return stale ? `前回同期 ${hours}:${minutes}` : `最終更新 ${hours}:${minutes}`;
}

function resolveErrorMessage(code: BacklogIssueBuckets["errorCode"], fallback?: string): string {
  if (fallback) {
    return fallback;
  }
  switch (code) {
    case "missing-config":
      return "Backlog API キーを設定してください";
    case "permission-denied":
      return "ドメインへのアクセス許可が必要です";
    case "request-denied":
      return "API 認証に失敗しました";
    case "network-error":
    default:
      return "課題の取得に失敗しました";
  }
}

function hideStatusMenu(menu: HTMLDivElement, immediate = false) {
  if (menuHideTimer) {
    window.clearTimeout(menuHideTimer);
  }
  const close = () => {
    menu.style.display = "none";
    menu.style.removeProperty("top");
    menu.style.removeProperty("left");
    menu.dataset.openFor = "";
    menuCurrentBadge = null;
    menuCurrentTask = null;
  };

  if (immediate) {
    close();
    return;
  }

  menuHideTimer = window.setTimeout(close, 120);
}

function updateBadgeAppearance(badge: HTMLButtonElement, task: TopBarTask, overrideLength?: number) {
  const maxLength = overrideLength && overrideLength > 0 ? overrideLength : 15;
  const truncated = truncateSummary(task.summary, maxLength);
  badge.textContent = truncated;
  badge.dataset.status = task.status;
  const color = getStatusColor(task.status);
  badge.style.backgroundColor = color;
  badge.style.color = "#ffffff";
  badge.dataset.baseColor = color;
  badge.dataset.baseTextColor = "#ffffff";
  badge.setAttribute("aria-label", `${task.summary}（ステータス: ${task.status}）`);
}

function getStatusColor(status: string): string {
  return STATUS_COLOR_MAP[status] ?? DEFAULT_STATUS_COLOR;
}

function truncateSummary(summary: string, maxLength: number): string {
  const chars = Array.from(summary);
  if (chars.length <= maxLength) {
    return summary;
  }
  return chars.slice(0, maxLength).join("");
}

function getBucketForKey(buckets: BacklogIssueBuckets, key: SectionKey): BacklogIssueLite[] {
  switch (key) {
    case "past":
      return buckets.past;
    case "today":
      return buckets.today;
    case "week":
      return buckets.thisWeek ?? [];
    case "noDue":
      return buckets.noDue;
    default:
      return [];
  }
}

function applyFocusModeAppearance(context: InteractionContext): void {
  const badgeEntries: Array<{
    badge: HTMLButtonElement;
    task: TopBarTask;
    baseColor: string;
    baseTextColor: string;
  }> = [];

  SECTION_SEQUENCE.forEach((key) => {
    const list = context.sections[key];
    if (!list) {
      return;
    }
    const badges = list.querySelectorAll<HTMLButtonElement>(".badge");
    badges.forEach((badge) => {
      const task = context.taskRegistry.get(badge);
      if (!task) {
        return;
      }
      const baseColor = badge.dataset.baseColor ?? getStatusColor(task.status);
      const baseTextColor = badge.dataset.baseTextColor ?? "#ffffff";
      badgeEntries.push({ badge, task, baseColor, baseTextColor });
    });
  });

  const focusActive = focusedTaskId !== null;
  const activeTaskId = focusedTaskId ?? -1;

  badgeEntries.forEach(({ badge, task, baseColor, baseTextColor }) => {
    const isFocused = focusActive && task.id === activeTaskId;
    badge.classList.toggle("badge--focused", isFocused);
    if (isFocused) {
      updateBadgeAppearance(badge, task, 40);
    } else {
      updateBadgeAppearance(badge, task);
    }
    if (focusActive && !isFocused) {
      badge.style.backgroundColor = FOCUS_DIM_BACKGROUND;
      badge.style.color = FOCUS_DIM_TEXT_COLOR;
      badge.style.opacity = "0.65";
      badge.dataset.dimmed = "true";
    } else {
      badge.style.backgroundColor = baseColor;
      badge.style.color = baseTextColor;
      badge.style.opacity = "1";
      delete badge.dataset.dimmed;
    }
  });
}

function ensureFocusedTaskVisible(buckets: BacklogIssueBuckets | null | undefined): void {
  if (focusedTaskId === null || !buckets) {
    return;
  }
  const exists = SECTION_SEQUENCE.some((key) => getBucketForKey(buckets, key).some((task) => task.id === focusedTaskId));
  if (!exists) {
    setFocusedTask(null, null);
  }
}

function updateLevelBadge(context: InteractionContext | null): void {
  if (!context) {
    return;
  }
  context.levelBadge.innerHTML = `<span class="actions__level-top">Backlog</span><span class="actions__level-bottom">Lv.${currentLevel}</span>`;
}

function primeCelebrationEffects(elements: CelebrationElements): void {
  elements.confettiPieces.forEach((piece, index) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.6;
    const duration = 1.2 + Math.random() * 0.7;
    const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    piece.style.animation = "none";
    piece.offsetHeight;
    piece.style.left = `${left}%`;
    piece.style.setProperty("--confetti-x", `${left - 50}px`);
    piece.style.backgroundColor = color;
    piece.style.animation = `confettiFall ${duration}s ease-out infinite`;
    piece.style.animationDelay = `${delay}s`;
  });

  elements.sparkles.forEach((sparkle) => {
    const left = Math.random() * 100;
    const top = Math.random() * 60;
    const delay = Math.random() * 0.8;
    const duration = 1.6 + Math.random() * 1.1;
    sparkle.style.animation = "none";
    sparkle.offsetHeight;
    sparkle.style.left = `${left}%`;
    sparkle.style.top = `${top}%`;
    sparkle.style.animation = `sparkleTwinkle ${duration}s ease-in-out infinite`;
    sparkle.style.animationDelay = `${delay}s`;
  });

  elements.crackerPiecesLeft.forEach((piece) => {
    const offsetX = 24 + Math.random() * 60;
    piece.style.animation = "none";
    piece.offsetHeight;
    piece.style.left = `${offsetX}px`;
    piece.style.setProperty("--burst-x", `${offsetX}px`);
    piece.style.animation = "crackerBurst 0.85s ease-out forwards";
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    piece.style.backgroundColor = CRACKER_CONFETTI_COLORS[Math.floor(Math.random() * CRACKER_CONFETTI_COLORS.length)];
  });

  elements.crackerPiecesRight.forEach((piece) => {
    const offsetX = 24 + Math.random() * 60;
    piece.style.animation = "none";
    piece.offsetHeight;
    piece.style.right = `${offsetX}px`;
    piece.style.setProperty("--burst-x", `${-offsetX}px`);
    piece.style.animation = "crackerBurst 0.85s ease-out forwards";
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    piece.style.backgroundColor = CRACKER_CONFETTI_COLORS[Math.floor(Math.random() * CRACKER_CONFETTI_COLORS.length)];
  });
}

function showCelebrationPopup(context: InteractionContext | null): void {
  if (!context) {
    return;
  }
  if (celebrationHideTimer) {
    window.clearTimeout(celebrationHideTimer);
  }
  currentLevel += 1;
  context.celebration.message.textContent = `本日のタスクを全て処理し、Lv.${currentLevel}に上がりました！\nこの調子でがんばりましょう！！`;
  updateLevelBadge(context);
  void saveCurrentLevel(currentLevel);
  primeCelebrationEffects(context.celebration);
  context.celebration.overlay.dataset.open = "true";
  celebrationHideTimer = window.setTimeout(() => {
    hideCelebrationPopup(context);
  }, 30000);
}

function hideCelebrationPopup(context: InteractionContext | null): void {
  if (!context) {
    return;
  }
  if (celebrationHideTimer) {
    window.clearTimeout(celebrationHideTimer);
    celebrationHideTimer = undefined;
  }
  delete context.celebration.overlay.dataset.open;
}

function handleTodayCompletionCelebration(context: InteractionContext, todayCount: number): void {
  if (todayCount === 0 && celebrationArmed) {
    showCelebrationPopup(context);
    celebrationArmed = false;
  } else if (todayCount > 0) {
    hideCelebrationPopup(context);
  }
}

function scheduleTooltipForBadge(badge: HTMLButtonElement, task: TopBarTask, tooltip: HTMLDivElement) {
  if (tooltipShowTimer) {
    window.clearTimeout(tooltipShowTimer);
  }
  tooltipShowTimer = window.setTimeout(() => {
    tooltipShowTimer = undefined;
    showTooltipForBadge(badge, task, tooltip);
  }, 500);
}

function showTooltipForBadge(badge: HTMLButtonElement, task: TopBarTask, tooltip: HTMLDivElement) {
  if (tooltipHideTimer) {
    window.clearTimeout(tooltipHideTimer);
    tooltipHideTimer = undefined;
  }

  const title = tooltip.querySelector(".tooltip__title") as HTMLHeadingElement;
  const meta = tooltip.querySelector(".tooltip__meta") as HTMLDivElement;
  const body = tooltip.querySelector(".tooltip__body") as HTMLParagraphElement;

  title.textContent = task.summary;

  const projectLabel = task.projectName || "プロジェクト未設定";
  const categoryLabel = task.categoryName || "カテゴリ未設定";
  meta.innerHTML = "";
  [projectLabel, categoryLabel].forEach((text) => {
    const span = document.createElement("span");
    span.textContent = text;
    meta.append(span);
  });

  body.textContent = task.description?.trim() ? task.description : "本文なし";

  tooltip.style.display = "block";
  tooltip.style.visibility = "hidden";

  positionFloatingElement(badge, tooltip, 12, true);

  tooltip.style.visibility = "visible";
}

function hideTooltip(tooltip: HTMLDivElement, delay = 100) {
  if (tooltipShowTimer) {
    window.clearTimeout(tooltipShowTimer);
    tooltipShowTimer = undefined;
  }
  if (tooltipHideTimer) {
    window.clearTimeout(tooltipHideTimer);
  }
  tooltipHideTimer = window.setTimeout(() => {
    tooltip.style.display = "none";
    tooltip.style.removeProperty("top");
    tooltip.style.removeProperty("left");
    tooltip.style.removeProperty("--tooltip-arrow-left");
  }, delay);
}

async function toggleStatusMenuForBadge(badge: HTMLButtonElement, task: TopBarTask, context: InteractionContext) {
  hideTooltip(context.tooltip, 0);
  const { statusMenu } = context;
  if (statusMenu.dataset.openFor === task.issueKey) {
    hideStatusMenu(statusMenu, true);
    return;
  }
  await showStatusMenuForBadge(badge, task, context);
}

async function showStatusMenuForBadge(badge: HTMLButtonElement, task: TopBarTask, context: InteractionContext) {
  if (menuHideTimer) {
    window.clearTimeout(menuHideTimer);
    menuHideTimer = undefined;
  }

  const { statusMenu } = context;
  const hasOptions = await ensureStatusMenuOptions(context, statusMenu, task);
  statusMenu.style.display = "block";
  statusMenu.style.visibility = "hidden";

  menuCurrentBadge = badge;
  menuCurrentTask = task;
  menuCurrentContext = context;
  statusMenu.dataset.openFor = task.issueKey;
  if (hasOptions) {
    updateStatusMenuSelection(statusMenu, task.status);
  }

  positionFloatingElement(badge, statusMenu, 8, true);

  statusMenu.style.visibility = "visible";
}

function updateStatusMenuSelection(menu: HTMLDivElement, currentStatus: string) {
  menu.querySelectorAll<HTMLButtonElement>(".status-menu__item").forEach((item) => {
    if (item.dataset.status === currentStatus) {
      item.classList.add("is-active");
    } else {
      item.classList.remove("is-active");
    }
  });
}

function positionFloatingElement(
  badge: HTMLButtonElement,
  floating: HTMLElement,
  gap: number,
  constrainToViewport = false
) {
  const rect = badge.getBoundingClientRect();
  const floatingRect = floating.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - floatingRect.width / 2;
  const minMargin = 12;
  const maxLeft = window.innerWidth - floatingRect.width - minMargin;
  if (constrainToViewport) {
    left = Math.max(minMargin, Math.min(maxLeft, left));
  }

  let top = rect.bottom + gap;
  if (constrainToViewport) {
    const maxTop = window.innerHeight - floatingRect.height - minMargin;
    top = Math.min(top, maxTop);
  }

  floating.style.left = `${left}px`;
  floating.style.top = `${top}px`;

  if (floating.classList.contains("tooltip")) {
    const arrowCenter = rect.left + rect.width / 2;
    const arrowOffset = arrowCenter - left - 7; // 7 = arrow half width
    floating.style.setProperty(
      "--tooltip-arrow-left",
      `${Math.max(12, Math.min(floatingRect.width - 12, arrowOffset))}px`
    );
  }
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatDueDate(due: string | null): string {
  if (!due) {
    return "未設定";
  }
  const segments = due.split("-");
  if (segments.length !== 3) {
    return "未設定";
  }
  const [_year, month, day] = segments;
  if (!month || !day) {
    return "未設定";
  }
  return `${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
}

function enableWheelScroll(element: Element | null) {
  if (!element) {
    return;
  }
  element.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      (event.currentTarget as HTMLElement).scrollLeft += event.deltaY;
    },
    { passive: false }
  );
}

function toggleSidePanel(): Promise<void> {
  return sendMessageWithRetry<{ ok?: boolean; error?: string }>({ type: "sidepanel:toggle" }, 2)
    .then((response) => {
      if (!response?.ok) {
        throw new Error(response?.error ?? "サイドパネルを開けませんでした");
      }
    });
}

async function initTopBar(): Promise<void> {
  const storedMinimized = await loadMinimizedState();
  const storedFocusedTask = await loadFocusedTaskId();
  const storedLevel = await loadStoredLevel();
  currentLevel = storedLevel;
  setFocusedTask(null, storedFocusedTask, { persist: false });
  // 常に展開状態から開始する（最小化状態が残っているとホスト高さ0pxのままになることがあるため）
  if (storedMinimized) {
    void saveMinimizedState(false);
  }
  isMinimized = false;
  currentBarHeight = expandedBarHeight;
  const shadowRoot = ensureShadowHost();
  if (!shadowRoot) {
    return;
  }
  const authConfig = await getBacklogAuthConfig().catch(() => null);
  const context = renderTopBar(shadowRoot, {
    showTomorrowSection: authConfig?.showTomorrowSection !== false,
    showNoDueSection: authConfig?.showNoDueSection !== false
  });
  setFocusedTask(context, focusedTaskId, { persist: false });
  ensurePageSpacing();

  if (isMinimized) {
    showMinimizedIndicator(context, true);
  }

  void refreshIssues(context, { showLoading: true });

  if (issuesRefreshTimer) {
    window.clearInterval(issuesRefreshTimer);
  }
  issuesRefreshTimer = window.setInterval(() => {
    void refreshIssues(context);
  }, ISSUES_REFRESH_INTERVAL_MS);

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeModal();
      }
    },
    { capture: true }
  );

  window.addEventListener("resize", scheduleLayoutCheck, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleLayoutCheck();
      void refreshIssues(context);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (BACKLOG_AUTH_KEY in changes) {
      const updated = changes[BACKLOG_AUTH_KEY]?.newValue as BacklogAuthConfig | undefined;
      const nextShowTomorrow = updated?.showTomorrowSection !== false;
      const nextShowNoDue = updated?.showNoDueSection !== false;
      if (context.preferences.showTomorrowSection !== nextShowTomorrow) {
        context.preferences.showTomorrowSection = nextShowTomorrow;
        updateSectionVisibility(context, "week", nextShowTomorrow, latestIssueBuckets);
      }
      if (context.preferences.showNoDueSection !== nextShowNoDue) {
        context.preferences.showNoDueSection = nextShowNoDue;
        updateSectionVisibility(context, "noDue", nextShowNoDue, latestIssueBuckets);
      }
    }

    if (STORAGE_FOCUSED_TASK_KEY in changes) {
      const nextFocus = parseFocusedTaskId(changes[STORAGE_FOCUSED_TASK_KEY]?.newValue ?? null);
      setFocusedTask(context, nextFocus, { persist: false });
    }

    if (STORAGE_LEVEL_KEY in changes) {
      const nextLevelRaw = changes[STORAGE_LEVEL_KEY]?.newValue;
      const parsed = typeof nextLevelRaw === "number" && Number.isFinite(nextLevelRaw) && nextLevelRaw >= 0 ? Math.floor(nextLevelRaw) : 0;
      currentLevel = parsed;
      updateLevelBadge(context);
      context.celebration.message.textContent = `本日のタスクを全て処理し、Lv.${currentLevel}に上がりました！
この調子でがんばりましょう！！`;
    }

    if (BACKLOG_ISSUES_REVISION_KEY in changes) {
      void refreshIssues(context);
    }

    if (STORAGE_MINIMIZED_KEY in changes) {
      const nextValue = Boolean(changes[STORAGE_MINIMIZED_KEY]?.newValue);
      if (!minimizedIndicatorContext) {
        minimizedIndicatorContext = context;
      }
      setBarMinimized(minimizedIndicatorContext ?? context, nextValue);
    }
  });

  scheduleLayoutCheck();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initTopBar();
  }, { once: true });
} else {
  void initTopBar();
}
