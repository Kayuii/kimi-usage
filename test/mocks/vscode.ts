// Minimal `vscode` API stub for unit tests. Only the surface area touched by
// the modules under test is implemented; everything else throws.

export class MemorySecretStorage {
  private data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const outputChannel = {
  name: 'mock',
  appendLine: (_msg: string) => { /* noop */ },
  append: (_msg: string) => { /* noop */ },
  clear: () => { /* noop */ },
  show: () => { /* noop */ },
  hide: () => { /* noop */ },
  replace: () => { /* noop */ },
  dispose: () => { /* noop */ }
};

export const window = {
  createOutputChannel: (_name: string) => outputChannel
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
  })
};

// Type re-export so `import * as vscode from 'vscode'; vscode.SecretStorage`
// works for type positions. Runtime callers must inject MemorySecretStorage.
export type SecretStorage = MemorySecretStorage;

export class MemoryMemento {
  private data = new Map<string, unknown>();
  keys(): readonly string[] {
    return Array.from(this.data.keys());
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data.has(key) ? (this.data.get(key) as T) : defaultValue);
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
    return Promise.resolve();
  }
}

export function makeContext(initial?: Record<string, unknown>): {
  globalState: MemoryMemento;
  subscriptions: Array<{ dispose: () => void }>;
} {
  const globalState = new MemoryMemento();
  if (initial) {
    for (const [k, v] of Object.entries(initial)) {
      void globalState.update(k, v);
    }
  }
  return { globalState, subscriptions: [] };
}
