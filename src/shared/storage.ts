type StorageArea = chrome.storage.LocalStorageArea;

const storage: StorageArea = chrome.storage.local;

export function storageGet<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve, reject) => {
    storage.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve(items as Record<string, T>);
      }
    });
  });
}

export function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    storage.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    storage.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
