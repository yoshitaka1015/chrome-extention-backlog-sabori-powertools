// src/content/chatgpt/index.ts
function announceReady() {
  chrome.runtime.sendMessage({ type: "chatgpt:content-ready" }).catch(() => {
  });
}
function extractLatestAssistantJson() {
  const messageNodes = Array.from(
    document.querySelectorAll("[data-message-author-role='assistant'] .markdown")
  );
  for (let index = messageNodes.length - 1; index >= 0; index -= 1) {
    const node = messageNodes[index];
    const candidates = collectJsonCandidates(node);
    for (const candidate of candidates) {
      const parsed = tryParseJson(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}
function collectJsonCandidates(node) {
  const candidates = /* @__PURE__ */ new Set();
  const codeBlocks = Array.from(node.querySelectorAll("pre code"));
  codeBlocks.forEach((block) => {
    const text = block.textContent?.trim();
    if (text) {
      candidates.add(text);
    }
  });
  const rawText = node.textContent?.trim();
  if (rawText) {
    candidates.add(rawText);
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      candidates.add(match[0].trim());
    }
  }
  return Array.from(candidates).filter((candidate) => candidate.startsWith("{"));
}
function tryParseJson(source) {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      return { json: parsed, raw: trimmed };
    }
  } catch (error) {
    console.debug("Failed to parse ChatGPT JSON candidate", error, trimmed);
  }
  return null;
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "chatgpt:extract-json") {
    try {
      const result = extractLatestAssistantJson();
      if (!result) {
        sendResponse({ ok: false, error: "ChatGPT \u306E\u56DE\u7B54\u304B\u3089 JSON \u3092\u691C\u51FA\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
        return;
      }
      sendResponse({ ok: true, data: result.json, raw: result.raw });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: messageText });
    }
  }
});
announceReady();
//# sourceMappingURL=index.js.map
