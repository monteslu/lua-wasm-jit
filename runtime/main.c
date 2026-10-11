/*
 * main.c - a minimal headless wasmcart cart around Lua 5.4.
 *
 * Boot (wc_init): run the asset "prelude.lua" if the cart has one, then the
 * asset "main.lua". Each frame (wc_render): call the global function
 * __wasmcart_frame if the script defined one. Errors go to the host log as
 * "lua error: <traceback>".
 *
 * The global table `wc` has log(s), asset_read(name) -> string | nil and, in
 * the JIT build, jit (the JIT's controls: threshold, stats, status, compile).
 * print and Lua's own stdout/stderr hooks write to the host log (cartconf.h).
 *
 * Libraries: base, coroutine, table, string, math, utf8, debug. No io, os or
 * package: a cart has no files, no clock and no dynamic loading. The VM test
 * prelude (test/luatests/prelude.lua) provides the io and os the official
 * tests touch.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
#include "wasmcart.h"

#ifdef LJIT
#include "ljit.h"
#endif

#define FB_W 16
#define FB_H 16

static uint32_t fb[FB_W * FB_H];
static wc_time_t wc_time_buf;
static wc_info_t info;
static lua_State *L;
static unsigned int seed;

static void log_str(const char *s, size_t len)
{
    wc_log(s, (unsigned)len);
}

static void log_cstr(const char *s)
{
    log_str(s, strlen(s));
}

/* ------------------------------------------------ Lua's stdout and stderr */

/* cartconf.h routes lua_writestring / lua_writestringerror here: one host
   log line per newline */
static char linebuf[4096];
static size_t linelen;

void wcl_write(const char *s, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        if (s[i] == '\n') {
            log_str(linebuf, linelen);
            linelen = 0;
        } else if (linelen < sizeof linebuf - 1) {
            linebuf[linelen++] = s[i];
        }
    }
}

void wcl_writef(const char *fmt, const char *arg)
{
    char buf[1024];
    snprintf(buf, sizeof buf, fmt, arg);
    wcl_write(buf, strlen(buf));
}

/* ---------------------------------------------------------------- assets */

static char *read_asset(const char *name, size_t *plen)
{
    int n = wc_asset_size(name, (unsigned)strlen(name));
    if (n < 0)
        return NULL;
    char *buf = malloc((size_t)n + 1);
    if (!buf)
        return NULL;
    int got = wc_load_asset(name, (unsigned)strlen(name), buf, (unsigned)n);
    if (got < 0) {
        free(buf);
        return NULL;
    }
    buf[got] = '\0';
    if (plen)
        *plen = (size_t)got;
    return buf;
}

/* ------------------------------------------------------------- wc table */

static int l_log(lua_State *S)
{
    size_t n;
    const char *s = luaL_checklstring(S, 1, &n);
    log_str(s, n);
    return 0;
}

static int l_asset_read(lua_State *S)
{
    const char *name = luaL_checkstring(S, 1);
    size_t len;
    char *buf = read_asset(name, &len);
    if (!buf) {
        lua_pushnil(S);
        return 1;
    }
    lua_pushlstring(S, buf, len);
    free(buf);
    return 1;
}

/* ------------------------------------------------------------ running */

/* message handler: strings get a traceback, other error values (the VM
   tests' os.exit marker is a table) pass through untouched */
static int msgh(lua_State *S)
{
    const char *m = lua_tostring(S, 1);
    if (!m) {
        if (lua_type(S, 1) == LUA_TTABLE)
            return 1;
        if (luaL_callmeta(S, 1, "__tostring") && lua_type(S, -1) == LUA_TSTRING)
            return 1;
        m = lua_pushfstring(S, "(error object is a %s value)", luaL_typename(S, 1));
    }
    luaL_traceback(S, S, m, 1);
    return 1;
}

static void log_error(const char *prefix)
{
    const char *e = lua_tostring(L, -1);
    if (!e)
        e = "(error object is not a string)";
    size_t n = strlen(prefix) + strlen(e) + 4;
    char *line = malloc(n);
    if (line) {
        snprintf(line, n, "%s: %s", prefix, e);
        log_cstr(line);
        free(line);
    }
}

/* runs the named asset as a chunk; 0 on success, -1 when absent, 1 on error */
static int run_source(const char *name)
{
    size_t len;
    char *src = read_asset(name, &len);
    if (!src)
        return -1;
    lua_pushcfunction(L, msgh);
    int base = lua_gettop(L);
    char chunk[128];
    snprintf(chunk, sizeof chunk, "@%s", name);
    int st = luaL_loadbuffer(L, src, len, chunk);
    free(src);
    if (st == LUA_OK)
        st = lua_pcall(L, 0, 0, base);
    if (st != LUA_OK)
        log_error("lua error");
    lua_settop(L, base - 1);
    return st == LUA_OK ? 0 : 1;
}

/* ----------------------------------------------------------- wasmcart ABI */

__attribute__((export_name("wc_get_info")))
wc_info_t *wc_get_info(void)
{
    info.version = WC_ABI_VERSION;
    info.width = FB_W;
    info.height = FB_H;
    info.fb_ptr = (uint32_t)(uintptr_t)fb;
    info.time_ptr = (uint32_t)(uintptr_t)&wc_time_buf;
    return &info;
}

__attribute__((export_name("wc_set_seed")))
void wc_set_seed(unsigned int s)
{
    seed = s;
}

__attribute__((export_name("wc_init")))
void wc_init(void)
{
    static const luaL_Reg libs[] = {
        {LUA_GNAME, luaopen_base},
        {LUA_COLIBNAME, luaopen_coroutine},
        {LUA_TABLIBNAME, luaopen_table},
        {LUA_STRLIBNAME, luaopen_string},
        {LUA_MATHLIBNAME, luaopen_math},
        {LUA_UTF8LIBNAME, luaopen_utf8},
        {LUA_DBLIBNAME, luaopen_debug},
        {NULL, NULL}
    };
    L = luaL_newstate();
    if (!L) {
        log_cstr("lua error: cannot create state");
        return;
    }
    for (const luaL_Reg *lib = libs; lib->func; lib++) {
        luaL_requiref(L, lib->name, lib->func, 1);
        lua_pop(L, 1);
    }
    lua_newtable(L);
    lua_pushcfunction(L, l_log);
    lua_setfield(L, -2, "log");
    lua_pushcfunction(L, l_asset_read);
    lua_setfield(L, -2, "asset_read");
    lua_pushinteger(L, (lua_Integer)seed);
    lua_setfield(L, -2, "seed");
#ifdef LJIT
    luaopen_wcljit(L);
    lua_setfield(L, -2, "jit");
#endif
    lua_setglobal(L, "wc");

    if (wc_asset_size("prelude.lua", 11) > 0 && run_source("prelude.lua") != 0)
        return;
    if (run_source("main.lua") < 0)
        log_cstr("lua error: no main.lua asset");
}

__attribute__((export_name("wc_render")))
void wc_render(void)
{
    if (!L)
        return;
#ifdef LJIT
    luaJ_checkrestore(L);
#endif
    lua_pushcfunction(L, msgh);
    int base = lua_gettop(L);
    if (lua_getglobal(L, "__wasmcart_frame") == LUA_TFUNCTION) {
        if (lua_pcall(L, 0, 0, base) != LUA_OK) {
            log_error("lua frame error");
            lua_pushnil(L);
            lua_setglobal(L, "__wasmcart_frame");
        }
    }
    lua_settop(L, base - 1);
}
