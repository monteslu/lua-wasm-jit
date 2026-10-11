-- type-changing operands: specialized code must bail and stay correct
local function f(a, b, c)
  local x = a * b + c
  local y = x - a / b
  local z = -y
  if x < y then z = z + 1 end
  if a == b then z = z * 2 end
  if a >= 3 then z = z - 0.25 end
  local m = a % 7
  local d = a // 3
  return x, y, z, m, d
end
local mt = {__mul = function(p, q) return 42 end, __add = function(p, q) return 7 end,
            __sub = function() return 1 end, __div = function() return 2 end,
            __unm = function() return -9 end, __lt = function() return true end,
            __le = function() return false end, __mod = function() return 3 end,
            __idiv = function() return 4 end}
local obj = setmetatable({}, mt)
local out = {}
local function rec(...) local t = table.pack(...) for i = 1, t.n do out[#out+1] = tostring(t[i]) end end
for i = 1, 300 do rec(f(i * 0.5, 2.0, 1.25)) end          -- floats
for i = 1, 300 do rec(f(i, 3, 2)) end                      -- ints
for i = 1, 50 do rec(pcall(f, "3", 2, 1)) end              -- strings coerce
for i = 1, 50 do rec(pcall(f, obj, 2, 1)) end              -- metamethods
for i = 1, 50 do rec(pcall(f, 2^53 + 1, 3, 2)) end
for i = 1, 50 do rec(pcall(f, math.mininteger, -1, 0)) end
for i = 1, 300 do rec(f(i * 0.5, 2.0, 1.25)) end
for i = 1, 20 do rec(pcall(f, 0/0, 1, 1)) end
local function g(n) local s = 0 for i = 1, n do s = s + i % 5 * 1.5 - (i // 2) end return s end
for i = 1, 200 do rec(g(i)) end
local function h(t) local s = 0 for i = 1, #t do s = s + t[i] end return s end
for i = 1, 300 do rec(h({1, 2, 3.5, i})) end
for i = 1, 50 do rec(pcall(h, {1, "2", 3})) end
for i = 1, 50 do rec(pcall(h, {1, {}, 3})) end
local acc = 0
for i = 1, #out do acc = (acc * 31 + #out[i] + out[i]:byte(1)) % 1000000007 end
print("n", #out, "hash", acc, out[1], out[1000], out[#out])
