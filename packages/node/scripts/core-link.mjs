import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const nodeRoot = fileURLToPath(new URL('..', import.meta.url));
const coreTarget = path.join(nodeRoot, 'core');
const coreSource = fileURLToPath(new URL('../../core/src', import.meta.url));
const staging = path.join(nodeRoot, '.core-src');
const pkgPath = path.join(nodeRoot, 'package.json');
const mode = process.argv[2];

function removeCore() {
  const stat = fs.lstatSync(coreTarget, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) fs.unlinkSync(coreTarget);
  else fs.rmSync(coreTarget, { recursive: true, force: true });
}

function setImports(ext) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.imports = { '#core': `./core/index.${ext}`, '#core/*': `./core/*.${ext}` };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

if (mode === 'materialize') {
  removeCore();
  // Published files live under node_modules, where Node refuses to strip TS types.
  // Stage the core, rewrite .ts import specifiers to .js, then compile to JS.
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(coreSource, staging, { recursive: true });
  for (const name of fs.readdirSync(staging)) {
    if (!name.endsWith('.ts')) continue;
    const file = path.join(staging, name);
    const rewritten = fs.readFileSync(file, 'utf8').replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2');
    fs.writeFileSync(file, rewritten);
  }
  execFileSync('npx', ['tsc', '-p', path.join(nodeRoot, 'tsconfig.core.json')], { cwd: nodeRoot, stdio: 'inherit' });
  fs.rmSync(staging, { recursive: true, force: true });
  setImports('js');
  console.log('core compiled to JS and #core remapped for publishing');
} else if (mode === 'link') {
  fs.rmSync(staging, { recursive: true, force: true });
  setImports('ts');
  removeCore();
  fs.symlinkSync(path.relative(nodeRoot, coreSource), coreTarget, 'dir');
  console.log('core symlink restored for development');
} else {
  console.error('usage: core-link.mjs <materialize|link>');
  process.exit(1);
}
