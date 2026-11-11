// Random yards with every feature, run the way the app runs them, then checked against Zach's
// rules with checks that don't trust the engine's own verifier.
// node test/fuzz.js [count=50] [seed=1]
const E = require("../js/engine.js");

const COUNT = +process.argv[2] || 50;
let seed = +process.argv[3] || 1;
const rnd = () =>
  (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);

/* ---------- yard generator ---------- */

function lawnShape(ox, oy) {
  const w = between(25, 110),
    h = between(20, 80);
  const kind = pick([
    "rect",
    "rect",
    "L",
    "curved",
    "kidney",
    "odd",
    "strip",
    "curvedL",
  ]);
  const b = (k) => k; // bulge in feet
  if (kind === "rect")
    return {
      kind,
      pts: [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
    };
  if (kind === "strip")
    return {
      kind,
      pts: [
        [0, 0],
        [between(6, 14), 0],
        [between(6, 14), h],
        [0, h],
      ],
    };
  if (kind === "L") {
    const cx = w * between(0.35, 0.7),
      cy = h * between(0.35, 0.7);
    return {
      kind,
      pts: [
        [0, 0],
        [w, 0],
        [w, cy],
        [cx, cy],
        [cx, h],
        [0, h],
      ],
    };
  }
  if (kind === "curvedL") {
    const cx = w * between(0.4, 0.7),
      cy = h * between(0.4, 0.7);
    return {
      kind,
      pts: [
        [0, 0],
        [w, 0, b(between(-0.15, 0.15) * w)],
        [w, cy],
        [cx, cy],
        [cx, h],
        [0, h, b(between(-0.12, 0.12) * h)],
      ],
    };
  }
  if (kind === "curved")
    return {
      kind,
      pts: [
        [0, 0],
        [w, 0],
        [w, h, b(between(-0.18, 0.18) * w)],
        [0, h],
      ],
    };
  if (kind === "kidney")
    return {
      kind,
      pts: [
        [0, 0, b(between(2, 7))],
        [w, 0, b(-between(2, 8))],
        [w, h, b(between(2, 7))],
        [0, h, b(-between(2, 8))],
      ],
    };
  // odd: a 5 to 7 sided blob with a couple of slanted edges
  const n = 5 + Math.floor(rnd() * 3);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = between(0.75, 1);
    pts.push([
      w / 2 + (Math.cos(a) * w * r) / 2,
      h / 2 + (Math.sin(a) * h * r) / 2,
    ]);
  }
  return { kind, pts };
}

const shift = (pts, ox, oy) =>
  pts.map(([x, y, b]) => ({ x: x + ox, y: y + oy, b: b || 0 }));
// bounds of the drawn shape, curves included (corner points alone put "across" fences short of a
// bulging edge)
const bbox = (r0) => {
  const r = [];
  r0.forEach((v, i) => {
    r.push(v);
    E.arcPoints(v, r0[(i + 1) % r0.length], v.b || 0, 0.5).forEach((q) =>
      r.push(q),
    );
  });
  return {
    x0: Math.min(...r.map((p) => p.x)),
    x1: Math.max(...r.map((p) => p.x)),
    y0: Math.min(...r.map((p) => p.y)),
    y1: Math.max(...r.map((p) => p.y)),
  };
};

