import { resourceError } from './resources.mjs';

const MISSING_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED']);

/**
 * True when `error` means "this package (or its platform binary) is not installed",
 * as opposed to a genuine failure inside an installed package.
 */
export function isMissingModuleError(error) {
  if (!error || typeof error !== 'object') return false;
  if (MISSING_CODES.has(error.code)) return true;
  return /Cannot find (module|package)|Could not load the "sharp" module/i.test(String(error.message ?? ''));
}

/**
 * Load a dependency that is declared in optionalDependencies. Native packages such as
 * @napi-rs/canvas can be skipped by `--omit=optional` or fail to install on unsupported
 * platforms; features that need them must fail with a clear, stable
 * `OPTIONAL_DEPENDENCY_MISSING` error instead of a raw module-resolution crash. The
 * browser SDK never loads any of these.
 *
 * NOTE: `sharp` is deliberately NOT treated as optional. It is a hard dependency of
 * `ndarray-pixels` (pulled in by `@gltf-transform/functions`), whose Node build imports
 * it at load time, so it is always installed and always required by the Node tooling.
 *
 * @param {string} name       package specifier
 * @param {string} feature    human description of what needs it, used in the message
 * @param {(specifier: string) => Promise<any>} [importer]
 */
export async function importOptional(name, feature, importer = specifier => import(specifier)) {
  try {
    return await importer(name);
  } catch (error) {
    if (!isMissingModuleError(error)) throw error;
    throw resourceError(
      'OPTIONAL_DEPENDENCY_MISSING',
      `${feature} needs the optional dependency "${name}", which is not installed. `
        + `Run "npm install ${name}" next to mivo-model-viewer, or reinstall without --omit=optional.`,
      { dependency: name },
    );
  }
}
