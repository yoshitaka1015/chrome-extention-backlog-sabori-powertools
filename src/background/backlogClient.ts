import { backlogBaseUrl, getBacklogAuthConfig, BacklogAuthConfig, BACKLOG_ISSUES_REVISION_KEY } from "@shared/backlogConfig";
import type {
  BacklogIssueBuckets,
  BacklogIssueLite,
  BacklogProjectStatuses,
  BacklogStatusLite,
  BacklogCategoryLite,
  BacklogIssueTypeLite,
  BacklogUserLite
} from "@shared/backlogTypes";

type BacklogIssueResponse = {
  id: number;
  projectId: number;
  issueKey: string;
  summary: string;
  description: string;
  dueDate: string | null;
  created: string;
  status: {
    id: number;
    name: string;
  } | null;
  project: {
    projectKey: string;
    name: string;
  };
  category: Array<{
    id: number;
    name: string;
  }>;
  assignee: {
    id: number;
    name: string;
  } | null;
};

type BacklogUserResponse = {
  id: number;
  name: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_FETCH_COUNT = 1000;
const MAX_PAGE_SIZE = 100;

let cachedBuckets: { data: BacklogIssueBuckets; fetchedAt: number } | null = null;
const projectStatusCache = new Map<number, { data: BacklogStatusLite[]; fetchedAt: number }>();
const projectInfoCache = new Map<number, { data: { name: string; projectKey: string }; fetchedAt: number }>();
const projectCategoryCache = new Map<number, { data: BacklogCategoryLite[]; fetchedAt: number }>();
const projectIssueTypeCache = new Map<number, { data: BacklogIssueTypeLite[]; fetchedAt: number }>();
const projectUserCache = new Map<number, { data: BacklogUserLite[]; fetchedAt: number }>();
let currentUser: BacklogUserResponse | null = null;

export function clearBacklogIssueCache(): void {
  cachedBuckets = null;
  projectStatusCache.clear();
  projectInfoCache.clear();
  projectCategoryCache.clear();
  projectIssueTypeCache.clear();
  projectUserCache.clear();
  currentUser = null;
}

export async function updateIssueStatusById(issueId: number, statusId: number): Promise<void> {
  if (!Number.isFinite(issueId) || issueId <= 0) {
    throw new Error("Invalid issue id");
  }
  if (!Number.isFinite(statusId) || statusId <= 0) {
    throw new Error("Invalid status id");
  }

  const config = await ensureAuthConfig();
  await ensureHostPermission(config);
  await updateIssueStatus(config, issueId, statusId);
  cachedBuckets = null;
  void chrome.storage.local.set({ [BACKLOG_ISSUES_REVISION_KEY]: Date.now() });
}

export async function getProjectStatusesById(projectId: number): Promise<BacklogProjectStatuses> {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new Error("Invalid project id");
  }
  const config = await ensureAuthConfig();
  await ensureHostPermission(config);
  const statuses = await ensureProjectStatuses(config, projectId);
  return { projectId, statuses };
}

type ProjectListResponse = Array<{
  id: number;
  name: string;
  projectKey: string;
}>;

export type ProjectDetails = {
  projectId: number;
  name: string;
  projectKey: string;
  statuses: BacklogStatusLite[];
  categories: BacklogCategoryLite[];
  issueTypes: BacklogIssueTypeLite[];
  users: BacklogUserLite[];
  currentUserId: number | null;
};

export type CreateIssueParams = {
  projectId: number;
  issueTypeId: number;
  summary: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  categoryId?: number;
  assigneeId?: number;
  priorityId?: number;
};

type CreatedIssueResponse = {
  id: number;
  issueKey: string;
  summary: string;
};

export async function getAllProjectDetails(): Promise<ProjectDetails[]> {
  const config = await ensureAuthConfig();
  await ensureHostPermission(config);

  const current = await ensureCurrentUser(config).catch(() => null);
  const currentUserId = current?.id ?? null;

  const projects = await backlogFetch<ProjectListResponse>(config, "/api/v2/projects");
  const details: ProjectDetails[] = [];

  for (const project of projects) {
    const [statuses, categories, issueTypes, users] = await Promise.all([
      ensureProjectStatuses(config, project.id),
      ensureProjectCategories(config, project.id),
      ensureProjectIssueTypes(config, project.id),
      ensureProjectUsers(config, project.id)
    ]);

    details.push({
      projectId: project.id,
      name: project.name,
      projectKey: project.projectKey,
      statuses,
      categories,
      issueTypes,
      users,
      currentUserId
    });
  }

  return details;
}

