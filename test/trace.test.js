// Walk tracing: walk made-up yards with simulated phone GPS and check the cleaned-up shape.
// node test/trace.test.js            checks
// node test/trace.test.js report     also prints accuracy across many walks
const T = require("../js/trace.js");
const E = require("../js/engine.js");

const P = (pts) => pts.map(([x, y, b]) => ({ x, y, b: b || 0 }));
const yards = {
  "rectangle 60x40": {
    v: P([
      [0, 0],
      [60, 0],
      [60, 40],
      [0, 40],
    ]),
    straight: 4,
    curves: 0,
  },
  "L shape": {
    v: P([
      [0, 0],
      [70, 0],
      [70, 30],
      [35, 30],
      [35, 55],
      [0, 55],
    ]),
    straight: 6,
    curves: 0,
  },
  "one curved side": {
    v: P([
      [0, 0],
      [50, 0],
      [50, 35, 0],
      [0, 35, 0],
    ]).map((p, i) => (i === 2 ? { ...p, b: 8 } : p)),
    straight: 3,
    curves: 1,
  },
  kidney: {
    v: P([
      [0, 0, -6],
      [40, 0, -10],
      [40, 30, 4],
      [0, 30, -10],
    ]),
    straight: 0,
    curves: 4,
  },
  "big bed with curve front": {
    v: P([
      [0, 0, -12],
      [80, 0],
      [80, 12],
      [0, 12],
    ]),
    straight: 3,
    curves: 1,
  },
};

// dense outline of a shape, one point per ~0.25 ft
function outline(v) {
  const out = [];
  v.forEach((a, i) => {
    const b = v[(i + 1) % v.length];
    out.push({ x: a.x, y: a.y });
    if (Math.abs(a.b) >= 0.05)
      E.arcPoints(a, b, a.b, 0.25).forEach((p) => out.push(p));
    else {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 0.25; t < L; t += 0.25)
        out.push({
          x: a.x + ((b.x - a.x) * t) / L,
          y: a.y + ((b.y - a.y) * t) / L,
        });
    }
  });
  return out;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

// Walk the outline at 3 ft/s with one GPS fix a second. Phone GPS error is mostly a slow drift
// (biasFt, changing over ~tau seconds) plus a little jitter each fix (jitFt).
// Tapping Corner averages 3 fixes while standing still.
function walk(v, seed, biasFt, jitFt, tapCorners) {
  const r = rng(seed);
  const line = outline(v);
  const per = [];
  let tot = 0;
  line.forEach((p, i) => {
    per.push(tot);
    const q = line[(i + 1) % line.length];
    tot += Math.hypot(q.x - p.x, q.y - p.y);
  });
  const tau = 60,
    a = Math.exp(-1 / tau);
  let bx = gauss(r) * biasFt,
    by = gauss(r) * biasFt;
  const step = () => {
    bx = a * bx + Math.sqrt(1 - a * a) * biasFt * gauss(r);
    by = a * by + Math.sqrt(1 - a * a) * biasFt * gauss(r);
  };
  const fix = (p) => ({
    x: p.x + bx + gauss(r) * jitFt,
    y: p.y + by + gauss(r) * jitFt,
  });
  const at = (d) => {
    let i = per.findIndex((x) => x > d);
    if (i < 0) i = line.length;
    return line[Math.max(0, i - 1)];
  };
  const cornerAt = new Set();
  if (tapCorners) {
    // corners: vertices where the edge direction changes by more than 30 degrees
    let idx = 0;
    v.forEach((p) => {
      while (idx < line.length && (line[idx].x !== p.x || line[idx].y !== p.y))
        idx++;
      cornerAt.add(per[idx] || 0);
    });
  }
  const out = [];
  const offset = r() * tot; // start anywhere along the edge
  const corners = [...cornerAt]
    .map((d) => (d - offset + tot) % tot)
    .sort((x, y) => x - y);
  let ci = 0;
  for (let d = 0; d < tot; d += 3) {
    while (ci < corners.length && corners[ci] <= d) {
      // stand on it for 3 seconds
      const p = at((corners[ci] + offset) % tot);
      let sx = 0,
        sy = 0;
      for (let k = 0; k < 3; k++) {
        step();
        const f = fix(p);
        sx += f.x;
        sy += f.y;
      }
      out.push({ x: sx / 3, y: sy / 3, corner: true, bx, by });
      ci++;
    }
    step();
    out.push(Object.assign(fix(at((d + offset) % tot)), { bx, by }));
  }
  return out;
}

