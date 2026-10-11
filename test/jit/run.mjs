// test/jit/run.mjs [--engine PATH] - the JIT regression scripts.
//
// Every script runs under the interpreter (host refusing to link) and under
// the JIT forced on (threshold 0) at tier-up intervals 1, 4 and 64; the
// outputs must be equal. async.lua runs as 120 frames with asynchronous
// compiles (the browser path): compiled code arriving between frames must
// not change what the frames print.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const LUARUN = path.join(ROOT, 'tools', 'luarun.mjs');
const PRELUDE = path.join(ROOT, 'test', 'luatests');
const args = process.argv.slice(2);
const engineArgs = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--engine') engineArgs.push('--engine', args[++i]);

const SCRIPTS = ['t1', 'spec2', 'intr', 'intr2', 'deep', 'deep2', 'keys'];
// lines that legitimately differ between modes: the JIT's own counters
const noise = (l) => l.startsWith('host:') || l.startsWith('LUARUN JIT') || l.startsWith('wasmcart:') || /^spec1/.test(l) || /^[0-9]*\t[0-9]*\t[0-9]*\t$/.test(l);

function run(extra, script) {
  const r = spawnSync(process.execPath, [LUARUN, ...engineArgs, '--dir', PRELUDE, ...extra, path.join(HERE, script)],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26 });
  return ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => l.length && !noise(l));
}
const equal = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

let fail = 0;
for (const s of SCRIPTS) {
  const ref = run(['--nojit'], `${s}.lua`);
  if (!ref.includes('LUARUN OK')) { console.log(`FAIL ${s}: interpreter run did not finish`); fail++; continue; }
  for (const tu of [1, 4, 64]) {
    const got = run(['--jit', '0', '--tierup', String(tu)], `${s}.lua`);
    if (!equal(ref, got)) {
      fail++;
      const d = Math.max(0, ref.findIndex((l, i) => l !== got[i]));
      console.log(`FAIL ${s} tierup=${tu}\n   interp: ${(ref[d] || '').slice(0, 200)}\n   jit   : ${(got[d] || '').slice(0, 200)}`);
    }
  }
  console.log(`${s}.lua: ${ref.length} lines`);
}
{
  const only = (lines) => lines.filter((l) => l.startsWith('async') || l.startsWith('states'));
  const ref = only(run(['--nojit', '--frames', '120'], 'async.lua'));
  const got = only(run(['--async', '--frames', '120'], 'async.lua'));
  const okAsync = ref.length > 0 && ref[0] === got[0] && got.some((l) => l.startsWith('states') && l.includes('compiled'));
  if (!okAsync) { fail++; console.log(`FAIL async\n   interp: ${ref.join(' | ')}\n   async : ${got.join(' | ')}`); }
  else console.log(`async.lua: ${got[0]}`);
}
console.log(fail ? `${fail} FAILED` : 'all modes equal the interpreter');
process.exit(fail ? 1 : 0);