function makeYard(i) {
  const lawns = [];
  const nl = 1 + Math.floor(rnd() * 3);
  let ox = 0;
  for (let k = 0; k < nl; k++) {
    const s = lawnShape();
    const ring = shift(s.pts, ox, between(-10, 10));
    lawns.push({ kind: s.kind, ring, mode: rnd() < 0.2 ? "spray" : "auto" });
    ox = bbox(ring).x1 + between(8, 40);
  }
  const beds = [];
  const fences = [];
  lawns.forEach((l) => {
    const bb = bbox(l.ring);
    const W = bb.x1 - bb.x0,
      H = bb.y1 - bb.y0;
    // a bed inside the lawn (round tree ring or a rectangle) about half the time
    if (rnd() < 0.5 && W > 20 && H > 20) {
      const cx = bb.x0 + W * between(0.35, 0.65),
        cy = bb.y0 + H * between(0.35, 0.65);
      if (rnd() < 0.5) {
        const r = between(2, 5);
        beds.push({
          where: "inside",
          ring: [
            { x: cx - r, y: cy, b: 0 },
            { x: cx, y: cy + r, b: 0 },
            { x: cx + r, y: cy, b: 0 },
            { x: cx, y: cy - r, b: 0 },
          ].map((p) => Object.assign(p, { b: r * 0.4142 })),
        });
      } else {
        const bw = between(4, 12),
          bh = between(3, 6);
        beds.push({
          where: "inside",
          ring: shift(
            [
              [0, 0],
              [bw, 0],
              [bw, bh],
              [0, bh],
            ],
            cx - bw / 2,
            cy - bh / 2,
          ),
        });
      }
    }
    // a bed along the outside, sometimes wide enough for two rows, sometimes curved
    if (rnd() < 0.6) {
      const bw = between(10, Math.max(12, W)),
        bh = between(2, 16);
      beds.push({
        where: "outside",
        ring: shift(
          [
            [0, 0],
            [bw, 0],
            [bw, bh, rnd() < 0.3 ? between(-3, 3) : 0],
            [0, bh],
          ],
          bb.x0,
          bb.y1 + between(0.6, 4),
        ),
      });
    }
    // a small bed near it (joins a neighbour) or far (its own zone)
    if (rnd() < 0.3)
      beds.push({
        where: "small",
        ring: shift(
          [
            [0, 0],
            [3, 0],
            [3, 3],
            [0, 3],
          ],
          bb.x1 + between(2, 30),
          bb.y0 - between(5, 12),
        ),
      });
    // fences: across the lawn, partway in, or along an edge outside
    const f = rnd();
    if (f < 0.35) {
      const x = bb.x0 + W * between(0.3, 0.7);
      fences.push({
        kind: "across",
        pts: [
          { x, y: bb.y0 - 2 },
          { x: x + between(-6, 6), y: bb.y1 + 2 },
        ],
      });
    } else if (f < 0.5) {
      const y = bb.y0 + H * between(0.3, 0.7);
      fences.push({
        kind: "L-across",
        pts: [
          { x: bb.x0 - 2, y },
          { x: bb.x0 + W * 0.5, y },
          { x: bb.x0 + W * 0.5, y: bb.y1 + 2 },
        ],
      });
    } else if (f < 0.6) {
      const x = bb.x0 + W * 0.5;
      fences.push({
        kind: "partway",
        pts: [
          { x, y: bb.y0 - 2 },
          { x, y: bb.y0 + H * 0.4 },
        ],
      });
    } else if (f < 0.68) {
      // a fence piece with both ends inside the lawn
      const y0 = bb.y0 + H * 0.5;
      fences.push({
        kind: "floating",
        pts: [
          { x: bb.x0 + W * 0.3, y: y0 },
          { x: bb.x0 + W * 0.7, y: y0 + between(-4, 4) },
        ],
      });
    } else if (f < 0.75) {
      // in from the edge, then a turn, ending inside
      const x = bb.x0 + W * 0.45;
      fences.push({
        kind: "bent partway",
        pts: [
          { x, y: bb.y0 - 2 },
          { x, y: bb.y0 + H * 0.45 },
          { x: x + W * 0.2, y: bb.y0 + H * 0.45 },
        ],
      });
    } else if (f < 0.8) {
      fences.push({
        kind: "outside",
        pts: [
          { x: bb.x0 - 3, y: bb.y0 - 3 },
          { x: bb.x1 + 3, y: bb.y0 - 3 },
        ],
      });
    }
  });
  // a bed crossing a fence sometimes
  const across = fences.find((f) => f.kind === "across");
  if (across && rnd() < 0.5) {
    const x = across.pts[0].x;
    const l = lawns.find((l) => {
      const b = bbox(l.ring);
      return x > b.x0 && x < b.x1;
    });
    if (l) {
      const bb = bbox(l.ring);
      const y = bb.y0 + (bb.y1 - bb.y0) * between(0.2, 0.3);
      beds.push({
        where: "across fence",
        ring: shift(
          [
            [0, 0],
            [between(16, 30), 0],
            [between(16, 30), 4],
            [0, 4],
          ],
          x - 10,
          y,
        ),
      });
    }
  }
  // the app refuses a bed hanging over a lawn edge and beds that overlap each other
  // (shapeProblems in js/app.js), so a yard like that never reaches the engine; drop those beds
  const lawnRings = lawns.map((l) => dens(l.ring));
  const okBeds = [];
  beds.forEach((b) => {
    const r = dens(b.ring);
    const hangs = lawnRings.some((lr) => {
      const n = r.filter((p) => ptInRing(p, lr)).length;
      return (n > 0 && n < r.length) || ringsCrossing(r, lr);
    });
    const overlaps = okBeds.some((o) => {
      const or = dens(o.ring);
      return r.some((p) => ptInRing(p, or)) || or.some((p) => ptInRing(p, r));
    });
    if (!hangs && !overlaps) okBeds.push(b);
  });
  beds.length = 0;
  okBeds.forEach((b) => beds.push(b));
  return {
    name:
      "yard " +
      (i + 1) +
      " (" +
      lawns
        .map((l) => l.kind + (l.mode === "spray" ? "/pop-ups" : ""))
        .join(", ") +
      (fences.length ? "; fences " + fences.map((f) => f.kind).join(",") : "") +
      ")",
    lawns,
    beds,
    fences,
    psi: pick([40, 45, 50, 55, 60, 70]),
    cap: pick([12, 12, 12, 18, 9]),
    water: pick(["culinary", "secondary"]),
  };
}