export async function createIssue(params: CreateIssueParams): Promise<CreatedIssueResponse> {
  if (!Number.isFinite(params.projectId) || params.projectId <= 0) {
    throw new Error("Invalid project id");
  }
  if (!Number.isFinite(params.issueTypeId) || params.issueTypeId <= 0) {
    throw new Error("Invalid issue type id");
  }
  if (!params.summary || !params.summary.trim()) {
    throw new Error("Summary is required");
  }

  const config = await ensureAuthConfig();
  await ensureHostPermission(config);

  const base = backlogBaseUrl(config);
  const url = new URL("/api/v2/issues", `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);

  const body = new URLSearchParams();
  body.set("projectId", String(params.projectId));
  body.set("issueTypeId", String(params.issueTypeId));
  body.set("summary", params.summary.trim());
  if (params.description) {
    body.set("description", params.description);
  }
  if (params.startDate) {
    body.set("startDate", params.startDate);
  }
  if (params.dueDate) {
    body.set("dueDate", params.dueDate);
  }
  const priorityId = Number.isFinite(params.priorityId) && params.priorityId ? Number(params.priorityId) : 3;
  body.set("priorityId", String(priorityId));
  if (params.categoryId) {
    body.append("categoryId[]", String(params.categoryId));
  }
  if (Number.isFinite(params.assigneeId) && params.assigneeId) {
    body.set("assigneeId", String(params.assigneeId));
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`Backlog API error ${response.status}${text ? `: ${text}` : ""}`);
    (error as Error & { code?: string }).code = response.status === 401 ? "REQUEST_DENIED" : "NETWORK_ERROR";
    throw error;
  }

  const created = (await response.json()) as CreatedIssueResponse;

  cachedBuckets = null;
  void chrome.storage.local.set({ [BACKLOG_ISSUES_REVISION_KEY]: Date.now() });
  return created;
}

export async function updateIssueDueDate(issueId: number, dueDate: string): Promise<void> {
  if (!Number.isFinite(issueId) || issueId <= 0) {
    throw new Error("Invalid issue id");
  }
  if (!dueDate) {
    throw new Error("Invalid due date");
  }
  const config = await ensureAuthConfig();
  await ensureHostPermission(config);
  try {
    await updateIssueDueDateInternal(config, issueId, dueDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const needsStartDateUpdate =
      message.includes("開始日") ||
      message.includes("code\":7") ||
      message.includes("start date") ||
      message.includes("StartDate");
    if (!needsStartDateUpdate) {
      throw error;
    }
    await updateIssueDueDateInternal(config, issueId, dueDate, dueDate);
  }
  cachedBuckets = null;
  void chrome.storage.local.set({ [BACKLOG_ISSUES_REVISION_KEY]: Date.now() });
}

export async function getTodayTomorrowIssues(force = false): Promise<BacklogIssueBuckets> {
  if (!force && cachedBuckets && Date.now() - cachedBuckets.fetchedAt < CACHE_TTL_MS) {
    return cachedBuckets.data;
  }

  let projectIds: number[] = [];
  try {
    const config = await ensureAuthConfig();
    await ensureHostPermission(config);
    const user = await ensureCurrentUser(config);
    const issues: BacklogIssueResponse[] = [];
    let offset = 0;
    while (issues.length < MAX_FETCH_COUNT) {
      const remaining = MAX_FETCH_COUNT - issues.length;
      const pageSize = Math.min(MAX_PAGE_SIZE, remaining);
      const page = await fetchAssignedIssues(config, user.id, offset, pageSize);
      issues.push(...page);
      if (page.length < pageSize) {
        break;
      }
      offset += page.length;
    }
    projectIds = Array.from(
      new Set(issues.map((issue) => issue.projectId).filter((id): id is number => typeof id === "number" && id > 0))
    );
    console.debug("Resolved project IDs from issues", projectIds);
    const statusBundles: BacklogProjectStatuses[] = [];
    const projectInfoPairs: Array<[number, { name: string; projectKey: string }]> = [];
    for (const projectId of projectIds) {
      const [statuses, projectInfo] = await Promise.all([
        ensureProjectStatuses(config, projectId),
        ensureProjectInfo(config, projectId)
      ]);
      statusBundles.push({ projectId, statuses });
      projectInfoPairs.push([projectId, projectInfo]);
    }
    const projectInfoMap = new Map(projectInfoPairs);
    const buckets = bucketIssues(issues, config, projectInfoMap);
    const result: BacklogIssueBuckets = {
      ...buckets,
      statuses: statusBundles
    };
    cachedBuckets = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = cachedBuckets?.data;

    if (isMissingConfigError(error)) {
      return createEmptyBuckets("missing-config", message, projectIds);
    }

    if (isPermissionError(error)) {
      return fallback
        ? { ...fallback, stale: true, errorCode: "permission-denied", errorMessage: message }
        : createEmptyBuckets("permission-denied", message, projectIds);
    }

    if (isRequestDeniedError(error)) {
      return fallback
        ? { ...fallback, stale: true, errorCode: "request-denied", errorMessage: message }
        : createEmptyBuckets("request-denied", message, projectIds);
    }

    if (fallback) {
      return { ...fallback, stale: true, errorCode: "network-error", errorMessage: message };
    }

    return createEmptyBuckets("network-error", message, projectIds);
  }
}

async function ensureAuthConfig(): Promise<BacklogAuthConfig> {
  const config = await getBacklogAuthConfig();
  if (!config) {
    const error = new Error("Backlog API キーが未設定です。オプションページから登録してください。");
    (error as Error & { code?: string }).code = "MISSING_CONFIG";
    throw error;
  }
  return config;
}

async function ensureHostPermission(config: BacklogAuthConfig): Promise<void> {
  const origin = `${backlogBaseUrl(config)}/`;
  const permission = { origins: [`${origin}*`] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) {
    return;
  }
  const error = new Error(`${origin} へのアクセス許可が必要です。オプションページで許可してください。`);
  (error as Error & { code?: string }).code = "PERMISSION_DENIED";
  throw error;
}

async function ensureCurrentUser(config?: BacklogAuthConfig): Promise<BacklogUserResponse> {
  if (currentUser) {
    return currentUser;
  }
  const resolvedConfig = config ?? (await ensureAuthConfig());
  const response = await backlogFetch<BacklogUserResponse>(resolvedConfig, "/api/v2/users/myself");
  currentUser = response;
  return response;
}

async function fetchAssignedIssues(
  config: BacklogAuthConfig,
  assigneeId: number,
  offset: number,
  count: number
): Promise<BacklogIssueResponse[]> {
  const params: Record<string, string | number | Array<string | number>> = {
    "assigneeId[]": [assigneeId],
    sort: "dueDate",
    order: "desc",
    count: Math.max(1, Math.min(count, MAX_PAGE_SIZE))
  };
  if (offset > 0) {
    params.offset = offset;
  }

  const response = await backlogFetch<BacklogIssueResponse[]>(config, "/api/v2/issues", params);
  console.debug("Fetched issues", { count: response.length, projectIds: Array.from(new Set(response.map((issue) => issue.projectId))) });
  return response;
}

async function ensureProjectStatuses(config: BacklogAuthConfig, projectId: number): Promise<BacklogStatusLite[]> {
  const cached = projectStatusCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  type StatusResponse = {
    id: number;
    name: string;
    displayOrder: number;
  };

  try {
  const response = await backlogFetch<StatusResponse[]>(config, `/api/v2/projects/${projectId}/statuses`);
  console.debug("Fetched project statuses", { projectId, count: response.length });
    const normalized = response
      .map((status) => ({ id: status.id, name: status.name, displayOrder: status.displayOrder ?? 0 }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
    projectStatusCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch statuses for project ${projectId}`, error);
    const fallback = projectStatusCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}

