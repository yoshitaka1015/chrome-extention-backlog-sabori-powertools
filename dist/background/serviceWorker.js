// src/shared/storage.ts
var storage = chrome.storage.local;
function storageGet(keys) {
  return new Promise((resolve, reject) => {
    storage.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve(items);
      }
    });
  });
}

// src/shared/backlogConfig.ts
var BACKLOG_AUTH_KEY = "backlogAuth";
var BACKLOG_ISSUES_REVISION_KEY = "backlogManagerIssuesRevision";
var ISSUE_FETCH_LIMIT_MIN = 50;
var ISSUE_FETCH_LIMIT_MAX = 1e3;
var DEFAULT_ISSUE_FETCH_LIMIT = 1e3;
var DEFAULT_LLM_PROVIDER = "chatgpt";
async function getBacklogAuthConfig() {
  const result = await storageGet([BACKLOG_AUTH_KEY]);
  const config = result[BACKLOG_AUTH_KEY];
  if (!config) {
    return null;
  }
  if (config.showNoDueSection === void 0) {
    config.showNoDueSection = true;
  }
  if (config.showTomorrowSection === void 0) {
    config.showTomorrowSection = true;
  }
  config.issueFetchLimit = normalizeIssueFetchLimit(config.issueFetchLimit);
  config.excludedProjects = normalizeExcludedProjects(config.excludedProjects);
  config.llmProvider = normalizeLlmProvider(config.llmProvider);
  return config;
}
function backlogBaseUrl(config) {
  return `https://${config.spaceDomain}.${config.host}`;
}
function normalizeIssueFetchLimit(value) {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_ISSUE_FETCH_LIMIT;
  }
  const numericValue = Number(value);
  return Math.min(ISSUE_FETCH_LIMIT_MAX, Math.max(ISSUE_FETCH_LIMIT_MIN, Math.floor(numericValue)));
}
function normalizeExcludedProjects(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = /* @__PURE__ */ new Set();
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
function normalizeLlmProvider(value) {
  if (value === "gemini") {
    return "gemini";
  }
  return DEFAULT_LLM_PROVIDER;
}

// src/background/backlogClient.ts
var CACHE_TTL_MS = 10 * 60 * 1e3;
var MAX_PAGE_SIZE = 100;
var cachedBuckets = null;
var projectStatusCache = /* @__PURE__ */ new Map();
var projectInfoCache = /* @__PURE__ */ new Map();
var projectCategoryCache = /* @__PURE__ */ new Map();
var projectIssueTypeCache = /* @__PURE__ */ new Map();
var projectUserCache = /* @__PURE__ */ new Map();
var currentUser = null;
function clearBacklogIssueCache() {
  cachedBuckets = null;
  projectStatusCache.clear();
  projectInfoCache.clear();
  projectCategoryCache.clear();
  projectIssueTypeCache.clear();
  projectUserCache.clear();
  currentUser = null;
}
async function updateIssueStatusById(issueId, statusId) {
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
async function getProjectStatusesById(projectId) {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new Error("Invalid project id");
  }
  const config = await ensureAuthConfig();
  await ensureHostPermission(config);
  const statuses = await ensureProjectStatuses(config, projectId);
  return { projectId, statuses };
}
async function getAllProjectDetails(force = false) {
  const config = await ensureAuthConfig();
  await ensureHostPermission(config);
  const current = await ensureCurrentUser(config).catch(() => null);
  const currentUserId = current?.id ?? null;
  if (force) {
    clearProjectMetadataCaches();
  }
  const projects = await backlogFetch(config, "/api/v2/projects");
  const details = [];
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
function clearProjectMetadataCaches() {
  projectStatusCache.clear();
  projectInfoCache.clear();
  projectCategoryCache.clear();
  projectIssueTypeCache.clear();
  projectUserCache.clear();
}
async function createIssue(params) {
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
    error.code = response.status === 401 ? "REQUEST_DENIED" : "NETWORK_ERROR";
    throw error;
  }
  const created = await response.json();
  cachedBuckets = null;
  void chrome.storage.local.set({ [BACKLOG_ISSUES_REVISION_KEY]: Date.now() });
  return created;
}
async function updateIssueDueDate(issueId, dueDate) {
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
    const needsStartDateUpdate = message.includes("\u958B\u59CB\u65E5") || message.includes('code":7') || message.includes("start date") || message.includes("StartDate");
    if (!needsStartDateUpdate) {
      throw error;
    }
    await updateIssueDueDateInternal(config, issueId, dueDate, dueDate);
  }
  cachedBuckets = null;
  void chrome.storage.local.set({ [BACKLOG_ISSUES_REVISION_KEY]: Date.now() });
}
async function getTodayTomorrowIssues(force = false) {
  if (!force && cachedBuckets && Date.now() - cachedBuckets.fetchedAt < CACHE_TTL_MS) {
    return cachedBuckets.data;
  }
  let projectIds = [];
  try {
    const config = await ensureAuthConfig();
    await ensureHostPermission(config);
    const user = await ensureCurrentUser(config);
    const issueFetchLimit = normalizeIssueFetchLimit(config.issueFetchLimit);
    const issues = [];
    let offset = 0;
    while (issues.length < issueFetchLimit) {
      const remaining = issueFetchLimit - issues.length;
      const pageSize = Math.min(MAX_PAGE_SIZE, remaining);
      const page = await fetchAssignedIssues(config, user.id, offset, pageSize);
      issues.push(...page);
      if (page.length < pageSize) {
        break;
      }
      offset += page.length;
    }
    projectIds = Array.from(
      new Set(issues.map((issue) => issue.projectId).filter((id) => typeof id === "number" && id > 0))
    );
    console.debug("Resolved project IDs from issues", projectIds);
    const statusBundles = [];
    const projectInfoPairs = [];
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
    const result = {
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
      return fallback ? { ...fallback, stale: true, errorCode: "permission-denied", errorMessage: message } : createEmptyBuckets("permission-denied", message, projectIds);
    }
    if (isRequestDeniedError(error)) {
      return fallback ? { ...fallback, stale: true, errorCode: "request-denied", errorMessage: message } : createEmptyBuckets("request-denied", message, projectIds);
    }
    if (fallback) {
      return { ...fallback, stale: true, errorCode: "network-error", errorMessage: message };
    }
    return createEmptyBuckets("network-error", message, projectIds);
  }
}
async function ensureAuthConfig() {
  const config = await getBacklogAuthConfig();
  if (!config) {
    const error = new Error("Backlog API \u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002\u30AA\u30D7\u30B7\u30E7\u30F3\u30DA\u30FC\u30B8\u304B\u3089\u767B\u9332\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    error.code = "MISSING_CONFIG";
    throw error;
  }
  return config;
}
async function ensureHostPermission(config) {
  const origin = `${backlogBaseUrl(config)}/`;
  const permission = { origins: [`${origin}*`] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) {
    return;
  }
  const error = new Error(`${origin} \u3078\u306E\u30A2\u30AF\u30BB\u30B9\u8A31\u53EF\u304C\u5FC5\u8981\u3067\u3059\u3002\u30AA\u30D7\u30B7\u30E7\u30F3\u30DA\u30FC\u30B8\u3067\u8A31\u53EF\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
  error.code = "PERMISSION_DENIED";
  throw error;
}
async function ensureCurrentUser(config) {
  if (currentUser) {
    return currentUser;
  }
  const resolvedConfig = config ?? await ensureAuthConfig();
  const response = await backlogFetch(resolvedConfig, "/api/v2/users/myself");
  currentUser = response;
  return response;
}
async function fetchAssignedIssues(config, assigneeId, offset, count) {
  const params = {
    "assigneeId[]": [assigneeId],
    sort: "dueDate",
    order: "desc",
    count: Math.max(1, Math.min(count, MAX_PAGE_SIZE))
  };
  if (offset > 0) {
    params.offset = offset;
  }
  const response = await backlogFetch(config, "/api/v2/issues", params);
  console.debug("Fetched issues", { count: response.length, projectIds: Array.from(new Set(response.map((issue) => issue.projectId))) });
  return response;
}
async function ensureProjectStatuses(config, projectId) {
  const cached = projectStatusCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await backlogFetch(config, `/api/v2/projects/${projectId}/statuses`);
    console.debug("Fetched project statuses", { projectId, count: response.length });
    const normalized = response.map((status) => ({ id: status.id, name: status.name, displayOrder: status.displayOrder ?? 0 })).sort((a, b) => a.displayOrder - b.displayOrder);
    projectStatusCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch statuses for project ${projectId}`, error);
    const fallback = projectStatusCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}
async function ensureProjectCategories(config, projectId) {
  const cached = projectCategoryCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await backlogFetch(config, `/api/v2/projects/${projectId}/categories`);
    const normalized = response.map((category) => ({ id: category.id, name: category.name }));
    projectCategoryCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch categories for project ${projectId}`, error);
    const fallback = projectCategoryCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}
async function ensureProjectIssueTypes(config, projectId) {
  const cached = projectIssueTypeCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await backlogFetch(config, `/api/v2/projects/${projectId}/issueTypes`);
    const normalized = response.map((issueType) => ({
      id: issueType.id,
      name: issueType.name,
      color: issueType.color,
      displayOrder: issueType.displayOrder ?? 0
    })).sort((a, b) => {
      const orderDelta = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      return orderDelta !== 0 ? orderDelta : a.name.localeCompare(b.name, "ja");
    }).map(({ displayOrder: _discard, ...rest }) => rest);
    projectIssueTypeCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch issue types for project ${projectId}`, error);
    const fallback = projectIssueTypeCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}
