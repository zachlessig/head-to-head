/* Walk tracing (Zach 2026-11-13): the phone records a trail of GPS points as you walk the edge of a
   lawn or bed, and this turns that trail into a clean shape: straight edges where the edge is
   straight, smooth curves where it curves, and sharp corners where it turns.
   Points are in feet (x east, y north) and the trail is a closed loop. A point with corner:true was
   pinned by tapping Corner while standing on it; it always stays a corner, right where it was.
   Returns vertices [{x, y, b}], where b is the bulge of the edge to the next vertex in feet (positive
   bows to the left of the direction of travel), the same form the app's shapes use. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.H2HTrace = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STEP = 1; // resample every foot
  // These three are set for each walk from how far apart the fixes are and how shaky they were
  // (see fit()). Fixed values failed on simulated phone GPS: at 2 ft a 60x40 rectangle came back
  // with 14 to 25 corners, because one fix every 3 ft with 3 ft of jitter wanders more than that.
  let SMOOTH = 2; // ft, how much GPS jitter gets smoothed out
  let TOL = 2; // ft, how far the trail may wander from an edge and still count as that edge
  let TURN_SPAN = 4; // ft each side of a point used to measure how sharply the trail turns
  // Smoothing and tolerance as multiples of the measured jitter. Chosen from 1.5, 2 and 3 each on
  // the simulated walks in test/trace.test.js (2 and 2 had the fewest misses); not yet checked on
  // a real phone walk.
  const KS = 2;
  const KT = 2;
  const CORNER_DEG = 35; // a turn sharper than this over a few feet is a corner (guessed, tested in sim only)
  const SHARP_DEG = 60; // a turn this sharp at a found corner is a real corner (guessed, sim-tested)
  const MIN_EDGE = 2; // ft, shorter edges get folded into their neighbours
  const SNAP_FT = 8; // a corner moves at most this far to where its two straight edges meet

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const TAU = 2 * Math.PI;
  const mod = (a) => ((a % TAU) + TAU) % TAU;

  // Points a fixed distance apart, keeping every pinned corner exactly.
  function resample(raw) {
    const out = [];
    const n = raw.length;
    let carry = 0;
    for (let i = 0; i < n; i++) {
      const a = raw[i],
        b = raw[(i + 1) % n];
      if (a.corner) {
        out.push({ x: a.x, y: a.y, pin: true });
        carry = 0;
      } else if (i === 0) out.push({ x: a.x, y: a.y });
      const len = dist(a, b);
      let t = STEP - carry;
      while (t < len) {
        out.push({
          x: a.x + ((b.x - a.x) * t) / len,
          y: a.y + ((b.y - a.y) * t) / len,
        });
        t += STEP;
      }
      carry = len - (t - STEP);
    }
    return out;
  }

  // Gaussian smoothing around the loop. Pinned corners don't move, and smoothing never reaches
  // past one, so a corner you stood on stays sharp.
  function smooth(p) {
    const n = p.length;
    const k = Math.ceil((3 * SMOOTH) / STEP);
    const w = [];
    for (let j = 0; j <= k; j++)
      w.push(Math.exp(-((j * STEP) ** 2) / (2 * SMOOTH * SMOOTH)));
    return p.map((q, i) => {
      if (q.pin) return q;
      let sx = q.x * w[0],
        sy = q.y * w[0],
        sw = w[0];
      for (const dir of [1, -1]) {
        for (let j = 1; j <= k && j < n / 2; j++) {
          const r = p[(((i + dir * j) % n) + n) % n];
          sx += r.x * w[j];
          sy += r.y * w[j];
          sw += w[j];
          if (r.pin) break;
        }
      }
      return { x: sx / sw, y: sy / sw };
    });
  }

  // Signed turn at each point, measured over TURN_SPAN feet each way.
  function turns(p) {
    const n = p.length,
      w = Math.max(1, Math.round(TURN_SPAN / STEP));
    return p.map((q, i) => {
      const a = p[(i - w + n) % n],
        b = p[(i + w) % n];
      const t1 = Math.atan2(q.y - a.y, q.x - a.x),
        t2 = Math.atan2(b.y - q.y, b.x - q.x);
      let d = t2 - t1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    });
  }

  function findCorners(p) {
    const n = p.length;
    const t = turns(p);
    const w = Math.max(1, Math.round(TURN_SPAN / STEP));
    const lim = (CORNER_DEG * Math.PI) / 180;
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (p[i].pin) {
        idx.push(i);
        continue;
      }
      const a = Math.abs(t[i]);
      if (a < lim) continue;
      let peak = true;
      for (let j = 1; j <= w && peak; j++) {
        if (Math.abs(t[(i + j) % n]) > a || Math.abs(t[(i - j + n) % n]) >= a)
          peak = false;
      }
      if (peak) idx.push(i);
    }
    return idx;
  }

  // The arc from A to B with bulge b: its centre and radius (null when it's a straight line).
  function arcOf(A, B, b) {
    const dx = B.x - A.x,
      dy = B.y - A.y,
      c = Math.hypot(dx, dy);
    if (Math.abs(b) < 1e-6 || c < 1e-6) return null;
    const nl = { x: -dy / c, y: dx / c };
    const R = ((c * c) / 4 + b * b) / (2 * Math.abs(b));
    const s = Math.sign(b);
    const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const C = { x: M.x + nl.x * (b - s * R), y: M.y + nl.y * (b - s * R) };
    const P = { x: M.x + nl.x * b, y: M.y + nl.y * b };
    const tA = Math.atan2(A.y - C.y, A.x - C.x);
    let sweep = mod(Math.atan2(B.y - C.y, B.x - C.x) - tA);
    if (mod(Math.atan2(P.y - C.y, P.x - C.x) - tA) > sweep) sweep -= TAU;
    return { C, R, A, B, tA, sweep };
  }
  function lineDev(A, B, q) {
    const dx = B.x - A.x,
      dy = B.y - A.y,
      L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) return dist(A, q);
    let u = ((q.x - A.x) * dx + (q.y - A.y) * dy) / L2;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(A.x + u * dx - q.x, A.y + u * dy - q.y);
  }
  // Distance to the arc itself, not the whole circle: a point past either end measures to that end.
  // Measuring to the whole circle let a curve bowing the wrong way fit points on the far side of
  // its circle (a kidney lawn came back 16 ft off with perfect GPS, 2026-11-13).
  function arcDev(arc, q) {
    const t = mod(Math.atan2(q.y - arc.C.y, q.x - arc.C.x) - arc.tA);
    const within = arc.sweep >= 0 ? t <= arc.sweep : t >= TAU + arc.sweep || t === 0;
    if (within) return Math.abs(dist(arc.C, q) - arc.R);
    return Math.min(dist(arc.A, q), dist(arc.B, q));
  }


  // Best single edge through a run of points with fixed ends: a straight line if it fits, else the
  // curve that fits best. Returns {b, dev, at} (at = index of the worst point).
  // The bulge whose curve from A to B best follows the points between them.
  function bestBulge(A, B, pts) {
    const c = dist(A, B);
    const sse = (b) => {
      const arc = arcOf(A, B, b);
      let s = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = arc ? arcDev(arc, pts[i]) : lineDev(A, B, pts[i]);
        s += d * d;
      }
      return s;
    };
    const lo = -0.9 * c,
      hi = 0.9 * c,
      N = 60;
    let best = 0,
      bestS = sse(0);
    for (let k = 0; k <= N; k++) {
      const b = lo + ((hi - lo) * k) / N;
      const s = sse(b);
      if (s < bestS) ((bestS = s), (best = b));
    }
    // golden-section search around the best coarse value
    let a = Math.max(lo, best - (hi - lo) / N),
      z = Math.min(hi, best + (hi - lo) / N);
    const g = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 30; it++) {
      const m1 = z - g * (z - a),
        m2 = a + g * (z - a);
      if (sse(m1) < sse(m2)) z = m2;
      else a = m1;
    }
    return (a + z) / 2;
  }

  function fitEdge(pts) {
    const A = pts[0],
      B = pts[pts.length - 1];
    const c = dist(A, B);
    // Smoothing rounds the trail for a few feet either side of a corner, and the corner gets
    // rebuilt afterwards, so straight-or-curved is judged away from the ends. Judged end to end,
    // every edge of a perfectly walked rectangle came back slightly curved (2026-11-13).
    const e0 = Math.min(Math.ceil((2 * SMOOTH) / STEP), Math.floor(pts.length / 4));
    let dev = 0,
      at = 0;
    for (let i = 1 + e0; i < pts.length - 1 - e0; i++) {
      const d = lineDev(A, B, pts[i]);
      if (d > dev) ((dev = d), (at = i));
    }
    if (dev <= TOL || c < 1) return { b: 0, dev, at };
    const b = bestBulge(A, B, pts);
    const arc = arcOf(A, B, b);
    let adev = 0,
      aat = 0;
    for (let i = 1 + e0; i < pts.length - 1 - e0; i++) {
      const d = arc ? arcDev(arc, pts[i]) : lineDev(A, B, pts[i]);
      if (d > adev) ((adev = d), (aat = i));
    }
    return { b, dev: adev, at: aat };
  }

  // Edges for one run between two corners, split where a single edge can't follow the trail.
  function fitRun(pts, depth) {
    const f = fitEdge(pts);
    if (f.dev <= TOL || pts.length < 7 || depth > 12) return [{ pts, b: f.b }];
    const at = Math.max(3, Math.min(pts.length - 4, f.at));
    return fitRun(pts.slice(0, at + 1), depth + 1).concat(
      fitRun(pts.slice(at), depth + 1),
    );
  }

  // How sharply the trail turns from one edge into the next, in degrees, by their chords.
  function turnAt(e1, e2) {
    const a = e1.pts[0],
      b = e1.pts[e1.pts.length - 1],
      c = e2.pts[e2.pts.length - 1];
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    d = mod(d + Math.PI) - Math.PI;
    return (Math.abs(d) * 180) / Math.PI;
  }

  // Least-squares straight line through points: a point on it and its direction.
  function lsLine(pts) {
    let mx = 0,
      my = 0;
    pts.forEach((p) => ((mx += p.x), (my += p.y)));
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0,
      sxy = 0,
      syy = 0;
    pts.forEach((p) => {
      const dx = p.x - mx,
        dy = p.y - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    });
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { x: mx, y: my, dx: Math.cos(th), dy: Math.sin(th) };
  }
  function meet(l1, l2) {
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 0.17) return null; // under about 10 degrees apart: no clear corner
    const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den;
    return { x: l1.x + t * l1.dx, y: l1.y + t * l1.dy };
  }

  // Least-squares circle through points (Kasa fit): {cx, cy, r}, or null if they're in a line.
  function circleFit(pts) {
    if (pts.length < 3) return null;
    let mx = 0,
      my = 0;
    pts.forEach((p) => ((mx += p.x), (my += p.y)));
    mx /= pts.length;
    my /= pts.length;
    let suu = 0,
      svv = 0,
      suv = 0,
      suuu = 0,
      svvv = 0,
      suvv = 0,
      svuu = 0;
    pts.forEach((p) => {
      const u = p.x - mx,
        v = p.y - my;
      suu += u * u;
      svv += v * v;
      suv += u * v;
      suuu += u * u * u;
      svvv += v * v * v;
      suvv += u * v * v;
      svuu += v * u * u;
    });
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-9) return null;
    const r1 = 0.5 * (suuu + suvv),
      r2 = 0.5 * (svvv + svuu);
    const uc = (r1 * svv - r2 * suv) / det,
      vc = (r2 * suu - r1 * suv) / det;
    const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
    return { cx: uc + mx, cy: vc + my, r };
  }

  // Where two edges' lines or circles cross, nearest to the corner near: null when they barely
  // cross (under about 10 degrees), since then the corner can't be pinned down.
  function cross(c1, c2, near) {
    const pts = [];
    const isLine = (c) => c.dx !== undefined;
    const dirAt = (c, p) => (isLine(c) ? { x: c.dx, y: c.dy } : { x: -(p.y - c.cy) / c.r, y: (p.x - c.cx) / c.r });
    if (isLine(c1) && isLine(c2)) {
      const x = meet(c1, c2);
      return x;
    }
    if (isLine(c1) !== isLine(c2)) {
      const L = isLine(c1) ? c1 : c2,
        C = isLine(c1) ? c2 : c1;
      const fx = L.x - C.cx,
        fy = L.y - C.cy;
      const bq = fx * L.dx + fy * L.dy,
        cq = fx * fx + fy * fy - C.r * C.r;
      const disc = bq * bq - cq;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      [-bq - sq, -bq + sq].forEach((t) => pts.push({ x: L.x + t * L.dx, y: L.y + t * L.dy }));
    } else {
      const dx = c2.cx - c1.cx,
        dy = c2.cy - c1.cy,
        d = Math.hypot(dx, dy);
      if (d < 1e-9 || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return null;
      const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
      const mx = c1.cx + (a * dx) / d,
        my = c1.cy + (a * dy) / d;
      pts.push({ x: mx + (h * dy) / d, y: my - (h * dx) / d });
      pts.push({ x: mx - (h * dy) / d, y: my + (h * dx) / d });
    }
    if (!pts.length) return null;
    pts.sort((a, b) => dist(a, near) - dist(b, near));
    const x = pts[0];
    const d1 = dirAt(c1, x),
      d2 = dirAt(c2, x);
    if (Math.abs(d1.x * d2.y - d1.y * d2.x) < 0.17) return null;
    return x;
  }

  // Where the walk ends back at its start. People walk a few steps past where they began, stop
  // short, or pin the starting corner a second time, and each of those used to leave the shape
  // folding back on itself or a notch at the seam (review 2026-11-13: walking 10 ft past the start
  // of a 60x40 rectangle gave an edge doubling back; two pins of the same corner 2.5 ft apart gave
  // a notch). So cut the trail at the point in its last stretch closest to the start, and treat a
  // pin there as the same corner as the start.
  const SEAM_PIN_FT = 5; // two pins this close at the seam are the same corner (guessed)
  function closeSeam(clean) {
    const n = clean.length;
    let tot = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push((tot += dist(clean[i - 1], clean[i])));
    let best = n - 1,
      bestD = Infinity;
    for (let i = 1; i < n; i++) {
      if (cum[i] < 0.6 * tot) continue;
      const d = dist(clean[i], clean[0]);
      if (d < bestD) (bestD = d), (best = i);
    }
    // a pin just before or after the closest point is the corner the walk ended on
    for (let i = Math.max(1, best - 3); i < n; i++) {
      if (clean[i].corner && dist(clean[i], clean[0]) < SEAM_PIN_FT && cum[i] >= 0.6 * tot) {
        best = i;
        break;
      }
    }
    const end = clean[best];
    clean.splice(best + 1);
    if (dist(end, clean[0]) < SEAM_PIN_FT && (end.corner || clean[0].corner)) {
      // one corner: average two pins, or keep whichever one was pinned
      const a = clean[0];
      clean[0] =
        a.corner && end.corner
          ? { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2, corner: true }
          : a.corner
            ? a
            : end;
      clean.pop();
    } else if (dist(end, clean[0]) < 0.5) clean.pop();
  }

  function fit(raw) {
    // drop repeats, since standing still piles up points on one spot
    const clean = [];
    raw.forEach((p) => {
      const last = clean[clean.length - 1];
      if (!last || dist(last, p) >= 0.5)
        clean.push({ x: p.x, y: p.y, corner: !!p.corner });
      else if (p.corner)
        clean[clean.length - 1] = { x: p.x, y: p.y, corner: true };
    });
    if (clean.length < 3) return null;
    closeSeam(clean);
    if (clean.length < 3) return null;

    // How far apart the fixes are (about 3 ft walking with one fix a second) and how shaky they
    // are: each fix against the midpoint of its neighbours. For random jitter of s feet that
    // middle value comes out near 1.45 s; corners barely move the middle value.
    const nC = clean.length;
    const gaps = clean.map((q, i) => dist(q, clean[(i + 1) % nC])).sort((a, b) => a - b);
    const spacing = gaps[Math.floor(gaps.length / 2)];
    const offs = clean
      .map((q, i) => {
        const a = clean[(i - 1 + nC) % nC],
          b = clean[(i + 1) % nC];
        return Math.hypot(q.x - (a.x + b.x) / 2, q.y - (a.y + b.y) / 2);
      })
      .sort((a, b) => a - b);
    const jitter = offs[Math.floor(offs.length / 2)] / 1.45;
    SMOOTH = Math.max(1.5, Math.min(1.5 * spacing, KS * jitter));
    TURN_SPAN = Math.max(4, 2 * SMOOTH);
    TOL = Math.min(6, Math.max(1.5, KT * jitter));
    const p = smooth(resample(clean));
    const n = p.length;
    if (n < 8) return null;

    let cs = findCorners(p);
    // A smooth loop (a kidney lawn) still needs break points to hang its curves on.
    const want = 3;
    if (cs.length < want) {
      const extra = [];
      const start = cs.length ? cs[0] : 0;
      for (let k = 0; k < want; k++)
        extra.push((start + Math.round((n * (k + 1)) / (want + 1))) % n);
      cs = Array.from(new Set(cs.concat(extra))).sort((a, b) => a - b);
    }
    const hard = new Set(findCorners(p));

    // runs between corners, each fitted with as few edges as will follow it
    let edges = [];
    for (let k = 0; k < cs.length; k++) {
      const i0 = cs[k],
        i1 = cs[(k + 1) % cs.length];
      const run = [];
      for (let i = i0; ; i = (i + 1) % n) {
        run.push(p[i]);
        if (i === i1 && run.length > 1) break;
      }
      fitRun(run, 0).forEach((e, j) =>
        edges.push({
          pts: e.pts,
          b: e.b,
          hard: j === 0 && hard.has(i0),
          pin: j === 0 && !!p[i0].pin,
        }),
      );
    }

    // Join neighbours that make one good edge together (soft breaks and false corners).
    let changed = true;
    while (changed && edges.length > 3) {
      changed = false;
      let bestK = -1,
        bestDev = Infinity,
        bestB = 0;
      for (let k = 0; k < edges.length; k++) {
        const nx = edges[(k + 1) % edges.length];
        if (nx.pin) continue;
        // A real sharp corner never merges into a curve. Without this a walked 10x8 bed came back
        // as 3 corners and a curve with perfect GPS (review 2026-11-13); refusing every detected
        // corner instead broke the noisy L shape, so only turns over SHARP_DEG are kept.
        if (nx.hard && turnAt(edges[k], nx) > SHARP_DEG) continue;
        const pts = edges[k].pts.concat(nx.pts.slice(1));
        const f = fitEdge(pts);
        if (f.dev <= TOL && f.dev < bestDev)
          ((bestDev = f.dev), (bestK = k), (bestB = f.b));
      }
      if (bestK >= 0) {
        const k = bestK,
          k2 = (k + 1) % edges.length;
        const merged = {
          pts: edges[k].pts.concat(edges[k2].pts.slice(1)),
          b: bestB,
          hard: edges[k].hard,
          pin: edges[k].pin,
        };
        if (k2 === 0) {
          edges.splice(k, 1, merged);
          edges.shift();
        } else edges.splice(k, 2, merged);
        changed = true;
      }
    }

    // vertices: the start of each edge
    let verts = edges.map((e) => ({
      x: e.pts[0].x,
      y: e.pts[0].y,
      b: e.b,
      pin: e.pin,
      len: dist(e.pts[0], e.pts[e.pts.length - 1]),
    }));

    // Walking cuts corners and smoothing rounds them, so put each corner where its two edges,
    // extended, actually cross: straight or curved. A corner you pinned stays where you stood.
    // Only the line-line case did this at first, and a curve meeting a straight edge came back
    // 1.5 ft inside the true corner with perfect GPS (2026-11-13).
    const m = edges.length;
    const cut = Math.ceil((2 * SMOOTH) / STEP);
    const trim = (pts) => {
      const k = Math.min(cut, Math.floor(pts.length / 4));
      return pts.slice(k, pts.length - k);
    };
    const carriers = edges.map((e) => (e.b ? circleFit(trim(e.pts)) || lsLine(trim(e.pts)) : lsLine(trim(e.pts))));
    const reach = Math.max(SNAP_FT, 2 * SMOOTH);
    const moved = verts.map((v) => ({ x: v.x, y: v.y }));
    for (let k = 0; k < m; k++) {
      if (edges[k].pin) continue;
      const x = cross(carriers[(k - 1 + m) % m], carriers[k], verts[k]);
      if (x && dist(x, verts[k]) <= reach) moved[k] = x;
    }
    verts = verts.map((v, k) => {
      const nx = moved[(k + 1) % m];
      const b = v.b ? bestBulge(moved[k], nx, edges[k].pts) : 0;
      return { x: moved[k].x, y: moved[k].y, b, pin: v.pin };
    });

    // fold away tiny edges
    for (let guard = 0; guard < 50 && verts.length > 3; guard++) {
      const k = verts.findIndex(
        (v, i) => dist(v, verts[(i + 1) % verts.length]) < MIN_EDGE,
      );
      if (k < 0) break;
      const k2 = (k + 1) % verts.length;
      const drop = verts[k2].pin && !verts[k].pin ? k : k2;
      if (drop === k) verts[(k - 1 + verts.length) % verts.length].b = 0;
      verts.splice(drop, 1);
    }
    return verts.map((v) => ({
      x: v.x,
      y: v.y,
      b: Math.abs(v.b) < 0.3 ? 0 : v.b,
    }));
  }

  return { fit, TOL };
});
