-- Shared by every benchmark: the size comes from the command line (native
-- Lua / LuaJIT: arg[1]) or from BENCH_N set before the script runs (inside
-- the cart engine, where there is no arg).
function bench_n(default)
  local a = (arg and arg[1]) or BENCH_N
  return tonumber(a) or default
end
function bench_result(name, value)
  print(string.format("RESULT %s %.10g", name, value))
end