async function ensureProjectUsers(config, projectId) {
  const cached = projectUserCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await backlogFetch(config, `/api/v2/projects/${projectId}/users`);
    const normalized = response.map((user) => ({ id: user.id, name: user.name })).sort((a, b) => a.id - b.id);
    projectUserCache.set(projectId, { data: normalized, fetchedAt: now });
    return normalized;
  } catch (error) {
    console.warn(`Failed to fetch users for project ${projectId}`, error);
    const fallback = projectUserCache.get(projectId);
    return fallback ? fallback.data : [];
  }
}
async function ensureProjectInfo(config, projectId) {
  const cached = projectInfoCache.get(projectId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await backlogFetch(config, `/api/v2/projects/${projectId}`);
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
function collectCachedProjectStatuses(projectIds = []) {
  const ids = projectIds.length ? projectIds : Array.from(projectStatusCache.keys());
  return ids.map((projectId) => {
    const entry = projectStatusCache.get(projectId);
    if (!entry) {
      return null;
    }
    return { projectId, statuses: entry.data };
  }).filter((bundle) => bundle !== null);
}
async function backlogFetch(config, path, params = {}) {
  const base = backlogBaseUrl(config);
  const url = new URL(path, `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
    } else if (value !== void 0 && value !== null) {
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
    error.code = response.status === 401 ? "REQUEST_DENIED" : "NETWORK_ERROR";
    throw error;
  }
  return await response.json();
}
async function updateIssueStatus(config, issueId, statusId) {
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
async function updateIssueDueDateInternal(config, issueId, dueDate, startDate) {
  const base = backlogBaseUrl(config);
  const url = new URL(`/api/v2/issues/${issueId}`, `${base}/`);
  url.searchParams.set("apiKey", config.apiKey);
  const body = new URLSearchParams();
  body.set("dueDate", dueDate);
  if (startDate) {
    body.set("startDate", startDate);
  }
  body.set("comment", "\u671F\u9650\u65E5\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F");
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
function bucketIssues(issues, config, projectInfoMap) {
  const baseUrl = backlogBaseUrl(config);
  const today = truncateDate(/* @__PURE__ */ new Date());
  const todayKey = formatDateKey(today);
  const dayOfWeek = today.getDay();
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  const weekEnd = truncateDate(addDays(today, daysUntilSunday));
  const weekEndKey = formatDateKey(weekEnd);
  const normalized = issues.filter((issue) => issue.assignee).filter((issue) => !isCompletedStatus(issue.status?.name ?? "")).map((issue) => {
    const projectIdRaw = typeof issue.projectId === "number" && Number.isFinite(issue.projectId) ? issue.projectId : issue.project?.id ?? 0;
    if (!projectIdRaw) {
      console.warn("Issue missing projectId", {
        issueKey: issue.issueKey,
        projectId: issue.projectId,
        project: issue.project
      });
    }
    const categoryName = issue.category?.map((item) => item.name).join(", ") || null;
    const projectInfo = projectInfoMap.get(projectIdRaw);
    const projectName = projectInfo?.name || issue.project?.name || projectInfo?.projectKey || issue.project?.projectKey || projectIdRaw.toString();
    const url = `${baseUrl}/view/${issue.issueKey}`;
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      summary: issue.summary,
      description: issue.description ?? "",
      status: issue.status?.name ?? "\u672A\u8A2D\u5B9A",
      statusId: issue.status?.id ?? null,
      projectId: projectIdRaw,
      projectName: projectName ?? `Project ${projectIdRaw}`,
      categoryName,
      dueDate: normalizeDueDate(issue.dueDate),
      created: issue.created,
      url
    };
  });
  const past = [];
  const todayList = [];
  const thisWeekList = [];
  const noDueList = [];
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
  const sortByProjectThenCreated = (a, b) => {
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
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createEmptyBuckets(errorCode, errorMessage, projectIds = []) {
  return {
    past: [],
    today: [],
    thisWeek: [],
    noDue: [],
    statuses: collectCachedProjectStatuses(projectIds),
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    errorCode,
    errorMessage
  };
}
function isCompletedStatus(statusName) {
  if (!statusName) {
    return false;
  }
  const normalized = statusName.trim();
  return normalized.includes("\u5B8C\u4E86");
}
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
function truncateDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function normalizeDueDate(input) {
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
function isMissingConfigError(error) {
  return Boolean(error && typeof error === "object" && error.code === "MISSING_CONFIG");
}
function isPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "PERMISSION_DENIED");
}
function isRequestDeniedError(error) {
  return Boolean(error && typeof error === "object" && error.code === "REQUEST_DENIED");
}

// src/background/serviceWorker.ts
var SIDE_PANEL_PATH = "sidepanel/index.html";
var CHATGPT_URL_PATTERNS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
var GEMINI_URL_PATTERNS = ["https://gemini.google.com/*"];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "backlog-quick-capture",
    title: "Backlog \u306B\u9001\u308B",
    contexts: ["selection"]
  });
  chrome.sidePanel.setOptions({
    enabled: true,
    path: SIDE_PANEL_PATH
  }).catch((error) => console.warn("Failed to preset side panel options:", error));
});
chrome.action.onClicked.addListener(async (tab) => {
  await openSidePanel(tab.windowId ?? void 0);
});
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-side-panel") {
    await openSidePanel(tab?.windowId);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "backlog-auth:get") {
    getBacklogAuthConfig().then((config) => sendResponse({ config })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "sidepanel:toggle") {
    toggleSidePanelFromMessage(sender).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issues:list") {
    getTodayTomorrowIssues(Boolean(message?.force)).then((data) => sendResponse({ data })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:updateStatus") {
    const issueId = Number(message.issueId);
    const statusId = Number(message.statusId);
    updateIssueStatusById(issueId, statusId).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:updateDueDate") {
    const issueId = Number(message.issueId);
    const dueDate = String(message.dueDate ?? "");
    updateIssueDueDate(issueId, dueDate).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:project:statuses") {
    const projectId = Number(message.projectId);
    getProjectStatusesById(projectId).then((data) => sendResponse({ data })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:projects:details") {
    getAllProjectDetails(Boolean(message?.force)).then((data) => sendResponse({ data })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:create") {
    const payload = message.payload ?? {};
    const params = {
      projectId: Number(payload.projectId),
      issueTypeId: Number(payload.issueTypeId),
      summary: String(payload.summary ?? ""),
      description: typeof payload.description === "string" ? payload.description : void 0,
      startDate: typeof payload.startDate === "string" && payload.startDate ? payload.startDate : void 0,
      dueDate: typeof payload.dueDate === "string" && payload.dueDate ? payload.dueDate : void 0,
      assigneeId: Number(payload.assigneeId) > 0 ? Number(payload.assigneeId) : void 0,
      categoryId: Number(payload.categoryId) > 0 ? Number(payload.categoryId) : void 0
    };
    createIssue(params).then((issue) => sendResponse({ ok: true, issue })).catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "llm:json:request") {
    const provider = normalizeLlmProvider(message?.provider);
    extractJsonFromProvider(provider).then((result) => sendResponse({ data: result.data, raw: result.raw, tabId: result.tabId })).catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "chatgpt:json:request") {
    extractJsonFromProvider("chatgpt").then((result) => sendResponse({ data: result.data, raw: result.raw })).catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return void 0;
});
async function openSidePanel(windowId) {
  if (!chrome.sidePanel?.open) {
    throw new Error("Chrome \u306E\u30B5\u30A4\u30C9\u30D1\u30CD\u30EB API \u304C\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u30D6\u30E9\u30A6\u30B6\u306E\u30D0\u30FC\u30B8\u30E7\u30F3\u3084\u5B9F\u9A13\u6A5F\u80FD\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  const args = typeof windowId === "number" && windowId !== chrome.windows.WINDOW_ID_NONE ? { windowId } : void 0;
  try {
    await chrome.sidePanel.open(args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Extension context invalidated")) {
      console.warn("Side panel context invalidated; retrying open after short delay");
      await delay(200);
      await chrome.sidePanel.open(args ?? {});
      return;
    }
    console.warn("Failed to open side panel:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
async function toggleSidePanelFromMessage(sender) {
  await openSidePanel(sender.tab?.windowId);
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && BACKLOG_AUTH_KEY in changes) {
    clearBacklogIssueCache();
  }
});
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function extractJsonFromProvider(provider) {
  if (provider === "gemini") {
    return extractJsonFromTabs({
      patterns: GEMINI_URL_PATTERNS,
      messageType: "gemini:extract-json",
      notFoundMessage: "Gemini \u306E\u30BF\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u5148\u306B Gemini \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002",
      failureMessage: "Gemini \u304B\u3089\u6709\u52B9\u306A JSON \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    });
  }
  return extractJsonFromTabs({
    patterns: CHATGPT_URL_PATTERNS,
    messageType: "chatgpt:extract-json",
    notFoundMessage: "ChatGPT \u306E\u30BF\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u5148\u306B ChatGPT \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002",
    failureMessage: "ChatGPT \u304B\u3089\u6709\u52B9\u306A JSON \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
  });
}
async function extractJsonFromTabs({
  patterns,
  messageType,
  notFoundMessage,
  failureMessage
}) {
  const tabs = await chrome.tabs.query({ url: patterns });
  if (!tabs.length) {
    throw new Error(notFoundMessage);
  }
  const activeTabs = tabs.filter((tab) => tab.active);
  const inactiveTabs = tabs.filter((tab) => !tab.active);
  const orderedTabs = [...activeTabs, ...inactiveTabs];
  let matchedResults = [];
  let lastError = null;
  for (const tab of orderedTabs) {
    if (!tab.id) {
      continue;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: messageType });
      if (response?.ok) {
        matchedResults.push({ data: response.data, raw: response.raw, tabId: tab.id, windowId: tab.windowId });
        if (matchedResults.length > 1) {
          break;
        }
        continue;
      }
      if (response?.error) {
        lastError = response.error;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (matchedResults.length > 1) {
    throw new Error("\u8907\u6570\u306E\u30BF\u30D6\u3067 JSON \u304C\u691C\u51FA\u3055\u308C\u305F\u305F\u3081\u3001\u3069\u306E\u7D50\u679C\u3092\u63A1\u7528\u3059\u308B\u304B\u5224\u65AD\u3067\u304D\u307E\u305B\u3093\u3002");
  }
  if (matchedResults.length === 1) {
    return matchedResults[0];
  }
  if (typeof lastError === "string" && lastError.trim().length > 0) {
    throw new Error(lastError);
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(failureMessage);
}
//# sourceMappingURL=serviceWorker.js.map
