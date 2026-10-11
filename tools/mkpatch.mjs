#!/usr/bin/env node
// tools/mkpatch.mjs - regenerate runtime/jit/lua-5.4.7-jit.patch.
//
// The JIT's hooks in the Lua core are kept as a patch against the pristine
// vendor/lua. To change them: run ./build.sh jit once (it copies vendor/lua
// to build/src-jit and applies the current patch), edit build/src-jit/src,
// then run this script and build again.
//
//   node tools/mkpatch.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRISTINE = path.join(ROOT, 'vendor', 'lua', 'src');
const EDITED = path.join(ROOT, 'build', 'src-jit', 'src');
const OUT = path.join(ROOT, 'runtime', 'jit', 'lua-5.4.7-jit.patch');
const FILES = ['lobject.h', 'lstate.h', 'lstate.c', 'lfunc.c', 'ldo.c', 'lvm.c'];

if (!fs.existsSync(EDITED)) {
  console.error(`${EDITED} does not exist: run ./build.sh jit first`);
  process.exit(1);
}
let out = '';
for (const f of FILES) {
  const r = spawnSync('diff', ['-u', '--label', `a/src/${f}`, '--label', `b/src/${f}`,
    path.join(PRISTINE, f), path.join(EDITED, f)], { encoding: 'utf8' });
  if (r.status > 1) {
    console.error(r.stderr);
    process.exit(1);
  }
  out += r.stdout;
}
fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(ROOT, OUT)} (${out.split('\n').length - 1} lines)`);
