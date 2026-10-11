local sqrt, abs, floor, sin, cos = math.sqrt, math.abs, math.floor, math.sin, math.cos
local function f(x) return sqrt(x) + abs(x - 3) + floor(x * 0.7) + sin(x) * cos(x) end
local function g(n) return abs(n) + floor(n) end
local out = {}
for i = 1, 3000 do out[#out+1] = f(i * 0.37) end
for i = -3000, 3000 do out[#out+1] = g(i) end
for _, v in ipairs({1/0, -1/0, 0/0, 2^63, -2^63, 1e300, -0.0, "4"}) do out[#out+1] = tostring(pcall(f, v)) .. tostring(select(2, pcall(f, v))) end
out[#out+1] = math.type(g(5)) .. math.type(floor(2.5)) .. math.type(f(2))
sqrt = function(x) return -1 end
for i = 1, 10 do out[#out+1] = f(i) end
local h = 0 for i = 1, #out do h = (h * 33 + #tostring(out[i])) % 2147483647 end
print("intr", #out, h, out[1], out[3001], out[#out - 10], out[#out])
