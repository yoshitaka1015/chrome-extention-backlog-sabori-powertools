// src/content/topbar/viewportShimMain.ts
var VIEWPORT_SHIM_EVENT = "backlogManagerViewportShim";
var FLAG = "__backlogViewportShimLoaded";
var DEFAULT_OFFSET = 0;
if (!window[FLAG]) {
  window[FLAG] = true;
  const originalInner = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const originalClient = Object.getOwnPropertyDescriptor(document.documentElement, "clientHeight");
  const visualViewport = window.visualViewport;
  const originalVisualHeight = visualViewport ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(visualViewport), "height") : void 0;
  let currentOffset = DEFAULT_OFFSET;
  const getBaseInnerHeight = () => {
    if (visualViewport && typeof visualViewport.height === "number") {
      return visualViewport.height;
    }
    if (originalInner?.get) {
      try {
        return originalInner.get.call(window);
      } catch {
      }
    }
    return typeof window.innerHeight === "number" ? window.innerHeight : 0;
  };
  const safeDefine = (target, key, getter, original) => {
    if (original && original.configurable === false) {
      return;
    }
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        get: getter
      });
    } catch {
    }
  };
  const safeDefineVisualHeight = (getter) => {
    if (!visualViewport) {
      return;
    }
    try {
      Object.defineProperty(visualViewport, "height", {
        configurable: true,
        get: getter
      });
    } catch {
    }
  };
  const applyShim = () => {
    const nextHeight = Math.max(0, Math.floor(getBaseInnerHeight() - currentOffset));
    safeDefine(window, "innerHeight", () => nextHeight, originalInner);
    safeDefine(document.documentElement, "clientHeight", () => nextHeight, originalClient);
    safeDefineVisualHeight(() => nextHeight);
  };
  const restoreShim = () => {
    try {
      if (originalInner?.configurable) {
        Object.defineProperty(window, "innerHeight", originalInner);
      }
      if (originalClient?.configurable) {
        Object.defineProperty(document.documentElement, "clientHeight", originalClient);
      }
      if (visualViewport && originalVisualHeight?.configurable) {
        Object.defineProperty(Object.getPrototypeOf(visualViewport), "height", originalVisualHeight);
      }
    } catch {
    }
  };
  const updateOffset = (nextOffset) => {
    currentOffset = Math.max(0, Math.round(nextOffset));
    if (currentOffset > 0) {
      applyShim();
    } else {
      restoreShim();
    }
    try {
      window.dispatchEvent(new Event("resize"));
    } catch {
    }
  };
  updateOffset(DEFAULT_OFFSET);
  window.addEventListener(VIEWPORT_SHIM_EVENT, (event) => {
    const detail = event.detail;
    const nextOffset = detail && typeof detail.offset === "number" ? detail.offset : 0;
    updateOffset(nextOffset);
  });
}
//# sourceMappingURL=viewportShimMain.js.map
