local M = require("three.Matrix4")
local V = require("three.Vector3")
local m1, m2 = M.new(), M.new()
for i = 1, 3000 do m1:multiplyMatrices(m1, m2) end
local tot, totb = 0, 0
for _, f in ipairs({M.multiplyMatrices, M.invert, M.compose, V.applyMatrix4, V.add}) do
  local info = debug.getinfo(f, "S")
  local g = wc.jit.dump(f, false)
  local s = wc.jit.dump(f, true)
  print(info.linedefined, #g, #s, wc.jit.status(f))
end
