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

// src/shared/backlogConfig.ts
var BACKLOG_AUTH_KEY = "backlogAuth";
var DEFAULT_LLM_PROVIDER = "chatgpt";
var AUTO_IMPORT_DELAY_MIN = 10;
var AUTO_IMPORT_DELAY_MAX = 600;
var DEFAULT_AUTO_IMPORT_DELAY_SECONDS = 60;
var AUTO_CREATE_DELAY_MIN = 5;
var AUTO_CREATE_DELAY_MAX = 300;
var DEFAULT_AUTO_CREATE_DELAY_SECONDS = 15;
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

// src/sidepanel/index.ts
var CHATGPT_URL = "https://chatgpt.com/?temporary-chat=true";
var GEMINI_URL = "https://gemini.google.com/app?hl=ja";
var STORAGE_LAST_PROJECT_ID_KEY = "sidepanel:lastProjectId";
var STORAGE_PROJECT_PREFS_KEY = "sidepanel:lastProjectPrefs";
var LLM_PROVIDER_CONFIG = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    cardTitle: "ChatGPT \u9023\u643A",
    description: "\u30C1\u30B1\u30C3\u30C8\u306B\u3064\u3044\u3066\u306E\u60C5\u5831\u3092\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u30B3\u30D4\u30FC\u3057\u3066\u3001\u4EE5\u4E0B\u306E\u30DC\u30BF\u30F3\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    openButtonLabel: "ChatGPT \u3092\u958B\u304F",
    successMessage: (hasWarnings, warnings) => hasWarnings ? `ChatGPT \u306E JSON \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u3002\uFF08\u672A\u8A2D\u5B9A: ${warnings.join(", ")}\uFF09` : "ChatGPT \u306E JSON \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u3002",
    openUrl: CHATGPT_URL,
    noTabError: "ChatGPT \u306E\u30BF\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u5148\u306B ChatGPT \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002"
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    cardTitle: "Gemini \u9023\u643A",
    description: "\u30C1\u30B1\u30C3\u30C8\u306E\u60C5\u5831\u3092\u30B3\u30D4\u30FC\u3057\u305F\u3042\u3068\u3001\u4EE5\u4E0B\u306E\u30DC\u30BF\u30F3\u304B\u3089 Gemini \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002",
    openButtonLabel: "Gemini \u3092\u958B\u304F",
    successMessage: (hasWarnings, warnings) => hasWarnings ? `Gemini \u306E JSON \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u3002\uFF08\u672A\u8A2D\u5B9A: ${warnings.join(", ")}\uFF09` : "Gemini \u306E JSON \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u3002",
    openUrl: GEMINI_URL,
    noTabError: "Gemini \u306E\u30BF\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u5148\u306B Gemini \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002"
  }
};
var cachedProjectDetails = null;
var projectDetailsPromise = null;
var ticketProjectSelectRef = null;
var chatgptProjectSelectRef = null;
var chatgptCopyButtonRef = null;
var lastProjectId = null;
var projectPreferences = {};
var formPreferencesLoaded = false;
var promptTemplateCache = null;
var excludedProjectIds = /* @__PURE__ */ new Set();
var excludedProjectKeys = /* @__PURE__ */ new Set();
var currentLlmProvider = DEFAULT_LLM_PROVIDER;
var llmUiRefs = {
  heading: null,
  description: null,
  openButton: null
};
function getActiveLlmProvider() {
  return currentLlmProvider;
}
function getLlmProviderInfo(provider = currentLlmProvider) {
  return LLM_PROVIDER_CONFIG[provider];
}
function setActiveLlmProvider(provider) {
  const normalized = normalizeLlmProvider(provider);
  if (currentLlmProvider === normalized) {
    return;
  }
  currentLlmProvider = normalized;
  updateLlmUiTexts();
}
function updateLlmUiTexts() {
  const info = getLlmProviderInfo();
  if (llmUiRefs.heading) {
    llmUiRefs.heading.textContent = info.cardTitle;
  }
  if (llmUiRefs.description) {
    llmUiRefs.description.textContent = info.description;
  }
  if (llmUiRefs.openButton) {
    llmUiRefs.openButton.textContent = info.openButtonLabel;
  }
}
async function refreshAuthPreferences() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "backlog-auth:get" });
    const config = response?.config;
    updateProjectExclusions(config?.excludedProjects ?? []);
    setActiveLlmProvider(config?.llmProvider ?? DEFAULT_LLM_PROVIDER);
    autoImportDelaySeconds = normalizeAutoDelay(
      config?.autoImportDelaySeconds,
      AUTO_IMPORT_DELAY_MIN,
      AUTO_IMPORT_DELAY_MAX,
      DEFAULT_AUTO_IMPORT_DELAY_SECONDS
    );
    autoCreateDelaySeconds = normalizeAutoDelay(
      config?.autoCreateDelaySeconds,
      AUTO_CREATE_DELAY_MIN,
      AUTO_CREATE_DELAY_MAX,
      DEFAULT_AUTO_CREATE_DELAY_SECONDS
    );
  } catch (error) {
    console.warn("Failed to load Backlog auth config", error);
    updateProjectExclusions([]);
    setActiveLlmProvider(DEFAULT_LLM_PROVIDER);
    autoImportDelaySeconds = DEFAULT_AUTO_IMPORT_DELAY_SECONDS;
    autoCreateDelaySeconds = DEFAULT_AUTO_CREATE_DELAY_SECONDS;
  }
}
function updateProjectExclusions(tokens) {
  excludedProjectIds.clear();
  excludedProjectKeys.clear();
  tokens.forEach((token) => {
    if (typeof token !== "string") {
      return;
    }
    const trimmed = token.trim();
    if (!trimmed) {
      return;
    }
    if (/^\d+$/.test(trimmed)) {
      excludedProjectIds.add(Number(trimmed));
      return;
    }
    excludedProjectKeys.add(trimmed.toLowerCase());
  });
}
function isProjectExcluded(project) {
  if (excludedProjectIds.has(project.projectId)) {
    return true;
  }
  const key = project.projectKey?.toLowerCase?.();
  if (key && excludedProjectKeys.has(key)) {
    return true;
  }
  return false;
}
function filterProjects(projects) {
  if (!excludedProjectIds.size && !excludedProjectKeys.size) {
    return projects;
  }
  return projects.filter((project) => !isProjectExcluded(project));
}
async function ensureFormPreferencesLoaded() {
  if (formPreferencesLoaded) {
    return;
  }
  try {
    const result = await chrome.storage.local.get([STORAGE_LAST_PROJECT_ID_KEY, STORAGE_PROJECT_PREFS_KEY]);
    const storedProjectId = result[STORAGE_LAST_PROJECT_ID_KEY];
    if (typeof storedProjectId === "number" && Number.isFinite(storedProjectId) && storedProjectId > 0) {
      lastProjectId = storedProjectId;
    }
    const rawPrefs = result[STORAGE_PROJECT_PREFS_KEY];
    if (rawPrefs && typeof rawPrefs === "object") {
      const normalized = {};
      for (const [key, value] of Object.entries(rawPrefs)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const prefValue = value;
        const pref = {};
        const issueTypeId = Number(prefValue.issueTypeId);
        if (Number.isFinite(issueTypeId) && issueTypeId > 0) {
          pref.issueTypeId = issueTypeId;
        }
        const categoryId = Number(prefValue.categoryId);
        if (Number.isFinite(categoryId) && categoryId > 0) {
          pref.categoryId = categoryId;
        }
        normalized[key] = pref;
      }
      projectPreferences = normalized;
    } else {
      projectPreferences = {};
    }
  } catch (error) {
    console.warn("Failed to load ticket form preferences", error);
    projectPreferences = {};
    lastProjectId = null;
  } finally {
    formPreferencesLoaded = true;
  }
}
async function persistFormPreferences(projectId, updates) {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return;
  }
  await ensureFormPreferencesLoaded();
  const key = String(projectId);
  const current = projectPreferences[key] ?? {};
  const next = { ...current };
  if (updates.issueTypeId !== void 0) {
    next.issueTypeId = updates.issueTypeId > 0 ? updates.issueTypeId : void 0;
  }
  if (updates.categoryId !== void 0) {
    next.categoryId = updates.categoryId > 0 ? updates.categoryId : void 0;
  }
  projectPreferences[key] = next;
  lastProjectId = projectId;
  try {
    await chrome.storage.local.set({
      [STORAGE_LAST_PROJECT_ID_KEY]: lastProjectId,
      [STORAGE_PROJECT_PREFS_KEY]: projectPreferences
    });
  } catch (error) {
    console.warn("Failed to persist ticket form preferences", error);
  }
}
function getStoredPreference(projectId) {
  if (!projectId) {
    return null;
  }
  const pref = projectPreferences[String(projectId)];
  return pref ?? null;
}
async function ensurePromptTemplateLoaded() {
  if (promptTemplateCache) {
    return promptTemplateCache;
  }
  const template = await getPromptTemplate();
  promptTemplateCache = template;
  return template;
}
async function init() {
  const root = document.getElementById("sidepanel-root");
  if (!root) {
    return;
  }
  cachedProjectDetails = null;
  projectDetailsPromise = null;
  await refreshAuthPreferences().catch((error) => {
    console.warn("Failed to load Backlog preferences", error);
  });
  void loadProjectDetails(true);
  root.append(createLlmCard(), createTicketCard());
}
function createCardBase(title, description) {
  const card = document.createElement("div");
  card.className = "panel-card";
  const header = document.createElement("header");
  header.className = "panel-card__header";
  const heading = document.createElement("h2");
  heading.textContent = title;
  header.append(heading);
  if (description) {
    const desc = document.createElement("p");
    desc.className = "panel-card__description";
    desc.textContent = description;
    header.append(desc);
  }
  card.append(header);
  return card;
}
function createTicketCard() {
  const card = createCardBase("Backlog \u30C1\u30B1\u30C3\u30C8\u4F5C\u6210", "\u4E0A\u90E8\u30D0\u30FC\u3068\u9023\u52D5\u3057\u305F\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u30D5\u30A9\u30FC\u30E0\u3092\u3053\u3053\u306B\u914D\u7F6E\u3057\u307E\u3059\u3002");
  void ensureFormPreferencesLoaded();
  const form = document.createElement("div");
  form.className = "ticket-form";
  const projectField = document.createElement("div");
  projectField.className = "ticket-form__field";
  const projectLabel = document.createElement("span");
  projectLabel.textContent = "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8";
  const projectSelect = document.createElement("select");
  projectSelect.className = "ticket-form__select";
  projectSelect.innerHTML = `<option value="" selected>\u8AAD\u307F\u8FBC\u307F\u4E2D...</option>`;
  projectField.append(projectLabel, projectSelect);
  ticketProjectSelectRef = projectSelect;
  const issueTypeField = document.createElement("div");
  issueTypeField.className = "ticket-form__field";
  const issueTypeLabel = document.createElement("span");
  issueTypeLabel.textContent = "\u7A2E\u5225";
  const issueTypeSelect = document.createElement("select");
  issueTypeSelect.className = "ticket-form__select";
  issueTypeSelect.disabled = true;
  issueTypeSelect.innerHTML = `<option value="" selected>\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>`;
  issueTypeField.append(issueTypeLabel, issueTypeSelect);
  const categoryField = document.createElement("div");
  categoryField.className = "ticket-form__field";
  const categoryLabel = document.createElement("span");
  categoryLabel.textContent = "\u30AB\u30C6\u30B4\u30EA\u30FC";
  const categorySelect = document.createElement("select");
  categorySelect.className = "ticket-form__select";
  categorySelect.disabled = true;
  categorySelect.innerHTML = `<option value="" selected>\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>`;
  categoryField.append(categoryLabel, categorySelect);
  const assigneeField = document.createElement("div");
  assigneeField.className = "ticket-form__field";
  const assigneeLabel = document.createElement("span");
  assigneeLabel.textContent = "\u62C5\u5F53\u8005";
  const assigneeSelect = document.createElement("select");
  assigneeSelect.className = "ticket-form__select";
  assigneeSelect.disabled = true;
  assigneeSelect.innerHTML = `<option value="" selected>\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>`;
  assigneeField.append(assigneeLabel, assigneeSelect);
  form.append(projectField, issueTypeField, categoryField, assigneeField);
  const startDateField = createDateField("\u958B\u59CB\u65E5");
  const dueDateField = createDateField("\u671F\u9650\u65E5");
  form.append(startDateField.container, dueDateField.container);
  const titleField = createTextField("\u30BF\u30A4\u30C8\u30EB", "\u6982\u8981\u3092\u5165\u529B");
  const bodyField = createTextareaField("\u672C\u6587", "\u8A73\u7D30\u3092\u5165\u529B");
  form.append(titleField.container, bodyField.container);
  const actions = document.createElement("div");
  actions.className = "ticket-form__actions";
  const autoImportButton = document.createElement("button");
  autoImportButton.type = "button";
  autoImportButton.className = "button button--ghost";
  autoImportButton.textContent = "1\u5206\u5F8C\u306B\u81EA\u52D5\u53D6\u308A\u8FBC\u307F";
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "button button--ghost";
  importButton.textContent = "JSON \u3092\u53D6\u308A\u8FBC\u3080";
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "button button--primary";
  createButton.textContent = "\u30C1\u30B1\u30C3\u30C8\u3092\u4F5C\u6210";
  actions.append(autoImportButton, importButton, createButton);
  const feedback = document.createElement("p");
  feedback.className = "ticket-form__feedback";
  feedback.hidden = true;
  form.append(feedback);
  card.append(form, actions);
  void loadProjectDetails().then(async (details) => {
    const list = details ?? [];
    populateProjectSelect(projectSelect, issueTypeSelect, categorySelect, assigneeSelect, list);
    if (chatgptProjectSelectRef) {
      populateChatGptProjectSelect(chatgptProjectSelectRef, list);
    }
    populateProjectMetadataForSelection(
      Number(projectSelect.value),
      issueTypeSelect,
      categorySelect,
      assigneeSelect,
      list
    );
    await ensureFormPreferencesLoaded();
    const storedProjectId = lastProjectId;
    if (storedProjectId && projectSelect.querySelector(`option[value="${storedProjectId}"]`)) {
      if (String(storedProjectId) !== projectSelect.value) {
        projectSelect.value = String(storedProjectId);
        projectSelect.dispatchEvent(new Event("change", { bubbles: true, cancelable: false }));
      } else {
        populateProjectMetadataForSelection(
          storedProjectId,
          issueTypeSelect,
          categorySelect,
          assigneeSelect,
          list
        );
        const preference = getStoredPreference(storedProjectId);
        applyStoredPreferenceToSelectors(issueTypeSelect, categorySelect, preference);
        void persistFormPreferences(storedProjectId, preference ?? {});
      }
    } else {
      const currentProjectId = Number(projectSelect.value);
      if (currentProjectId) {
        const preference = getStoredPreference(currentProjectId);
        applyStoredPreferenceToSelectors(issueTypeSelect, categorySelect, preference);
      }
    }
  });
  projectSelect.addEventListener("change", () => {
    const projectId = Number(projectSelect.value);
    const details = cachedProjectDetails ?? [];
    populateProjectMetadataForSelection(projectId, issueTypeSelect, categorySelect, assigneeSelect, details);
    syncChatGptProjectSelection(projectId);
    resetPromptCache();
    if (projectId) {
      void ensureFormPreferencesLoaded().then(() => {
        const preference = getStoredPreference(projectId);
        applyStoredPreferenceToSelectors(issueTypeSelect, categorySelect, preference);
        if (preference) {
          void persistFormPreferences(projectId, preference);
        } else {
          void persistFormPreferences(projectId, {});
        }
      });
    }
  });
  const titleInput = titleField.input;
  const bodyTextarea = bodyField.textarea;
  let autoImportTimeoutId = null;
  let autoImportIntervalId = null;
  let autoImportRemainingSeconds = 0;
  let autoProcessPhase = "idle";
  let pendingAutoCloseTabId = null;
  let autoImportDelaySeconds2 = DEFAULT_AUTO_IMPORT_DELAY_SECONDS;
  let autoCreateDelaySeconds2 = DEFAULT_AUTO_CREATE_DELAY_SECONDS;
  function showFeedback(type, message) {
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.classList.toggle("ticket-form__feedback--error", type === "error");
    feedback.classList.toggle("ticket-form__feedback--success", type === "success");
  }
  function clearFeedback() {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.classList.remove("ticket-form__feedback--error", "ticket-form__feedback--success");
  }
  function resetAutoImportTimer(showMessage = false) {
    if (autoImportTimeoutId) {
      window.clearTimeout(autoImportTimeoutId);
      autoImportTimeoutId = null;
    }
    if (autoImportIntervalId) {
      window.clearInterval(autoImportIntervalId);
      autoImportIntervalId = null;
    }
    autoImportButton.dataset.timer = "idle";
    autoImportButton.textContent = "1\u5206\u5F8C\u306B\u81EA\u52D5\u53D6\u308A\u8FBC\u307F";
    autoImportButton.disabled = false;
    if (showMessage) {
      showFeedback("success", "\u81EA\u52D5\u53D6\u308A\u8FBC\u307F\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\u3057\u307E\u3057\u305F\u3002");
    }
    autoProcessPhase = "idle";
    pendingAutoCloseTabId = null;
  }
  async function runAutoImportWorkflow(triggeredByTimer) {
    const projectId = Number(projectSelect.value);
    if (!projectId) {
      showFeedback("error", "\u5148\u306B\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    if (issueTypeSelect.disabled || categorySelect.disabled) {
      showFeedback("error", "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u60C5\u5831\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    const provider = getActiveLlmProvider();
    try {
      showFeedback("success", "AI \u306E\u56DE\u7B54\u304B\u3089 JSON \u3092\u53D6\u308A\u8FBC\u307F\u4E2D\u3067\u3059\u2026");
      const response = await chrome.runtime.sendMessage({ type: "llm:json:request", provider });
      if (!response || response.error) {
        const info = getLlmProviderInfo(provider);
        throw new Error(response?.error ?? `${info.label} \u304B\u3089 JSON \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
      }
      const data = response.data ?? {};
      const tabIdToClose = typeof response.tabId === "number" ? response.tabId : null;
      applyImportedJson(
        data,
        { issueTypeSelect, categorySelect, titleInput, bodyTextarea, startDateField, dueDateField },
        showFeedback,
        projectId
      );
      if (triggeredByTimer) {
        pendingAutoCloseTabId = tabIdToClose;
        await startAutoCreateCountdown();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("error", message);
      resetAutoImportTimer();
    }
  }
  async function startAutoCreateCountdown() {
    autoProcessPhase = "wait-create";
    autoImportRemainingSeconds = autoCreateDelaySeconds2;
    autoImportButton.dataset.timer = "auto-create";
    autoImportButton.disabled = false;
    autoImportButton.textContent = `\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u307E\u3067 ${autoImportRemainingSeconds}\u79D2`;
    showFeedback("success", `${autoCreateDelaySeconds2}\u79D2\u5F8C\u306B\u81EA\u52D5\u3067\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u3092\u5B9F\u884C\u3057\u307E\u3059\u3002`);
    if (autoImportIntervalId) {
      window.clearInterval(autoImportIntervalId);
    }
    autoImportIntervalId = window.setInterval(() => {
      autoImportRemainingSeconds -= 1;
      if (autoImportRemainingSeconds <= 0) {
        if (autoImportIntervalId) {
          window.clearInterval(autoImportIntervalId);
          autoImportIntervalId = null;
        }
        autoImportButton.textContent = "\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u4E2D\u2026";
        autoImportButton.disabled = true;
        return;
      }
      autoImportButton.textContent = `\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u307E\u3067 ${autoImportRemainingSeconds}\u79D2`;
    }, 1e3);
    if (autoImportTimeoutId) {
      window.clearTimeout(autoImportTimeoutId);
      autoImportTimeoutId = null;
    }
    autoImportTimeoutId = window.setTimeout(async () => {
      autoImportTimeoutId = null;
      if (autoImportIntervalId) {
        window.clearInterval(autoImportIntervalId);
        autoImportIntervalId = null;
      }
      autoImportButton.textContent = "\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u4E2D\u2026";
      autoImportButton.disabled = true;
      await submitTicketCreation({ auto: true, tabIdToClose: pendingAutoCloseTabId });
      resetAutoImportTimer();
    }, autoCreateDelaySeconds2 * 1e3);
  }
  autoImportButton.addEventListener("click", () => {
    if (autoImportTimeoutId) {
      resetAutoImportTimer(true);
      return;
    }
    if (!Number(projectSelect.value)) {
      showFeedback("error", "\u5148\u306B\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    autoImportRemainingSeconds = autoImportDelaySeconds2;
    autoProcessPhase = "wait-import";
    autoImportButton.dataset.timer = "active";
    autoImportButton.textContent = `\u81EA\u52D5\u53D6\u308A\u8FBC\u307F\u307E\u3067 ${autoImportRemainingSeconds}\u79D2`;
    showFeedback(
      "success",
      `${autoImportDelaySeconds2}\u79D2\u5F8C\u306B AI \u306E JSON \u3092\u53D6\u308A\u8FBC\u307F\u3001\u305D\u306E\u5F8C\u30C1\u30B1\u30C3\u30C8\u4F5C\u6210\u307E\u3067\u81EA\u52D5\u3067\u9032\u3081\u307E\u3059\u3002`
    );
    autoImportIntervalId = window.setInterval(() => {
      autoImportRemainingSeconds -= 1;
      if (autoImportRemainingSeconds <= 0) {
        if (autoImportIntervalId) {
          window.clearInterval(autoImportIntervalId);
          autoImportIntervalId = null;
        }
        autoImportButton.textContent = "\u53D6\u308A\u8FBC\u307F\u4E2D\u2026";
        autoImportButton.disabled = true;
        return;
      }
      autoImportButton.textContent = `\u81EA\u52D5\u53D6\u308A\u8FBC\u307F\u307E\u3067 ${autoImportRemainingSeconds}\u79D2`;
    }, 1e3);
    autoImportTimeoutId = window.setTimeout(async () => {
      autoImportTimeoutId = null;
      if (autoImportIntervalId) {
        window.clearInterval(autoImportIntervalId);
        autoImportIntervalId = null;
      }
      autoImportButton.textContent = "\u53D6\u308A\u8FBC\u307F\u4E2D\u2026";
      autoImportButton.disabled = true;
      await runAutoImportWorkflow(true);
    }, autoImportDelaySeconds2 * 1e3);
  });
  importButton.addEventListener("click", async () => {
    if (autoImportTimeoutId) {
      resetAutoImportTimer();
    }
    if (importButton.dataset.loading === "true") {
      return;
    }
    clearFeedback();
    const projectId = Number(projectSelect.value);
    if (!projectId) {
      showFeedback("error", "\u5148\u306B\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    if (issueTypeSelect.disabled || categorySelect.disabled) {
      showFeedback("error", "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u60C5\u5831\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304B\u3089\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    importButton.dataset.loading = "true";
    importButton.disabled = true;
    try {
      await ensureFormPreferencesLoaded();
      const provider = getActiveLlmProvider();
      const response = await chrome.runtime.sendMessage({ type: "llm:json:request", provider });
      if (!response || response.error) {
        const info = getLlmProviderInfo(provider);
        throw new Error(response?.error ?? `${info.label} \u304B\u3089 JSON \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
      }
      const data = response.data ?? {};
      applyImportedJson(
        data,
        { issueTypeSelect, categorySelect, titleInput, bodyTextarea, startDateField, dueDateField },
        showFeedback,
        projectId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("error", message);
    } finally {
      delete importButton.dataset.loading;
      importButton.disabled = false;
    }
  });
  createButton.addEventListener("click", () => {
    if (autoProcessPhase !== "idle") {
      resetAutoImportTimer();
    }
    void submitTicketCreation();
  });
  async function submitTicketCreation(options = {}) {
    if (createButton.dataset.loading === "true") {
      return false;
    }
    clearFeedback();
    const projectId = Number(projectSelect.value);
    if (!projectId) {
      showFeedback("error", "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      projectSelect.focus();
      return false;
    }
    const issueTypeId = Number(issueTypeSelect.value);
    if (!issueTypeId || issueTypeSelect.disabled) {
      showFeedback("error", "\u7A2E\u5225\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      issueTypeSelect.focus();
      return false;
    }
    const summary = titleInput.value.trim();
    if (!summary) {
      showFeedback("error", "\u30BF\u30A4\u30C8\u30EB\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      titleInput.focus();
      return false;
    }
    const startDate = startDateField.input.value;
    const dueDate = dueDateField.input.value;
    if (startDate && dueDate && startDate > dueDate) {
      showFeedback("error", "\u958B\u59CB\u65E5\u306F\u671F\u9650\u65E5\u4EE5\u524D\u306E\u65E5\u4ED8\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      dueDateField.input.focus();
      return false;
    }
    const payload = {
      projectId,
      issueTypeId,
      summary,
      description: bodyTextarea.value,
      startDate: startDate || void 0,
      dueDate: dueDate || void 0,
      categoryId: Number(categorySelect.value) > 0 ? Number(categorySelect.value) : void 0,
      assigneeId: !assigneeSelect.disabled && Number(assigneeSelect.value) > 0 ? Number(assigneeSelect.value) : void 0
    };
    createButton.dataset.loading = options.auto ? "auto" : "manual";
    createButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "backlog:issue:create", payload });
      if (!response || response.error) {
        throw new Error(response?.error ?? "\u30C1\u30B1\u30C3\u30C8\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      }
      const issueKey = response.issue?.issueKey ?? "";
      if (options.auto) {
        showFeedback(
          "success",
          issueKey ? `\u81EA\u52D5\u3067\u30C1\u30B1\u30C3\u30C8 ${issueKey} \u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002` : "\u81EA\u52D5\u3067\u30C1\u30B1\u30C3\u30C8\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002"
        );
      } else {
        showFeedback("success", issueKey ? `\u30C1\u30B1\u30C3\u30C8 ${issueKey} \u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002` : "\u30C1\u30B1\u30C3\u30C8\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002");
      }
      titleInput.value = "";
      bodyTextarea.value = "";
      if (options.auto && options.tabIdToClose) {
        void chrome.tabs.remove(options.tabIdToClose).catch((error) => {
          console.warn("Failed to close AI tab after auto creation:", error);
        });
        pendingAutoCloseTabId = null;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("error", message);
      return false;
    } finally {
      delete createButton.dataset.loading;
      createButton.disabled = false;
    }
  }
  return card;
}
function createLlmCard() {
  const providerInfo = getLlmProviderInfo();
  const card = createCardBase(providerInfo.cardTitle, providerInfo.description);
  const headingEl = card.querySelector("h2");
  const descriptionEl = card.querySelector(".panel-card__description");
  if (headingEl) {
    llmUiRefs.heading = headingEl;
  }
  if (descriptionEl) {
    llmUiRefs.description = descriptionEl;
  }
  void ensureFormPreferencesLoaded();
  const projectField = document.createElement("div");
  projectField.className = "ticket-form__field";
  const projectLabel = document.createElement("span");
  projectLabel.textContent = "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8";
  const projectSelect = document.createElement("select");
  projectSelect.className = "ticket-form__select";
  projectSelect.innerHTML = `<option value="" selected>\u8AAD\u307F\u8FBC\u307F\u4E2D...</option>`;
  projectField.append(projectLabel, projectSelect);
  chatgptProjectSelectRef = projectSelect;
  const viewport = document.createElement("div");
  viewport.className = "chatgpt-view chatgpt-view--placeholder";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button button--ghost";
  copyButton.textContent = "\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30B3\u30D4\u30FC\u3059\u308B";
  copyButton.hidden = true;
  chatgptCopyButtonRef = copyButton;
  copyButton.addEventListener("click", async () => {
    try {
      const prompt = await buildPromptText();
      await navigator.clipboard.writeText(prompt);
      copyButton.textContent = "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01";
      window.setTimeout(() => {
        copyButton.textContent = "\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30B3\u30D4\u30FC\u3059\u308B";
      }, 1800);
    } catch (error) {
      console.warn("Failed to copy prompt", error);
      copyButton.textContent = "\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F";
      window.setTimeout(() => {
        copyButton.textContent = "\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30B3\u30D4\u30FC\u3059\u308B";
      }, 1800);
      resetPromptCache();
    }
  });
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "button button--primary";
  openButton.textContent = providerInfo.openButtonLabel;
  llmUiRefs.openButton = openButton;
  updateLlmUiTexts();
  openButton.addEventListener("click", async () => {
    const activeProvider = getActiveLlmProvider();
    const activeInfo = getLlmProviderInfo(activeProvider);
    if (openButton.dataset.loading === "true") {
      return;
    }
    openButton.dataset.loading = "true";
    openButton.disabled = true;
    try {
      const details = cachedProjectDetails ?? await loadProjectDetails();
      const projectId = determineChatGptProjectId();
      const project = details?.find((item) => item.projectId === projectId) ?? null;
      if (!project) {
        resetPromptCache();
        return;
      }
      const prompt = await buildProjectPromptWithClipboard(project);
      lastGeneratedPrompt = prompt;
      await navigator.clipboard.writeText(prompt);
      copyButton.hidden = false;
      copyButton.textContent = "\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30B3\u30D4\u30FC\u3059\u308B";
    } catch (error) {
      console.warn("Failed to prepare prompt for provider", error);
      resetPromptCache();
      return;
    } finally {
      delete openButton.dataset.loading;
      openButton.disabled = false;
    }
    chrome.tabs.create({ url: activeInfo.openUrl }).catch((error) => {
      console.warn("Failed to open provider tab", error);
    });
  });
  viewport.append(openButton, copyButton);
  card.append(projectField, viewport);
  void loadProjectDetails().then((details) => {
    const list = details ?? [];
    populateChatGptProjectSelect(projectSelect, list);
    const initialProjectId = determineChatGptProjectId();
    if (initialProjectId) {
      syncChatGptProjectSelection(initialProjectId);
    }
  });
  projectSelect.addEventListener("change", () => {
    const projectId = Number(projectSelect.value);
    if (ticketProjectSelectRef && projectId && ticketProjectSelectRef.value !== String(projectId)) {
      if (ticketProjectSelectRef.querySelector(`option[value="${projectId}"]`)) {
        ticketProjectSelectRef.value = String(projectId);
        const event = new Event("change", { bubbles: true, cancelable: false });
        ticketProjectSelectRef.dispatchEvent(event);
      }
    }
    resetPromptCache();
  });
  return card;
}
if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void init();
    },
    { once: true }
  );
} else {
  void init();
}
async function loadProjectDetails(force = false) {
  if (!force && cachedProjectDetails) {
    return cachedProjectDetails;
  }
  if (!force && projectDetailsPromise) {
    return projectDetailsPromise;
  }
  const request = (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "backlog:projects:details", force });
      const data = response?.data;
      if (Array.isArray(data)) {
        cachedProjectDetails = data;
        return data;
      }
      if (response?.error) {
        console.warn("Failed to load project details:", response.error);
      }
    } catch (error) {
      console.warn("Failed to load project details", error);
    } finally {
      projectDetailsPromise = null;
    }
    return null;
  })();
  if (!force) {
    projectDetailsPromise = request;
  } else {
    projectDetailsPromise = request;
  }
  return request;
}
function populateProjectSelect(projectSelect, issueTypeSelect, categorySelect, assigneeSelect, details) {
  projectSelect.innerHTML = "";
  const visibleProjects = filterProjects(details);
  const sortedProjects = visibleProjects.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (!sortedProjects.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093";
    projectSelect.append(emptyOption);
    projectSelect.disabled = true;
    populateIssueTypeSelect(issueTypeSelect, []);
    populateCategorySelect(categorySelect, []);
    populateAssigneeSelect(assigneeSelect, [], null);
    return;
  }
  projectSelect.disabled = false;
  sortedProjects.forEach((project) => {
    const option = document.createElement("option");
    option.value = String(project.projectId);
    option.textContent = `${project.name} (${project.projectKey})`;
    projectSelect.append(option);
  });
  if (!projectSelect.value || !projectSelect.querySelector(`option[value="${projectSelect.value}"]`)) {
    projectSelect.value = String(sortedProjects[0].projectId);
  }
  populateIssueTypeSelect(issueTypeSelect, []);
  populateCategorySelect(categorySelect, []);
  populateAssigneeSelect(assigneeSelect, [], null);
  issueTypeSelect.disabled = true;
  categorySelect.disabled = true;
}
function populateChatGptProjectSelect(select, details) {
  if (!select) {
    return;
  }
  const currentValue = select.value;
  select.innerHTML = "";
  const visibleProjects = filterProjects(details);
  const sortedProjects = visibleProjects.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (!sortedProjects.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093";
    select.append(emptyOption);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  sortedProjects.forEach((project) => {
    const option = document.createElement("option");
    option.value = String(project.projectId);
    option.textContent = `${project.name} (${project.projectKey})`;
    select.append(option);
  });
  if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
    select.value = currentValue;
  } else if (!select.value && sortedProjects.length) {
    select.value = String(sortedProjects[0].projectId);
  }
}
function populateIssueTypeSelect(issueTypeSelect, issueTypes) {
  issueTypeSelect.innerHTML = "";
  if (!issueTypes.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "\u7A2E\u5225\u672A\u8A2D\u5B9A";
    issueTypeSelect.append(emptyOption);
    issueTypeSelect.value = "";
    issueTypeSelect.disabled = true;
    return;
  }
  const sorted = issueTypes.slice().sort((a, b) => a.id - b.id);
  sorted.forEach((issueType) => {
    const option = document.createElement("option");
    option.value = String(issueType.id);
    option.textContent = issueType.name;
    issueTypeSelect.append(option);
  });
  issueTypeSelect.disabled = false;
  issueTypeSelect.value = String(sorted[0]?.id ?? "");
}
function populateCategorySelect(categorySelect, categories) {
  categorySelect.innerHTML = "";
  if (!categories.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "\u30AB\u30C6\u30B4\u30EA\u30FC\u672A\u8A2D\u5B9A";
    categorySelect.append(emptyOption);
    categorySelect.value = "";
    categorySelect.disabled = true;
    return;
  }
  const sorted = categories.slice().sort((a, b) => a.id - b.id);
  sorted.forEach((category) => {
    const option = document.createElement("option");
    option.value = String(category.id);
    option.textContent = category.name;
    categorySelect.append(option);
  });
  categorySelect.disabled = false;
  categorySelect.value = String(sorted[0]?.id ?? "");
}
function populateAssigneeSelect(assigneeSelect, users, currentUserId) {
  assigneeSelect.innerHTML = "";
  if (!users.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "\u62C5\u5F53\u8005\u672A\u8A2D\u5B9A";
    assigneeSelect.append(emptyOption);
    assigneeSelect.value = "";
    assigneeSelect.disabled = true;
    return;
  }
  const sorted = users.slice().sort((a, b) => a.id - b.id);
  let selectedValue = null;
  sorted.forEach((user) => {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = user.name;
    if (currentUserId && user.id === currentUserId) {
      selectedValue = option.value;
    }
    assigneeSelect.append(option);
  });
  assigneeSelect.disabled = false;
  assigneeSelect.value = selectedValue ?? String(sorted[0]?.id ?? "");
}
function populateProjectMetadataForSelection(projectId, issueTypeSelect, categorySelect, assigneeSelect, details) {
  const list = details ?? cachedProjectDetails ?? [];
  if (!projectId || !list.length) {
    populateIssueTypeSelect(issueTypeSelect, []);
    populateCategorySelect(categorySelect, []);
    populateAssigneeSelect(assigneeSelect, [], null);
    return;
  }
  const project = list.find((item) => item.projectId === projectId);
  if (!project) {
    populateIssueTypeSelect(issueTypeSelect, []);
    populateCategorySelect(categorySelect, []);
    populateAssigneeSelect(assigneeSelect, [], null);
    return;
  }
  populateIssueTypeSelect(issueTypeSelect, project.issueTypes ?? []);
  populateCategorySelect(categorySelect, project.categories ?? []);
  populateAssigneeSelect(assigneeSelect, project.users ?? [], project.currentUserId ?? null);
}
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function applyImportedJson(data, context, showFeedback, projectId) {
  const warnings = [];
  const issueTypeName = typeof data.issueType === "string" ? data.issueType.trim() : "";
  const categoryNames = Array.isArray(data.categoryNames) ? data.categoryNames.filter((name) => typeof name === "string" && name.trim().length > 0) : [];
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const startDate = typeof data.startDate === "string" ? data.startDate.trim() : "";
  const dueDateValue = data.dueDate;
  if (summary) {
    context.titleInput.value = summary;
  } else {
    warnings.push("summary");
  }
  if (description) {
    context.bodyTextarea.value = description.replace(/\r\n/g, "\n");
  } else {
    warnings.push("description");
  }
  if (startDate && DATE_PATTERN.test(startDate)) {
    context.startDateField.input.value = startDate;
  } else if (!startDate) {
    warnings.push("startDate");
  } else {
    warnings.push(`startDate(${startDate})`);
  }
  if (typeof dueDateValue === "string" && DATE_PATTERN.test(dueDateValue)) {
    context.dueDateField.input.value = dueDateValue;
  } else if (dueDateValue === null || dueDateValue === void 0) {
    context.dueDateField.input.value = "";
  } else if (dueDateValue !== null) {
    warnings.push("dueDate");
  }
  if (issueTypeName) {
    if (!selectOptionByLabel(context.issueTypeSelect, issueTypeName)) {
      warnings.push(`issueType(${issueTypeName})`);
    }
  }
  if (categoryNames.length) {
    const matched = categoryNames.find((name) => selectOptionByLabel(context.categorySelect, name));
    if (!matched) {
      warnings.push(`categoryNames(${categoryNames.join(", ")})`);
    }
  }
  void persistFormPreferences(projectId, {
    issueTypeId: Number(context.issueTypeSelect.value) > 0 ? Number(context.issueTypeSelect.value) : void 0,
    categoryId: Number(context.categorySelect.value) > 0 ? Number(context.categorySelect.value) : void 0
  });
  if (warnings.length) {
    const info = getLlmProviderInfo();
    showFeedback("success", info.successMessage(true, warnings));
  } else {
    const info = getLlmProviderInfo();
    showFeedback("success", info.successMessage(false, warnings));
  }
}
function syncChatGptProjectSelection(projectId) {
  if (!chatgptProjectSelectRef) {
    return;
  }
  if (projectId && chatgptProjectSelectRef.querySelector(`option[value="${projectId}"]`)) {
    chatgptProjectSelectRef.value = String(projectId);
  }
}
function selectOptionByLabel(select, label) {
  const normalized = label.trim();
  if (!normalized) {
    return false;
  }
  const option = Array.from(select.options).find((item) => item.textContent?.trim() === normalized);
  if (option) {
    select.value = option.value;
    return true;
  }
  return false;
}
function applyStoredPreferenceToSelectors(issueTypeSelect, categorySelect, preference) {
  if (!preference) {
    return;
  }
  if (preference.issueTypeId && issueTypeSelect.querySelector(`option[value="${preference.issueTypeId}"]`)) {
    issueTypeSelect.value = String(preference.issueTypeId);
  }
  if (preference.categoryId && categorySelect.querySelector(`option[value="${preference.categoryId}"]`)) {
    categorySelect.value = String(preference.categoryId);
  }
}
function determineChatGptProjectId() {
  if (chatgptProjectSelectRef) {
    const projectId = Number(chatgptProjectSelectRef.value);
    if (Number.isFinite(projectId) && projectId > 0) {
      return projectId;
    }
  }
  if (ticketProjectSelectRef) {
    const projectId = Number(ticketProjectSelectRef.value);
    if (Number.isFinite(projectId) && projectId > 0) {
      return projectId;
    }
  }
  return null;
}
async function buildProjectPromptWithClipboard(project) {
  const [template, clipboardText] = await Promise.all([
    ensurePromptTemplateLoaded(),
    navigator.clipboard.readText().catch(() => "")
  ]);
  return buildProjectPrompt(project, clipboardText, template);
}
var lastGeneratedPrompt = "";
function resetPromptCache() {
  lastGeneratedPrompt = "";
  if (chatgptCopyButtonRef) {
    chatgptCopyButtonRef.hidden = true;
    chatgptCopyButtonRef.textContent = "\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u30B3\u30D4\u30FC\u3059\u308B";
  }
  promptTemplateCache = null;
}
async function buildPromptText() {
  if (!lastGeneratedPrompt) {
    await ensureFormPreferencesLoaded();
    const details = cachedProjectDetails ?? await loadProjectDetails();
    const projectId = determineChatGptProjectId();
    const project = details?.find((item) => item.projectId === projectId) ?? null;
    if (!project) {
      throw new Error("\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002");
    }
    lastGeneratedPrompt = await buildProjectPromptWithClipboard(project);
  }
  return lastGeneratedPrompt;
}
function buildProjectPrompt(project, clipboardText, template) {
  const today = formatDateValue(/* @__PURE__ */ new Date());
  const issueTypeNames = project.issueTypes.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const categoryNames = project.categories.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const assigneeNames = project.users.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const fallbackIssueTypes = ["\u30D0\u30B0", "\u30BF\u30B9\u30AF", "\u6539\u5584\u8981\u671B", "\u304A\u554F\u3044\u5408\u308F\u305B", "\u305D\u306E\u4ED6"];
  const issueTypeEnumValues = issueTypeNames.length ? issueTypeNames : fallbackIssueTypes;
  const issueTypeListText = issueTypeEnumValues.join(" / ");
  const categoryListText = categoryNames.length ? categoryNames.join(" / ") : "\u306A\u3057";
  const assigneeContext = assigneeNames.length ? assigneeNames.map((name) => `- ${name}`).join("\n") : "- \u306A\u3057";
  const normalizedClipboard = clipboardText.replace(/\r\n/g, "\n").trim();
  const inputText = normalizedClipboard || "{clipboard}";
  const schemaText = createSchemaText(issueTypeEnumValues, categoryNames);
  const replacements = {
    TODAY: today,
    ISSUE_TYPES: issueTypeListText,
    CATEGORIES: categoryListText,
    ASSIGNEES: assigneeContext,
    INPUT_TEXT: inputText,
    JSON_SCHEMA: schemaText
  };
  return renderPromptTemplate(template, replacements);
}
function createSchemaText(issueTypeEnumValues, categoryNames) {
  const properties = {
    issueType: {
      type: ["string", "null"],
      enum: [...issueTypeEnumValues, null]
    },
    categoryNames: {
      type: "array",
      items: categoryNames.length ? { type: "string", enum: categoryNames } : { type: "string" }
    },
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 20
    },
    description: {
      type: "string",
      minLength: 1
    },
    startDate: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
    },
    dueDate: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
    }
  };
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["summary", "description", "startDate"],
    properties,
    additionalProperties: false
  };
  return JSON.stringify(schema, null, 2);
}
function renderPromptTemplate(template, replacements) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      return replacements[key];
    }
    return match;
  });
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[CHATGPT_PROMPT_TEMPLATE_KEY]) {
    promptTemplateCache = null;
    resetPromptCache();
  }
  if (areaName === "local" && changes[BACKLOG_AUTH_KEY]) {
    void refreshAuthPreferences();
  }
});
function createDateField(label) {
  const container = document.createElement("div");
  container.className = "ticket-form__field";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "date";
  input.className = "ticket-form__input";
  input.value = formatDateValue(/* @__PURE__ */ new Date());
  container.append(name, input);
  return { container, input };
}
function formatDateValue(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function createTextField(label, placeholder) {
  const container = document.createElement("div");
  container.className = "ticket-form__field ticket-form__field--wide";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ticket-form__input";
  input.placeholder = placeholder;
  container.append(name, input);
  return { container, input };
}
function createTextareaField(label, placeholder) {
  const container = document.createElement("div");
  container.className = "ticket-form__field ticket-form__field--wide";
  const name = document.createElement("span");
  name.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.className = "ticket-form__textarea";
  textarea.placeholder = placeholder;
  textarea.rows = 5;
  container.append(name, textarea);
  return { container, textarea };
}
//# sourceMappingURL=index.js.map
