# lua-wasm-jit: design notes

The engine design and the decisions behind it, written while the baseline JIT was built (October 2026),
followed by the open problems and the design for the next phase, a trace compiler. The import protocol
itself (`wc_jit_link`, `wc_jit_unlink`, `wc_jit_config`) is specified in wasmcart's SPEC.md, section
"Runtime code generation".

## Engine design

- Hotness: calls (counted at function entry) + loop back-edges (FORLOOP, TFORLOOP, backward JMP), threshold 500.
- Tier 1 (generic): one wasm function per Proto, `f(L, ci, pc, depth) -> NOENTRY|BAIL|CALL|RETURN`.
  Body `loop { block_N .. block_0 { br_table pc } code_0 .. code_N }`: forward jumps are `br`, backward jumps
  go through the br_table; any leader (jump targets, after CALL) is an entry point (call resume, OSR).
  Everything lives in linear memory (Lua stack, CallInfo, constants by absolute address); base reloaded after
  every helper. Every 5.4 opcode compiles. Inline: moves/loads, upvalues, array-part int keys, hash-part walks
  for constant short-string keys (GETFIELD/GETTABUP/SELF/SETFIELD/SETTABUP, plus the metatable's __index table
  on a miss: method lookup) and for register keys that are short strings or tables (GETTABLE/SETTABLE),
  int/float arithmetic, bitwise ints, comparisons, FORLOOP, RETURN0/1, Lua calls (precall inline when the
  callee is compiled with matching arity, then call_indirect). Everything else: exported helpers that do
  what lvm.c does with the same functions (metamethods, C calls, concat, len, closures, varargs, tbc).
  Generic code also records operand tag masks (type feedback) and counts entries/back-edges.
- Tier 2 (specialized, same compiler, recompiled after 1024 entries/back-edges): operands seen only as
  integers or only as floats are guarded once per basic block and kept unboxed in wasm locals; arithmetic,
  comparisons and math.sqrt/abs/floor/sin/cos (incl. tail calls) run on the locals; values are stored back
  lazily (before generic instructions/helpers, at block ends, on bails; at most 6 pending). A failed guard
  stores the cache and hands the rest of the activation to the interpreter, recording the types it saw;
  after 64 bails the generic code runs again and may respecialize (3 times), then stays generic.
- Calls: compiled-to-compiled calls are direct (call_indirect); `luaJ_depth` bounds compiled frames on the
  wasm stack across all C levels at 64 (restored by luaD_rawrunprotected after errors/yields); beyond it the
  interpreter runs the call. Other Lua calls return CALL to luaV_execute (no C recursion), which re-enters
  the caller at the instruction after the call.
- Hooks: compiled code is never entered while hookmask != 0; after calls and returns it checks and bails.
  Errors (wasm EH longjmp) and yields unwind compiled frames safely because memory is current at every helper.
- Lua API: `wc.jit.threshold(n)`, `stats()`, `status(f)`, `compile(f)`, `dump(f [, spec])`, `spec(bool)`,
  `enabled()`. Generated modules carry a name section (`lua:<src>:<line>`, `lua+` = specialized).

## Decisions (and why)

- Compiler in the engine (C), host only compiles+links: any host with the import gets the JIT, no JS compiler.
- Helpers imported by export name (module `cart`): direct calls, no call_indirect, and the host stays generic.
- One module per function (Node compile ~0.2 ms/module). Batching is a phase-2 item.
- Async completion through a memory cell rather than a poll import.
- Bail = hand the activation to the interpreter (no deopt to an "every pc is a leader" version): simple and
  exact; re-entry happens at leaders, the next call, or a back-edge.
- Type specialization by feedback + guards with bail, not by static inference: Lua 5.4's int/float split makes
  static typing of table loads impossible, and feedback is cheap.
- Kept the br_table dispatch in tier 1 (needed for resume at leaders); tier 2 caches only within blocks, so
  values do not live across the dispatch. Cross-block values are the phase-2 trace JIT's job.
- Accepted semantic gaps (documented): a hook switched on inside a metamethod is noticed at the next
  call/return; debug.setlocal from a metamethod on a specialized frame's register may not be seen by a value
  already cached in the same basic block.
- Test environment: VM tests run with a minimal prelude (luatests/prelude.lua: real math.random, print as a C
  function via coroutine.wrap, read-only io.open from assets, os.exit marker) so the official suite can run.


## Open problems / what remains

- Table slots of freed Protos are never reclaimed (needs a release import or a slot pool).
- One module per function: batching (and fewer imports per module) would cut instantiate overhead, mostly a
  browser concern (async, between frames).
- Tier 1's br_table dispatch for back-edges and the per-block register cache limit numeric loops; the next step
  is the phase-2 trace JIT below (values across iterations, hoisted guards/lookups, inlining, sinking).
