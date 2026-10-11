-- per-frame workload: compiled code arrives asynchronously between frames
local V = {}; V.__index = V
local function vec(x, y, z) return setmetatable({x = x, y = y, z = z}, V) end
function V:add(o) self.x = self.x + o.x; self.y = self.y + o.y; self.z = self.z + o.z; return self end
function V:len() return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z) end
local p, d, acc, frame = vec(1, 2, 3), vec(0.01, -0.02, 0.005), 0, 0
local seen = {}
function __wasmcart_frame()
  frame = frame + 1
  for i = 1, 2000 do acc = acc + p:add(d):len() % 7 + (i // 3) end
  local s = wc.jit.stats()
  seen[s.compiled > 0 and "compiled" or "cold"] = true
  if frame == 120 then
    print(string.format("async acc=%.17g frames=%d", acc, frame))
    print("states", seen.cold and "cold" or "-", seen.compiled and "compiled" or "-", wc.jit.status(V.add))
  end
end
