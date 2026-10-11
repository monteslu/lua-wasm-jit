local function f(a, b) return a * b + 1.5 end
local s = 0
for i = 1, 5000 do s = s + f(i * 0.5, 2.0) end
print(s, wc.jit.status(f))
local st = wc.jit.stats()
print(st.compiled, st.specialized, st.specrejected, st.lasterr)
