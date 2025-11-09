import {
  BACKLOG_AUTH_KEY,
  BacklogAuthConfig,
  backlogApiOrigin,
  clearBacklogAuthConfig,
  getBacklogAuthConfig,
  saveBacklogAuthConfig,
  DEFAULT_ISSUE_FETCH_LIMIT,
  DEFAULT_LLM_PROVIDER,
  normalizeIssueFetchLimit,
  normalizeExcludedProjects,
  normalizeLlmProvider,
  type LlmProvider,
  DEFAULT_AUTO_IMPORT_DELAY_SECONDS,
  DEFAULT_AUTO_CREATE_DELAY_SECONDS,
  AUTO_IMPORT_DELAY_MIN,
  AUTO_IMPORT_DELAY_MAX,
  AUTO_CREATE_DELAY_MIN,
  AUTO_CREATE_DELAY_MAX,
  normalizeAutoDelay
} from "@shared/backlogConfig";
import {
  CHATGPT_PROMPT_TEMPLATE_KEY,
  DEFAULT_PROMPT_TEMPLATE,
  clearPromptTemplate,
  getPromptTemplate,
  savePromptTemplate
} from "@shared/promptTemplate";

const form = document.getElementById("auth-form") as HTMLFormElement | null;
const statusEl = document.getElementById("status");
const clearButton = document.getElementById("clear-auth");
const promptForm = document.getElementById("prompt-form") as HTMLFormElement | null;
const promptTextarea = document.getElementById("prompt-template") as HTMLTextAreaElement | null;
const promptResetButton = document.getElementById("prompt-reset");
const promptStatusEl = document.getElementById("prompt-status");
const issueFetchLimitInput = document.getElementById("issue-fetch-limit") as HTMLInputElement | null;
const excludedProjectsTextarea = document.getElementById("excluded-projects") as HTMLTextAreaElement | null;
const llmProviderSelect = document.getElementById("llm-provider") as HTMLSelectElement | null;
const autoImportDelayInput = document.getElementById("auto-import-delay") as HTMLInputElement | null;
const autoCreateDelayInput = document.getElementById("auto-create-delay") as HTMLInputElement | null;
let confirmDialog: HTMLDialogElement | null = null;

async function populateForm() {
  const config = await getBacklogAuthConfig();
  if (!form || !config) {
    return;
  }
  (form.elements.namedItem("spaceDomain") as HTMLInputElement).value = config.spaceDomain;
  (form.elements.namedItem("host") as HTMLSelectElement).value = config.host;
  (form.elements.namedItem("apiKey") as HTMLInputElement).value = config.apiKey;
  const showTomorrowInput = form.elements.namedItem("showTomorrowSection") as HTMLInputElement | null;
  if (showTomorrowInput) {
    showTomorrowInput.checked = config.showTomorrowSection !== false;
  }
  const showNoDueInput = form.elements.namedItem("showNoDueSection") as HTMLInputElement | null;
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
  setStatus(`保存済み: ${config.spaceDomain}.${config.host}`);
}

function setStatus(message: string, isError = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#dc2626" : "#16a34a";
}

function setPromptStatus(message: string, isError = false) {
  if (!promptStatusEl) {
    return;
  }
  promptStatusEl.textContent = message;
  promptStatusEl.style.color = isError ? "#dc2626" : "#16a34a";
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const config: BacklogAuthConfig = {
    spaceDomain: (formData.get("spaceDomain") ?? "").toString().trim(),
    host: (formData.get("host") ?? "backlog.com") as BacklogAuthConfig["host"],
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
    config.llmProvider = normalizeLlmProvider(llmProviderSelect.value as LlmProvider);
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
    setStatus("スペースドメインと API キーを入力してください。", true);
    return;
  }

  await saveBacklogAuthConfig(config);

  const permissionGranted = await ensureHostPermission(config);
  if (!permissionGranted) {
    setStatus("ドメインへのアクセス許可が必要です。ブラウザの確認ダイアログを許可してください。", true);
    return;
  }

  setStatus(`保存しました: ${config.spaceDomain}.${config.host}`);
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
  setStatus("認証情報を削除しました。", true);
}

function ensureConfirmDialog(): HTMLDialogElement {
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
  heading.textContent = "認証情報をクリア";
  heading.style.margin = "0 0 12px";
  heading.style.fontSize = "18px";

  const message = document.createElement("p");
  message.textContent = "保存済みのスペース情報と API キーを削除します。よろしいですか？";
  message.style.margin = "0 0 20px";
  message.style.fontSize = "14px";

  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.gap = "12px";
  buttonRow.style.justifyContent = "flex-end";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "戻る";
  cancel.style.background = "#e2e8f0";
  cancel.style.color = "#0f172a";
  cancel.style.border = "none";
  cancel.style.padding = "8px 16px";
  cancel.style.borderRadius = "8px";
  cancel.style.cursor = "pointer";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.textContent = "はい。クリアします。";
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

async function populatePromptForm(): Promise<void> {
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
    setPromptStatus("プロンプトを保存しました。");
  });
}

if (promptResetButton && promptTextarea) {
  promptResetButton.addEventListener("click", async () => {
    promptTextarea.value = DEFAULT_PROMPT_TEMPLATE;
    await clearPromptTemplate();
    setPromptStatus("プロンプトをリセットしました。");
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
    setPromptStatus("プロンプト設定が更新されました。");
  }
});

async function ensureHostPermission(config: BacklogAuthConfig): Promise<boolean> {
  const originPattern = `${backlogApiOrigin(config)}*`;
  const permission = { origins: [originPattern] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) {
    return true;
  }
  return chrome.permissions.request(permission);
}

async function removeHostPermission(config: BacklogAuthConfig): Promise<void> {
  const originPattern = `${backlogApiOrigin(config)}*`;
  const permission = { origins: [originPattern] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (!hasPermission) {
    return;
  }
  await chrome.permissions.remove(permission);
}

function parseExcludedProjectsInput(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
