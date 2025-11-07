import { CHATGPT_PROMPT_TEMPLATE_KEY, getPromptTemplate } from "@shared/promptTemplate";
import { BACKLOG_AUTH_KEY } from "@shared/backlogConfig";
import type { BacklogAuthConfig } from "@shared/backlogConfig";

const CHATGPT_URL = "https://chatgpt.com/?temporary-chat=true";
const STORAGE_LAST_PROJECT_ID_KEY = "sidepanel:lastProjectId";
const STORAGE_PROJECT_PREFS_KEY = "sidepanel:lastProjectPrefs";

type ProjectPreference = {
  issueTypeId?: number;
  categoryId?: number;
};

type ProjectDetailBundle = {
  projectId: number;
  name: string;
  projectKey: string;
  statuses: Array<{ id: number; name: string; displayOrder: number }>;
  categories: Array<{ id: number; name: string }>;
  issueTypes: Array<{ id: number; name: string; color?: string }>;
  users: Array<{ id: number; name: string }>;
  currentUserId: number | null;
};

let cachedProjectDetails: ProjectDetailBundle[] | null = null;
let projectDetailsPromise: Promise<ProjectDetailBundle[] | null> | null = null;
let ticketProjectSelectRef: HTMLSelectElement | null = null;
let chatgptProjectSelectRef: HTMLSelectElement | null = null;
let chatgptCopyButtonRef: HTMLButtonElement | null = null;
let lastProjectId: number | null = null;
let projectPreferences: Record<string, ProjectPreference> = {};
let formPreferencesLoaded = false;
let promptTemplateCache: string | null = null;
const excludedProjectIds = new Set<number>();
const excludedProjectKeys = new Set<string>();

async function refreshAuthPreferences(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "backlog-auth:get" });
    const config = response?.config as BacklogAuthConfig | null;
    updateProjectExclusions(config?.excludedProjects ?? []);
  } catch (error) {
    console.warn("Failed to load Backlog auth config", error);
    updateProjectExclusions([]);
  }
}

