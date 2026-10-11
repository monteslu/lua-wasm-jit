#!/usr/bin/env node
// bench/run.mjs - cross-runtime Lua benchmarks: the same programs in the
// stock engine, the JIT engine, native Lua, LuaJIT, Luau and V8.
//
//   node bench/run.mjs [--only fib,nbody] [--configs puc-wasm,jit-wasm,js-v8] [--reps 3]
//
// Each run is a separate process, timed by wall clock; the cost of starting
// that runtime (measured on an empty script, same process shape) is
// subtracted. Best of N. Every run prints `RESULT <name> <checksum>`, which
// must match the reference (native Lua's result, or the stock engine's when
// native Lua is not installed), or the cell is marked WRONG.
//
// Native runtimes are optional and found on PATH or through the environment:
// PUC_LUA (a Lua 5.4 binary), LUAJIT, LUAU. A lane whose binary is missing
// is skipped. Output: a markdown table on stdout and bench/results/<stamp>.{md,json}.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LUARUN = path.join(ROOT, 'tools', 'luarun.mjs');

// Sizes chosen so the slowest Lua runtimes take a few seconds.
const BENCH = {
  fib: { n: 35 },
  mandelbrot: { n: 1200 },
  nbody: { n: 2000000 },
  spectralnorm: { n: 1000 },
  binarytrees: { n: 17 },
  fannkuch: { n: 10 },
  vec3: { n: 8000000 },
};

function which(name) {
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
const env = process.env;
const PUC = env.PUC_LUA || which('lua5.4') || which('lua54') || which('lua');
const LUAJIT = env.LUAJIT || which('luajit');
const LUAU = env.LUAU || which('luau');

// Engines are copied before timing, so a rebuild mid-run cannot change them.
const ENG = path.join(HERE, 'engines');
fs.mkdirSync(ENG, { recursive: true });
const snap = (src, name) => {
  if (!fs.existsSync(src)) return null;
  const d = path.join(ENG, name);
  fs.copyFileSync(src, d);
  return d;
};
const STOCK = snap(path.join(ROOT, 'build', 'engine-stock.wasm'), 'engine-stock.wasm');
const JITENG = snap(path.join(ROOT, 'build', 'engine.wasm'), 'engine.wasm');

const CONFIGS = {
  'puc-native': (f) => PUC && [PUC, [f]],
  'puc-wasm': (f) => STOCK && ['node', [LUARUN, '--nojit', '--engine', STOCK, f]],
  'jit-wasm': (f) => JITENG && ['node', [LUARUN, '--engine', JITENG, f]],
  'luajit-interp': (f) => LUAJIT && [LUAJIT, ['-joff', f]],
  'luajit': (f) => LUAJIT && [LUAJIT, [f]],
  'luau-native': (f) => LUAU && [LUAU, ['-O2', f]],
  'luau-codegen': (f) => LUAU && [LUAU, ['-O2', '--codegen', f]],
  'js-v8': null, // handled separately
};

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', Object.keys(BENCH).join(',')).split(',');
const configs = opt('--configs', Object.keys(CONFIGS).join(',')).split(',');
const REPS = Number(opt('--reps', 3));
// the reference lane runs first
const REF = PUC ? 'puc-native' : 'puc-wasm';
if (configs[0] !== REF) { const i = configs.indexOf(REF); if (i > 0) configs.splice(i, 1); configs.unshift(REF); }

// One script per benchmark and size: the size, the shared helpers, the body.
const GEN = path.join(HERE, 'gen');
fs.mkdirSync(GEN, { recursive: true });
const common = fs.readFileSync(path.join(HERE, 'lua/common.lua'), 'utf8');
function script(name, n) {
  const f = path.join(GEN, `${name}-${n}.lua`);
  const body = name === 'empty' ? 'print("RESULT empty 0")\n' : fs.readFileSync(path.join(HERE, `lua/${name}.lua`), 'utf8');
  fs.writeFileSync(f, `BENCH_N = ${n}\n${common}\n${body}`);
  return f;
}

function timeOnce(cmd, argv) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 1 << 24 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/RESULT \S+ (\S+)/);
  return { ms, result: m ? m[1] : null, ok: r.status === 0, out };
}
function best(cmd, argv) {
  let b = null;
  for (let i = 0; i < REPS; i++) {
    const r = timeOnce(cmd, argv);
    if (!b || r.ms < b.ms) b = { ...r };
    if (!r.ok || !r.result) return r;
  }
  return b;
}

const rows = [];
for (const cfg of configs) {
  let make;
  if (cfg === 'js-v8') make = (name, n) => ['node', [path.join(HERE, 'js/bench.mjs'), name, String(n)]];
  else {
    const c = CONFIGS[cfg];
    if (c === undefined) { console.error(`unknown config ${cfg}`); continue; }
    make = (name, n) => c(name === 'empty' ? script('empty', 0) : script(name, n));
  }
  if (!make('empty', 0)) { console.error(`${cfg}: not available, skipped`); continue; }
  const base = cfg === 'js-v8' ? best('node', ['-e', '0']).ms : best(...make('empty', 0)).ms;
  for (const name of only) {
    const { n } = BENCH[name];
    const r = best(...make(name, n));
    if (cfg === REF) BENCH[name].ref = r.result;
    const right = r.result != null && r.result === BENCH[name].ref;
    rows.push({ cfg, name, ms: Math.max(0, r.ms - base), right, got: r.result, err: r.ok ? '' : r.out.slice(-300) });
    console.error(`${cfg.padEnd(14)} ${name.padEnd(13)} ${(r.ms - base).toFixed(0).padStart(7)} ms ${right ? '' : 'WRONG ' + r.result}`);
  }
}

// Table: rows = benchmarks, columns = configs, each cell also relative to puc-wasm.
const cfgs = [...new Set(rows.map((r) => r.cfg))];
const cell = (cfg, name) => rows.find((r) => r.cfg === cfg && r.name === name);
let md = `| benchmark | ${cfgs.join(' | ')} |\n| --- | ${cfgs.map(() => '---:').join(' | ')} |\n`;
for (const name of only) {
  const basis = cell('puc-wasm', name);
  md += `| ${name} | ${cfgs.map((c) => {
    const r = cell(c, name);
    if (!r) return '';
    if (!r.right) return 'WRONG';
    const x = basis && basis.right && r.ms > 0 ? ` (${(basis.ms / r.ms).toFixed(1)}x)` : '';
    return `${r.ms.toFixed(0)} ms${x}`;
  }).join(' | ')} |\n`;
}
console.log(md);
const wrong = rows.filter((r) => !r.right);
if (wrong.length) console.error(`WRONG checksums: ${wrong.map((r) => `${r.cfg}/${r.name}`).join(', ')}`);
const stamp = new Date().toISOString().slice(0, 16).replace(':', '');
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', `${stamp}.json`), JSON.stringify({ rows, configs: cfgs, reps: REPS }, null, 2));
fs.writeFileSync(path.join(HERE, 'results', `${stamp}.md`), md);
process.exit(wrong.length ? 2 : 0);
