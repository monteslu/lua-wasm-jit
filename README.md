# lua-wasm-jit

A runtime JIT for Lua 5.4 running inside a [wasmcart](https://github.com/monteslu/wasmcart) cart. Hot Lua
functions are translated, inside the cart, from Lua 5.4 bytecode into small WebAssembly modules; the host
turns those bytes into machine code and hands back a table slot the interpreter calls through. Lua itself is
PUC Lua 5.4.7, unmodified except for a 200-line patch of hooks.

It is the JIT behind [wasmcart-lua](https://github.com/wasmcart/wasmcart-lua), which takes it as a
dependency, and the sibling of [quickjs-wasm-jit](https://github.com/monteslu/quickjs-wasm-jit), which does
the same for QuickJS through the same host protocol. It is not LuaJIT and cannot be: LuaJIT emits native
machine code into executable memory, which a wasm module does not have, and its interpreter is per-CPU
assembly with no wasm target.

## Results

Seven benchmarks, best of 3, 2026-10-04, shared machine (`bench/README.md` has the full table and the
method). Speedups are over the same Lua in the same cart without the JIT:

| benchmark | stock engine | JIT engine | speedup | native Lua 5.4.7 |
| --- | ---: | ---: | ---: | ---: |
| fib | 723 ms | 348 ms | 2.1x | 348 ms |
| mandelbrot | 2133 ms | 187 ms | 11.4x | 663 ms |
| nbody | 5254 ms | 1357 ms | 3.9x | 2327 ms |
| spectralnorm | 2332 ms | 615 ms | 3.8x | 1079 ms |
| binarytrees | 3957 ms | 3137 ms | 1.3x | 2541 ms |
| fannkuch | 2084 ms | 806 ms | 2.6x | 954 ms |
| vec3 | 3749 ms | 1289 ms | 2.9x | 1518 ms |

The JIT engine, running in wasm, is faster than native PUC Lua on six of the seven. In
[three.lua](https://github.com/monteslu/three.lua) carts, frames ran 22 to 58 percent faster. LuaJIT's trace
compiler is still 5 to 20x ahead on numeric loops; `docs/DESIGN.md` has the plan for closing that gap.

Correctness is measured differentially: the same engine with the host refusing to link (pure interpreter)
against the JIT at threshold 0 (every function compiled on first use).

| suite | result |
| --- | --- |
| official Lua 5.4.7 tests, 13 files (math, strings, nextvar, calls, closure, goto, locals, constructs, events, vararg, sort, errors, coroutine) | identical output, at the default tier-up, with the specialized tier forced, and through the asynchronous compile path |
| `test/jit` regression scripts (type changes, metamethods, NaN, mininteger, intrinsics, deep recursion, generic keys, async compiles) | identical output at tier-up 1, 4 and 64 |
| wasmcart-lua's own suite (59 checks with render hashes and determinism goldens) and three.lua's 16 test files | identical with the JIT forced |

Two deliberately miscompiling builds (`LUAJ_CONTROL=1`, `LUAJ_CONTROL=2`) are kept as must-fail controls;
both are caught by the suites.

## How it works

Wasm cannot execute bytes in linear memory, so a JIT inside a wasm module cannot finish the job alone. The
work is split in two:

1. **Generate, in the cart.** The compiler (`runtime/jit/ljit.c`) walks a hot function's bytecode and writes
   a complete binary wasm module into the cart's own memory. One wasm function per `Proto`,
   `f(L, ci, pc) -> NOENTRY | BAIL | CALL | RETURN`, entered at the function start, at any loop header
   (on-stack replacement from the interpreter's back-edge counter) or after a call returns.
2. **Load, in the host.** The cart calls `wc_jit_link(bytes, len, &result)`. The host validates the module,
   refuses any import not from the module name `cart`, instantiates it against the cart's exports (memory,
   function table, the engine's `luaJ_h_*` helpers), grows the table and returns the slot. Generated code
   works on the interpreter's own state in linear memory (the Lua stack, the `CallInfo`, the constants), so
   the interpreter can take over at any instruction boundary.

Inside the generated code:

- Every Lua 5.4 opcode compiles. Inline: moves and loads, upvalues, array-part integer keys, hash-part
  walks for constant short-string keys (including the metatable's `__index` table on a miss, which is method
  lookup), integer and float arithmetic, bitwise operations, comparisons, numeric `for` loops, returns, and
  Lua calls (the callee's frame set up inline when it is compiled with matching arity, then a direct
  `call_indirect`). Everything else calls an exported helper that does what `lvm.c` does with the same
  functions: metamethods, C calls, concatenation, closures, varargs, to-be-closed variables.
- Two tiers. The generic tier records which types each operand was seen with. After 1024 entries and
  back-edges the function is recompiled: operands seen only as integers or only as floats are guarded once
  per basic block and kept unboxed in wasm locals, arithmetic and comparisons run on the locals, and
  `math.sqrt`, `abs`, `floor`, `sin` and `cos` are intrinsics. A failed guard stores the cached values and
  hands the rest of the activation to the interpreter; after 64 bails the function may respecialize up to
  three times, then stays generic.
- Compiled frames on the wasm stack are bounded at 64 across all C levels; beyond that the interpreter runs
  the call. Compiled code is never entered while a debug hook is set.
- The engine forgets every slot after a save-state restore (`wc_jit_config` key 7), since restored memory
  carries slot numbers from another host.

Asynchronous compilation, the browser path, returns pending to the cart and installs the slot between
frames; the interpreter keeps running meanwhile.

## Requirements

- Node 22 or later.
- [emsdk](https://github.com/emscripten-core/emsdk) 4.x, found at `../emsdk` or `EMSDK=/path`.
- `npm install`, which brings in the wasmcart package: its `createJitImports` is the host side of the JIT
  protocol that the runner uses, and its `include/wasmcart.h` is the ABI header the engine is built against.
- For the native benchmark lanes, optional: a Lua 5.4 binary, LuaJIT, Luau.

## Build and run

```
npm install
./build.sh                 # build/engine.wasm (JIT) and build/engine-stock.wasm (pristine Lua)
./build.sh jit             # only the JIT engine

node tools/luarun.mjs script.lua                    # run a script with the JIT engine
node tools/luarun.mjs --engine build/engine-stock.wasm script.lua
node tools/luarun.mjs --nojit script.lua            # JIT engine, host refuses to link (interpreter)
node tools/luarun.mjs --jit 0 script.lua            # compile every function on first use
node tools/luarun.mjs --tierup 1 script.lua         # specialized tier from the first event
node tools/luarun.mjs --async --frames 120 script.lua   # asynchronous compiles, 120 frames
```

The engine is a headless cart: `runtime/main.c` runs the asset `main.lua` at boot and calls the global
`__wasmcart_frame` every frame if the script defines one. Scripts get the base, coroutine, table, string,
math, utf8 and debug libraries, `print` through the host log, and a `wc` table with `log`, `asset_read` and
`jit` (`threshold`, `stats`, `status(fn)`, `compile(fn)`). The runner wraps the script so `dofile` and
`loadfile` read the files given on the command line, prints the program's output, then `LUARUN OK` or
`LUARUN FAIL: <error>`, then one line of JIT statistics. `--nojit` makes the host print wasmcart's notice
that runtime code generation is off; that is the loud off switch working as intended.

Build options: `LUAJ_CONTROL=1` or `2` builds a deliberately wrong JIT for must-fail checks (integer add off
by one in the generic or the specialized tier), `LJ_PROF=1` keeps function names for host profilers. The
vendored Lua stays pristine: the build copies it to `build/src-jit/` and applies
`runtime/jit/lua-5.4.7-jit.patch` there. To change the hooks, edit `build/src-jit/src` and run
`node tools/mkpatch.mjs`.

## Tests

```
test/all.sh                                  # every suite
node test/luatests/prepare.mjs               # once: the official tests into test/luatests/suite/
node test/luatests/diff.mjs                  # official Lua tests, interpreter vs JIT
node test/luatests/diff.mjs --tierup 1       # with the specialized tier forced
node test/luatests/diff.mjs --mode async     # through the asynchronous compile path
node test/jit/run.mjs                        # regression scripts, three tier-up intervals, async frames
```

The official tests run under a small prelude (`test/luatests/prelude.lua`) that supplies the `io` and `os`
pieces they touch, since a cart has neither; `prepare.mjs` rewrites the nine lines that need `io.stdin`.

## Benchmarks

```
node bench/run.mjs                           # every installed lane, 3 reps
node bench/run.mjs --only fib,nbody --configs puc-wasm,jit-wasm,js-v8
```

Every run must reproduce the reference checksum or the cell is marked WRONG and the harness exits 2.
`bench/README.md` describes the lanes and the method.

## Layout

- `vendor/lua/`: Lua 5.4.7, unmodified. `vendor/lua-tests/`: its official test suite (`vendor/VENDOR`).
- `runtime/jit/`: the JIT. `lua-5.4.7-jit.patch` (hooks in lobject.h, lstate.h, lstate.c, lfunc.c, ldo.c and
  lvm.c), `ljit.c` (compiler, helpers and the `wc.jit` library), `ljit.h`.
- `runtime/main.c`, `runtime/cartconf.h`: the headless cart and the build configuration that routes Lua's
  output to the host log.
- `tools/`: `luarun.mjs` (runner), `mkpatch.mjs` (regenerate the patch).
- `test/`, `bench/`: as above. `docs/DESIGN.md`: design, decisions, open problems and the phase 2 plan.

## Using the JIT in a cart

Build Lua 5.4.7 with `runtime/jit/lua-5.4.7-jit.patch` applied, compile `runtime/jit/ljit.c` into the VM with
`runtime/jit` on the include path, link with `-sALLOW_TABLE_GROWTH=1`, and after creating the state call
`luaopen_wcljit` to expose the controls and `luaJ_checkrestore` once per frame (`runtime/jit/ljit.h`).
wasmcart-lua's `runtime/build.sh` is the reference. The host needs wasmcart 0.32 or later; its
`createJitImports` is what every wasmcart host already uses to serve `wc_jit_link`. A cart that asks for the
JIT on a host that has it switched off (`WASMCART_JIT=0`) runs on the interpreter and the host says so once.

## License

MIT, see `LICENSE`. Lua and its test suite are Copyright (C) 1994-2024 Lua.org, PUC-Rio, MIT License.
