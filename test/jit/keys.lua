local out = {}
local keys = {}
for i = 1, 40 do keys[i] = {} end
local strs = {}
for i = 1, 40 do strs[i] = "k" .. i end
local function fill(t, n) for i = 1, n do t[keys[i]] = i; t[strs[i]] = -i; t[i] = i * 2; t[i + 0.5] = i end return t end
local function sum(t, n) local s = 0 for i = 1, n do s = s + (t[keys[i]] or 0) + (t[strs[i]] or 0) + (t[i] or 0) + (t[i + 0.5] or 0) end return s end
for r = 1, 200 do
  local t = fill({}, (r % 40) + 1)
  out[#out+1] = sum(t, 40)
  t[keys[3]] = nil; t[strs[5]] = nil
  out[#out+1] = sum(t, 40)
end
local log = {}
local proxy = setmetatable({}, {__index = function(t, k) log[#log+1] = type(k) return 7 end,
                                 __newindex = function(t, k, v) rawset(t, k, v * 10) end})
for r = 1, 300 do
  out[#out+1] = sum(proxy, 3)
  proxy[keys[r % 40 + 1]] = r
  proxy[strs[r % 40 + 1]] = r
end
out[#out+1] = #log
local weak = setmetatable({}, {__mode = "k"})
for r = 1, 300 do weak[keys[r % 40 + 1]] = r; out[#out+1] = weak[keys[(r * 7) % 40 + 1]] or -1 end
local h = 0 for i = 1, #out do h = (h * 31 + math.floor(out[i] * 2)) % 1000000007 end
print("keys", #out, h, out[1], out[#out])
