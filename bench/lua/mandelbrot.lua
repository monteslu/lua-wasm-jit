local n = bench_n(600)
local total = 0
for y = 0, n - 1 do
  local ci = 2.0 * y / n - 1.0
  for x = 0, n - 1 do
    local cr = 2.0 * x / n - 1.5
    local zr, zi, i = 0.0, 0.0, 0
    while i < 50 and zr * zr + zi * zi <= 4.0 do
      zr, zi = zr * zr - zi * zi + cr, 2.0 * zr * zi + ci
      i = i + 1
    end
    total = total + i
  end
end
bench_result("mandelbrot", total)