async function ensureProjectCategories(config: BacklogAuthConfig, projectId: number): Promise<BacklogCategoryLite[]> {
  const cached = projectCategoryCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  type CategoryResponse = {
    id: number;
    name: string;
  };

  try {
    const response = await backlogFetch<CategoryResponse[]>(config, `/api/v2/projects/${projectId}/categories`);
    const normalized = response.map((category) => ({ id: category.id, name: category.name }));
    projectCategoryCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch categories for project ${projectId}`, error);
    const fallback = projectCategoryCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}

async function ensureProjectIssueTypes(config: BacklogAuthConfig, projectId: number): Promise<BacklogIssueTypeLite[]> {
  const cached = projectIssueTypeCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  type IssueTypeResponse = {
    id: number;
    name: string;
    color?: string;
    displayOrder?: number;
  };

  try {
    const response = await backlogFetch<IssueTypeResponse[]>(config, `/api/v2/projects/${projectId}/issueTypes`);
    const normalized = response
      .map((issueType) => ({
        id: issueType.id,
        name: issueType.name,
        color: issueType.color,
        displayOrder: issueType.displayOrder ?? 0
      }))
      .sort((a, b) => {
        const orderDelta = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        return orderDelta !== 0 ? orderDelta : a.name.localeCompare(b.name, "ja");
      })
      .map(({ displayOrder: _discard, ...rest }) => rest);
    projectIssueTypeCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch issue types for project ${projectId}`, error);
    const fallback = projectIssueTypeCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}

