// The same benchmarks as lua/*.lua, in JavaScript, for V8. Same algorithms
// and the same RESULT checksum line, so every runtime is shown to do the
// same work. Usage: node js/bench.mjs <name> <n>
const B = {
  fib(n) { const f = (k) => (k < 2 ? k : f(k - 1) + f(k - 2)); return f(n); },
  mandelbrot(n) {
    let total = 0;
    for (let y = 0; y < n; y++) {
      const ci = 2.0 * y / n - 1.0;
      for (let x = 0; x < n; x++) {
        const cr = 2.0 * x / n - 1.5;
        let zr = 0, zi = 0, i = 0;
        while (i < 50 && zr * zr + zi * zi <= 4.0) { const t = zr * zr - zi * zi + cr; zi = 2.0 * zr * zi + ci; zr = t; i++; }
        total += i;
      }
    }
    return total;
  },
  nbody(n) {
    const PI = Math.PI, SOLAR = 4 * PI * PI, DAYS = 365.24;
    const b = [
      { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: SOLAR },
      { x: 4.84143144246472090e+00, y: -1.16032004402742839e+00, z: -1.03622044471123109e-01, vx: 1.66007664274403694e-03 * DAYS, vy: 7.69901118419740425e-03 * DAYS, vz: -6.90460016972063023e-05 * DAYS, mass: 9.54791938424326609e-04 * SOLAR },
      { x: 8.34336671824457987e+00, y: 4.12479856412430479e+00, z: -4.03523417114321381e-01, vx: -2.76742510726862411e-03 * DAYS, vy: 4.99852801234917238e-03 * DAYS, vz: 2.30417297573763929e-05 * DAYS, mass: 2.85885980666130812e-04 * SOLAR },
      { x: 1.28943695621391310e+01, y: -1.51111514016986312e+01, z: -2.23307578892655734e-01, vx: 2.96460137564761618e-03 * DAYS, vy: 2.37847173959480950e-03 * DAYS, vz: -2.96589568540237556e-05 * DAYS, mass: 4.36624404335156298e-05 * SOLAR },
      { x: 1.53796971148509165e+01, y: -2.59193146099879641e+01, z: 1.79258772950371181e-01, vx: 2.68067772490389322e-03 * DAYS, vy: 1.62824170038242295e-03 * DAYS, vz: -9.51592254519715870e-05 * DAYS, mass: 5.15138902046611451e-05 * SOLAR },
    ];
    let px = 0, py = 0, pz = 0;
    for (const o of b) { px += o.vx * o.mass; py += o.vy * o.mass; pz += o.vz * o.mass; }
    b[0].vx = -px / SOLAR; b[0].vy = -py / SOLAR; b[0].vz = -pz / SOLAR;
    const nb = b.length, dt = 0.01;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < nb; i++) {
        const bi = b[i];
        let bvx = bi.vx, bvy = bi.vy, bvz = bi.vz;
        for (let j = i + 1; j < nb; j++) {
          const bj = b[j];
          const dx = bi.x - bj.x, dy = bi.y - bj.y, dz = bi.z - bj.z;
          const d2 = dx * dx + dy * dy + dz * dz, mag = dt / (d2 * Math.sqrt(d2));
          let bm = bj.mass * mag; bvx -= dx * bm; bvy -= dy * bm; bvz -= dz * bm;
          bm = bi.mass * mag; bj.vx += dx * bm; bj.vy += dy * bm; bj.vz += dz * bm;
        }
        bi.vx = bvx; bi.vy = bvy; bi.vz = bvz;
        bi.x += dt * bvx; bi.y += dt * bvy; bi.z += dt * bvz;
      }
    }
    let e = 0;
    for (let i = 0; i < nb; i++) {
      const o = b[i]; e += 0.5 * o.mass * (o.vx * o.vx + o.vy * o.vy + o.vz * o.vz);
      for (let j = i + 1; j < nb; j++) { const c = b[j]; const dx = o.x - c.x, dy = o.y - c.y, dz = o.z - c.z; e -= o.mass * c.mass / Math.sqrt(dx * dx + dy * dy + dz * dz); }
    }
    return e;
  },
  spectralnorm(N) {
    const A = (i, j) => { const ij = i + j - 1; return 1.0 / (ij * (ij - 1) * 0.5 + i); };
    const Av = (x, y) => { for (let i = 1; i <= N; i++) { let a = 0; for (let j = 1; j <= N; j++) a += x[j] * A(i, j); y[i] = a; } };
    const Atv = (x, y) => { for (let i = 1; i <= N; i++) { let a = 0; for (let j = 1; j <= N; j++) a += x[j] * A(j, i); y[i] = a; } };
    const u = new Array(N + 1).fill(1), v = new Array(N + 1).fill(0), t = new Array(N + 1).fill(0);
    for (let k = 0; k < 10; k++) { Av(u, t); Atv(t, v); Av(v, t); Atv(t, u); }
    let vBv = 0, vv = 0;
    for (let i = 1; i <= N; i++) { vBv += u[i] * v[i]; vv += v[i] * v[i]; }
    return Math.sqrt(vBv / vv);
  },
  binarytrees(N) {
    const bottomUp = (d) => (d === 0 ? [] : [bottomUp(d - 1), bottomUp(d - 1)]);
    const check = (t) => (t.length ? 1 + check(t[0]) + check(t[1]) : 1);
    let total = 0;
    const long = bottomUp(N);
    for (let d = 4; d <= N; d += 2) {
      const iters = 2 ** (N - d + 4);
      let c = 0;
      for (let k = 0; k < iters; k++) c += check(bottomUp(d));
      total += c;
    }
    return total + check(long);
  },
  fannkuch(n) {
    const p = [], q = [], s = [];
    let sign = 1, maxflips = 0, sum = 0;
    for (let i = 1; i <= n; i++) { p[i] = i; q[i] = i; s[i] = i; }
    for (;;) {
      let q1 = p[1];
      if (q1 !== 1) {
        for (let i = 2; i <= n; i++) q[i] = p[i];
        let flips = 1;
        for (;;) {
          const qq = q[q1];
          if (qq === 1) { sum += sign * flips; if (flips > maxflips) maxflips = flips; break; }
          q[q1] = q1;
          if (q1 >= 4) { let i = 2, j = q1 - 1; do { const t = q[i]; q[i] = q[j]; q[j] = t; i++; j--; } while (i < j); }
          q1 = qq; flips++;
        }
      }
      if (sign === 1) { const t = p[2]; p[2] = p[1]; p[1] = t; sign = -1; }
      else {
        let t = p[2]; p[2] = p[3]; p[3] = t; sign = 1;
        for (let i = 3; i <= n; i++) {
          const sx = s[i];
          if (sx !== 1) { s[i] = sx - 1; break; }
          if (i === n) return sum * 1000 + maxflips;
          s[i] = i;
          t = p[1]; for (let j = 1; j <= i; j++) p[j] = p[j + 1]; p[i + 1] = t;
        }
      }
    }
  },
  vec3(n) {
    class V {
      constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
      add(b) { this.x += b.x; this.y += b.y; this.z += b.z; return this; }
      applyMatrix4(m) {
        const e = m.elements, x = this.x, y = this.y, z = this.z;
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
        this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
        this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
        return this;
      }
      length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    }
    const m = { elements: [0.9, 0.1, 0, 0, -0.1, 0.9, 0, 0, 0, 0, 1, 0, 0.5, 0.25, 0, 1] };
    const p = new V(1, 2, 3), d = new V(0.001, 0.002, 0.003);
    let acc = 0;
    for (let i = 1; i <= n; i++) { p.add(d).applyMatrix4(m); acc += p.length(); }
    return acc;
  },
};
const [name, n] = process.argv.slice(2);
const v = B[name](Number(n));
// C's %.10g: 10 significant digits, trailing zeros of the mantissa dropped.
function g10(x) {
  let t = Number(x).toPrecision(10);
  let [m, e] = t.split('e');
  if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
  if (e) { const n = Number(e); e = (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0'); return m + 'e' + e; }
  return m;
}
console.log(`RESULT ${name} ${g10(v)}`);