function updateProjectExclusions(tokens: string[]): void {
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

function isProjectExcluded(project: { projectId: number; projectKey: string }): boolean {
  if (excludedProjectIds.has(project.projectId)) {
    return true;
  }
  const key = project.projectKey?.toLowerCase?.();
  if (key && excludedProjectKeys.has(key)) {
    return true;
  }
  return false;
}

function filterProjects<T extends { projectId: number; projectKey: string }>(projects: T[]): T[] {
  if (!excludedProjectIds.size && !excludedProjectKeys.size) {
    return projects;
  }
  return projects.filter((project) => !isProjectExcluded(project));
}

async function ensureFormPreferencesLoaded(): Promise<void> {
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
      const normalized: Record<string, ProjectPreference> = {};
      for (const [key, value] of Object.entries(rawPrefs as Record<string, unknown>)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const prefValue = value as { issueTypeId?: unknown; categoryId?: unknown };
        const pref: ProjectPreference = {};
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

async function persistFormPreferences(projectId: number, updates: ProjectPreference): Promise<void> {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return;
  }
  await ensureFormPreferencesLoaded();

  const key = String(projectId);
  const current = projectPreferences[key] ?? {};
  const next: ProjectPreference = { ...current };
  if (updates.issueTypeId !== undefined) {
    next.issueTypeId = updates.issueTypeId > 0 ? updates.issueTypeId : undefined;
  }
  if (updates.categoryId !== undefined) {
    next.categoryId = updates.categoryId > 0 ? updates.categoryId : undefined;
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

function getStoredPreference(projectId: number | null): ProjectPreference | null {
  if (!projectId) {
    return null;
  }
  const pref = projectPreferences[String(projectId)];
  return pref ?? null;
}

async function ensurePromptTemplateLoaded(): Promise<string> {
  if (promptTemplateCache) {
    return promptTemplateCache;
  }
  const template = await getPromptTemplate();
  promptTemplateCache = template;
  return template;
}

async function init(): Promise<void> {
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

  root.append(createChatGPTCard(), createTicketCard());
}

function createCardBase(title: string, description?: string): HTMLDivElement {
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

function createTicketCard(): HTMLElement {
  const card = createCardBase("Backlog チケット作成", "上部バーと連動したチケット作成フォームをここに配置します。");

  void ensureFormPreferencesLoaded();

  const form = document.createElement("div");
  form.className = "ticket-form";

  const projectField = document.createElement("div");
  projectField.className = "ticket-form__field";
  const projectLabel = document.createElement("span");
  projectLabel.textContent = "プロジェクト";
  const projectSelect = document.createElement("select");
  projectSelect.className = "ticket-form__select";
  projectSelect.innerHTML = `<option value="" selected>読み込み中...</option>`;
  projectField.append(projectLabel, projectSelect);
  ticketProjectSelectRef = projectSelect;

  const issueTypeField = document.createElement("div");
  issueTypeField.className = "ticket-form__field";
  const issueTypeLabel = document.createElement("span");
  issueTypeLabel.textContent = "種別";
  const issueTypeSelect = document.createElement("select");
  issueTypeSelect.className = "ticket-form__select";
  issueTypeSelect.disabled = true;
  issueTypeSelect.innerHTML = `<option value="" selected>プロジェクトを選択してください</option>`;
  issueTypeField.append(issueTypeLabel, issueTypeSelect);

  const categoryField = document.createElement("div");
  categoryField.className = "ticket-form__field";
  const categoryLabel = document.createElement("span");
  categoryLabel.textContent = "カテゴリー";
  const categorySelect = document.createElement("select");
  categorySelect.className = "ticket-form__select";
  categorySelect.disabled = true;
  categorySelect.innerHTML = `<option value="" selected>プロジェクトを選択してください</option>`;
  categoryField.append(categoryLabel, categorySelect);

  const assigneeField = document.createElement("div");
  assigneeField.className = "ticket-form__field";
  const assigneeLabel = document.createElement("span");
  assigneeLabel.textContent = "担当者";
  const assigneeSelect = document.createElement("select");
  assigneeSelect.className = "ticket-form__select";
  assigneeSelect.disabled = true;
  assigneeSelect.innerHTML = `<option value="" selected>プロジェクトを選択してください</option>`;
  assigneeField.append(assigneeLabel, assigneeSelect);

  form.append(projectField, issueTypeField, categoryField, assigneeField);

  const startDateField = createDateField("開始日");
  const dueDateField = createDateField("期限日");
  form.append(startDateField.container, dueDateField.container);

  const titleField = createTextField("タイトル", "概要を入力");
  const bodyField = createTextareaField("本文", "詳細を入力");
  form.append(titleField.container, bodyField.container);

  const actions = document.createElement("div");
  actions.className = "ticket-form__actions";
  actions.innerHTML = `
    <button type="button" class="button button--ghost">JSON を取り込む</button>
    <button type="button" class="button button--primary">チケットを作成</button>
  `;

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

    await ensureFormPreferencesLoaded();
    const storedProjectId = lastProjectId;
    if (storedProjectId && projectSelect.querySelector(`option[value="${storedProjectId}"]`)) {
      if (String(storedProjectId) !== projectSelect.value) {
        projectSelect.value = String(storedProjectId);
        projectSelect.dispatchEvent(new Event("change", { bubbles: true, cancelable: false }));
      } else {
        const preference = getStoredPreference(storedProjectId);
        applyStoredPreferenceToSelectors(issueTypeSelect, categorySelect, preference);
        void persistFormPreferences(storedProjectId, preference ?? {});
      }
    }
  });

  projectSelect.addEventListener("change", () => {
    const projectId = Number(projectSelect.value);
    const details = cachedProjectDetails ?? [];
    const project = details.find((item) => item.projectId === projectId);
    populateIssueTypeSelect(issueTypeSelect, project?.issueTypes ?? []);
    populateCategorySelect(categorySelect, project?.categories ?? []);
    populateAssigneeSelect(assigneeSelect, project?.users ?? [], project?.currentUserId ?? null);
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

  const importButton = actions.querySelector(".button--ghost") as HTMLButtonElement;
  const createButton = actions.querySelector(".button--primary") as HTMLButtonElement;
  const titleInput = titleField.input;
  const bodyTextarea = bodyField.textarea;

  function showFeedback(type: "error" | "success", message: string): void {
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.classList.toggle("ticket-form__feedback--error", type === "error");
    feedback.classList.toggle("ticket-form__feedback--success", type === "success");
  }

  function clearFeedback(): void {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.classList.remove("ticket-form__feedback--error", "ticket-form__feedback--success");
  }

  importButton.addEventListener("click", async () => {
    if (importButton.dataset.loading === "true") {
      return;
    }
    clearFeedback();

    const projectId = Number(projectSelect.value);
    if (!projectId) {
      showFeedback("error", "先にプロジェクトを選択してください。");
      return;
    }
    if (issueTypeSelect.disabled || categorySelect.disabled) {
      showFeedback("error", "プロジェクト情報を読み込み中です。少し待ってから再度お試しください。");
      return;
    }

    importButton.dataset.loading = "true";
    importButton.disabled = true;
    try {
      await ensureFormPreferencesLoaded();
      const response = await chrome.runtime.sendMessage({ type: "chatgpt:json:request" });
      if (!response || response.error) {
        throw new Error(response?.error ?? "ChatGPT から JSON を取得できませんでした。");
      }
      const data = response.data ?? {};
      applyImportedJson(
        data as Record<string, unknown>,
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

  createButton.addEventListener("click", async () => {
    if (createButton.dataset.loading === "true") {
      return;
    }
    clearFeedback();

    const projectId = Number(projectSelect.value);
    if (!projectId) {
      showFeedback("error", "プロジェクトを選択してください。");
      projectSelect.focus();
      return;
    }

    const issueTypeId = Number(issueTypeSelect.value);
    if (!issueTypeId || issueTypeSelect.disabled) {
      showFeedback("error", "種別を選択してください。");
      issueTypeSelect.focus();
      return;
    }

    const summary = titleInput.value.trim();
    if (!summary) {
      showFeedback("error", "タイトルを入力してください。");
      titleInput.focus();
      return;
    }

    const startDate = startDateField.input.value;
    const dueDate = dueDateField.input.value;
    if (startDate && dueDate && startDate > dueDate) {
      showFeedback("error", "開始日は期限日以前の日付を指定してください。");
      dueDateField.input.focus();
      return;
    }

    const payload = {
      projectId,
      issueTypeId,
      summary,
      description: bodyTextarea.value,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      categoryId: Number(categorySelect.value) > 0 ? Number(categorySelect.value) : undefined,
      assigneeId: !assigneeSelect.disabled && Number(assigneeSelect.value) > 0 ? Number(assigneeSelect.value) : undefined
    };

    createButton.dataset.loading = "true";
    createButton.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({ type: "backlog:issue:create", payload });
      if (!response || response.error) {
        throw new Error(response?.error ?? "チケットを作成できませんでした。");
      }
      const issueKey = response.issue?.issueKey ?? "";
      showFeedback("success", issueKey ? `チケット ${issueKey} を作成しました。` : "チケットを作成しました。");
      titleInput.value = "";
      bodyTextarea.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("error", message);
    } finally {
      delete createButton.dataset.loading;
      createButton.disabled = false;
    }
  });

  return card;
}

function createChatGPTCard(): HTMLElement {
  const card = createCardBase("ChatGPT 連携", "チケットについての情報をクリップボードにコピーして、以下のボタンを押してください。");

  void ensureFormPreferencesLoaded();

  const projectField = document.createElement("div");
  projectField.className = "ticket-form__field";
  const projectLabel = document.createElement("span");
  projectLabel.textContent = "プロジェクト";
  const projectSelect = document.createElement("select");
  projectSelect.className = "ticket-form__select";
  projectSelect.innerHTML = `<option value="" selected>読み込み中...</option>`;
  projectField.append(projectLabel, projectSelect);
  chatgptProjectSelectRef = projectSelect;

  const viewport = document.createElement("div");
  viewport.className = "chatgpt-view chatgpt-view--placeholder";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button button--ghost";
  copyButton.textContent = "プロンプトをコピーする";
  copyButton.hidden = true;
  chatgptCopyButtonRef = copyButton;
  copyButton.addEventListener("click", async () => {
    try {
      const prompt = await buildPromptText();
      await navigator.clipboard.writeText(prompt);
      copyButton.textContent = "コピーしました！";
      window.setTimeout(() => {
        copyButton.textContent = "プロンプトをコピーする";
      }, 1800);
    } catch (error) {
      console.warn("Failed to copy prompt", error);
      copyButton.textContent = "コピーに失敗しました";
      window.setTimeout(() => {
        copyButton.textContent = "プロンプトをコピーする";
      }, 1800);
      resetPromptCache();
    }
  });

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "button button--primary";
  openButton.textContent = "ChatGPT を開く";
  openButton.addEventListener("click", async () => {
    if (openButton.dataset.loading === "true") {
      return;
    }
    openButton.dataset.loading = "true";
    openButton.disabled = true;
    try {
      const details = cachedProjectDetails ?? (await loadProjectDetails());
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
      copyButton.textContent = "プロンプトをコピーする";
    } catch (error) {
      console.warn("Failed to prepare ChatGPT prompt", error);
      resetPromptCache();
      return;
    } finally {
      delete openButton.dataset.loading;
      openButton.disabled = false;
    }

    chrome.tabs.create({ url: CHATGPT_URL }).catch((error) => {
      console.warn("Failed to open ChatGPT tab", error);
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

async function loadProjectDetails(force = false): Promise<ProjectDetailBundle[] | null> {
  if (!force && cachedProjectDetails) {
    return cachedProjectDetails;
  }
  if (!force && projectDetailsPromise) {
    return projectDetailsPromise;
  }

  const request = (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "backlog:projects:details" });
      const data = response?.data as ProjectDetailBundle[] | undefined;
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

function populateProjectSelect(
  projectSelect: HTMLSelectElement,
  issueTypeSelect: HTMLSelectElement,
  categorySelect: HTMLSelectElement,
  assigneeSelect: HTMLSelectElement,
  details: ProjectDetailBundle[]
): void {
  projectSelect.innerHTML = "";
  const visibleProjects = filterProjects(details);
  const sortedProjects = visibleProjects.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));

  if (!sortedProjects.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "プロジェクトが取得できません";
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

function populateChatGptProjectSelect(
  select: HTMLSelectElement | null,
  details: ProjectDetailBundle[]
): void {
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
    emptyOption.textContent = "プロジェクトが取得できません";
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

function populateIssueTypeSelect(issueTypeSelect: HTMLSelectElement, issueTypes: Array<{ id: number; name: string }>): void {
  issueTypeSelect.innerHTML = "";

  if (!issueTypes.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "種別未設定";
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

function populateCategorySelect(categorySelect: HTMLSelectElement, categories: Array<{ id: number; name: string }>): void {
  categorySelect.innerHTML = "";

  if (!categories.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "カテゴリー未設定";
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

function populateAssigneeSelect(
  assigneeSelect: HTMLSelectElement,
  users: Array<{ id: number; name: string }>,
  currentUserId: number | null
): void {
  assigneeSelect.innerHTML = "";

  if (!users.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "担当者未設定";
    assigneeSelect.append(emptyOption);
    assigneeSelect.value = "";
    assigneeSelect.disabled = true;
    return;
  }

  const sorted = users.slice().sort((a, b) => a.id - b.id);
  let selectedValue: string | null = null;
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function applyImportedJson(
  data: Record<string, unknown>,
  context: {
    issueTypeSelect: HTMLSelectElement;
    categorySelect: HTMLSelectElement;
    titleInput: HTMLInputElement;
    bodyTextarea: HTMLTextAreaElement;
    startDateField: { input: HTMLInputElement };
    dueDateField: { input: HTMLInputElement };
  },
  showFeedback: (type: "error" | "success", message: string) => void,
  projectId: number
): void {
  const warnings: string[] = [];
  const issueTypeName = typeof data.issueType === "string" ? data.issueType.trim() : "";
  const categoryNames = Array.isArray(data.categoryNames)
    ? data.categoryNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
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
  } else if (dueDateValue === null || dueDateValue === undefined) {
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
    issueTypeId: Number(context.issueTypeSelect.value) > 0 ? Number(context.issueTypeSelect.value) : undefined,
    categoryId: Number(context.categorySelect.value) > 0 ? Number(context.categorySelect.value) : undefined
  });

  if (warnings.length) {
    showFeedback("success", `ChatGPT の JSON を取り込みました。（未設定: ${warnings.join(", ")}）`);
  } else {
    showFeedback("success", "ChatGPT の JSON を取り込みました。");
  }
}

function syncChatGptProjectSelection(projectId: number | null): void {
  if (!chatgptProjectSelectRef) {
    return;
  }
  if (projectId && chatgptProjectSelectRef.querySelector(`option[value="${projectId}"]`)) {
    chatgptProjectSelectRef.value = String(projectId);
  }
}

function selectOptionByLabel(select: HTMLSelectElement, label: string): boolean {
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

function applyStoredPreferenceToSelectors(
  issueTypeSelect: HTMLSelectElement,
  categorySelect: HTMLSelectElement,
  preference: ProjectPreference | null
): void {
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

function determineChatGptProjectId(): number | null {
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

async function buildProjectPromptWithClipboard(project: ProjectDetailBundle): Promise<string> {
  const [template, clipboardText] = await Promise.all([
    ensurePromptTemplateLoaded(),
    navigator.clipboard.readText().catch(() => "")
  ]);
  return buildProjectPrompt(project, clipboardText, template);
}

let lastGeneratedPrompt = "";
function resetPromptCache(): void {
  lastGeneratedPrompt = "";
  if (chatgptCopyButtonRef) {
    chatgptCopyButtonRef.hidden = true;
    chatgptCopyButtonRef.textContent = "プロンプトをコピーする";
  }
  promptTemplateCache = null;
}

async function buildPromptText(): Promise<string> {
  if (!lastGeneratedPrompt) {
    await ensureFormPreferencesLoaded();
    const details = cachedProjectDetails ?? (await loadProjectDetails());
    const projectId = determineChatGptProjectId();
    const project = details?.find((item) => item.projectId === projectId) ?? null;
    if (!project) {
      throw new Error("プロジェクトが選択されていません。");
    }
    lastGeneratedPrompt = await buildProjectPromptWithClipboard(project);
  }
  return lastGeneratedPrompt;
}

function buildProjectPrompt(project: ProjectDetailBundle, clipboardText: string, template: string): string {
  const today = formatDateValue(new Date());
  const issueTypeNames = project.issueTypes.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const categoryNames = project.categories.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const assigneeNames = project.users.map((item) => item.name.trim()).filter((name) => name.length > 0);
  const fallbackIssueTypes = ["バグ", "タスク", "改善要望", "お問い合わせ", "その他"];
  const issueTypeEnumValues = issueTypeNames.length ? issueTypeNames : fallbackIssueTypes;
  const issueTypeListText = issueTypeEnumValues.join(" / ");
  const categoryListText = categoryNames.length ? categoryNames.join(" / ") : "なし";
  const assigneeContext = assigneeNames.length
    ? assigneeNames.map((name) => `- ${name}`).join("\n")
    : "- なし";

  const normalizedClipboard = clipboardText.replace(/\r\n/g, "\n").trim();
  const inputText = normalizedClipboard || "{clipboard}";
  const schemaText = createSchemaText(issueTypeEnumValues, categoryNames);

  const replacements: Record<string, string> = {
    TODAY: today,
    ISSUE_TYPES: issueTypeListText,
    CATEGORIES: categoryListText,
    ASSIGNEES: assigneeContext,
    INPUT_TEXT: inputText,
    JSON_SCHEMA: schemaText
  };

  return renderPromptTemplate(template, replacements);
}

function createSchemaText(issueTypeEnumValues: string[], categoryNames: string[]): string {
  const properties: Record<string, unknown> = {
    issueType: {
      type: ["string", "null"],
      enum: [...issueTypeEnumValues, null]
    },
    categoryNames: {
      type: "array",
      items: categoryNames.length
        ? { type: "string", enum: categoryNames }
        : { type: "string" }
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

function renderPromptTemplate(template: string, replacements: Record<string, string>): string {
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

function createDateField(label: string): { container: HTMLDivElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "ticket-form__field";

  const name = document.createElement("span");
  name.textContent = label;

  const input = document.createElement("input");
  input.type = "date";
  input.className = "ticket-form__input";
  input.value = formatDateValue(new Date());

  container.append(name, input);
  return { container, input };
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createTextField(label: string, placeholder: string): { container: HTMLDivElement; input: HTMLInputElement } {
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

function createTextareaField(label: string, placeholder: string): {
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
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
