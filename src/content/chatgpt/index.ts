function announceReady() {
  chrome.runtime.sendMessage({ type: "chatgpt:content-ready" }).catch(() => {
    // Ignored: the background might not be listening yet.
  });
}

function extractLatestAssistantJson(): { json: unknown; raw: string } | null {
  const messageNodes = Array.from(
    document.querySelectorAll<HTMLDivElement>("[data-message-author-role='assistant'] .markdown")
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

function collectJsonCandidates(node: HTMLElement): string[] {
  const candidates = new Set<string>();
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

function tryParseJson(source: string): { json: unknown; raw: string } | null {
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
        sendResponse({ ok: false, error: "ChatGPT の回答から JSON を検出できませんでした。" });
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