async function ensureProjectUsers(config: BacklogAuthConfig, projectId: number): Promise<BacklogUserLite[]> {
  const cached = projectUserCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  type ProjectUserResponse = {
    id: number;
    name: string;
  };

  try {
    const response = await backlogFetch<ProjectUserResponse[]>(config, `/api/v2/projects/${projectId}/users`);
    const normalized = response
      .map((user) => ({ id: user.id, name: user.name }))
      .sort((a, b) => a.id - b.id);
    projectUserCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch users for project ${projectId}`, error);
    const fallback = projectUserCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}

async function ensureProjectInfo(
  config: BacklogAuthConfig,
  projectId: number
): Promise<{ name: string; projectKey: string }> {
  const cached = projectInfoCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  type ProjectResponse = {
    id: number;
    name: string;
    projectKey: string;
  };

  try {
    const response = await backlogFetch<ProjectResponse>(config, `/api/v2/projects/${projectId}`);
    const info = { name: response.name, projectKey: response.projectKey };
    projectInfoCache.set(projectId, { data: info, fetchedAt: now });
    return info;
  } catch (error) {
    console.warn(`Failed to fetch project info for project ${projectId}`, error);
    const fallback = projectInfoCache.get(projectId);
    if (fallback) {
      return fallback.data;
    }
    return { name: `Project ${projectId}`, projectKey: `${projectId}` };
  }
}

function collectCachedProjectStatuses(projectIds: number[] = []): BacklogProjectStatuses[] {
  const ids = projectIds.length ? projectIds : Array.from(projectStatusCache.keys());
  return ids
    .map((projectId) => {
      const entry = projectStatusCache.get(projectId);
      if (!entry) {
        return null;
      }
      return { projectId, statuses: entry.data } as BacklogProjectStatuses;
    })
    .filter((bundle): bundle is BacklogProjectStatuses => bundle !== null);
}

async function backlogFetch<T>(
  config: BacklogAuthConfig,
  path: string,
  params: Record<string, string | number | Array<string | number>> = {}
): Promise<T> {
  const base = backlogBaseUrl(config);
  const url = new URL(path, `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
    } else if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`Backlog API error ${response.status}`);
    (error as Error & { code?: string }).code = response.status === 401 ? "REQUEST_DENIED" : "NETWORK_ERROR";
    throw error;
  }

  return (await response.json()) as T;
}

async function updateIssueStatus(config: BacklogAuthConfig, issueId: number, statusId: number): Promise<void> {
  const base = backlogBaseUrl(config);
  const url = new URL(`/api/v2/issues/${issueId}`, `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);

  const body = new URLSearchParams();
  body.set("statusId", String(statusId));

  console.debug("Updating issue status", { issueId, statusId, url: url.toString() });

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    const error = new Error(message || `Backlog API error ${response.status}`);
    console.warn("Issue status update failed", { issueId, statusId, status: response.status, message });
    throw error;
  }

  console.debug("Updated issue status", { issueId, statusId });
}

async function updateIssueDueDateInternal(
  config: BacklogAuthConfig,
  issueId: number,
  dueDate: string,
  startDate?: string
): Promise<void> {
  const base = backlogBaseUrl(config);
  const url = new URL(`/api/v2/issues/${issueId}`, `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);

  const body = new URLSearchParams();
  body.set("dueDate", dueDate);
  if (startDate) {
    body.set("startDate", startDate);
  }
  body.set("comment", "期限日を更新しました");

  console.debug("Updating issue due date", { issueId, dueDate, startDate, url: url.toString() });

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    const error = new Error(message || `Backlog API error ${response.status}`);
    console.warn("Issue due date update failed", { issueId, dueDate, status: response.status, message });
    throw error;
  }

  console.debug("Updated issue due date", { issueId, dueDate });
}