function ringsCrossing(a, b) {
  const cross = (p, q, r, s) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
    const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (cross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
        return true;
  return false;
}

/* ---------- the app's pipeline, mirrored ---------- */

function ptInRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      c = !c;
  }
  return c;
}
function dens(r) {
  const o = [];
  r.forEach((v, i) => {
    o.push({ x: v.x, y: v.y });
    E.arcPoints(v, r[(i + 1) % r.length], v.b || 0, 0.25).forEach((q) =>
      o.push(q),
    );
  });
  return o;
}
function segDist(a, b, p) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    L2 = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2),
  );
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
// beds are pulled off fences with E.offFence, the same call js/app.js makes
function buildAreas(y) {
  const fences = y.fences.map((f) => f.pts);
  const areas = [];
  y.lawns.forEach((l) => {
    E.splitByFences(l.ring, fences).forEach((piece) => {
      const slit = E.fenceSlits(piece, fences);
      const outer = slit.outer;
      const ring = dens(outer);
      const holes = y.beds
        .flatMap((b) => E.splitByFences(b.ring, fences))
        .map((h) => E.offFence(h, fences))
        .filter((h) => ptInRing(E.pointInside(h), ring));
      areas.push({ outer, holes: holes.concat(slit.holes), mode: l.mode });
    });
  });
  return areas;
}

/* ---------- independent checks ---------- */

function sectorPoints(h, step) {
  const out = [];
  const full = h.arc >= 359.5,
    a0 = full ? 0 : h.dir - h.arc / 2,
    span = full ? 360 : h.arc;
  const na = Math.max(8, Math.ceil(span / 0.75));
  for (let i = 0; i <= na; i++) {
    const a = ((a0 + (span * i) / na) * Math.PI) / 180;
    for (let f = step; f < h.r; f += step)
      out.push({ x: h.x + f * Math.cos(a), y: h.y + f * Math.sin(a) });
    out.push({ x: h.x + h.r * Math.cos(a), y: h.y + h.r * Math.sin(a) });
  }
  return out;
}

