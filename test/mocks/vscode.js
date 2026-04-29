"use strict";
// Minimal `vscode` API stub for unit tests. Only the surface area touched by
// the modules under test is implemented; everything else throws.
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspace = exports.window = exports.MemorySecretStorage = void 0;
class MemorySecretStorage {
    constructor() {
        this.data = new Map();
    }
    async get(key) {
        return this.data.get(key);
    }
    async store(key, value) {
        this.data.set(key, value);
    }
    async delete(key) {
        this.data.delete(key);
    }
}
exports.MemorySecretStorage = MemorySecretStorage;
const outputChannel = {
    name: 'mock',
    appendLine: (_msg) => { },
    append: (_msg) => { },
    clear: () => { },
    show: () => { },
    hide: () => { },
    replace: () => { },
    dispose: () => { }
};
exports.window = {
    createOutputChannel: (_name) => outputChannel
};
exports.workspace = {
    getConfiguration: (_section) => ({
        get: (_key, defaultValue) => defaultValue
    })
};
//# sourceMappingURL=vscode.js.map