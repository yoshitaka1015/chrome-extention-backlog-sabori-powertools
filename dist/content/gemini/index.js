// src/content/gemini/index.ts
function extractLatestGeminiJson() {
  const codeBlocks = Array.from(
    document.querySelectorAll("code[data-test-id='code-content'], pre code")
  );
  for (let index = codeBlocks.length - 1; index >= 0; index -= 1) {
    const block = codeBlocks[index];
    const text = block.textContent?.trim();
    if (!text) {
      continue;
    }
    const parsed = tryParseJson(text);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}
function tryParseJson(raw) {
  const normalized = raw.replace(/\u00a0/g, " ").trim();
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) {
    return null;
  }
  try {
    const json = JSON.parse(normalized);
    return { json, raw: normalized };
  } catch {
    return null;
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "gemini:extract-json") {
    const latest = extractLatestGeminiJson();
    if (latest) {
      sendResponse({ ok: true, data: latest.json, raw: latest.raw });
    } else {
      sendResponse({ ok: false, error: "Gemini \u306E\u56DE\u7B54\u304B\u3089 JSON \u3092\u691C\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
    }
    return true;
  }
  return void 0;
});
//# sourceMappingURL=index.js.map
