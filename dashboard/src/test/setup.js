import '@testing-library/jest-dom/vitest';

// Node 22+ ships a native global `localStorage` that, without a `--localstorage-file`
// backing path, is a non-functional stub — and it shadows jsdom's own implementation
// too. Replace both with a minimal in-memory polyfill so component code that reads/
// writes localStorage (e.g. ThemeContext) behaves the same under test as in a real
// browser, instead of throwing "not a function" on every call.
function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
    key: index => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
}

const memoryStorage = createMemoryStorage();
globalThis.localStorage = memoryStorage;
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });
}
