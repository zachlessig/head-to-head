/*
 * Sprinkler layout engine. Pure math, no DOM: runs in the browser and in node tests.
 * Units are feet, x east, y north. Rules come from Zach's sprinkler-store method.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SprinklerEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Rain Bird chart, GPM at 30 PSI. design = the radius Zach draws (rated minus 1 or 2 ft).
  const FIXED = {
    5: { design: 4, F: 0.41, H: 0.2, Q: 0.1 },
    8: { design: 7, F: 1.05, H: 0.52, Q: 0.26 },
    10: { design: 9, F: 1.58, H: 0.79, Q: 0.39 },
    12: { design: 11, F: 2.6, H: 1.3, Q: 0.65 },
    15: { design: 13, F: 3.7, H: 1.85, Q: 0.92 },
  };
  const VAN = {
    4: { design: 3, 90: 0.29, 180: 0.45, 270: 0.73, 330: 0.88 },
    6: { design: 5, 90: 0.37, 180: 0.6, 270: 1.1, 330: 1.2 },
    8: { design: 7, 90: 0.72, 180: 1.19, 270: 1.55, 330: 1.7 },
    10: { design: 9, 90: 0.75, 180: 1.45, 270: 2.1, 330: 2.6 },
    12: { design: 11, 90: 0.65, 180: 1.3, 270: 1.95, 330: 2.6 },
    15: { design: 13, 90: 0.92, 180: 1.85, 270: 2.78, 330: 3.7 },
    18: { design: 16, 90: 1.33, 180: 2.66, 270: 3.99, 330: 5.32 },
  };
  const THROTTLE = 0.75; // a nozzle can be screwed down to 75% of its design radius
  // Zach 2026-11-06: 3504 throws 18 to 23 ft, 5004 throws 24 to 30 ft, either one dialed in with the
  // screw on top. Anything in that range is fair game; 23 to 24 ft falls between and drops to a 3504 at 23.
  const ROTOR = { min: 18, max3504: 23, split: 24, max: 30 };
  // Open ground at least 2 x ROTOR_RHO wide counts as rotor country. Guessed from Zach's 18 ft
  // minimum 3504 throw: a 24 ft strip still gets rotors head to head from both edges. Never measured.
  const ROTOR_RHO = 12;
  // Zach 2026-11-06: "in a situation where the distance only allows 2 rotors, go back to pop ups,
  // only use rotors if you can fit 3 or more in a zone"
  const MIN_ROTORS = 3;
  const TOL = 0.2; // ft. Closer than this to the boundary counts as on the line
  const BSTEP = 0.25; // boundary sample spacing
  const CURVE_OVER = 0.3; // ft a curve head may reach past a curved edge; verify() flags past 0.35
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  const FIXED_SERIES = Object.keys(FIXED)
    .map(Number)
    .sort((a, b) => a - b);
  const VAN_SERIES = Object.keys(VAN)
    .map(Number)
    .sort((a, b) => a - b);

  /* ---------------- nozzles ---------------- */

  function vanStep(arc) {
    return arc <= 90 ? 90 : arc <= 180 ? 180 : arc <= 270 ? 270 : 330; // always round UP
  }

  // Largest radius <= r this series family can throw, using the least-throttled series that reaches it.
  function pickSeries(table, seriesList, r) {
    let best = null;
    for (const s of seriesList) {
      const d = table[s].design;
      if (r + 1e-9 < THROTTLE * d) continue;
      const reach = Math.min(r, d);
      if (!best || reach > best.r + 1e-9) best = { s, r: reach };
    }
    return best;
  }

  // kind: Q | H | F | VAN | R. Returns {kind, series, model, r, gpm30, label} or null.
  function nozzle(kind, arc, r) {
    if (kind === "R") {
      if (r + 1e-9 < ROTOR.min) return null;
      let rr = Math.min(r, ROTOR.max);
      if (rr < ROTOR.split - 1e-9) rr = Math.min(rr, ROTOR.max3504);
      const model = rr >= ROTOR.split - 1e-9 ? "5004" : "3504";
      const gpm = Math.max(0.5, Math.round((arc / 90) * 2) / 2);
      return {
        kind: "R",
        model,
        series: null,
        r: rr,
        gpm,
        scales: false,
        label: (model === "5004" ? "R" : "S") + fmtNum(gpm),
      };
    }
    if (kind === "VAN") {
      const p = pickSeries(VAN, VAN_SERIES, r);
      if (!p) return null;
      const step = vanStep(arc);
      let g = VAN[p.s][step];
      if (arc > 330) g = (VAN[p.s][330] * arc) / 330;
      return {
        kind: "VAN",
        model: "1804",
        series: p.s,
        r: p.r,
        gpm: g,
        scales: true,
        label: p.s + "VAN",
      };
    }
    const p = pickSeries(FIXED, FIXED_SERIES, r);
    if (!p && (kind === "Q" || kind === "H"))
      return nozzle("VAN", kind === "Q" ? 90 : 180, r);
    if (!p) return null;
    return {
      kind,
      model: "1804",
      series: p.s,
      r: p.r,
      gpm: FIXED[p.s][kind],
      scales: true,
      label: p.s + kind,
    };
  }

  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function sprayKind(arc) {
    if (arc >= 83 && arc <= 91) return "Q";
    if (arc >= 175 && arc <= 181) return "H";
    return "VAN";
  }

  /* ---------------- geometry ---------------- */

  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  // Ring vertices carry b = bulge (sagitta, ft) of the edge to the next vertex, positive = left of travel.
  function orient(verts, ccw) {
    const v = verts.map((p) => ({ x: p.x, y: p.y, b: p.b || 0 }));
    if (signedArea(v) > 0 === ccw) return v;
    const n = v.length,
      out = [];
    for (let j = 0; j < n; j++) {
      const src = v[n - 1 - j];
      const e = (((n - 2 - j) % n) + n) % n;
      out.push({ x: src.x, y: src.y, b: -v[e].b });
    }
    return out;
  }

  // Points strictly between A and B along a circular arc with sagitta b.
  function arcPoints(A, B, b, step) {
    const dx = B.x - A.x,
      dy = B.y - A.y,
      c = Math.hypot(dx, dy);
    if (Math.abs(b) < 0.05 || c < 1e-6) return [];
    const nl = { x: -dy / c, y: dx / c };
    const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const R = ((c * c) / 4 + b * b) / (2 * Math.abs(b));
    const s = Math.sign(b);
    const C = { x: M.x + nl.x * (b - s * R), y: M.y + nl.y * (b - s * R) };
    const P = { x: M.x + nl.x * b, y: M.y + nl.y * b };
    const mod = (a) => ((a % TAU) + TAU) % TAU;
    const tA = Math.atan2(A.y - C.y, A.x - C.x),
      tB = Math.atan2(B.y - C.y, B.x - C.x),
      tP = Math.atan2(P.y - C.y, P.x - C.x);
    let sweep = mod(tB - tA);
    if (mod(tP - tA) > sweep) sweep -= TAU;
    const n = Math.max(2, Math.ceil((Math.abs(sweep) * R) / step));
    const out = [];
    for (let i = 1; i < n; i++) {
      const t = tA + (sweep * i) / n;
      out.push({ x: C.x + R * Math.cos(t), y: C.y + R * Math.sin(t) });
    }
    return out;
  }

  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  // Build the working geometry for one lawn: rings, segments, spatial bins, boundary samples, sides.
  function prepare(area) {
    const raw = [orient(area.outer, true)].concat(
      (area.holes || []).map((h) => orient(h, false)),
    );
    const rings = raw.map((ring) => {
      const pts = [];
      ring.forEach((v, i) => {
        const nx = ring[(i + 1) % ring.length];
        pts.push({ x: v.x, y: v.y, vertex: true });
        arcPoints(v, nx, v.b, 1.0).forEach((p) =>
          pts.push({ x: p.x, y: p.y, vertex: false }),
        );
      });
      return pts;
    });

    const segs = [];
    rings.forEach((pts) => {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length];
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, curve: !a.vertex || !b.vertex });
      }
    });

    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    segs.forEach((s) => {
      x0 = Math.min(x0, s.ax);
      x1 = Math.max(x1, s.ax);
      y0 = Math.min(y0, s.ay);
      y1 = Math.max(y1, s.ay);
    });
    const G = { x0, y0, x1, y1, rings, segs };

    // y-bands for fast point-in-lawn; square bins for nearest-boundary queries
    G.band = 2;
    G.bands = new Map();
    segs.forEach((s, i) => {
      const lo = Math.floor(Math.min(s.ay, s.by) / G.band),
        hi = Math.floor(Math.max(s.ay, s.by) / G.band);
      for (let k = lo; k <= hi; k++) {
        if (!G.bands.has(k)) G.bands.set(k, []);
        G.bands.get(k).push(i);
      }
    });

    // boundary samples every BSTEP ft, tagged with ring, side and corner flags
    const bs = [];
    G.ringSamples = rings.map((pts, ri) => {
      const list = [];
      // corner test on densified vertices: true vertex whose turn is more than 5 degrees off straight
      const n = pts.length;
      const isCorner = pts.map((p, i) => {
        if (!p.vertex) return false;
        const ang = interiorAngle(pts[(i - 1 + n) % n], p, pts[(i + 1) % n]);
        return Math.abs(ang - 180) > 5;
      });
      for (let i = 0; i < n; i++) {
        const a = pts[i],
          b = pts[(i + 1) % n];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const k = Math.max(1, Math.ceil(len / BSTEP));
        const nx = -(b.y - a.y) / (len || 1),
          ny = (b.x - a.x) / (len || 1);
        for (let j = 0; j < k; j++) {
          const t = j / k;
          const smp = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            ring: ri,
            idx: list.length,
            corner: j === 0 && isCorner[i],
            nx,
            ny,
            prev: pts[(i - 1 + n) % n],
            next: b,
            at: j === 0 ? a : null,
          };
          list.push(smp);
        }
      }
      // sides run corner to corner
      const cornersIdx = list.filter((s) => s.corner).map((s) => s.idx);
      let side = cornersIdx.length ? -1 : 0;
      if (cornersIdx.length) {
        // start labelling at the first corner, wrap around
        const start = cornersIdx[0];
        let sid = -1;
        for (let m = 0; m < list.length; m++) {
          const s = list[(start + m) % list.length];
          if (s.corner) sid++;
          s.side = sid;
        }
      } else list.forEach((s) => (s.side = side));
      list.corners = cornersIdx;
      list.sideCount = Math.max(1, cornersIdx.length);
      list.forEach((s) => bs.push(s));
      return list;
    });
    G.bsamples = bs;
    G.bbin = 4;
    G.bbins = new Map();
    bs.forEach((s, i) => {
      const key = binKey(Math.floor(s.x / G.bbin), Math.floor(s.y / G.bbin));
      if (!G.bbins.has(key)) G.bbins.set(key, []);
      G.bbins.get(key).push(i);
    });
    G.sbin = 6;
    G.sbins = new Map();
    segs.forEach((s, i) => {
      const bx0 = Math.floor(Math.min(s.ax, s.bx) / G.sbin),
        bx1 = Math.floor(Math.max(s.ax, s.bx) / G.sbin);
      const by0 = Math.floor(Math.min(s.ay, s.by) / G.sbin),
        by1 = Math.floor(Math.max(s.ay, s.by) / G.sbin);
      for (let a = bx0; a <= bx1; a++)
        for (let b = by0; b <= by1; b++) {
          const key = binKey(a, b);
          if (!G.sbins.has(key)) G.sbins.set(key, []);
          G.sbins.get(key).push(i);
        }
    });
    G.area = rings.reduce(
      (acc, pts, i) => acc + (i === 0 ? 1 : 1) * signedArea(pts),
      0,
    );
    return G;
  }

  function binKey(a, b) {
    return a * 100003 + b;
  }

  // Interior angle (deg) at p, lawn on the left of travel prev -> p -> next.
  function interiorAngle(prev, p, next) {
    const a1 = Math.atan2(prev.y - p.y, prev.x - p.x);
    const a2 = Math.atan2(next.y - p.y, next.x - p.x);
    let d = (a1 - a2) % TAU;
    if (d < 0) d += TAU;
    return d / DEG;
  }

  function inLawn(G, x, y) {
    const list = G.bands.get(Math.floor(y / G.band));
    if (!list) return false;
    let c = false;
    for (const i of list) {
      const s = G.segs[i];
      if (s.ay > y !== s.by > y) {
        const xi = s.ax + ((y - s.ay) * (s.bx - s.ax)) / (s.by - s.ay);
        if (x < xi) c = !c;
      }
    }
    return c;
  }

  function segDist(s, x, y) {
    const dx = s.bx - s.ax,
      dy = s.by - s.ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - s.ax) * dx + (y - s.ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy));
  }

  // Distance from a point to the nearest boundary line. Searches outward ring by ring of bins.
  function distB(G, x, y) {
    const bx = Math.floor(x / G.sbin),
      by = Math.floor(y / G.sbin);
    let best = Infinity;
    const maxRing = Math.ceil(Math.max(G.x1 - G.x0, G.y1 - G.y0) / G.sbin) + 2;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best < (ring - 1) * G.sbin) break;
      for (let a = bx - ring; a <= bx + ring; a++)
        for (let b = by - ring; b <= by + ring; b++) {
          if (Math.max(Math.abs(a - bx), Math.abs(b - by)) !== ring) continue;
          const list = G.sbins.get(binKey(a, b));
          if (!list) continue;
          for (const i of list) {
            const d = segDist(G.segs[i], x, y);
            if (d < best) best = d;
          }
        }
    }
    return best;
  }

  // Is a curved stretch of edge within rad of this point?
  function nearCurve(G, x, y, rad) {
    const a0 = Math.floor((x - rad) / G.sbin), a1 = Math.floor((x + rad) / G.sbin);
    const b0 = Math.floor((y - rad) / G.sbin), b1 = Math.floor((y + rad) / G.sbin);
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++) {
        const list = G.sbins.get(binKey(a, b));
        if (list) for (const i of list) if (G.segs[i].curve && segDist(G.segs[i], x, y) <= rad) return true;
      }
    return false;
  }

  function boundaryNear(G, x, y, r, fn) {
    const b0x = Math.floor((x - r) / G.bbin),
      b1x = Math.floor((x + r) / G.bbin);
    const b0y = Math.floor((y - r) / G.bbin),
      b1y = Math.floor((y + r) / G.bbin);
    for (let a = b0x; a <= b1x; a++)
      for (let b = b0y; b <= b1y; b++) {
        const list = G.bbins.get(binKey(a, b));
        if (list) for (const i of list) fn(G.bsamples[i], i);
      }
  }

  /* ---------------- fitting a head on the boundary ---------------- */

  // Walk along the ring from sample i in direction dir, staying on allowed sides and within r.
  function walkLocal(G, list, i, dir, sideOk, r, p, mark, stamp, out) {
    const n = list.length;
    let j = i;
    for (let step = 0; step < n; step++) {
      j = (j + dir + n) % n;
      if (j === i) break;
      const s = list[j];
      const onSide = sideOk(s, dir);
      if (!onSide) break;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > r) break;
      s._stamp = stamp;
      out.push(s);
      if (s.corner && s.idx !== list[i].idx) break; // stop at the far corner, inclusive
    }
  }

  let STAMP = 1;

  // Given a boundary sample, find the biggest head that sits there without spraying outside the lawn.
  function fitBoundary(G, smp, isCorner, family, rMax) {
    const list = G.ringSamples[smp.ring];
    const n = list.length;
    const p = { x: smp.x, y: smp.y };
    let thetaN;
    if (isCorner) {
      const ang = interiorAngle(smp.prev, p, smp.next);
      thetaN = Math.atan2(smp.next.y - p.y, smp.next.x - p.x) + (ang * DEG) / 2;
    } else thetaN = Math.atan2(smp.ny, smp.nx);
    const mySide = smp.side;
    const prevSide = (mySide - 1 + list.sideCount) % list.sideCount;
    const single = list.corners.length === 0;
    let r = rMax;
    for (let iter = 0; iter < 80; iter++) {
      const stamp = ++STAMP;
      smp._stamp = stamp;
      const fwd = [],
        back = [];
      // forward: stay on my side (a corner sample starts my side, so the far corner ends it)
      walkLocal(
        G,
        list,
        smp.idx,
        +1,
        (s) => single || s.side === mySide || s.corner,
        r,
        p,
        null,
        stamp,
        fwd,
      );
      // backward: corners look back along the previous side, edge heads along their own
      const backSide = isCorner ? prevSide : mySide;
      walkLocal(
        G,
        list,
        smp.idx,
        -1,
        (s) => single || s.side === backSide || s.corner,
        r,
        p,
        null,
        stamp,
        back,
      );
      let phiR = -Math.PI,
        phiL = Math.PI;
      for (const s of fwd) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < 0.05) continue;
        const phi = wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN);
        if (phi > phiR) phiR = phi;
      }
      for (const s of back) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < 0.05) continue;
        const phi = wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN);
        if (phi < phiL) phiL = phi;
      }
      // On a curve the arc is bounded by chords, and the boundary bows past each chord, leaving a
      // dry lens between neighbouring heads (2.7 ft deep for a 25 ft rotor on a 30 ft radius curve,
      // first test on a real traced yard). Let curve heads reach up to CURVE_OVER past the line,
      // the same small allowance Zach gives VANs on curves. Straight edges stay exactly 180.
      const curved =
        !isCorner &&
        (Math.abs(phiR + Math.PI / 2) > DEG ||
          Math.abs(phiL - Math.PI / 2) > DEG);
      if (curved) {
        phiR = -Math.PI;
        phiL = Math.PI;
        for (const s of fwd) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d < 0.05) continue;
          const phi =
            wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN) -
            Math.asin(Math.min(1, CURVE_OVER / d));
          if (phi > phiR) phiR = phi;
        }
        for (const s of back) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d < 0.05) continue;
          const phi =
            wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN) +
            Math.asin(Math.min(1, CURVE_OVER / d));
          if (phi < phiL) phiL = phi;
        }
      }
      if (!fwd.length) phiR = -Math.PI / 2;
      if (!back.length) phiL = Math.PI / 2;
      if (phiL - phiR < 10 * DEG) return null;
      // anything else on the boundary that pokes into this wedge closer than r limits the radius
      let dmin = Infinity;
      const margin = 0.25 * DEG;
      boundaryNear(G, p.x, p.y, r + 0.5, (s) => {
        if (s._stamp === stamp) return;
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d <= TOL || d >= dmin) return;
        const phi = wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN);
        if (phi > phiR + margin && phi < phiL - margin) dmin = d;
      });
      if (dmin < r - 1e-6) {
        r = dmin - 0.01;
        if (r < 2.2) return null;
        continue;
      }
      const arc = (phiL - phiR) / DEG;
      const dir = thetaN + (phiR + phiL) / 2;
      let kind = family === "rotor" ? "R" : sprayKind(arc);
      let useArc = arc;
      if (kind === "VAN" && arc > 330) useArc = 330;
      const nz = nozzle(kind, useArc, r);
      if (!nz) return null;
      if (nz.r < r - 1e-6) {
        r = nz.r;
        continue;
      }
      return makeHead(
        p.x,
        p.y,
        nz,
        dir / DEG,
        useArc,
        isCorner ? "corner" : "edge",
      );
    }
    return null;
  }

  function makeHead(x, y, nz, dirDeg, arc, role) {
    return {
      x,
      y,
      r: nz.r,
      dir: ((dirDeg % 360) + 360) % 360,
      arc,
      role,
      kind: nz.kind,
      model: nz.model,
      series: nz.series,
      label: nz.label,
      gpmBase: nz.gpm,
      scales: nz.scales,
    };
  }

  function covers(h, x, y) {
    const dx = x - h.x,
      dy = y - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > h.r * h.r + 1e-6) return false;
    if (h.arc >= 359.5 || d2 < 1e-8) return true;
    const a = Math.atan2(dy, dx) / DEG;
    let diff = Math.abs(((((a - h.dir) % 360) + 540) % 360) - 180);
    return diff <= h.arc / 2 + 1e-6;
  }

  /* ---------------- greedy placement ---------------- */

  function Heap(cmp) {
    const a = [];
    return {
      size: () => a.length,
      peek: () => a[0],
      push(v) {
        a.push(v);
        let i = a.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (cmp(a[i], a[p]) <= 0) break;
          [a[i], a[p]] = [a[p], a[i]];
          i = p;
        }
      },
      pop() {
        const top = a[0],
          last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1,
              r = l + 1;
            let m = i;
            if (l < a.length && cmp(a[l], a[m]) > 0) m = l;
            if (r < a.length && cmp(a[r], a[m]) > 0) m = r;
            if (m === i) break;
            [a[i], a[m]] = [a[m], a[i]];
            i = m;
          }
        }
        return top;
      },
    };
  }

  // Lazy greedy set cover toward "every sample hit by two heads".
  function greedy(cands, S, cov, target, minGain, heads, maxHeads) {
    const reach = (c) => {
      if (c._reach) return c._reach;
      const out = [];
      S.near(c.head.x, c.head.y, c.head.r, (k) => {
        if (covers(c.head, S.x[k], S.y[k])) out.push(k);
      });
      c._reach = Int32Array.from(out);
      return c._reach;
    };
    const gain = (c) => {
      let g = 0;
      for (const k of reach(c)) if (target[k] && cov[k] < 2) g++;
      return g + 0.001 * c.head.r;
    };
    const heap = Heap((a, b) => a.g - b.g);
    cands.forEach((c) => {
      const g = gain(c);
      if (g >= minGain) heap.push({ c, g });
    });
    while (heap.size() && heads.length < maxHeads) {
      const top = heap.pop();
      // two heads a couple of feet apart is never a real layout: the first test render
      // stacked 15H pairs along edges because each one added a sliver of coverage
      const h0 = top.c.head;
      if (
        heads.some(
          (h) => Math.hypot(h.x - h0.x, h.y - h0.y) < 0.5 * Math.min(h.r, h0.r),
        )
      )
        continue;
      const g = gain(top.c);
      if (g < minGain) continue;
      if (heap.size() && g < heap.peek().g - 1e-9) {
        heap.push({ c: top.c, g });
        continue;
      }
      heads.push(top.c.head);
      for (const k of reach(top.c)) cov[k]++;
    }
  }

  function sampleGrid(G, step) {
    const xs = [],
      ys = [],
      db = [];
    for (let x = G.x0 + step / 2; x < G.x1; x += step) {
      for (let y = G.y0 + step / 2; y < G.y1; y += step) {
        if (!inLawn(G, x, y)) continue;
        const d = distB(G, x, y);
        if (d < 0.4) continue; // the last few inches at the edge are covered by overspray, per Zach
        xs.push(x);
        ys.push(y);
        db.push(d);
      }
    }
    const S = {
      x: Float64Array.from(xs),
      y: Float64Array.from(ys),
      d: Float64Array.from(db),
      n: xs.length,
      step,
      bin: 4,
      bins: new Map(),
    };
    for (let k = 0; k < S.n; k++) {
      const key = binKey(
        Math.floor(S.x[k] / S.bin),
        Math.floor(S.y[k] / S.bin),
      );
      if (!S.bins.has(key)) S.bins.set(key, []);
      S.bins.get(key).push(k);
    }
    S.near = (x, y, r, fn) => {
      const a0 = Math.floor((x - r) / S.bin),
        a1 = Math.floor((x + r) / S.bin);
      const b0 = Math.floor((y - r) / S.bin),
        b1 = Math.floor((y + r) / S.bin);
      for (let a = a0; a <= a1; a++)
        for (let b = b0; b <= b1; b++) {
          const list = S.bins.get(binKey(a, b));
          if (list) for (const k of list) fn(k);
        }
    };
    return S;
  }

  // ctx (optional) shares one sample grid between a rotor pass and a pop-up pass on the same lawn:
  // {S, cov, heads, target}. target marks the samples this pass is responsible for.
  function layoutArea(G, family, ctx) {
    const spray = family === "spray";
    const maxR = spray ? 16 : ROTOR.max;
    const gS = ctx ? ctx.S.step : spray ? 1 : 2; // coverage sample spacing
    const S = ctx ? ctx.S : sampleGrid(G, gS);
    const cov = ctx ? ctx.cov : new Int32Array(S.n);
    const heads = ctx ? ctx.heads : [];
    const target = ctx && ctx.target ? ctx.target : new Uint8Array(S.n).fill(1);
    const issues = [];
    const mark = (h) =>
      S.near(h.x, h.y, h.r, (k) => {
        if (covers(h, S.x[k], S.y[k])) cov[k]++;
      });
    // how many samples this pass still owes coverage to, near a spot
    const needNear = (x, y, rad) => {
      let n = 0;
      S.near(x, y, rad, (k) => {
        if (target[k] && cov[k] < 2 && Math.hypot(S.x[k] - x, S.y[k] - y) <= rad) n++;
      });
      return n;
    };

    // 1. corners first (skipped where another pass already handled the corner)
    G.ringSamples.forEach((list) => {
      list.corners.forEach((ci) => {
        const c = list[ci];
        if (ctx && (heads.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < 0.5) || needNear(c.x, c.y, 4) === 0)) return;
        const h = fitBoundary(G, c, true, family, maxR);
        if (h) {
          heads.push(h);
          mark(h);
        } else if (spray) issues.push({ type: "corner", x: c.x, y: c.y });
      });
    });

    // 2. the perimeter: heads sitting on the edge lines, until the strip along the edge is double covered
    const stripW = spray ? 2.5 : 4;
    const strip = new Uint8Array(S.n);
    for (let k = 0; k < S.n; k++) strip[k] = target[k] && S.d[k] <= stripW ? 1 : 0;
    const edgeCands = [];
    const every = spray ? 2 : 4; // every 0.5 ft for sprays, 1 ft for rotors
    G.ringSamples.forEach((list) => {
      for (let i = 0; i < list.length; i += every) {
        const s = list[i];
        if (s.corner) continue;
        const h = fitBoundary(G, s, false, family, maxR);
        if (h) edgeCands.push({ head: h });
      }
    });
    // straight sides first, the way it's drawn on paper: evenly spaced, head to head, corner to corner
    G.ringSamples.forEach((list) => {
      if (!list.corners.length) return;
      list.corners.forEach((ci, n0) => {
        const cj = list.corners[(n0 + 1) % list.corners.length];
        const side = [];
        for (let m = ci; ; m = (m + 1) % list.length) {
          side.push(list[m]);
          if (m === cj && side.length > 1) break;
        }
        const straight =
          side
            .slice(0, -1)
            .every(
              (s) =>
                Math.abs(s.nx - side[0].nx) < 1e-6 &&
                Math.abs(s.ny - side[0].ny) < 1e-6,
            ) || side.length < 3;
        if (!straight) return;
        const A = side[0],
          B = side[side.length - 1];
        const L = Math.hypot(B.x - A.x, B.y - A.y);
        const cornerR = heads
          .filter(
            (h) =>
              h.role === "corner" &&
              (Math.hypot(h.x - A.x, h.y - A.y) < 0.01 ||
                Math.hypot(h.x - B.x, h.y - B.y) < 0.01),
          )
          .map((h) => h.r);
        if (cornerR.length === 2 && Math.min(...cornerR) >= L - 0.01) return; // the two corners already cover each other
        if (ctx) {
          // in a mixed lawn, only space heads down a side this pass actually owns
          let owed = 0, near = 0;
          for (let m = 0; m < side.length; m += 8) {
            const q = side[m];
            S.near(q.x, q.y, 2.5, (k) => {
              if (Math.hypot(S.x[k] - q.x, S.y[k] - q.y) > 2.5) return;
              near++;
              if (target[k] && cov[k] < 2) owed++;
            });
          }
          if (!near || owed < 0.7 * near) return;
        }
        const edgeMax = spray ? 13 : ROTOR.max;
        for (
          let n = Math.max(2, Math.ceil(L / edgeMax));
          // only one extra head of slack: past that the side runs into a sharp corner and a
          // row of tiny evenly spaced heads (8H down a whole side in the first render) is worse
          n <= Math.max(2, Math.ceil(L / edgeMax)) + 1;
          n++
        ) {
          const sp = L / n;
          if (!spray && sp > ROTOR.max) continue;
          const placed = [];
          let ok = true;
          for (let i = 1; i < n; i++) {
            const t = (i * sp) / L;
            const smp = side[Math.round(t * (side.length - 1))];
            const h = fitBoundary(
              G,
              smp,
              false,
              family,
              Math.min(edgeMax, sp + 0.5),
            );
            if (!h || h.r < sp - 0.05) {
              ok = false;
              break;
            }
            placed.push(h);
          }
          if (!ok) {
            if (!spray) break;
            continue;
          }
          placed.forEach((h) => {
            heads.push(h);
            mark(h);
          });
          break;
        }
      });
    });
    greedy(edgeCands, S, cov, strip, 1, heads, 400);

    // 3. the middle: full circles only, as few and as big as fit without reaching the boundary
    const all = target;
    const midCands = [];
    const gI = spray ? 1 : 2;
    for (let x = G.x0 + gI / 2; x < G.x1; x += gI) {
      for (let y = G.y0 + gI / 2; y < G.y1; y += gI) {
        if (!inLawn(G, x, y)) continue;
        const room = Math.min(distB(G, x, y) - 0.02, maxR);
        const nz = spray
          ? nozzle("F", 360, Math.min(room, 13))
          : nozzle("R", 360, room);
        if (!nz) continue;
        midCands.push({ head: makeHead(x, y, nz, 0, 360, "interior") });
      }
    }
    const minGain = spray ? 3 : 2; // don't add a head for a sliver a neighbour's overspray already hits
    greedy(midCands, S, cov, all, minGain, heads, 600);

    // 4. patch any leftovers with whichever head helps most
    greedy(edgeCands.concat(midCands), S, cov, all, minGain, heads, 600);

    let gaps = 0;
    const gapPts = [];
    let owned = 0;
    for (let k = 0; k < S.n; k++) {
      if (!target[k]) continue;
      owned++;
      if (cov[k] < 2) {
        gaps++;
        gapPts.push({ x: S.x[k], y: S.y[k], c: cov[k] });
      }
    }
    return { heads, samples: owned, gaps, gapPts, issues, sampleStep: gS };
  }

  // Samples sitting in ground open enough for rotors: inside some circle of ROTOR_RHO radius that
  // fits in the lawn. Narrow side strips and tight corners fall outside and get pop-ups.
  // Returns R (rotor ground, reaching into corners) and R.core (just the open circles).
  function rotorRegion(G, S) {
    const R = new Uint8Array(S.n);
    const core = new Uint8Array(S.n);
    for (let x = G.x0 + 1; x < G.x1; x += 2)
      for (let y = G.y0 + 1; y < G.y1; y += 2) {
        if (!inLawn(G, x, y) || distB(G, x, y) < ROTOR_RHO) continue;
        // reach a little past the open circle so the corners of an open lawn stay rotor ground;
        // without this the first mixed render put 15H pop-ups in every rotor corner
        const reach = ROTOR_RHO + 6;
        S.near(x, y, reach, (k) => {
          const d = Math.hypot(S.x[k] - x, S.y[k] - y);
          if (d <= reach) R[k] = 1;
          if (d <= ROTOR_RHO) core[k] = 1;
        });
      }
    R.core = core;
    return R;
  }

  // Rotors where the lawn opens up, pop-ups everywhere else. An open patch that can't hold
  // MIN_ROTORS rotors goes back to pop-ups (Zach, 2026-11-06).
  function layoutMixed(G) {
    const S = sampleGrid(G, 1);
    const cov = new Int32Array(S.n);
    const heads = [];
    const R = rotorRegion(G, S);
    let rotors = 0, dropped = 0;
    if (R.some((v) => v)) {
      layoutArea(G, "rotor", { S, cov, heads, target: R });
      // group rotors whose throws touch; each group is one open patch
      const seen = new Set();
      const groups = [];
      heads.forEach((h) => {
        if (seen.has(h)) return;
        const g = [], stack = [h];
        seen.add(h);
        while (stack.length) {
          const u = stack.pop();
          g.push(u);
          heads.forEach((v) => {
            if (!seen.has(v) && Math.hypot(u.x - v.x, u.y - v.y) < (u.r + v.r) * 0.95) {
              seen.add(v);
              stack.push(v);
            }
          });
        }
        groups.push(g);
      });
      // each rotor patch owns the rotor ground nearest to it; a patch whose rotors leave more than
      // 1% of that ground thin goes to pop-ups (a 35x34 pentagon came out 85% covered on 5 rotors)
      const owned = groups.map(() => ({ n: 0, thin: 0 }));
      // thin ground along a curve is VAN ground (Zach: curves get VANs), so it doesn't count against rotors
      const curveStrip = new Uint8Array(S.n);
      for (let k = 0; k < S.n; k++) if (R[k] && S.d[k] <= 5 && nearCurve(G, S.x[k], S.y[k], 5)) curveStrip[k] = 1;
      R.curveStrip = curveStrip;
      for (let k = 0; k < S.n; k++) {
        if (!R.core[k] || curveStrip[k]) continue;
        let gi = -1, bd = Infinity;
        groups.forEach((g, i) => g.forEach((h) => {
          const d = Math.hypot(h.x - S.x[k], h.y - S.y[k]);
          if (d < bd) { bd = d; gi = i; }
        }));
        if (gi < 0) continue;
        owned[gi].n++;
        if (cov[k] < 2) owned[gi].thin++;
      }
      groups.forEach((g, gi) => {
        // 3% of the open core: the 35x34 pentagon left 15% thin, good rotor lawns under 0.5%
        const poor = owned[gi].n && owned[gi].thin / owned[gi].n > 0.03;
        if (g.length >= MIN_ROTORS && !poor) return;
        g.forEach((h) => {
          heads.splice(heads.indexOf(h), 1);
          S.near(h.x, h.y, h.r, (k) => {
            if (covers(h, S.x[k], S.y[k])) cov[k]--;
          });
          dropped++;
        });
      });
      rotors = heads.length;
    }
    // pop-ups own the narrow ground, plus any rotor ground left bone dry. A rotor spot hit once is
    // left as a thin spot: the first mixed render sprinkled 15H patches down rotor edges otherwise
    const own = new Uint8Array(S.n);
    // ground whose rotors were all dropped is pop-up ground again
    const rotorsLeft = heads.length > 0;
    // the fringe where rotor ground meets narrow ground also goes to pop-ups where it's thin
    for (let k = 0; k < S.n; k++)
      own[k] = !R[k] || cov[k] === 0 || !rotorsLeft || (cov[k] < 2 && (!R.core[k] || (R.curveStrip && R.curveStrip[k]))) ? 1 : 0;
    const res = layoutArea(G, "spray", { S, cov, heads, target: own });
    let gaps = 0;
    res.gapPts = [];
    for (let k = 0; k < S.n; k++)
      if (cov[k] < 2) {
        gaps++;
        res.gapPts.push({ x: S.x[k], y: S.y[k], c: cov[k] });
      }
    res.gaps = gaps;
    res.samples = S.n;
    res.rotors = rotors;
    res.droppedRotors = dropped;
    return res;
  }

  function maxInscribed(G) {
    let best = 0;
    for (let x = G.x0 + 1; x < G.x1; x += 2)
      for (let y = G.y0 + 1; y < G.y1; y += 2) {
        if (inLawn(G, x, y)) best = Math.max(best, distB(G, x, y));
      }
    return best;
  }

  /* ---------------- independent check ---------------- */

  // Re-checks a layout from scratch at finer resolution than placement used.
  function verify(G, heads) {
    let overspray = 0,
      worst = 0;
    const bad = [];
    for (const h of heads) {
      let hWorst = 0;
      const full = h.arc >= 359.5;
      const a0 = full ? 0 : h.dir - h.arc / 2;
      const span = full ? 360 : h.arc;
      const na = Math.max(8, Math.ceil(span / 1.5));
      for (let i = 0; i <= na; i++) {
        const a = (a0 + (span * i) / na) * DEG;
        const c = Math.cos(a),
          s = Math.sin(a);
        for (let f = 0.5; f <= h.r + 1e-9; f += 0.5) {
          const x = h.x + f * c,
            y = h.y + f * s;
          if (!inLawn(G, x, y)) {
            const d = distB(G, x, y);
            if (d > hWorst) hWorst = d;
          }
        }
      }
      if (hWorst > 0.35) {
        overspray++;
        bad.push(h);
      }
      worst = Math.max(worst, hWorst);
    }
    let n = 0,
      gaps = 0;
    const gapPts = [];
    for (let x = G.x0 + 0.25; x < G.x1; x += 0.5)
      for (let y = G.y0 + 0.25; y < G.y1; y += 0.5) {
        if (!inLawn(G, x, y) || distB(G, x, y) < 0.5) continue;
        n++;
        let c = 0;
        for (const h of heads) if (covers(h, x, y) && ++c >= 2) break;
        if (c < 2) {
          gaps++;
          if (gaps % 2 === 1) gapPts.push({ x, y, c });
        }
      }
    return {
      overspray,
      worstOverspray: worst,
      oversprayHeads: bad,
      points: n,
      gaps,
      gapPts,
      coverage: n ? 1 - gaps / n : 1,
    };
  }

  /* ---------------- zones ---------------- */

  function zoneHeads(heads, cap) {
    const groups = new Map();
    heads.forEach((h, i) => {
      h._i = i;
      const key = h.area + "|" + (h.kind === "R" ? "rotor" : "spray");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(h);
    });
    const zones = [];
    for (const [key, list] of groups) {
      const family = key.split("|")[1];
      const adj = new Map(list.map((h) => [h, []]));
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i],
            b = list[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.95) {
            adj.get(a).push(b);
            adj.get(b).push(a);
          }
        }
      // contiguous clusters
      const seen = new Set();
      for (const h of list) {
        if (seen.has(h)) continue;
        const comp = [];
        const stack = [h];
        seen.add(h);
        while (stack.length) {
          const u = stack.pop();
          comp.push(u);
          for (const v of adj.get(u))
            if (!seen.has(v)) {
              seen.add(v);
              stack.push(v);
            }
        }
        splitCluster(comp, adj, cap, family).forEach((z) =>
          zones.push({ family, heads: z }),
        );
      }
    }
    // never leave a rotor zone under 3 heads when a neighbouring rotor zone can absorb or share
    fixSmallRotorZones(zones, cap);
    zones.forEach((z) => (z.gpm = z.heads.reduce((s, h) => s + h.gpm, 0)));
    // number zones top-left to bottom-right so the plan reads naturally
    zones.forEach((z) => {
      z.cx = z.heads.reduce((s, h) => s + h.x, 0) / z.heads.length;
      z.cy = z.heads.reduce((s, h) => s + h.y, 0) / z.heads.length;
    });
    zones.sort(
      (a, b) => a.heads[0].area - b.heads[0].area || b.cy - a.cy || a.cx - b.cx,
    );
    zones.forEach((z, i) => {
      z.n = i + 1;
      z.heads.forEach((h) => (h.zone = i + 1));
    });
    return zones;
  }

  function splitCluster(comp, adj, cap, family) {
    const total = comp.reduce((s, h) => s + h.gpm, 0);
    let k = Math.max(1, Math.ceil(total / cap - 1e-9));
    for (let tries = 0; tries < 12; tries++, k++) {
      const zones = growZones(comp, adj, k, cap);
      if (zones.every((z) => z.reduce((s, h) => s + h.gpm, 0) <= cap + 1e-9))
        return zones;
    }
    // fallback: chop in order, still under cap
    const out = [];
    let cur = [],
      sum = 0;
    comp.forEach((h) => {
      if (sum + h.gpm > cap && cur.length) {
        out.push(cur);
        cur = [];
        sum = 0;
      }
      cur.push(h);
      sum += h.gpm;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // Grow k zones of roughly equal flow, each one a connected patch of neighbouring heads.
  function growZones(comp, adj, k, cap) {
    const total = comp.reduce((s, h) => s + h.gpm, 0);
    const left = new Set(comp);
    const zones = [];
    for (let z = 0; z < k - 1 && left.size; z++) {
      const remainingTotal = [...left].reduce((s, h) => s + h.gpm, 0);
      const target = remainingTotal / (k - z);
      const arr = [...left];
      const cx = arr.reduce((s, h) => s + h.x, 0) / arr.length,
        cy = arr.reduce((s, h) => s + h.y, 0) / arr.length;
      let seed = arr[0],
        far = -1;
      arr.forEach((h) => {
        const d = Math.hypot(h.x - cx, h.y - cy);
        if (d > far) {
          far = d;
          seed = h;
        }
      });
      const zone = [seed];
      left.delete(seed);
      let sum = seed.gpm;
      while (sum < target - 1e-9) {
        let best = null,
          bd = Infinity;
        for (const u of zone)
          for (const v of adj.get(u)) {
            if (!left.has(v)) continue;
            const d = Math.hypot(v.x - seed.x, v.y - seed.y);
            if (d < bd) {
              bd = d;
              best = v;
            }
          }
        if (!best) break;
        // stop if adding overshoots the target by more than stopping short does
        if (sum + best.gpm > cap + 1e-9) break;
        if (sum + best.gpm - target > target - sum) break;
        zone.push(best);
        left.delete(best);
        sum += best.gpm;
      }
      zones.push(zone);
    }
    if (left.size) {
      // what's left may be in pieces; each piece becomes its own zone
      const rest = [...left];
      const seen = new Set();
      rest.forEach((h) => {
        if (seen.has(h)) return;
        const piece = [],
          stack = [h];
        seen.add(h);
        while (stack.length) {
          const u = stack.pop();
          piece.push(u);
          for (const v of adj.get(u))
            if (left.has(v) && !seen.has(v)) {
              seen.add(v);
              stack.push(v);
            }
        }
        zones.push(piece);
      });
    }
    void total;
    return zones;
  }

  function fixSmallRotorZones(zones, cap) {
    const sum = (zz) => zz.reduce((s, h) => s + h.gpm, 0);
    const gap = (a, b) => Math.min(...a.heads.map((p) => Math.min(...b.heads.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const z of zones) {
        if (z.family !== 'rotor' || z.heads.length >= 3 || !z.heads.length) continue;
        // every other rotor zone on this lawn, nearest first (empty ones skipped)
        const others = zones
          .filter((o) => o !== z && o.family === 'rotor' && o.heads.length && o.heads[0].area === z.heads[0].area)
          .map((o) => ({ o, d: gap(z, o) }))
          .sort((a, b) => a.d - b.d);
        const into = others.find(({ o }) => sum(z.heads) + sum(o.heads) <= cap + 1e-9);
        if (into) {
          into.o.heads.push(...z.heads);
          z.heads = [];
          changed = true;
          continue;
        }
        // nothing can absorb it: borrow the nearest heads from neighbours that can spare them
        for (const { o } of others) {
          while (z.heads.length < 3 && o.heads.length > 3) {
            let mv = null, md = Infinity;
            o.heads.forEach((b) => {
              const d = Math.min(...z.heads.map((a) => Math.hypot(a.x - b.x, a.y - b.y)));
              if (d < md) { md = d; mv = b; }
            });
            if (sum(z.heads) + mv.gpm > cap + 1e-9) break;
            o.heads.splice(o.heads.indexOf(mv), 1);
            z.heads.push(mv);
            changed = true;
          }
          if (z.heads.length >= 3) break;
        }
      }
      for (let i = zones.length - 1; i >= 0; i--) if (!zones[i].heads.length) zones.splice(i, 1);
      if (!changed) break;
    }
    zones.forEach((z) => (z.small = z.family === 'rotor' && z.heads.length < 3));
  }

  /* ---------------- parts ---------------- */

  const SWING_FT_PER_HEAD = 3;
  const SWING_ROLL_FT = 100;
  function swingRolls(headCount) {
    if (!headCount) return 0;
    return Math.max(1, Math.ceil((headCount * SWING_FT_PER_HEAD) / SWING_ROLL_FT));
  }
  function rotorCount(rotors, model) {
    let n = 0;
    rotors.forEach((qty, key) => {
      if (key.split("|")[0] === model) n += qty;
    });
    return n;
  }

  // Water source parts, per Zach 2026-11-07: culinary needs a backflow preventer, secondary
  // needs a filter. Zach is writing the full fixed list for each; it goes here when it comes.
  const WATER_SOURCE_PARTS = {
    culinary: [{ item: "Backflow preventer", qty: 1 }],
    secondary: [{ item: "Filter", qty: 1 }],
  };
  const WATER_SOURCE_GROUP = {
    culinary: "Culinary water connection",
    secondary: "Secondary water connection",
  };

  // Sections, per Zach 2026-11-07: heads, pipe, fittings, manifold, controller, water source.
  function parts(heads, zones, dripZones, water) {
    const nozzles = new Map();
    let sprayBodies = 0;
    const rotors = new Map();
    heads.forEach((h) => {
      if (h.kind === "R") {
        const key = h.model + "|" + fmtNum(h.gpmBase);
        rotors.set(key, (rotors.get(key) || 0) + 1);
      } else {
        sprayBodies++;
        nozzles.set(h.label, (nozzles.get(h.label) || 0) + 1);
      }
    });
    const order = (a, b) => {
      const pa = parseInt(a, 10),
        pb = parseInt(b, 10);
      return pb - pa || a.localeCompare(b);
    };
    const lines = [];
    if (sprayBodies)
      lines.push({ group: "Spray heads", item: "1804 pop-up spray body", qty: sprayBodies });
    [...nozzles.keys()].sort(order).forEach((k) =>
      lines.push({ group: "Spray nozzles", item: k + " nozzle", qty: nozzles.get(k) }),
    );
    // Rotors ship with every nozzle, so the list counts rotors by model only and the crew
    // reads each rotor's nozzle off the map (Zach 2026-11-08). Pop-up nozzles are bought
    // separately, so those stay counted one line per nozzle.
    ["5004", "3504"].forEach((model) => {
      const n = rotorCount(rotors, model);
      if (n) lines.push({ group: "Rotors", item: model + " rotor", qty: n });
    });

    // Swing joints, per Zach 2026-11-07: a 1/2" swing elbow under every pop-up and 3504,
    // a 3/4" swing elbow under every 5004, and 3 ft of swing pipe per head, bought in
    // 100 ft rolls (whole rolls, rounded up, never fewer than one).
    if (heads.length) {
      const swingFeet = heads.length * SWING_FT_PER_HEAD;
      lines.push({
        group: "Pipe",
        item: "Swing pipe, " + SWING_ROLL_FT + " ft roll (" + swingFeet + " ft needed)",
        qty: swingRolls(heads.length),
      });
    }
    const elbows34 = rotorCount(rotors, "5004");
    const elbows12 = heads.length - elbows34;
    if (elbows12) lines.push({ group: "Fittings", item: '1/2" swing elbow', qty: elbows12 });
    if (elbows34) lines.push({ group: "Fittings", item: '3/4" swing elbow', qty: elbows34 });

    const valves = zones.length;
    if (valves) lines.push({ group: "Manifold", item: "Zone valve", qty: valves });
    if (dripZones)
      lines.push({ group: "Manifold", item: "Drip zone (parts not included yet)", qty: dripZones });
    const stations = valves + (dripZones || 0);
    if (stations)
      lines.push({ group: "Controller", item: "Controller with at least " + stations + " stations", qty: 1 });

    (WATER_SOURCE_PARTS[water] || []).forEach((p) =>
      lines.push({ group: WATER_SOURCE_GROUP[water], item: p.item, qty: p.qty }),
    );
    return { lines, stations, overLimit: stations > 16, waterSet: !!WATER_SOURCE_PARTS[water] };
  }

  /* ---------------- whole job ---------------- */

  // job: {areas:[{outer, holes, mode:'auto'|'spray'|'rotor'}], psi, cap, popupsOnly, dripZones}
  function layoutJob(job) {
    const factor = Math.sqrt((job.psi || 50) / 30);
    const allHeads = [];
    const areaResults = [];
    job.areas.forEach((area, ai) => {
      const G = prepare(area);
      let family = "spray";
      let tried = null;
      const width = 2 * maxInscribed(G);
      let res = null;
      if (job.popupsOnly || area.mode === "spray") res = layoutArea(G, "spray");
      else if (area.mode === "rotor-only") {
        // rotors only: the whole lawn on rotors, unless it can't even hold the minimum
        const r = layoutArea(G, "rotor");
        if (r.heads.length >= MIN_ROTORS) {
          res = r;
          family = "rotor";
        } else {
          res = layoutArea(G, "spray");
          tried = "too small for " + MIN_ROTORS + " rotors, used pop-ups";
        }
      } else {
        res = layoutMixed(G);
        family = res.rotors ? (res.heads.length > res.rotors ? "mixed" : "rotor") : "spray";
        if (res.droppedRotors) tried = "an open patch fit fewer than " + MIN_ROTORS + " rotors, or rotors left it thin, so it used pop-ups there";
      }
      res.heads.forEach((h) => {
        h.area = ai;
        h.gpm = h.scales ? h.gpmBase * factor : h.gpmBase;
        allHeads.push(h);
      });
      const check = verify(G, res.heads);
      areaResults.push({
        family,
        width,
        note: tried,
        check,
        issues: res.issues,
        G,
      });
    });
    const zones = zoneHeads(allHeads, job.cap || 12);
    const p = parts(allHeads, zones, job.dripZones || 0, job.water);
    const totals = areaResults.reduce(
      (t, a) => {
        t.points += a.check.points;
        t.gaps += a.check.gaps;
        t.overspray += a.check.overspray;
        return t;
      },
      { points: 0, gaps: 0, overspray: 0 },
    );
    totals.coverage = totals.points ? 1 - totals.gaps / totals.points : 1;
    allHeads.forEach((h) => {
      delete h._i;
      delete h._reach;
    });
    return {
      heads: allHeads,
      zones,
      parts: p,
      areas: areaResults,
      totals,
      factor,
    };
  }

  function recheck(job, heads) {
    const results = job.areas.map((area, ai) =>
      verify(
        prepare(area),
        heads.filter((h) => h.area === ai),
      ),
    );
    const t = results.reduce(
      (acc, c) => {
        acc.points += c.points;
        acc.gaps += c.gaps;
        acc.overspray += c.overspray;
        acc.gapPts.push(...c.gapPts.map((g) => Object.assign({ area: 0 }, g)));
        return acc;
      },
      { points: 0, gaps: 0, overspray: 0, gapPts: [] },
    );
    t.coverage = t.points ? 1 - t.gaps / t.points : 1;
    return t;
  }

  return {
    layoutJob,
    recheck,
    prepare,
    verify,
    nozzle,
    sprayKind,
    covers,
    zoneHeads,
    parts,
    swingRolls,
    FIXED,
    VAN,
    ROTOR,
    arcPoints,
    orient,
  };
});
