import { storageGet, storageSet, storageRemove } from "./storage";

export type LlmProvider = "chatgpt" | "gemini";

export interface BacklogAuthConfig {
  spaceDomain: string;
  apiKey: string;
  host: "backlog.com" | "backlog.jp";
  showNoDueSection?: boolean;
  showTomorrowSection?: boolean;
  issueFetchLimit?: number;
  excludedProjects?: string[];
  llmProvider?: LlmProvider;
  autoImportDelaySeconds?: number;
  autoCreateDelaySeconds?: number;
}

export const BACKLOG_AUTH_KEY = "backlogAuth";
export const BACKLOG_ISSUES_REVISION_KEY = "backlogManagerIssuesRevision";
export const ISSUE_FETCH_LIMIT_MIN = 50;
export const ISSUE_FETCH_LIMIT_MAX = 1000;
export const DEFAULT_ISSUE_FETCH_LIMIT = 1000;
export const DEFAULT_LLM_PROVIDER: LlmProvider = "chatgpt";
export const AUTO_IMPORT_DELAY_MIN = 10;
export const AUTO_IMPORT_DELAY_MAX = 600;
export const DEFAULT_AUTO_IMPORT_DELAY_SECONDS = 60;
export const AUTO_CREATE_DELAY_MIN = 5;
export const AUTO_CREATE_DELAY_MAX = 300;
export const DEFAULT_AUTO_CREATE_DELAY_SECONDS = 15;

export async function getBacklogAuthConfig(): Promise<BacklogAuthConfig | null> {
  const result = await storageGet<BacklogAuthConfig | null>([BACKLOG_AUTH_KEY]);
  const config = result[BACKLOG_AUTH_KEY];
  if (!config) {
    return null;
  }
  if (config.showNoDueSection === undefined) {
    config.showNoDueSection = true;
  }
  if (config.showTomorrowSection === undefined) {
    config.showTomorrowSection = true;
  }
  config.issueFetchLimit = normalizeIssueFetchLimit(config.issueFetchLimit);
  config.excludedProjects = normalizeExcludedProjects(config.excludedProjects);
  config.llmProvider = normalizeLlmProvider(config.llmProvider);
  config.autoImportDelaySeconds = normalizeAutoDelay(
    config.autoImportDelaySeconds,
    AUTO_IMPORT_DELAY_MIN,
    AUTO_IMPORT_DELAY_MAX,
    DEFAULT_AUTO_IMPORT_DELAY_SECONDS
  );
  config.autoCreateDelaySeconds = normalizeAutoDelay(
    config.autoCreateDelaySeconds,
    AUTO_CREATE_DELAY_MIN,
    AUTO_CREATE_DELAY_MAX,
    DEFAULT_AUTO_CREATE_DELAY_SECONDS
  );
  return config;
}

export async function saveBacklogAuthConfig(config: BacklogAuthConfig): Promise<void> {
  await storageSet({ [BACKLOG_AUTH_KEY]: config });
}

export async function clearBacklogAuthConfig(): Promise<void> {
  await storageRemove([BACKLOG_AUTH_KEY]);
}

export function backlogBaseUrl(config: BacklogAuthConfig): string {
  return `https://${config.spaceDomain}.${config.host}`;
}

export function backlogApiOrigin(config: BacklogAuthConfig): string {
  return `${backlogBaseUrl(config)}/`;
}

export function normalizeIssueFetchLimit(value?: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_ISSUE_FETCH_LIMIT;
  }
  const numericValue = Number(value);
  return Math.min(ISSUE_FETCH_LIMIT_MAX, Math.max(ISSUE_FETCH_LIMIT_MIN, Math.floor(numericValue)));
}

export function normalizeExcludedProjects(raw?: string[] | null): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  raw.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return;
    }
    seen.add(trimmed);
  });
  return Array.from(seen);
}

export function normalizeLlmProvider(value?: string | null): LlmProvider {
  if (value === "gemini") {
    return "gemini";
  }
  return DEFAULT_LLM_PROVIDER;
}

export function normalizeAutoDelay(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.floor(Math.max(min, Math.min(max, numeric)));
  return clamped;
}
