-- Minimal prelude for VM-level tests: no LOVE layer, so math.random and the
-- rest of the standard library stay exactly as Lua ships them.
local wc = wc
local concat, tostring, select = table.concat, tostring, select
local outbuf = {}
local function flushline(s) wc.log(s) end
-- print must be a C function (calls.lua and closure.lua check that
-- string.dump and debug.upvaluejoin refuse it): coroutine.wrap gives one.
print = coroutine.wrap(function(...)
  local args = table.pack(...)
  while true do
    local t = {}
    for i = 1, args.n do t[i] = tostring(args[i]) end
    flushline(concat(t, "\t"))
    args = table.pack(coroutine.yield())
  end
end)
local pending = ""
local function iowrite(...)
  for i = 1, select('#', ...) do
    local v = (select(i, ...))
    local tv = type(v)
    if tv ~= "string" and tv ~= "number" then
      error("bad argument #" .. i .. " to 'io.write' (string expected, got " .. tv .. ")", 2)
    end
    pending = pending .. tostring(v)
  end
  while true do
    local nl = pending:find("\n", 1, true)
    if not nl then break end
    flushline(pending:sub(1, nl - 1))
    pending = pending:sub(nl + 1)
  end
  return io
end
io = { write = iowrite, stdout = { write = function(self, ...) iowrite(...) return self end },
       stderr = { write = function(self, ...) iowrite(...) return self end },
       read = function() return nil end }
-- read-only files from the cart's assets
function io.open(name, mode)
  if mode and mode:find("[wa+]") then return nil, name .. ": read-only" end
  local data = wc.asset_read(name)
  if not data then return nil, name .. ": No such file or directory" end
  local pos = 1
  local f = {}
  function f:read(fmt)
    fmt = fmt or "l"
    if type(fmt) == "string" then fmt = fmt:gsub("^%*", "") end
    if pos > #data and fmt ~= "a" then return nil end
    if fmt == "a" then local r = data:sub(pos); pos = #data + 1; return r end
    if fmt == "l" or fmt == "L" then
      local nl = data:find("\n", pos, true)
      local line
      if nl then line = data:sub(pos, fmt == "L" and nl or nl - 1); pos = nl + 1
      else line = data:sub(pos); pos = #data + 1 end
      return line
    end
    if type(fmt) == "number" then local r = data:sub(pos, pos + fmt - 1); pos = pos + fmt; return r end
    error("unsupported read format " .. tostring(fmt))
  end
  function f:lines(fmt) return function() return self:read(fmt) end end
  function f:close() return true end
  return f
end
os = { clock = function() return 0 end, time = function() return 0 end,
       getenv = function() return nil end, exit = function(code) error({ __luarun_exit = code == nil and true or code }, 0) end,
       date = function() return "" end }
package = { loaded = { string = string, table = table, math = math, coroutine = coroutine,
                       utf8 = utf8, debug = debug, os = os, io = io, _G = _G }, path = "?.lua;?/init.lua" }
package.loaded.package = package
function require(name)
  local m = package.loaded[name]
  if m then return m end
  local fname = name:gsub("%.", "/")
  local src, path
  for tmpl in package.path:gmatch("[^;]+") do
    path = tmpl:gsub("%?", fname)
    src = wc.asset_read(path)
    if src then break end
  end
  if not src then error("module '" .. name .. "' not found", 2) end
  m = assert(load(src, "@" .. path))(name, path)
  if m == nil then m = true end
  package.loaded[name] = m
  return m
end
