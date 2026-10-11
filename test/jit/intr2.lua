local sqrt = math.sqrt
local function len(x, y) return sqrt(x * x + y * y) end
local function fl(x) return math.floor(x) end
local out = {}
for i = 1, 3000 do out[#out+1] = len(i * 0.5, 3) end
for i = 1, 3000 do out[#out+1] = fl(i * 0.37) end
local function wrap() return len(3, 4), fl(-2.5), select('#', fl(1.5)) end
for i = 1, 100 do out[#out+1] = table.concat({wrap()}, ",") end
out[#out+1] = tostring(fl(2^70)) .. tostring(fl(0/0))
sqrt = function(x) return "lua" end
for i = 1, 5 do out[#out+1] = len(1, 1) end
print("intr2", #out, out[1], out[3001], out[6050], out[#out - 5], out[#out])
