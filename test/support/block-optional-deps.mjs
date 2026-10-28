// Preload hook for tests: makes the optional native package `@napi-rs/canvas` look
// uninstalled (what `npm install --omit=optional` produces). Use with `node --import <this file>`.
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
const BLOCKED = new Set(['@napi-rs/canvas']);
export async function resolve(specifier, context, next) {
  if (BLOCKED.has(specifier)) {
    const error = new Error("Cannot find package '" + specifier + "' imported from test");
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return next(specifier, context);
}
`), import.meta.url);
