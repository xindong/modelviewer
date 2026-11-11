import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const nodeRoot = fileURLToPath(new URL('..', import.meta.url));
const coreTarget = path.join(nodeRoot, 'core');
const coreSource = fileURLToPath(new URL('../../core/src', import.meta.url));
const staging = path.join(nodeRoot, '.core-src');
const buildOut = path.join(nodeRoot, '.core-build');
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
  // Published files live under node_modules, where Node refuses to strip TS types.
  // Compile in a temp dir first so a failed build never breaks the dev symlink.
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(buildOut, { recursive: true, force: true });
  try {
    fs.cpSync(coreSource, staging, { recursive: true });
    for (const name of fs.readdirSync(staging)) {
      if (!name.endsWith('.ts')) continue;
      const file = path.join(staging, name);
      const rewritten = fs.readFileSync(file, 'utf8').replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2');
      fs.writeFileSync(file, rewritten);
    }
    execFileSync('npx', ['tsc', '-p', path.join(nodeRoot, 'tsconfig.core.json')], { cwd: nodeRoot, stdio: 'inherit' });
    // Compile succeeded: swap the dev symlink for the compiled output.
    removeCore();
    fs.renameSync(buildOut, coreTarget);
    setImports('js');
    console.log('core compiled to JS and #core remapped for publishing');
  } catch (error) {
    fs.rmSync(buildOut, { recursive: true, force: true });
    console.error('core materialize failed; dev symlink left intact:', error.message);
    process.exit(1);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
} else if (mode === 'link') {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(buildOut, { recursive: true, force: true });
  setImports('ts');
  removeCore();
  fs.symlinkSync(path.relative(nodeRoot, coreSource), coreTarget, 'dir');
  console.log('core symlink restored for development');
} else {
  console.error('usage: core-link.mjs <materialize|link>');
  process.exit(1);
}
