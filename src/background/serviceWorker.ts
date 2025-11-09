import { getBacklogAuthConfig, BACKLOG_AUTH_KEY, normalizeLlmProvider } from "@shared/backlogConfig";
import {
  getTodayTomorrowIssues,
  clearBacklogIssueCache,
  updateIssueStatusById,
  getProjectStatusesById,
  updateIssueDueDate,
  getAllProjectDetails,
  createIssue,
  CreateIssueParams
} from "./backlogClient";

const SIDE_PANEL_PATH = "sidepanel/index.html";
const CHATGPT_URL_PATTERNS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const GEMINI_URL_PATTERNS = ["https://gemini.google.com/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "backlog-quick-capture",
    title: "Backlog に送る",
    contexts: ["selection"]
  });

  chrome.sidePanel.setOptions({
    enabled: true,
    path: SIDE_PANEL_PATH
  }).catch((error) => console.warn("Failed to preset side panel options:", error));
});

chrome.action.onClicked.addListener(async (tab) => {
  await openSidePanel(tab.windowId ?? undefined);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-side-panel") {
    await openSidePanel(tab?.windowId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "backlog-auth:get") {
    getBacklogAuthConfig()
      .then((config) => sendResponse({ config }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "sidepanel:toggle") {
    toggleSidePanelFromMessage(sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issues:list") {
    getTodayTomorrowIssues(Boolean(message?.force))
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:updateStatus") {
    const issueId = Number(message.issueId);
    const statusId = Number(message.statusId);
    updateIssueStatusById(issueId, statusId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:updateDueDate") {
    const issueId = Number(message.issueId);
    const dueDate = String(message.dueDate ?? "");
    updateIssueDueDate(issueId, dueDate)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:project:statuses") {
    const projectId = Number(message.projectId);
    getProjectStatusesById(projectId)
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:projects:details") {
    getAllProjectDetails(Boolean(message?.force))
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "backlog:issue:create") {
    const payload = message.payload ?? {};
    const params: CreateIssueParams = {
      projectId: Number(payload.projectId),
      issueTypeId: Number(payload.issueTypeId),
      summary: String(payload.summary ?? ""),
      description: typeof payload.description === "string" ? payload.description : undefined,
      startDate: typeof payload.startDate === "string" && payload.startDate ? payload.startDate : undefined,
      dueDate: typeof payload.dueDate === "string" && payload.dueDate ? payload.dueDate : undefined,
      assigneeId: Number(payload.assigneeId) > 0 ? Number(payload.assigneeId) : undefined,
      categoryId: Number(payload.categoryId) > 0 ? Number(payload.categoryId) : undefined
    };
    createIssue(params)
      .then((issue) => sendResponse({ ok: true, issue }))
      .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
    return true;
  }
  if (message?.type === "llm:json:request") {
    const provider = normalizeLlmProvider(message?.provider);
    extractJsonFromProvider(provider)
      .then((result) => sendResponse({ data: result.data, raw: result.raw, tabId: result.tabId }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "chatgpt:json:request") {
    extractJsonFromProvider("chatgpt")
      .then((result) => sendResponse({ data: result.data, raw: result.raw }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return undefined;
});

async function openSidePanel(windowId?: number): Promise<void> {
  if (!chrome.sidePanel?.open) {
    throw new Error("Chrome のサイドパネル API が利用できません。ブラウザのバージョンや実験機能を確認してください。");
  }

  const args =
    typeof windowId === "number" && windowId !== chrome.windows.WINDOW_ID_NONE
      ? { windowId }
      : undefined;

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

async function toggleSidePanelFromMessage(sender: chrome.runtime.MessageSender): Promise<void> {
  await openSidePanel(sender.tab?.windowId);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && BACKLOG_AUTH_KEY in changes) {
    clearBacklogIssueCache();
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type JsonExtractionResult = {
  data: unknown;
  raw: string;
  tabId: number;
  windowId: number | undefined;
};

async function extractJsonFromProvider(provider: "chatgpt" | "gemini"): Promise<JsonExtractionResult> {
  if (provider === "gemini") {
    return extractJsonFromTabs({
      patterns: GEMINI_URL_PATTERNS,
      messageType: "gemini:extract-json",
      notFoundMessage: "Gemini のタブが見つかりません。先に Gemini を開いてください。",
      failureMessage: "Gemini から有効な JSON を取得できませんでした。"
    });
  }
  return extractJsonFromTabs({
    patterns: CHATGPT_URL_PATTERNS,
    messageType: "chatgpt:extract-json",
    notFoundMessage: "ChatGPT のタブが見つかりません。先に ChatGPT を開いてください。",
    failureMessage: "ChatGPT から有効な JSON を取得できませんでした。"
  });
}

async function extractJsonFromTabs({
  patterns,
  messageType,
  notFoundMessage,
  failureMessage
}: {
  patterns: string[];
  messageType: string;
  notFoundMessage: string;
  failureMessage: string;
}): Promise<JsonExtractionResult> {
  const tabs = await chrome.tabs.query({ url: patterns });
  if (!tabs.length) {
    throw new Error(notFoundMessage);
  }

  const activeTabs = tabs.filter((tab) => tab.active);
  const inactiveTabs = tabs.filter((tab) => !tab.active);
  const orderedTabs = [...activeTabs, ...inactiveTabs];

  let matchedResults: JsonExtractionResult[] = [];
  let lastError: unknown = null;
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
    throw new Error("複数のタブで JSON が検出されたため、どの結果を採用するか判断できません。");
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
