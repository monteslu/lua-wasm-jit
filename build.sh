#!/bin/bash
#
# build.sh - build the lua-wasm-jit engine carts.
#
#   build/engine.wasm        Lua 5.4.7 + the runtime JIT (core hooks from
#                            runtime/jit/lua-5.4.7-jit.patch, compiler in
#                            runtime/jit/ljit.c)
#   build/engine-stock.wasm  pristine Lua, no hooks (the differential
#                            baseline, and what the hooks cost)
#
# Usage: ./build.sh [all|jit|stock]   (default all)
# Env:   EMSDK (default ../emsdk), WASMCART_REPO (default node_modules/wasmcart
#        from `npm install`, else ../wasmcart; only include/wasmcart.h is used),
#        LUAJ_CONTROL=1|2 builds a deliberately miscompiling JIT (integer ADD
#        off by one in the generic tier (1) or the specialized tier (2), the
#        must-fail control) to build/engine-control.wasm, LJ_OUT overrides the
#        JIT output path, LJ_PROF=1 keeps function names for host profilers,
#        LJ_OPT overrides -O2.
#
# The vendored Lua (vendor/lua) stays pristine: the JIT build copies it to
# build/src-jit and applies the patch there. To change the hooks, edit
# build/src-jit/src and run tools/mkpatch.mjs.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

EMSDK="${EMSDK:-$HERE/../emsdk}"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1 || true
command -v emcc >/dev/null || { echo "emcc not found (set EMSDK)"; exit 1; }

if [ -z "$WASMCART_REPO" ]; then
  if [ -f "$HERE/node_modules/wasmcart/include/wasmcart.h" ]; then WASMCART_REPO="$HERE/node_modules/wasmcart"
  else WASMCART_REPO="$HERE/../wasmcart"; fi
fi
WASMCART_INC="$WASMCART_REPO/include"
[ -f "$WASMCART_INC/wasmcart.h" ] || { echo "wasmcart.h not found under $WASMCART_INC (set WASMCART_REPO)"; exit 1; }

LUA="$HERE/vendor/lua"
WHAT="${1:-all}"
OPT="${LJ_OPT:--O2}"

# core + the libraries a cart can have. No liolib, loslib, loadlib, linit:
# a cart has no filesystem, no clock and no dynamic loading.
CORE="lapi lcode lctype ldebug ldo ldump lfunc lgc llex lmem lobject lopcodes \
      lparser lstate lstring ltable ltm lundump lvm lzio lauxlib lbaselib \
      lcorolib ldblib lmathlib lstrlib ltablib lutf8lib"

CFLAGS="$OPT -sSUPPORT_LONGJMP=wasm -ffile-prefix-map=$HERE=. \
  -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable"
LINK_FLAGS="$OPT ${LJ_PROF:+--profiling-funcs} -sSTANDALONE_WASM=1 --no-entry \
  -sSUPPORT_LONGJMP=wasm -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 \
  -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=4194304 -sALLOW_TABLE_GROWTH=1 \
  -sERROR_ON_UNDEFINED_SYMBOLS=0"

mkdir -p build obj/stock obj/jit

compile_core() { # $1 = source dir, $2 = objdir, $3 = extra flags
  for f in $CORE; do
    emcc $CFLAGS $3 -include "$HERE/runtime/cartconf.h" -I "$1" -c "$1/$f.c" -o "$2/$f.o"
  done
}

build_stock() {
  echo "=== stock engine ==="
  compile_core "$LUA/src" obj/stock ""
  emcc $CFLAGS -I "$LUA/src" -I "$WASMCART_INC" -c runtime/main.c -o obj/stock/main.o
  emcc $LINK_FLAGS obj/stock/*.o -o build/engine-stock.wasm
  echo "  build/engine-stock.wasm $(wc -c < build/engine-stock.wasm) bytes"
}

build_jit() {
  local out="${LJ_OUT:-build/engine.wasm}"
  local extra="-DLJIT -I $HERE/runtime/jit"
  if [ -n "$LUAJ_CONTROL" ]; then
    extra="$extra -DLUAJ_CONTROL_MISCOMPILE=$LUAJ_CONTROL"
    out="${LJ_OUT:-build/engine-control.wasm}"
  fi
  echo "=== JIT engine -> $out ==="
  local SRC=build/src-jit
  rm -rf "$SRC"; mkdir -p "$SRC"
  cp -r "$LUA/src" "$SRC/src"
  ( cd "$SRC" && patch -p1 --quiet --forward < "$HERE/runtime/jit/lua-5.4.7-jit.patch" )
  rm -f obj/jit/*.o
  compile_core "$HERE/$SRC/src" obj/jit "$extra"
  emcc $CFLAGS $extra -I "$HERE/$SRC/src" -c runtime/jit/ljit.c -o obj/jit/ljit.o
  emcc $CFLAGS $extra -I "$HERE/$SRC/src" -I "$WASMCART_INC" -c runtime/main.c -o obj/jit/main.o
  emcc $LINK_FLAGS obj/jit/*.o -o "$out"
  echo "  $out $(wc -c < "$out") bytes"
}

case "$WHAT" in
  stock) build_stock ;;
  jit) build_jit ;;
  all) build_stock; build_jit ;;
  *) echo "usage: $0 [all|jit|stock]"; exit 2 ;;
esac