// Tap Anchor n times spread through the walk (the first at the start), each lined up on the photo
// to within about a foot. The app spreads the correction between anchors over the time walked
// between them (offsetAt in js/app.js); here time is the point's place in the trail.
function anchored(tr, n, seed) {
  const r = rng(seed);
  const at = [];
  for (let k = 0; k < n; k++) at.push(Math.round((k * (tr.length - 1)) / Math.max(1, n - 1)));
  const fixes = at.map((i) => ({ i, x: -(tr[i].bx + gauss(r)), y: -(tr[i].by + gauss(r)) }));
  return tr.map((p, i) => {
    let o = fixes[0];
    if (i > fixes[0].i) {
      o = fixes[fixes.length - 1];
      for (let k = 1; k < fixes.length; k++) {
        if (i <= fixes[k].i) {
          const u = (i - fixes[k - 1].i) / (fixes[k].i - fixes[k - 1].i);
          o = { x: fixes[k - 1].x + u * (fixes[k].x - fixes[k - 1].x), y: fixes[k - 1].y + u * (fixes[k].y - fixes[k - 1].y) };
          break;
        }
      }
    }
    return { x: p.x + o.x, y: p.y + o.y, corner: p.corner };
  });
}

// how far apart two outlines are at worst (both ways), after lining up their centres the way
// Anchor lines the walk up with the photo
function worstGap(a, b, absolute) {
  const c = (pts) =>
    pts.reduce(
      (s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }),
      { x: 0, y: 0 },
    );
  const ca = c(a),
    cb = c(b);
  const bb = absolute ? b : b.map((p) => ({ x: p.x - cb.x + ca.x, y: p.y - cb.y + ca.y }));
  const one = (p, set) =>
    Math.min(...set.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  let w = 0;
  a.forEach((p, i) => i % 4 === 0 && (w = Math.max(w, one(p, bb))));
  bb.forEach((p, i) => i % 4 === 0 && (w = Math.max(w, one(p, a))));
  return w;
}

let fails = 0;
const check = (ok, msg) => {
  if (!ok) {
    fails++;
    console.log("FAIL " + msg);
  }
};

// 1. Perfect GPS: the shape comes back almost exactly, with the right straight edges and curves.
for (const [name, y] of Object.entries(yards)) {
  y.name = name;
  for (const tap of [false, true]) {
    for (let seed = 1; seed <= 5; seed++) {
      const tr = walk(y.v, seed, 0, 0, tap);
      const got = T.fit(tr);
      check(got, name + " gave no shape");
      if (!got) continue;
      const gap = worstGap(outline(y.v), outline(got));
      const st = got.filter((p) => !p.b).length,
        cu = got.length - st;
      // Under 2 ft, not 1: one fix every 3 ft means a corner walked past without a tap is only
      // known to within a step or so. Measured worst 1.8 ft (kidney, seed 3) on 2026-11-13.
      check(
        gap < 2.0,
        `${name} (${tap ? "corners tapped" : "no taps"}, seed ${seed}) off by ${gap.toFixed(2)} ft with perfect GPS`,
      );
      // A kidney has no sharp corners, so its gentlest curve (4 ft of bow over 40 ft) can come
      // back straight when nothing was tapped.
      const countOk =
        y.name === "kidney" && !tap
          ? cu >= y.curves - 1
          : st === y.straight && cu === y.curves;
      check(
        countOk,
        `${name} (${tap ? "taps" : "no taps"}, seed ${seed}) gave ${st} straight + ${cu} curves, want ${y.straight} + ${y.curves}`,
      );
    }
  }
}

// 2. Hundreds of points in, a handful of corners out.
{
  const tr = walk(yards["rectangle 60x40"].v, 7, 0, 0.3, false);
  const got = T.fit(
    tr.flatMap((p) => [p, { x: p.x + 0.1, y: p.y }, { x: p.x, y: p.y + 0.1 }]),
  );
  check(
    got && got.length <= 6,
    `noisy rectangle kept ${got && got.length} corners`,
  );
}

