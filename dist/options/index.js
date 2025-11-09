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
function storageSet(items) {
  return new Promise((resolve, reject) => {
    storage.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    storage.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// src/shared/backlogConfig.ts
var BACKLOG_AUTH_KEY = "backlogAuth";
var ISSUE_FETCH_LIMIT_MIN = 50;
var ISSUE_FETCH_LIMIT_MAX = 1e3;
var DEFAULT_ISSUE_FETCH_LIMIT = 1e3;
var DEFAULT_LLM_PROVIDER = "chatgpt";
var AUTO_IMPORT_DELAY_MIN = 10;
var AUTO_IMPORT_DELAY_MAX = 600;
var DEFAULT_AUTO_IMPORT_DELAY_SECONDS = 60;
var AUTO_CREATE_DELAY_MIN = 5;
var AUTO_CREATE_DELAY_MAX = 300;
var DEFAULT_AUTO_CREATE_DELAY_SECONDS = 15;
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
async function saveBacklogAuthConfig(config) {
  await storageSet({ [BACKLOG_AUTH_KEY]: config });
}
async function clearBacklogAuthConfig() {
  await storageRemove([BACKLOG_AUTH_KEY]);
}
function backlogBaseUrl(config) {
  return `https://${config.spaceDomain}.${config.host}`;
}
function backlogApiOrigin(config) {
  return `${backlogBaseUrl(config)}/`;
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
function normalizeAutoDelay(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.floor(Math.max(min, Math.min(max, numeric)));
  return clamped;
}

// src/shared/promptTemplate.ts
var CHATGPT_PROMPT_TEMPLATE_KEY = "chatgptPromptTemplate";
var DEFAULT_PROMPT_TEMPLATE = `You are a JSON extraction assistant. Read the unstructured input text and produce **only** a JSON object that validates against the JSON Schema provided below. All textual values (summary, description, category names, etc.) must be written in Japanese. Enforce the following domain rules:
- summary\u306F\u65E5\u672C\u8A9E\u306720\u6587\u5B57\u4EE5\u5185\u306B\u3057\u307E\u3059\u3002
- \u30B5\u30D6\u30BF\u30B9\u30AF\u3084\u30A2\u30AF\u30B7\u30E7\u30F3\u304C\u542B\u307E\u308C\u308B\u5834\u5408\u3001Backlog\u306E\u30C1\u30A7\u30C3\u30AF\u30DC\u30C3\u30AF\u30B9\u8A18\u6CD5 (\u4F8B: "- [ ] \u30BF\u30B9\u30AF") \u3067\u5217\u6319\u3057\u307E\u3059\u3002
- startDate\u304C\u5165\u529B\u6587\u3067\u6307\u5B9A\u3055\u308C\u3066\u3044\u306A\u3044\u5834\u5408\u306F {{TODAY}} \u3092\u8A2D\u5B9A\u3057\u307E\u3059\u3002
- \u308F\u304B\u3089\u306A\u3044\u5024\u306F null \u307E\u305F\u306F\u7A7A\u914D\u5217\u306B\u3057\u307E\u3059\u3002

Available project context:
- Issue types: {{ISSUE_TYPES}}
- Categories: {{CATEGORIES}}
- Assignees:
{{ASSIGNEES}}

Input text:
{{INPUT_TEXT}}

JSON Schema (Draft 2020-12):
{{JSON_SCHEMA}}

Output the JSON object now.`;
async function getPromptTemplate() {
  const stored = await storageGet([CHATGPT_PROMPT_TEMPLATE_KEY]);
  const value = stored[CHATGPT_PROMPT_TEMPLATE_KEY];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_PROMPT_TEMPLATE;
}
async function savePromptTemplate(value) {
  const normalized = value.trim().length > 0 ? value : DEFAULT_PROMPT_TEMPLATE;
  await storageSet({ [CHATGPT_PROMPT_TEMPLATE_KEY]: normalized });
}
async function clearPromptTemplate() {
  await storageRemove([CHATGPT_PROMPT_TEMPLATE_KEY]);
}

// src/options/index.ts
var form = document.getElementById("auth-form");
var statusEl = document.getElementById("status");
var clearButton = document.getElementById("clear-auth");
var promptForm = document.getElementById("prompt-form");
var promptTextarea = document.getElementById("prompt-template");
var promptResetButton = document.getElementById("prompt-reset");
var promptStatusEl = document.getElementById("prompt-status");
var issueFetchLimitInput = document.getElementById("issue-fetch-limit");
var excludedProjectsTextarea = document.getElementById("excluded-projects");
var llmProviderSelect = document.getElementById("llm-provider");
var autoImportDelayInput = document.getElementById("auto-import-delay");
var autoCreateDelayInput = document.getElementById("auto-create-delay");
var confirmDialog = null;
async function populateForm() {
  const config = await getBacklogAuthConfig();
  if (!form || !config) {
    return;
  }
  form.elements.namedItem("spaceDomain").value = config.spaceDomain;
  form.elements.namedItem("host").value = config.host;
  form.elements.namedItem("apiKey").value = config.apiKey;
  const showTomorrowInput = form.elements.namedItem("showTomorrowSection");
  if (showTomorrowInput) {
    showTomorrowInput.checked = config.showTomorrowSection !== false;
  }
  const showNoDueInput = form.elements.namedItem("showNoDueSection");
  if (showNoDueInput) {
    showNoDueInput.checked = config.showNoDueSection !== false;
  }
  if (issueFetchLimitInput) {
    issueFetchLimitInput.value = String(config.issueFetchLimit ?? DEFAULT_ISSUE_FETCH_LIMIT);
  }
  if (excludedProjectsTextarea) {
    excludedProjectsTextarea.value = (config.excludedProjects ?? []).join("\n");
  }
  if (llmProviderSelect) {
    llmProviderSelect.value = config.llmProvider ?? DEFAULT_LLM_PROVIDER;
  }
  if (autoImportDelayInput) {
    autoImportDelayInput.value = String(config.autoImportDelaySeconds ?? DEFAULT_AUTO_IMPORT_DELAY_SECONDS);
  }
  if (autoCreateDelayInput) {
    autoCreateDelayInput.value = String(config.autoCreateDelaySeconds ?? DEFAULT_AUTO_CREATE_DELAY_SECONDS);
  }
  setStatus(`\u4FDD\u5B58\u6E08\u307F: ${config.spaceDomain}.${config.host}`);
}
function setStatus(message, isError = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#dc2626" : "#16a34a";
}
function setPromptStatus(message, isError = false) {
  if (!promptStatusEl) {
    return;
  }
  promptStatusEl.textContent = message;
  promptStatusEl.style.color = isError ? "#dc2626" : "#16a34a";
}
async function handleSubmit(event) {
  event.preventDefault();
  if (!form) {
    return;
  }
  const formData = new FormData(form);
  const config = {
    spaceDomain: (formData.get("spaceDomain") ?? "").toString().trim(),
    host: formData.get("host") ?? "backlog.com",
    apiKey: (formData.get("apiKey") ?? "").toString().trim(),
    showTomorrowSection: formData.get("showTomorrowSection") === "on",
    showNoDueSection: formData.get("showNoDueSection") === "on"
  };
  if (issueFetchLimitInput) {
    const limitValue = Number(issueFetchLimitInput.value);
    config.issueFetchLimit = normalizeIssueFetchLimit(limitValue);
  }
  if (excludedProjectsTextarea) {
    config.excludedProjects = normalizeExcludedProjects(parseExcludedProjectsInput(excludedProjectsTextarea.value));
  }
  if (llmProviderSelect) {
    config.llmProvider = normalizeLlmProvider(llmProviderSelect.value);
  }
  if (autoImportDelayInput) {
    config.autoImportDelaySeconds = normalizeAutoDelay(
      Number(autoImportDelayInput.value),
      AUTO_IMPORT_DELAY_MIN,
      AUTO_IMPORT_DELAY_MAX,
      DEFAULT_AUTO_IMPORT_DELAY_SECONDS
    );
  }
  if (autoCreateDelayInput) {
    config.autoCreateDelaySeconds = normalizeAutoDelay(
      Number(autoCreateDelayInput.value),
      AUTO_CREATE_DELAY_MIN,
      AUTO_CREATE_DELAY_MAX,
      DEFAULT_AUTO_CREATE_DELAY_SECONDS
    );
  }
  if (!config.spaceDomain || !config.apiKey) {
    setStatus("\u30B9\u30DA\u30FC\u30B9\u30C9\u30E1\u30A4\u30F3\u3068 API \u30AD\u30FC\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", true);
    return;
  }
  await saveBacklogAuthConfig(config);
  const permissionGranted = await ensureHostPermission(config);
  if (!permissionGranted) {
    setStatus("\u30C9\u30E1\u30A4\u30F3\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u8A31\u53EF\u304C\u5FC5\u8981\u3067\u3059\u3002\u30D6\u30E9\u30A6\u30B6\u306E\u78BA\u8A8D\u30C0\u30A4\u30A2\u30ED\u30B0\u3092\u8A31\u53EF\u3057\u3066\u304F\u3060\u3055\u3044\u3002", true);
    return;
  }
  setStatus(`\u4FDD\u5B58\u3057\u307E\u3057\u305F: ${config.spaceDomain}.${config.host}`);
}
async function handleClear() {
  const existing = await getBacklogAuthConfig();
  await clearBacklogAuthConfig();
  if (form) {
    form.reset();
  }
  if (existing) {
    void removeHostPermission(existing);
  }
  setStatus("\u8A8D\u8A3C\u60C5\u5831\u3092\u524A\u9664\u3057\u307E\u3057\u305F\u3002", true);
}
function ensureConfirmDialog() {
  if (confirmDialog) {
    return confirmDialog;
  }
  const dialog = document.createElement("dialog");
  dialog.style.border = "none";
  dialog.style.borderRadius = "12px";
  dialog.style.padding = "24px";
  dialog.style.boxShadow = "0 24px 48px rgba(15, 23, 42, 0.25)";
  dialog.style.maxWidth = "320px";
  dialog.style.width = "90vw";
  dialog.style.fontFamily = "system-ui, sans-serif";
  const heading = document.createElement("h2");
  heading.textContent = "\u8A8D\u8A3C\u60C5\u5831\u3092\u30AF\u30EA\u30A2";
  heading.style.margin = "0 0 12px";
  heading.style.fontSize = "18px";
  const message = document.createElement("p");
  message.textContent = "\u4FDD\u5B58\u6E08\u307F\u306E\u30B9\u30DA\u30FC\u30B9\u60C5\u5831\u3068 API \u30AD\u30FC\u3092\u524A\u9664\u3057\u307E\u3059\u3002\u3088\u308D\u3057\u3044\u3067\u3059\u304B\uFF1F";
  message.style.margin = "0 0 20px";
  message.style.fontSize = "14px";
  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.gap = "12px";
  buttonRow.style.justifyContent = "flex-end";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "\u623B\u308B";
  cancel.style.background = "#e2e8f0";
  cancel.style.color = "#0f172a";
  cancel.style.border = "none";
  cancel.style.padding = "8px 16px";
  cancel.style.borderRadius = "8px";
  cancel.style.cursor = "pointer";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.textContent = "\u306F\u3044\u3002\u30AF\u30EA\u30A2\u3057\u307E\u3059\u3002";
  confirmBtn.style.background = "#dc2626";
  confirmBtn.style.color = "#ffffff";
  confirmBtn.style.border = "none";
  confirmBtn.style.padding = "8px 16px";
  confirmBtn.style.borderRadius = "8px";
  confirmBtn.style.cursor = "pointer";
  cancel.addEventListener("click", () => {
    dialog.close("cancel");
  });
  confirmBtn.addEventListener("click", () => {
    dialog.close("confirm");
  });
  buttonRow.append(cancel, confirmBtn);
  dialog.append(heading, message, buttonRow);
  document.body.append(dialog);
  confirmDialog = dialog;
  return dialog;
}
if (form) {
  form.addEventListener("submit", handleSubmit);
  void populateForm();
}
async function populatePromptForm() {
  if (!promptTextarea) {
    return;
  }
  const template = await getPromptTemplate();
  promptTextarea.value = template;
}
if (promptForm) {
  void populatePromptForm();
  promptForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!promptTextarea) {
      return;
    }
    await savePromptTemplate(promptTextarea.value);
    setPromptStatus("\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002");
  });
}
if (promptResetButton && promptTextarea) {
  promptResetButton.addEventListener("click", async () => {
    promptTextarea.value = DEFAULT_PROMPT_TEMPLATE;
    await clearPromptTemplate();
    setPromptStatus("\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30EA\u30BB\u30C3\u30C8\u3057\u307E\u3057\u305F\u3002");
  });
}
if (clearButton) {
  clearButton.addEventListener("click", () => {
    const dialog = ensureConfirmDialog();
    dialog.showModal();
    dialog.returnValue = "";
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue === "confirm") {
          void handleClear();
        }
      },
      { once: true }
    );
  });
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[BACKLOG_AUTH_KEY]) {
    void populateForm();
  }
  if (areaName === "local" && changes[CHATGPT_PROMPT_TEMPLATE_KEY]) {
    void populatePromptForm();
    setPromptStatus("\u30D7\u30ED\u30F3\u30D7\u30C8\u8A2D\u5B9A\u304C\u66F4\u65B0\u3055\u308C\u307E\u3057\u305F\u3002");
  }
});
async function ensureHostPermission(config) {
  const originPattern = `${backlogApiOrigin(config)}*`;
  const permission = { origins: [originPattern] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) {
    return true;
  }
  return chrome.permissions.request(permission);
}
async function removeHostPermission(config) {
  const originPattern = `${backlogApiOrigin(config)}*`;
  const permission = { origins: [originPattern] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (!hasPermission) {
    return;
  }
  await chrome.permissions.remove(permission);
}
function parseExcludedProjectsInput(raw) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}
//# sourceMappingURL=index.js.map
