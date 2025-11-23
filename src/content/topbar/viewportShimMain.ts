const VIEWPORT_SHIM_EVENT = "backlogManagerViewportShim";
const FLAG = "__backlogViewportShimLoaded";
const DEFAULT_OFFSET = 0;
const MIN_DELTA_BEFORE_SHRINK = 32; // この差分未満なら縮めない

declare global {
  interface Window {
    [FLAG]?: boolean;
  }
}

if (!window[FLAG]) {
  window[FLAG] = true;

  const originalInner = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const originalClient = Object.getOwnPropertyDescriptor(document.documentElement, "clientHeight");
  const visualViewport = window.visualViewport;
  const originalVisualHeight = visualViewport
    ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(visualViewport), "height")
    : undefined;

  let currentOffset = DEFAULT_OFFSET;

  const getBaseInnerHeight = () => {
    if (visualViewport && typeof visualViewport.height === "number") {
      return visualViewport.height;
    }
    if (originalInner?.get) {
      try {
        return originalInner.get.call(window) as number;
      } catch {
        // ignore
      }
    }
    return typeof window.innerHeight === "number" ? window.innerHeight : 0;
  };

  const safeDefine = (
    target: Window | HTMLElement,
    key: "innerHeight" | "clientHeight",
    getter: () => number,
    original?: PropertyDescriptor
  ) => {
    if (original && original.configurable === false) {
      return;
    }
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        get: getter
      });
    } catch {
      // ignore
    }
  };

  const safeDefineVisualHeight = (getter: () => number) => {
    if (!visualViewport) {
      return;
    }
    try {
      Object.defineProperty(visualViewport, "height", {
        configurable: true,
        get: getter
      });
    } catch {
      // ignore
    }
  };

  const applyShim = () => {
    const baseHeight = getBaseInnerHeight();
    if (!Number.isFinite(baseHeight) || baseHeight <= 0) {
      restoreShim();
      return;
    }
    if (baseHeight <= currentOffset + MIN_DELTA_BEFORE_SHRINK) {
      restoreShim();
      return;
    }
    const nextHeight = Math.max(0, Math.floor(baseHeight - currentOffset));
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
      // ignore
    }
  };

  const updateOffset = (nextOffset: number) => {
    currentOffset = Math.max(0, Math.round(nextOffset));
    if (currentOffset > 0) {
      applyShim();
    } else {
      restoreShim();
    }
    try {
      window.dispatchEvent(new Event("resize"));
    } catch {
      // ignore
    }
  };

  // 初期オフセットは 0、イベント受信時に上書き
  updateOffset(DEFAULT_OFFSET);

  window.addEventListener(VIEWPORT_SHIM_EVENT, (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const nextOffset = detail && typeof detail.offset === "number" ? detail.offset : 0;
    updateOffset(nextOffset);
  });
}
