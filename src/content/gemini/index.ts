function extractLatestGeminiJson(): { json: unknown; raw: string } | null {
  const codeBlocks = Array.from(
    document.querySelectorAll<HTMLElement>("code[data-test-id='code-content'], pre code")
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

function tryParseJson(raw: string): { json: unknown; raw: string } | null {
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
      sendResponse({ ok: false, error: "Gemini の回答から JSON を検出できませんでした。" });
    }
    return true;
  }
  return undefined;
});
