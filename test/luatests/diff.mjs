// test/luatests/diff.mjs - differential run of the official Lua test suite:
// interpreter (host refusing to link) against the JIT forced on (threshold 0:
// every function compiles on first use). A file passes when both runs
// complete and print the same lines. Each run is a child process with a
// timeout, so a miscompile that loops forever reads as a failure.
//
//   node test/luatests/diff.mjs [--engine PATH] [--mode sync|async]
//        [--threshold N] [--tierup N] [--timeout S] [--soft 0|1] [files...]
//
// Run test/luatests/prepare.mjs first (it writes suite/).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'suite');
const LUARUN = path.join(HERE, '..', '..', 'tools', 'luarun.mjs');
const args = process.argv.slice(2);
let engine, mode = 'sync', threshold = 0, timeout = 300, soft = 1, tierup = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--engine') engine = args[++i];
  else if (args[i] === '--mode') mode = args[++i];
  else if (args[i] === '--threshold') threshold = Number(args[++i]);
  else if (args[i] === '--timeout') timeout = Number(args[++i]);
  else if (args[i] === '--soft') soft = Number(args[++i]);
  else if (args[i] === '--tierup') tierup = args[++i];
  else files.push(args[i]);
}
if (!fs.existsSync(SUITE)) {
  console.error('suite/ missing: run node test/luatests/prepare.mjs first');
  process.exit(2);
}
const list = files.length ? files : ['math', 'strings', 'nextvar', 'calls', 'closure', 'goto',
  'locals', 'constructs', 'events', 'vararg', 'sort', 'errors', 'coroutine'];

function run(file, extra) {
  const argv = [LUARUN, '--dir', SUITE, '--dir', HERE, '--pre', `_port=true _soft=${soft ? 'true' : 'false'}`];
  if (engine) argv.push('--engine', engine);
  argv.push(...extra, file);
  const t0 = performance.now();
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 28 });
  const ms = performance.now() - t0;
  const lines = (r.stdout || '').split('\n').filter((l) => l.length);
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  return { ok: r.status === 0, timedOut, lines, ms, stderr: r.stderr };
}
const strip = (lines) => lines.filter((l) => !l.startsWith('LUARUN JIT') && !l.startsWith('host:'));

let bad = 0;
for (const f of list) {
  const file = path.join(SUITE, f.endsWith('.lua') ? f : f + '.lua');
  const a = run(file, ['--nojit']);
  const b = run(file, ['--jit', String(threshold), ...(tierup ? ['--tierup', tierup] : []),
    ...(mode === 'async' ? ['--async', '--frames', '1'] : [])]);
  const la = strip(a.lines), lb = strip(b.lines);
  const same = la.length === lb.length && la.every((l, i) => l === lb[i]);
  const st = (b.lines.find((l) => l.startsWith('LUARUN JIT')) || '').replace('LUARUN JIT ', '');
  const ok = a.ok && b.ok && same;
  if (!ok) bad++;
  const tag = (r) => (r.ok ? 'ok' : r.timedOut ? 'TIMEOUT' : 'FAIL');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f.padEnd(11)} interp=${tag(a)} ${(a.ms / 1000).toFixed(1)}s  jit=${tag(b)} ${(b.ms / 1000).toFixed(1)}s  same=${same}  ${st}`);
  if (!ok) {
    const d = Math.max(0, la.findIndex((l, i) => l !== lb[i]));
    console.log('   first difference at output line', d, '\n   interp:', (la[d] || '').slice(0, 300), '\n   jit   :', (lb[d] || '').slice(0, 300));
    const fail = [...a.lines, ...b.lines].find((l) => l.startsWith('LUARUN FAIL') || l.startsWith('LUARUN TRAP') || l.startsWith('lua error'));
    if (fail) console.log('   ', fail.slice(0, 300));
  }
}
console.log(bad ? `${bad} FAILED` : `all ${list.length} files equal`);
process.exit(bad ? 1 : 0);
