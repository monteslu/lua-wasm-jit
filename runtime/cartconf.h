/*
 * cartconf.h - route Lua's stdout/stderr hooks to the wasmcart host log.
 *
 * Force-included into every Lua translation unit (-include cartconf.h) so it
 * lands before lauxlib.h's `#if !defined(lua_writestring)` guards. These are
 * upstream's designated override points, so no Lua source is modified.
 *
 * A cart has no stdout. Left alone, lua_writestring/lua_writestringerror
 * expand to fwrite(stdout)/fprintf(stderr), which drag WASI imports into the
 * engine. Sending Lua's own output to wc_log is both the right destination
 * and what keeps the import list to the wasmcart `env` module.
 */
#ifndef LUA_WASM_JIT_CARTCONF_H
#define LUA_WASM_JIT_CARTCONF_H

#include <stddef.h>

#ifdef __wasm__
__attribute__((import_module("env"), import_name("wc_log")))
extern void wc_log(const char *ptr, unsigned int len);
#else
static inline void wc_log(const char *ptr, unsigned int len) { (void)ptr; (void)len; }
#endif

void wcl_write(const char *s, size_t len);
void wcl_writef(const char *fmt, const char *arg);

#define lua_writestring(s, l)       wcl_write((s), (size_t)(l))
#define lua_writeline()             wcl_write("\n", 1)
#define lua_writestringerror(s, p)  wcl_writef((s), (const char *)(p))

/*
 * Fixed string hash seed (another upstream `#if !defined` override point, in
 * lstate.c). Stock Lua seeds from time(NULL) and addresses, which varies the
 * order of pairs() between runs. A cart promises identical output from
 * identical input, and the differential tests compare the interpreter's
 * output with the JIT's line by line, so the seed is a constant.
 */
#define luai_makeseed(L)            ((unsigned int)0x9E3779B9u)

#endif
