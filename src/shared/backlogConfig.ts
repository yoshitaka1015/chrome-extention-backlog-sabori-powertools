import { storageGet, storageSet, storageRemove } from "./storage";

export interface BacklogAuthConfig {
  spaceDomain: string;
  apiKey: string;
  host: "backlog.com" | "backlog.jp";
  showNoDueSection?: boolean;
  showTomorrowSection?: boolean;
}

export const BACKLOG_AUTH_KEY = "backlogAuth";
export const BACKLOG_ISSUES_REVISION_KEY = "backlogManagerIssuesRevision";

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
