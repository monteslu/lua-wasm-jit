# lua-wasm-jit benchmarks

The same seven programs in the stock engine, the JIT engine, native Lua, LuaJIT, Luau and V8.

```
node bench/run.mjs                       # every lane that is installed, 3 reps
node bench/run.mjs --only fib,nbody --configs puc-wasm,jit-wasm,js-v8 --reps 5
```

Each benchmark (`lua/*.lua`, written to run unchanged on Lua 5.1 and later so LuaJIT and Luau take the same
source; `js/bench.mjs` is the same algorithms for V8) runs as its own process. The start-up cost of each
runtime, measured on an empty script of the same shape, is subtracted; best of N is reported. Every run prints
a `RESULT` checksum that must equal the reference, native Lua's result at the same size (the stock engine's
when no native Lua is installed), or the cell is marked WRONG and the harness exits 2. Engines are copied
before timing so a rebuild mid-run cannot mix versions.

Lanes: `puc-native` (a Lua 5.4 binary, `PUC_LUA` or `lua5.4`/`lua` on PATH), `puc-wasm` (the stock engine
through `tools/luarun.mjs --nojit`), `jit-wasm` (the JIT engine), `luajit-interp` (`luajit -joff`), `luajit`
(`LUAJIT` or on PATH), `luau-native` and `luau-codegen` (`LUAU` or on PATH, `-O2` and `-O2 --codegen`), `js-v8`
(`node`). A lane whose binary is missing is skipped.

| benchmark | stresses |
| --- | --- |
| fib | recursive calls, small-int add |
| mandelbrot | tight float loop, no calls or allocation |
| nbody | float math on table fields, math.sqrt |
| spectralnorm | small hot function in a nested loop, array of doubles |
| binarytrees | allocation and GC of small tables |
| fannkuch | integer array shuffling, branches |
| vec3 | methods on small objects, matrix as a 16-element array |

The nbody, spectralnorm, binarytrees, fannkuch and mandelbrot algorithms are the classic Computer Language
Benchmarks Game problems; the code here was written for this harness, not copied from the Benchmarks Game
sources.

## Results

Baseline JIT, 2026-10-04, shared machine at load 4 to 5, 3 reps, best of 3. (x) is the speedup over the stock
engine (`puc-wasm`). LuaJIT 2.1 and Luau were built from source; native Lua is 5.4.7.

| benchmark | puc-native | puc-wasm | jit-wasm | luajit | js-v8 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fib | 348 ms (2.1x) | 723 ms (1.0x) | 348 ms (2.1x) | 44 ms (16.4x) | 51 ms (14.1x) |
| mandelbrot | 663 ms (3.2x) | 2133 ms (1.0x) | 187 ms (11.4x) | 95 ms (22.4x) | 76 ms (28.0x) |
| nbody | 2327 ms (2.3x) | 5254 ms (1.0x) | 1357 ms (3.9x) | 178 ms (29.5x) | 114 ms (46.2x) |
| spectralnorm | 1079 ms (2.2x) | 2332 ms (1.0x) | 615 ms (3.8x) | 47 ms (50.0x) | 51 ms (45.4x) |
| binarytrees | 2541 ms (1.6x) | 3957 ms (1.0x) | 3137 ms (1.3x) | 1969 ms (2.0x) | 253 ms (15.6x) |
| fannkuch | 954 ms (2.2x) | 2084 ms (1.0x) | 806 ms (2.6x) | 253 ms (8.2x) | 158 ms (13.2x) |
| vec3 | 1518 ms (2.5x) | 3749 ms (1.0x) | 1289 ms (2.9x) | 61 ms (61.4x) | 94 ms (40.0x) |

The JIT engine, running in wasm, is faster than native PUC Lua on six of the seven; binarytrees is
allocation-bound and the baseline does not touch allocation. LuaJIT's trace compiler remains 5 to 20x ahead on
numeric loops, which is what the phase 2 design in `docs/DESIGN.md` is about.

Earlier runs of the same harness, including the LuaJIT interpreter and the two Luau lanes, are in `results/`.
