local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end
print("fib(20)=", fib(20))
local s = 0
for i = 1, 100 do s = s + i * 2.5 end
print("sum", s)
local t = {}
for i = 1, 10 do t[i] = i * i end
local acc = 0
for i, v in ipairs(t) do acc = acc + v end
print("acc", acc, #t)
local o = {x = 1, y = 2}
o.z = o.x + o.y
print("o.z", o.z, wc.jit.status(fib))
