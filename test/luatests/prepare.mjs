// test/luatests/prepare.mjs - copy the official Lua 5.4.7 tests
// (vendor/lua-tests) into suite/ with the few edits a cart needs: a cart has
// no io library, so there is no FILE* userdata. Every edit removes or
// rewrites one line that needs io.stdin or io.input; nothing else changes.
//
//   node test/luatests/prepare.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'vendor', 'lua-tests');
const OUT = path.join(HERE, 'suite');
fs.mkdirSync(OUT, { recursive: true });

const edits = {
  'strings.lua': [[/io\.stdin/, null]],
  'errors.lua': [[/io\.stdin|io\.input/, null]],
  'nextvar.lua': [[/\[io\.stdin\] = 9,/, '    [{}] = 9,                       -- (no io: a table)']],
};
let n = 0;
for (const f of fs.readdirSync(SRC)) {
  const p = path.join(SRC, f);
  if (!fs.statSync(p).isFile()) continue;
  let buf = fs.readFileSync(p);
  const ed = edits[f];
  if (ed) {
    const lines = buf.toString('latin1').split('\n');
    const out = [];
    for (const line of lines) {
      const hit = ed.find(([re]) => re.test(line));
      if (!hit) { out.push(line); continue; }
      n++;
      if (hit[1] !== null) out.push(hit[1]); else out.push('-- [cart: no io] ' + line);
    }
    buf = Buffer.from(out.join('\n'), 'latin1');
  }
  fs.writeFileSync(path.join(OUT, f), buf);
}
console.log(`suite/ ready, ${n} lines edited`);
