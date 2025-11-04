import { storageGet, storageRemove, storageSet } from "./storage";

export const CHATGPT_PROMPT_TEMPLATE_KEY = "chatgptPromptTemplate";

export const DEFAULT_PROMPT_TEMPLATE = `You are a JSON extraction assistant. Read the unstructured input text and produce **only** a JSON object that validates against the JSON Schema provided below. All textual values (summary, description, category names, etc.) must be written in Japanese. Enforce the following domain rules:
- summaryは日本語で20文字以内にします。
- サブタスクやアクションが含まれる場合、Backlogのチェックボックス記法 (例: "- [ ] タスク") で列挙します。
- startDateが入力文で指定されていない場合は {{TODAY}} を設定します。
- わからない値は null または空配列にします。

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

export async function getPromptTemplate(): Promise<string> {
  const stored = await storageGet<string | null>([CHATGPT_PROMPT_TEMPLATE_KEY]);
  const value = stored[CHATGPT_PROMPT_TEMPLATE_KEY];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_PROMPT_TEMPLATE;
}

export async function savePromptTemplate(value: string): Promise<void> {
  const normalized = value.trim().length > 0 ? value : DEFAULT_PROMPT_TEMPLATE;
  await storageSet({ [CHATGPT_PROMPT_TEMPLATE_KEY]: normalized });
}

export async function clearPromptTemplate(): Promise<void> {
  await storageRemove([CHATGPT_PROMPT_TEMPLATE_KEY]);
}
