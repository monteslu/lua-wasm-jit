local function f1() return 1 < 2 end
print("f1", f1())
local function f2(x) return type(x) end
print("f2", f2(true))
local function f3() return type(true) == 'boolean' end
print("f3", f3())
local function f4(a, b) if a < b then return "lt" else return "ge" end end
print("f4", f4(1, 2), f4(2, 1), f4(1.5, 2), f4(3, 2.5))
local function f5(x) return x == 'boolean' end
print("f5", f5('boolean'), f5('x'))
local function f6(x) return not x end
print("f6", f6(nil), f6(1))
