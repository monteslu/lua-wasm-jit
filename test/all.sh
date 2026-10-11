#!/bin/bash
# test/all.sh [engine]: the differential suites. The official Lua tests at
# the default tier-up, with the specialized tier forced from the first event
# (--tierup 1) and through the asynchronous compile path, then the JIT
# regression scripts. Prints one summary line each.
cd "$(dirname "$0")/.."
E=${1:-build/engine.wasm}
node test/luatests/prepare.mjs >/dev/null
echo "lua tests        : $(node test/luatests/diff.mjs --engine $E | tail -1)"
echo "lua tests tier1  : $(node test/luatests/diff.mjs --engine $E --tierup 1 | tail -1)"
echo "lua tests async  : $(node test/luatests/diff.mjs --engine $E --mode async | tail -1)"
echo "jit regressions  : $(node test/jit/run.mjs --engine $E | tail -1)"
