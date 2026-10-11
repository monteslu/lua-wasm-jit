-- Shaped like three.lua's hot code: small objects with named number fields,
-- methods through a metatable, a matrix as a table of 16 numbers.
local V = {}; V.__index = V
local function vec(x, y, z) return setmetatable({ x = x, y = y, z = z }, V) end
function V:add(b) self.x = self.x + b.x; self.y = self.y + b.y; self.z = self.z + b.z; return self end
function V:applyMatrix4(m)
  local e = m.elements
  local x, y, z = self.x, self.y, self.z
  local w = 1 / (e[4] * x + e[8] * y + e[12] * z + e[16])
  self.x = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
  self.y = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
  self.z = (e[3] * x + e[7] * y + e[11] * z + e[15]) * w
  return self
end
function V:length() return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z) end
local m = { elements = { 0.9, 0.1, 0, 0, -0.1, 0.9, 0, 0, 0, 0, 1, 0, 0.5, 0.25, 0, 1 } }
local n = bench_n(2000000)
local p, d, acc = vec(1, 2, 3), vec(0.001, 0.002, 0.003), 0
for i = 1, n do
  p:add(d):applyMatrix4(m)
  acc = acc + p:length()
end
bench_result("vec3", acc)