// 2b. How a walk really ends (review 2026-11-13). Rectangle trail points, one every 3 ft from (0,0).
function rectTrail(w, h, extra) {
  const c = [[0, 0], [w, 0], [w, h], [0, h]];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < L; t += 3) out.push({ x: a[0] + ((b[0] - a[0]) * t) / L, y: a[1] + ((b[1] - a[1]) * t) / L });
  }
  for (let t = 0; t <= (extra || 0); t += 3) out.push({ x: t, y: 0 });
  return out;
}
// segments of the outline crossing each other anywhere
function crosses(v) {
  const o = outline(v);
  const seg = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < o.length; i++)
    for (let j = i + 2; j < o.length; j++) {
      if (i === 0 && j === o.length - 1) continue;
      const a = o[i], b = o[(i + 1) % o.length], c = o[j], d = o[(j + 1) % o.length];
      if (seg(a, b, c) * seg(a, b, d) < 0 && seg(c, d, a) * seg(c, d, b) < 0) return true;
    }
  return false;
}
{
  const rect = P([[0, 0], [60, 0], [60, 40], [0, 40]]);
  const over = T.fit(rectTrail(60, 40, 10));
  check(over && over.length === 4 && worstGap(outline(rect), outline(over), true) < 1.5, `walking 10 ft past the start gave ${over && over.length} corners`);
  const pins = rectTrail(60, 40);
  pins[0].corner = true;
  pins.push({ x: 2.5, y: 0.3, corner: true }); // pinned the start corner again, 2.5 ft off
  const pg = T.fit(pins);
  check(pg && pg.length === 4 && !crosses(pg), `pinning the start corner again gave ${pg && pg.length} corners`);
  const short = rectTrail(60, 40).slice(0, -1); // stopped 3 ft short
  const sg = T.fit(short);
  check(sg && sg.length === 4, `stopping short gave ${sg && sg.length} corners`);
  for (const [w, h] of [[10, 8], [12, 10], [15, 10]]) {
    const g = T.fit(rectTrail(w, h));
    check(g && g.length === 4 && g.every((q) => !q.b), `${w}x${h} bed gave ${g && g.length} corners, ${g && g.filter((q) => q.b).length} curves`);
  }
  // drift that leaves the end a few feet from the start shouldn't fold the shape
  let folded = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(500 + seed);
    let dx = 0, dy = 0;
    const tr = rectTrail(60, 40).map((q) => ((dx += gauss(r) * 0.3), (dy += gauss(r) * 0.3), { x: q.x + dx + gauss(r), y: q.y + dy + gauss(r) }));
    const g = T.fit(tr);
    if (!g || crosses(g)) folded++;
  }
  check(folded === 0, `${folded} of 40 drifting rectangle walks folded over at the seam`);
}

// 3. Real-phone GPS: the cleaned shape shouldn't be worse than the raw trail it came from.
const report = process.argv[2] === "report";
for (const [name, y] of Object.entries(yards)) {
  for (const [label, bias, jit, tap] of [
    ["open sky", 3, 1.5, false],
    ["open sky, corners tapped", 3, 1.5, true],
    ["typical", 8, 3, false],
    ["typical, corners tapped", 8, 3, true],
  ]) {
    const gaps = [],
      raws = [],
      counts = [];
    for (let seed = 1; seed <= 40; seed++) {
      const tr = walk(y.v, 100 + seed, bias, jit, tap);
      const got = T.fit(tr);
      if (!got) {
        gaps.push(99);
        continue;
      }
      gaps.push(worstGap(outline(y.v), outline(got)));
      raws.push(worstGap(outline(y.v), tr));
      counts.push(got.length);
    }
    gaps.sort((a, b) => a - b);
    raws.sort((a, b) => a - b);
    const med = (a) => a[Math.floor(a.length / 2)],
      p90 = (a) => a[Math.floor(a.length * 0.9)];
    check(
      // +1 ft: on a typical phone with no taps, the GPS drift dominates and straightening a wobbly
      // edge can land up to about 0.8 ft further out than the wobble itself (L shape, 2026-11-13).
      med(gaps) <= med(raws) + 1,
      `${name}, ${label}: cleaned shape (${med(gaps).toFixed(1)} ft) worse than raw trail (${med(raws).toFixed(1)} ft)`,
    );
    if (report)
      console.log(
        `${name.padEnd(26)} ${label.padEnd(26)} worst gap median ${med(gaps).toFixed(1)} ft, 90% ${p90(gaps).toFixed(1)} ft | raw trail ${med(raws).toFixed(1)} ft | corners ${Math.min(...counts)}-${Math.max(...counts)}`,
      );
  }
}

// 4. Anchors: with a typical phone, tapping Anchor 4 times through the walk should land the shape
// on the photo much closer than one anchor at the start. Measured on the map, not just the shape.
for (const [name, y] of Object.entries(yards)) {
  const res = {};
  for (const [label, n, tap] of [
    ["1 anchor", 1, false],
    ["4 anchors", 4, false],
    ["4 anchors, corners tapped", 4, true],
  ]) {
    const gaps = [];
    for (let seed = 1; seed <= 30; seed++) {
      const got = T.fit(anchored(walk(y.v, 300 + seed, 8, 3, tap), n, 900 + seed));
      gaps.push(got ? worstGap(outline(y.v), outline(got), true) : 99);
    }
    gaps.sort((a, b) => a - b);
    res[label] = gaps[Math.floor(gaps.length / 2)];
    if (report)
      console.log(`${name.padEnd(26)} typical, ${label.padEnd(26)} worst gap on the map, median ${res[label].toFixed(1)} ft, 90% ${gaps[Math.floor(gaps.length * 0.9)].toFixed(1)} ft`);
  }
  check(res["4 anchors"] < res["1 anchor"] * 0.8, `${name}: 4 anchors (${res["4 anchors"].toFixed(1)} ft) barely beat 1 (${res["1 anchor"].toFixed(1)} ft)`);
}

console.log(fails ? fails + " failing" : "all passing");
process.exit(fails ? 1 : 0);
