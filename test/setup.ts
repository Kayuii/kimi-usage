// Test bootstrap: intercept `import 'vscode'` in production code so the
// modules under test can run outside an Extension Host.

import * as path from 'path';
import Module = require('module');

const mockPath = path.resolve(__dirname, 'mocks/vscode.ts');

type ResolveFn = (request: string, parent: NodeJS.Module | undefined, ...rest: unknown[]) => string;
const moduleAny = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = moduleAny._resolveFilename;

moduleAny._resolveFilename = function patchedResolve(request, parent, ...rest) {
  if (request === 'vscode') {
    return mockPath;
  }
  return originalResolve.call(this, request, parent, ...rest);
};
