import { createRequire } from 'node:module';

// Resolve dependencies normally from this SDK, preserving ESM import conditions
// so Three.js and its official loaders share the same module identity.
export const sdkRequire = createRequire(import.meta.url);
export function sdkImport(specifier) {
  return import(specifier);
}