function bucketIssues(
  issues: BacklogIssueResponse[],
  config: BacklogAuthConfig,
  projectInfoMap: Map<number, { name: string; projectKey: string }>
): Omit<BacklogIssueBuckets, "statuses"> {
  const baseUrl = backlogBaseUrl(config);
  const today = truncateDate(new Date());
  const todayKey = formatDateKey(today);
  const dayOfWeek = today.getDay();
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  const weekEnd = truncateDate(addDays(today, daysUntilSunday));
  const weekEndKey = formatDateKey(weekEnd);

  const normalized: BacklogIssueLite[] = issues
    .filter((issue) => issue.assignee) // only assigned
    .filter((issue) => !isCompletedStatus(issue.status?.name ?? ""))
    .map((issue) => {
      const projectIdRaw =
        typeof issue.projectId === "number" && Number.isFinite(issue.projectId)
          ? issue.projectId
          : (issue.project as { id?: number } | undefined)?.id ?? 0;
      if (!projectIdRaw) {
        console.warn("Issue missing projectId", {
          issueKey: issue.issueKey,
          projectId: issue.projectId,
          project: issue.project
        });
      }
      const categoryName = issue.category?.map((item) => item.name).join(", ") || null;
      const projectInfo = projectInfoMap.get(projectIdRaw);
      const projectName =
        projectInfo?.name ||
        issue.project?.name ||
        projectInfo?.projectKey ||
        (issue.project as { projectKey?: string } | undefined)?.projectKey ||
        projectIdRaw.toString();
      const url = `${baseUrl}/view/${issue.issueKey}`;
      return {
        id: issue.id,
        issueKey: issue.issueKey,
        summary: issue.summary,
        description: issue.description ?? "",
        status: issue.status?.name ?? "未設定",
        statusId: issue.status?.id ?? null,
        projectId: projectIdRaw,
        projectName: projectName ?? `Project ${projectIdRaw}`,
        categoryName,
        dueDate: normalizeDueDate(issue.dueDate),
        created: issue.created,
        url
      };
    });

  const past: BacklogIssueLite[] = [];
  const todayList: BacklogIssueLite[] = [];
  const thisWeekList: BacklogIssueLite[] = [];
  const noDueList: BacklogIssueLite[] = [];

  normalized.forEach((issue) => {
    const due = issue.dueDate;
    if (!due) {
      noDueList.push(issue);
      return;
    }
    if (due < todayKey) {
      past.push(issue);
    } else if (due === todayKey) {
      todayList.push(issue);
    } else if (due <= weekEndKey) {
      thisWeekList.push(issue);
    }
  });

  const sortByProjectThenCreated = (a: BacklogIssueLite, b: BacklogIssueLite) => {
    if (a.projectId !== b.projectId) {
      return a.projectId - b.projectId;
    }
    const aCreated = new Date(a.created).getTime();
    const bCreated = new Date(b.created).getTime();
    return aCreated - bCreated;
  };

  past.sort(sortByProjectThenCreated);
  todayList.sort(sortByProjectThenCreated);
  thisWeekList.sort(sortByProjectThenCreated);
  noDueList.sort(sortByProjectThenCreated);

  return {
    past,
    today: todayList,
    thisWeek: thisWeekList,
    noDue: noDueList,
    fetchedAt: new Date().toISOString()
  };
}

function createEmptyBuckets(
  errorCode: BacklogIssueBuckets["errorCode"],
  errorMessage: string,
  projectIds: number[] = []
): BacklogIssueBuckets {
  return {
    past: [],
    today: [],
    thisWeek: [],
    noDue: [],
    statuses: collectCachedProjectStatuses(projectIds),
    fetchedAt: new Date().toISOString(),
    errorCode,
    errorMessage
  };
}

function isCompletedStatus(statusName: string): boolean {
  if (!statusName) {
    return false;
  }
  const normalized = statusName.trim();
  return normalized.includes("完了");
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function truncateDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeDueDate(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const truncated = truncateDate(date);
  return formatDateKey(truncated);
}

function isMissingConfigError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "MISSING_CONFIG");
}

function isPermissionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "PERMISSION_DENIED");
}

function isRequestDeniedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "REQUEST_DENIED");
}