- binarytrees-like allocation-heavy code barely improves (allocation sinking is phase 2).
- Code size (~90-134 bytes/instruction) is larger than ideal; the cold paths (helpers' argument setup) could be
  shared out of line.
- wasmcart-native (C++/V8 via libnode) would need: the two env imports (wc_jit_link: copy bytes, compile and
  instantiate with v8::WasmModuleObject from the cart's own isolate, resolve 'cart' imports from the cart
  instance's exports, grow the exported table and set slots; synchronous compile is fine natively), and
  wc_jit_config from its own options. It already auto-stubs unknown env imports, so today it simply interprets.
  A wasmtime host would do the same through Module::new + Linker with the instance's exports.
- The three.lua browser bench lane needs a yielding warm-up to measure any async JIT (see the browser notes in the README).

## Phase 2 design: a trace JIT modeled on LuaJIT, for Lua 5.4 and a wasm target

(Written after reading LuaJIT 2.1's lj_record.c, lj_ir.h, lj_snap.c, lj_opt_fold.c, lj_opt_loop.c,
lj_opt_mem.c, lj_opt_sink.c, lj_asm_x86.h (MIT).)

### Why, given the baseline

The baseline (tier 1 + its type-specialized tier) removes dispatch, keeps numbers unboxed only inside a
basic block, and calls compiled callees directly. What it cannot do: keep values in locals across blocks
and loop iterations (every leader flushes the register cache), hoist guards or table lookups out of
loops, forward stores to loads (`self.x = self.x + d` reloads and re-checks every time), inline small
methods, or avoid allocating temporaries. Those are exactly what a trace compiler does, and they are
what three.lua's remaining profile is made of (method calls, field loads/stores, Vector3/Matrix4
temporaries).

### Shape

1. **Hot loop detection.** A small hash of counters indexed by loop-header pc (LuaJIT's hotcount),
   bumped by the interpreter's back-edges and by baseline code's back-edges (which already count for
   tier-up). Also hot function entries (for root traces of called functions, LuaJIT's FUNCF).
2. **Recording from the 5.4 interpreter.** When a loop header is hot, baseline code bails to the
   interpreter at the header with a "record" flag; the interpreter runs one iteration and, through the
   existing `trap`/vmfetch hook (the same path the JIT re-entry uses), calls `rec_ins(L, ci, pc)`
   before each instruction. The recorder sees the live values, so it emits IR specialized to the
   actual types, constants, table shapes and callees, with a guard for every assumption
   (lj_record.c's model). Recording stops when the loop closes (back at the header: a looping trace),
   at an NYI instruction or event (abort; blacklist the pc after N aborts), or at a trace length limit.
3. **IR**: LuaJIT-style typed SSA in an array, constants below a bias, each instruction (op, type,
   op1, op2). Types follow 5.4 variants: nil, false, true, int (i64), num (f64), shrstr, lngstr, table,
   Lua closure, light C function, C closure, userdata, thread, lightuserdata, plus pointer types
   (P32) for node/array addresses. Ops: SLOAD (stack slot with type guard), guards EQ/NE/LT/GE/ULT...,
   arithmetic for int (wrapping: Lua 5.4 integers wrap, so no overflow guards and no LuaJIT-style
   narrowing) and num, CONV int<->num (exact 5.4 rules: int->num is a cast; num->int only with an
   exactness guard, luaV_flttointeger), FLOAD (table hmask/lsizenode, node, array, alimit,
   metatable, closure upvalue array), HREFK/HREF/AREF/UREF, ALOAD/HLOAD/ULOAD, ASTORE/HSTORE/USTORE,
   TBAR (backward barrier on table stores), TNEW/TDUP, CALLN (pure C helpers: sin, pow, fmod...),
   CALLS (helpers that can run Lua code: needs a materialized snapshot first), LOOP, PHI.
4. **Snapshots** (lj_snap.c): each guard records which stack slots differ from the interpreter's view
   at that pc and the IR ref holding each (sparse, deduplicated when unchanged since the last
   guard), plus the frame chain for inlined calls and the pc to resume at.
   *Wasm adaptation*: values live in wasm locals, which no exit handler can read, so restoration is
   generated code: a failing guard branches to its exit block, which boxes each snapshot entry into
   its stack TValue (value + tag), rebuilds CallInfo for inlined frames, sets savedpc/L->top, and
   returns the exit number. Exits with equal snapshots share one block (LuaJIT merges snapshots the
   same way). Sunk allocations are re-created in the exit block by a helper (lj_snap's unsink).
5. **Optimisations, in order of payoff for three.lua**:
   - FOLD/CSE (lj_opt_fold.c): constant folding, algebraic simplification, CSE of loads and guards.
   - **HREFK**: a constant-key lookup in a table recorded with lsizenode s and the key found at node
     index k becomes `guard FLOAD(t,lsizenode)==s; n = FLOAD(t,node); guard n[k].key == key; slot =
     n + k*24`. No hash, no chain walk. With LOOP this hoists out of the loop whenever the table is
     invariant. Method lookups record the miss on the instance (HREFK on a key that must stay absent,
     or a guarded "no key" fast check) plus `guard metatable == M` and HREFK in the class table,
     which folds the method to a constant closure, enabling inlining.
   - **FWD / alias analysis** (lj_opt_mem.c): store-to-load and load-to-load forwarding through
     HSTORE/ASTORE with disambiguation by (table ref, key, field), so `self.x` lives in a local for
     the whole loop and is stored once per iteration (or sunk).
   - **LOOP** (lj_opt_loop.c): copy-substitution unrolling. The recorded iteration becomes a pre-roll;
     re-emitting it with substituted refs produces a loop body that contains only the variant
     instructions, invariant guards and loads stay in the pre-roll. PHIs become wasm locals assigned
     at the end of the body, and the body is one wasm `loop` block: a reducible CFG with values in
     locals, which is what V8's optimizing tier needs (the LuaAOT lesson: no resume-anywhere switch).
   - **Inlining**: calls to Lua functions are recorded through (frames in snapshots), so small methods
     (Vector3:add, Matrix4 element access) disappear. Return below the trace's start frame ends the
     trace (LuaJIT's down-recursion rules).
   - **Allocation sinking** (lj_opt_sink.c): TNEW/TDUP whose stores are only read inside the trace
     and do not escape are not allocated; their fields stay in locals; exits re-create them.
     Targets three.lua's `clone()`/temporary vectors.
6. **Code generation**: one wasm function per trace, `(L, ci) -> exit number`, IR refs mapped to typed
   wasm locals (i64/f64/i32), V8 does register allocation. Guards are `br_if` to exit blocks laid out
   after the loop.
7. **Trace linking and side traces without code patching.** Each trace is a function in a table
   slot. Each exit has a counter and a cell in linear memory holding a side-trace slot (0 = none).
   The exit block, after materializing its snapshot, loads the cell: 0 returns the exit number to the
   C side (resume in the interpreter, or in baseline code if the pc is one of its leaders); otherwise
   it tail-calls the side trace with `return_call_indirect` (wasm tail calls, shipped in V8 since
   2023; feature-test at link time and fall back to returning a "continue at slot" code that the C
   trampoline follows). A side trace starts by reloading the slots it needs (state crosses the link
   through memory: the price of not patching code). Root traces ending at another loop's header link
   the same way. The loop header in baseline code checks a per-pc trace cell and calls the trace.
   New traces are batched into one module per wc_jit_link (root + its hot side traces), compiled
   between frames on the web through the existing async ticket.
8. **Lua 5.4 specifics to handle**: integer/float subtypes (two numeric IR types, explicit CONV,
   mixed comparisons via exact rules or type guards); 5.4 opcodes (K/I variants, MMBIN after arith:
   record the numeric fast path with type guards and never the MMBIN, EQK/EQI/LTI..., GETI/SETI,
   LFALSESKIP, TESTSET, GETTABUP globals = HREFK on _ENV); the integer for loop's precomputed count
   (FORPREP: count = (limit-init)/step, so the IV is the count, no overflow checks); float for loops;
   to-be-closed variables (TBC/CLOSE and RETURN with k: abort recording, NYI); generic for (`next`:
   NYI at first, `ipairs` specialized to an AREF loop); VARARG/VARARGPREP (record with a fixed
   count guard); the 5.4 GC (incremental and generational: TBAR on table stores, USTORE barrier on
   upvalues); alimit vs real array size (record AREF against alimit with a bounds guard, exactly
   luaV_fastgeti); coroutines (no trace spans a yield; a CALLS that may yield materializes the full
   snapshot first so the longjmp leaves consistent memory, as baseline does today); hooks (traces are
   never entered while hookmask != 0, and exits check it).
9. **Effort and staging** (each stage differential-tested like the baseline: threshold-0 forced
   recording on the Lua suite, three.lua tests and bench checks, a miscompile control):
   - P2a: recorder for numeric loops (SLOAD, arith, compares, FORLOOP), snapshots + generated exit
     blocks, LOOP with PHIs. Target: mandelbrot/nbody/spectralnorm inner loops near V8 JS.
   - P2b: HREFK/AREF/FLOAD + FOLD/CSE/FWD. Target: field-heavy loops (vec3, 14-cpu-math).
   - P2c: call inlining and method lookup folding. Target: 15-raycast, 19-scenegraph.
   - P2d: exit counters, side traces, linking via table cells and tail calls, batched modules.
   - P2e: allocation sinking.
   Risks: exit-block code size (mitigate: snapshot merging, sparse snapshots, shared restore helper
   for large snapshots), compile latency on the web (batching + async), V8 running fresh modules in
   Liftoff before TurboFan (traces are hot by construction, so tier-up comes quickly), and the
   semantic corners (debug.getlocal/setlocal on frames inside a trace, which LuaJIT also leaves
   unsupported).