function check(y) {
  const bugs = [];
  const bug = (what) => bugs.push(what);
  const t0 = Date.now();
  let o, areas, drip, parts;
  try {
    areas = buildAreas(y);
    o = E.layoutJob({ areas, psi: y.psi, cap: y.cap, water: y.water });
    drip = E.dripPlan(y.beds.map((b, i) => ({ id: i, pts: b.ring })));
    parts = E.parts(o.heads, o.zones, drip, y.water);
  } catch (e) {
    bug("CRASH: " + e.message + " " + (e.stack || "").split("\n")[1]);
    return { bugs, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  if (ms > 8000) bug("SLOW: " + ms + " ms");

  // heads are numbers
  o.heads.forEach((h) => {
    if (![h.x, h.y, h.r, h.dir, h.arc, h.gpm].every(Number.isFinite))
      bug("NaN in a head " + JSON.stringify(h).slice(0, 120));
  });
  if (!o.heads.length && areas.length) bug("no heads at all");

  // independent overspray: past a straight edge 0.35 ft, past a curve 1.0 ft (nearest edge decides)
  areas.forEach((a, ai) => {
    const ring = dens(a.outer);
    const holes = a.holes.map(dens);
    const segs = [];
    const addSegs = (r, curveFlags) =>
      r.forEach((p, i) =>
        segs.push({ a: p, b: r[(i + 1) % r.length], curve: curveFlags[i] }),
      );
    // a densified point is on a curve if its source edge had a bulge
    const flags = (src) => {
      const f = [];
      src.forEach((v, i) => {
        const n =
          1 + E.arcPoints(v, src[(i + 1) % src.length], v.b || 0, 0.25).length;
        for (let k = 0; k < n; k++) f.push(Math.abs(v.b || 0) > 1e-6);
      });
      return f;
    };
    addSegs(ring, flags(a.outer));
    holes.forEach((h, k) => addSegs(h, flags(a.holes[k])));
    const inLawn = (p) =>
      ptInRing(p, ring) && !holes.some((h) => ptInRing(p, h));
    let worstS = 0,
      worstC = 0,
      who = "";
    o.heads
      .filter((h) => h.area === ai)
      .forEach((h) => {
        sectorPoints(h, 0.5).forEach((p) => {
          if (inLawn(p)) return;
          // past a curve when a curved edge is as close as any straight one (within 0.05 ft): where a
          // fence ends on a curved lawn edge, spray past that point lands past the curve
          let dC = Infinity,
            dS = Infinity;
          segs.forEach((s) => {
            const d = segDist(s.a, s.b, p);
            if (s.curve) dC = Math.min(dC, d);
            else dS = Math.min(dS, d);
          });
          const curve = dC <= dS + 0.05;
          const best = Math.min(dC, dS);
          if (curve) worstC = Math.max(worstC, best);
          else if (best > worstS) {
            worstS = best;
            who =
              " by " +
              h.label +
              " (" +
              h.role +
              ", r " +
              h.r.toFixed(1) +
              ", arc " +
              Math.round(h.arc) +
              ") at " +
              h.x.toFixed(1) +
              "," +
              h.y.toFixed(1);
          }
        });
        // heads ring a bed's edge on purpose; only one more than 0.3 ft inside counts
        if (
          a.holes.some((hh) => {
            const r = dens(hh);
            return (
              ptInRing(h, r) &&
              r.every((q, k) => segDist(q, r[(k + 1) % r.length], h) > 0.3)
            );
          })
        )
          bug(
            "head " +
              h.label +
              " inside a bed at " +
              h.x.toFixed(1) +
              "," +
              h.y.toFixed(1),
          );
      });
    if (worstS > 0.4)
      bug(
        "overspray " +
          worstS.toFixed(2) +
          " ft past a straight edge (area " +
          ai +
          ")" +
          who,
      );
    if (worstC > 1.05)
      bug(
        "overspray " + worstC.toFixed(2) + " ft past a curve (area " + ai + ")",
      );
  });

  // nothing sprays across a fence that splits a lawn (a fence that stops partway doesn't split
  // it, so that's tallied separately as a known gap)
  y.fences.forEach((f) => {
    o.heads.forEach((h) => {
      let worst = 0;
      sectorPoints(h, 1).forEach((p) => {
        for (let i = 0; i + 1 < f.pts.length; i++) {
          const A = f.pts[i],
            B = f.pts[i + 1];
          // does the segment head -> p cross the fence segment, more than 0.35 ft past it?
          const d1x = p.x - h.x,
            d1y = p.y - h.y,
            d2x = B.x - A.x,
            d2y = B.y - A.y;
          const den = d1x * d2y - d1y * d2x;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((A.x - h.x) * d2y - (A.y - h.y) * d2x) / den;
          const u = ((A.x - h.x) * d1y - (A.y - h.y) * d1x) / den;
          if (t > 0 && t < 1 && u > 0.001 && u < 0.999) {
            const past = (1 - t) * Math.hypot(d1x, d1y);
            const startOnFence = segDist(A, B, h) < 0.3;
            if (!startOnFence) worst = Math.max(worst, past);
          }
        }
      });
      if (worst > 0.4) {
        if (false) partway.n++;
        else
          bug(
            "head " +
              h.label +
              " at " +
              h.x.toFixed(1) +
              "," +
              h.y.toFixed(1) +
              " sprays " +
              worst.toFixed(1) +
              " ft across a " +
              f.kind +
              " fence",
          );
      }
    });
  });

  // coverage
  const cov = o.totals.coverage;
  // Zach accepts single coverage in strips a couple of feet wide (2026-11-10), which can pull a small
  // yard to about 98%, so flag below 98
  if (cov < 0.98) bug("coverage " + (cov * 100).toFixed(2) + "%");
  if (o.totals.overspray)
    bug("engine's own check flags " + o.totals.overspray + " overspray heads");

  // zones
  o.zones.forEach((z) => {
    if (z.gpm > y.cap + 1e-6)
      bug(
        "zone " +
          z.n +
          " is " +
          z.gpm.toFixed(1) +
          " GPM over the " +
          y.cap +
          " cap",
      );
    const fam = new Set(
      z.heads.map((h) => (h.kind === "R" ? "rotor" : "spray")),
    );
    if (fam.size > 1) bug("zone " + z.n + " mixes rotors and pop-ups");
    if (z.family === "rotor" && z.heads.length < 3)
      bug("rotor zone " + z.n + " has " + z.heads.length + " heads");
    const seen = new Set([z.heads[0]]),
      st = [z.heads[0]];
    while (st.length) {
      const u = st.pop();
      for (const v of z.heads)
        if (
          !seen.has(v) &&
          Math.hypot(u.x - v.x, u.y - v.y) <= Math.max(45, u.r + v.r)
        ) {
          seen.add(v);
          st.push(v);
        }
    }
    if (seen.size !== z.heads.length)
      bug("zone " + z.n + " is split across the yard");
  });
  const zoned = o.zones.reduce((a, z) => a + z.heads.length, 0);
  if (zoned !== o.heads.length)
    bug(o.heads.length - zoned + " heads not in any zone");

  // parts list math
  const q = (item) =>
    parts.lines.filter((l) => l.item === item).reduce((a, l) => a + l.qty, 0);
  const sprays = o.heads.filter((h) => h.kind !== "R").length;
  const r5 = o.heads.filter((h) => h.model === "5004").length,
    r3 = o.heads.filter((h) => h.model === "3504").length;
  if (q("1804 pop-up spray body") !== sprays)
    bug(
      "pop-up bodies " +
        q("1804 pop-up spray body") +
        " vs " +
        sprays +
        " pop-ups",
    );
  const noz = parts.lines
    .filter((l) => l.group === "Spray nozzles")
    .reduce((a, l) => a + l.qty, 0);
  if (noz !== sprays) bug("nozzles " + noz + " vs " + sprays + " pop-ups");
  if (q("5004 rotor") !== r5 || q("3504 rotor") !== r3) bug("rotor counts off");
  if (q('1/2" swing elbow') !== sprays + r3)
    bug("1/2 elbows " + q('1/2" swing elbow') + " vs " + (sprays + r3));
  if (q('3/4" swing elbow') !== r5) bug("3/4 elbows off");
  const swing = parts.lines.find((l) => /^Swing pipe/.test(l.item));
  if (
    o.heads.length &&
    (!swing || swing.qty !== Math.max(1, Math.ceil((o.heads.length * 3) / 100)))
  )
    bug("swing pipe rolls off");
  if (q("Zone valve") !== o.zones.length)
    bug("zone valves " + q("Zone valve") + " vs " + o.zones.length + " zones");
  if (q("Drip zone valve") !== drip.zones.length) bug("drip valves off");
  if (parts.stations !== o.zones.length + drip.zones.length)
    bug("controller stations off");
  if (parts.lines.some((l) => !(l.qty > 0)))
    bug(
      "a zero or bad qty line: " +
        JSON.stringify(parts.lines.find((l) => !(l.qty > 0))),
    );
  if (
    !parts.lines.some(
      (l) =>
        l.item === (y.water === "culinary" ? "Backflow setup" : "Filter setup"),
    )
  )
    bug("water connection part missing");

  // drip
  drip.zones.forEach((z) => {
    if (z.ft > 250) bug("drip zone " + z.n + " is " + z.ft + " ft");
  });
  if (drip.beds.some((b) => !b.zone)) bug("a bed with no drip zone");
  if (y.beds.length && drip.ft <= 0) bug("beds but no drip");
  if (drip.ft) {
    const per = Math.ceil(drip.ft / 100);
    if (q("Drip tee") !== 3 * per || q("Drip coupling") !== per)
      bug("drip fittings off");
    const rolled = parts.lines
      .filter((l) => /^Drip pipe, \d+ ft roll/.test(l.item))
      .reduce((a, l) => a + l.qty * +l.item.match(/(\d+) ft/)[1], 0);
    if (rolled < drip.ft)
      bug("drip rolls " + rolled + " ft short of " + drip.ft);
    if (rolled - drip.ft >= 100 && drip.ft > 0)
      bug("drip rolls leave " + (rolled - drip.ft) + " ft over");
  }

  return {
    bugs,
    ms,
    heads: o.heads.length,
    zones: o.zones.length,
    drip: drip.zones.length,
    cov,
  };
}

/* ---------- run ---------- */

const partway = { n: 0 };
let bad = 0;
const tally = {};
for (let i = 0; i < COUNT; i++) {
  const y = makeYard(i);
  // DUMP=n prints yard n's shapes and the lawn pieces after fences, for digging into one yard
  if (process.env.DUMP && +process.env.DUMP === i + 1) {
    console.log(JSON.stringify({ yard: y, areas: buildAreas(y) }));
    process.exit(0);
  }
  const r = check(y);
  const line =
    y.name.padEnd(70) +
    " " +
    String(r.ms).padStart(5) +
    " ms" +
    (r.heads != null
      ? "  heads " +
        r.heads +
        ", zones " +
        r.zones +
        ", drip " +
        r.drip +
        ", cov " +
        (r.cov * 100).toFixed(1) +
        "%"
      : "");
  if (r.bugs.length) {
    bad++;
    console.log("BUG  " + line);
    r.bugs.forEach((b) => {
      console.log("       - " + b);
      const key = b
        .replace(/[\d.]+/g, "#")
        .replace(/\(area #\)/, "")
        .slice(0, 60);
      tally[key] = (tally[key] || 0) + 1;
    });
  } else console.log("ok   " + line);
}
console.log("\n" + (COUNT - bad) + " of " + COUNT + " yards clean");
if (partway.n)
  console.log(
    "known gap: " +
      partway.n +
      " heads spray past a fence that stops partway into a lawn",
  );
Object.entries(tally)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, n]) => console.log(String(n).padStart(4) + "  " + k));
process.exit(bad ? 1 : 0);
