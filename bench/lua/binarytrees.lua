local function bottomUp(d) if d == 0 then return {} end d = d - 1; return { bottomUp(d), bottomUp(d) } end
local function check(t) if t[1] then return 1 + check(t[1]) + check(t[2]) end return 1 end
local N = bench_n(15)
local total = 0
local long = bottomUp(N)
for d = 4, N, 2 do
  local iters = 2 ^ (N - d + 4)
  local c = 0
  for _ = 1, iters do c = c + check(bottomUp(d)) end
  total = total + c
end
total = total + check(long)
bench_result("binarytrees", total)
