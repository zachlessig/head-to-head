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
  // Zach 2026-11-08: along a curve "the most overspray that I think is okay is probably a foot.
  // nothing over a foot ever", and "overspray is better than a bunch of small heads. 8 van should be
  // the smallest for a general curve", but small VANs stay allowed where a tight curve needs one.
  // ARC_OVER is his hard limit and verify() flags anything past it. Heads are fitted to ARC_FIT so
  // the 0.5 ft sampling in rayOver can't land one a few inches over. Straight edges keep zero.
  const ARC_OVER = 1.0;
  const ARC_FIT = 0.9;
  const MIN_ARC_VAN = 8; // smallest VAN on a curve unless a spot is still dry after the first pass
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
            curve: !a.vertex || !b.vertex,
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
    // the tip of a fence that stops inside a lawn: the ring goes out along the fence and straight
    // back, and the lawn wraps all the way around the tip
    if (d < 1e-9 && Math.hypot(prev.x - next.x, prev.y - next.y) < 1e-6) return 360;
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

  // Distance to the nearest edge, and whether that edge is part of a curve.
  function nearestEdge(G, x, y) {
    const bx = Math.floor(x / G.sbin),
      by = Math.floor(y / G.sbin);
    let best = Infinity,
      curve = false;
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
            // a tie means the spot is past the corner where a curve meets a straight edge:
            // count it as straight (first test: a 10VAN put 0.72 ft past such a corner)
            if (d < best - 1e-6) {
              best = d;
              curve = G.segs[i].curve;
            } else if (d <= best + 1e-6 && !G.segs[i].curve) curve = false;
          }
        }
    }
    return { d: best, curve };
  }

  // How far a point outside the lawn sits past what its nearest edge allows (0 = within).
  // Curves allow `curveAllow`, straight edges CURVE_OVER (the old few-inch tolerance).
  function excessAt(G, x, y, curveAllow) {
    if (inLawn(G, x, y)) return 0;
    const e = nearestEdge(G, x, y);
    return Math.max(0, e.d - (e.curve ? curveAllow : CURVE_OVER));
  }

  // Does any part of this spray land further out than its edges allow?
  // The outer rim of a spray is where overspray peaks, and past a corner it peaks in a sliver a
  // couple of degrees wide (an 18VAN tip 0.43 ft past a curve-to-straight corner slipped between
  // 2 degree samples). So the rim is checked every quarter degree, the inside more coarsely.
  function rimExcess(G, p, a0, a1, r, curveAllow) {
    const span = a1 - a0;
    const na = Math.max(8, Math.ceil(span / (0.25 * DEG)));
    let worst = 0;
    for (let i = 0; i <= na; i++) {
      const a = a0 + (span * i) / na;
      worst = Math.max(worst, excessAt(G, p.x + r * Math.cos(a), p.y + r * Math.sin(a), curveAllow));
    }
    return worst;
  }

  function sprayTooFar(G, p, a0, a1, r) {
    if (rimExcess(G, p, a0, a1, r, ARC_FIT) > 0) return true;
    const span = a1 - a0;
    const na = Math.max(8, Math.ceil(span / (2 * DEG)));
    for (let i = 0; i <= na; i++) {
      const a = a0 + (span * i) / na;
      const c = Math.cos(a),
        sn = Math.sin(a);
      for (const f of reachSteps(r, 0.5))
        if (excessAt(G, p.x + f * c, p.y + f * sn, ARC_FIT) > 0) return true;
    }
    return false;
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

  // Distances out along a spray, every `step` ft and always the tip itself: stopping at the last
  // whole step missed the tip of an 8H on a kidney lawn, which sat 1.08 ft past the curve.
  function reachSteps(r, step) {
    const out = [];
    for (let f = step; f < r - 1e-9; f += step) out.push(f);
    out.push(r);
    return out;
  }

  // How far past the lawn edge a ray from p at angle ang reaches within distance r.
  function rayOver(G, p, ang, r) {
    const c = Math.cos(ang),
      sn = Math.sin(ang);
    let worst = 0;
    for (const f of reachSteps(r, 0.5)) {
      const x = p.x + f * c,
        y = p.y + f * sn;
      if (!inLawn(G, x, y)) worst = Math.max(worst, distB(G, x, y));
    }
    return worst;
  }

  // Given a boundary sample, find the biggest head that sits there without spraying outside the lawn.
  function fitBoundary(G, smp, isCorner, family, rMax, allowSmallArc) {
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
      // Only an actual curve earns the allowance. A slanted fence meeting a straight edge at under
      // 5 degrees isn't a corner, and that bend alone used to switch this on: an 18VAN threw
      // 0.9 ft past a straight edge (random yard 10, 2026-11-09).
      const curved =
        !isCorner &&
        (Math.abs(phiR + Math.PI / 2) > DEG ||
          Math.abs(phiL - Math.PI / 2) > DEG) &&
        (smp.curve || nearCurve(G, p.x, p.y, r));
      if (curved) {
        phiR = -Math.PI;
        phiL = Math.PI;
        for (const s of fwd) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d < 0.05) continue;
          const phi =
            wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN) -
            Math.asin(Math.min(1, ARC_FIT / d));
          if (phi > phiR) phiR = phi;
        }
        for (const s of back) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d < 0.05) continue;
          const phi =
            wrapPi(Math.atan2(s.y - p.y, s.x - p.x) - thetaN) +
            Math.asin(Math.min(1, ARC_FIT / d));
          if (phi < phiL) phiL = phi;
        }
      }
      if (!fwd.length) phiR = -Math.PI / 2;
      if (!back.length) phiL = Math.PI / 2;
      if (curved) {
        // Widening by the angle alone overshoots on a lawn that bulges out: the curve falls away
        // past the sample, so the arc's outer edge lands further out the longer the throw
        // (1.4 ft on a 40x30 kidney at a 1 ft allowance). Walk each edge back until it's within ARC_FIT.
        for (let t = 0; t < 45 && rayOver(G, p, thetaN + phiR, r) > ARC_FIT; t++) phiR += DEG;
        for (let t = 0; t < 45 && rayOver(G, p, thetaN + phiL, r) > ARC_FIT; t++) phiL -= DEG;
      }
      if (phiL - phiR < 10 * DEG) return null;
      // anything else on the boundary that pokes into this wedge closer than r limits the radius
      let dmin = Infinity;
      const margin = 0.25 * DEG;
      boundaryNear(G, p.x, p.y, r + 0.5, (s) => {
        if (s._stamp === stamp) return;
        const d0 = Math.hypot(s.x - p.x, s.y - p.y);
        if (d0 <= TOL) return;
        const d = s.curve ? d0 + ARC_FIT : d0; // a curve can take a little overspray
        if (d >= dmin) return;
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
      // Near a curve, check the whole spray: nothing past ARC_FIT over a curve, nothing past the
      // old tolerance over a straight edge. Without this a 40x30 kidney reached 1.08 ft past its
      // curve and rotors put 0.78 ft on a straight edge where it meets a curve.
      if (nearCurve(G, p.x, p.y, nz.r + 1) && sprayTooFar(G, p, dir - (useArc * DEG) / 2, dir + (useArc * DEG) / 2, nz.r)) {
        r = nz.r - 0.5;
        if (r < 2.2) return null;
        continue;
      }
      // no little VANs on a curve unless asked for: the neighbours' overspray covers it first
      if (!allowSmallArc && nz.kind === "VAN" && nz.series < MIN_ARC_VAN && (smp.curve || curved || nearCurve(G, p.x, p.y, 1)))
        return null;
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

    // 5. a curve still dry after that is a tight spot: now a small VAN may go in
    let dryNearCurve = false;
    for (let k = 0; k < S.n && !dryNearCurve; k++)
      if (all[k] && cov[k] < 2 && nearCurve(G, S.x[k], S.y[k], 8)) dryNearCurve = true;
    if (spray && dryNearCurve) {
      const smallCands = [];
      G.ringSamples.forEach((list) => {
        for (let i = 0; i < list.length; i += every) {
          const s = list[i];
          if (s.corner || !nearCurve(G, s.x, s.y, 1)) continue;
          const h = fitBoundary(G, s, false, family, maxR, true);
          if (h && h.kind === "VAN" && h.series < MIN_ARC_VAN) smallCands.push({ head: h });
        }
      });
      greedy(smallCands, S, cov, all, minGain, heads, 600);
    }

    // No sliver-filling pass. A strip a couple of feet wide (a bed 2.4 ft from a fence) can end up
    // single covered; extra 4VANs would fix it, and Zach said 2026-11-10 "just leave it. its
    // probably fine without those heads" after seeing the 3 extra heads it cost on a test yard.

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
      const na = Math.max(8, Math.ceil(span / 1));
      for (let i = 0; i <= na; i++) {
        const a = (a0 + (span * i) / na) * DEG;
        const c = Math.cos(a),
          s = Math.sin(a);
        for (const f of reachSteps(h.r, 0.25)) {
          const x = h.x + f * c,
            y = h.y + f * s;
          if (!inLawn(G, x, y)) {
            // judged by the nearest edge: past a curve counts only beyond ARC_OVER (flags past 1 ft)
            const e = nearestEdge(G, x, y);
            const d = e.curve ? Math.max(0, e.d - ARC_OVER + 0.35) : e.d;
            if (d > hWorst) hWorst = d;
          }
        }
      }
      // the rim at quarter-degree spacing, on the same scale as hWorst (flags past 0.35)
      const re = rimExcess(G, h, a0 * DEG, (a0 + span) * DEG, h.r, ARC_OVER);
      if (re > 0) hWorst = Math.max(hWorst, 0.35 + re);
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
    mergeNeighbourZones(zones, cap);
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
    // Fallback: grow each zone outward from the head farthest from the rest, always taking the
    // nearest head that still fits, until the cap. Chopping the list in order (the old fallback)
    // paired heads 50 ft apart with nothing between them (random yards, 2026-11-09).
    const out = [];
    const left = new Set(comp);
    while (left.size) {
      const arr = [...left];
      const cx = arr.reduce((a, h) => a + h.x, 0) / arr.length, cy = arr.reduce((a, h) => a + h.y, 0) / arr.length;
      let seed = arr[0], far = -1;
      arr.forEach((h) => { const d = Math.hypot(h.x - cx, h.y - cy); if (d > far) { far = d; seed = h; } });
      const zone = [seed];
      left.delete(seed);
      let sum = seed.gpm;
      for (;;) {
        let best = null, bd = Infinity;
        for (const v of left) {
          if (sum + v.gpm > cap + 1e-9) continue;
          const d = Math.min(...zone.map((u) => Math.hypot(u.x - v.x, u.y - v.y)));
          if (d < bd) { bd = d; best = v; }
        }
        // stay a patch: the next head has to be within reach of one already in the zone
        if (!best || bd > Math.max(best.r, ...zone.map((u) => u.r)) + 3) break;
        zone.push(best);
        left.delete(best);
        sum += best.gpm;
      }
      out.push(zone);
    }
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

  // Zach 2026-11-09: "keep the same heads that are in the same zone in the same general area",
  // never "rotors across the entire yard" so the crew runs pipe all over for an 'optimal' layout.
  // Two zones are neighbours when their closest heads are within reach of each other: the
  // bigger throw of the two plus ZONE_REACH_SLACK ft.
  const ZONE_REACH_SLACK = 3;
  function zoneGap(a, b) {
    let best = Infinity;
    for (const p of a.heads) for (const q of b.heads) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    return best;
  }
  function zonesNeighbour(a, b) {
    const reach = Math.max(...a.heads.map((h) => h.r), ...b.heads.map((h) => h.r)) + ZONE_REACH_SLACK;
    return zoneGap(a, b) <= reach;
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
          .filter((o) => o !== z && o.family === 'rotor' && o.heads.length && o.heads[0].area === z.heads[0].area && zonesNeighbour(z, o))
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
            // the closest rotor that still fits under the cap: taking only the very closest left
            // a 9 GPM zone at 2 rotors when a 1 GPM rotor next door would fit (random yard 25)
            let mv = null, md = Infinity;
            const room = cap - sum(z.heads) + 1e-9;
            o.heads.forEach((b) => {
              if (b.gpm > room) return;
              const d = Math.min(...z.heads.map((a) => Math.hypot(a.x - b.x, a.y - b.y)));
              if (d < md) { md = d; mv = b; }
            });
            if (!mv) break;
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

  // A zone of one or two heads may join a zone on the same lawn up to TINY_JOIN_FT away: a valve
  // for a lone head costs more than a lateral that long. In the example yard the pop-ups along
  // the curved back bed sat 18 to 42 ft apart with rotors between, all on one bed line; true
  // opposite sides of a yard are farther than this. A guess, not measured.
  const TINY_JOIN_FT = 45;

  // Fewest valves, per Zach 2026-11-09: two zones of the same kind merge when they're neighbours
  // and fit under the cap together, so stray pop-ups along a curve don't get a valve of their
  // own (the example yard had three single-15H zones). No minimum head count for pop-ups ("in
  // almost every yard there will be pop ups"). Smallest zones merge first, into their closest
  // neighbour.
  function mergeNeighbourZones(zones, cap) {
    const sum = (zz) => zz.reduce((s, h) => s + h.gpm, 0);
    for (let pass = 0; pass < 50; pass++) {
      let best = null;
      for (const z of zones) {
        if (!z.heads.length) continue;
        for (const o of zones) {
          if (o === z || !o.heads.length || o.family !== z.family) continue;
          if (sum(z.heads) + sum(o.heads) > cap + 1e-9) continue;
          const tiny = z.heads.length <= 2 || o.heads.length <= 2;
          const sameLawn = z.heads[0].area === o.heads[0].area;
          if (!zonesNeighbour(z, o) && !(tiny && sameLawn && zoneGap(z, o) <= TINY_JOIN_FT)) continue;
          const size = Math.min(sum(z.heads), sum(o.heads));
          const d = zoneGap(z, o);
          if (!best || size < best.size - 1e-9 || (Math.abs(size - best.size) < 1e-9 && d < best.d)) best = { z, o, size, d };
        }
      }
      if (!best) break;
      best.o.heads.push(...best.z.heads);
      best.z.heads = [];
      for (let i = zones.length - 1; i >= 0; i--) if (!zones[i].heads.length) zones.splice(i, 1);
    }
  }

  /* ---------------- drip ---------------- */

  // Zach 2026-11-08: every bed gets drip. A row runs from one side of the bed to the other; the
  // width is checked every DRIP_STEP ft and anywhere it's over DRIP_ROW_W the bed gets an extra
  // row there ("anything under 7 gets 1 row"). A drip zone carries DRIP_ZONE_FT of pipe at most,
  // not counting the line from the valve box. Separate beds are separate zones, except beds that
  // touch share a zone, and a small bed (under DRIP_SMALL_FT of pipe) joins a bed in the same part
  // of the yard. Rolls come in 100, 250 and 500 ft.
  const DRIP_ROW_W = 7;
  const DRIP_STEP = 1;
  const DRIP_ZONE_FT = 250;
  const DRIP_SMALL_FT = 20;
  // "same general area in the yard": within 15 ft, edge to edge (Zach 2026-11-08).
  const DRIP_NEAR_FT = 15;
  const DRIP_ROLLS = [500, 250, 100];

  function bedRing(pts) {
    const out = [];
    pts.forEach((v, i) => {
      out.push({ x: v.x, y: v.y });
      arcPoints(v, pts[(i + 1) % pts.length], v.b || 0, 0.5).forEach((p) => out.push(p));
    });
    return out;
  }

  // Width of the bed through point (x,y) along direction (ux,uy): the inside stretch of that line.
  function chordAt(ring, x, y, ux, uy) {
    const ts = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a.x - x, wy = a.y - y;
      const t = (wx * ey - wy * ex) / den;
      const s = (wx * uy - wy * ux) / den;
      if (s >= 0 && s < 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k] <= 0 && ts[k + 1] >= 0) return ts[k + 1] - ts[k];
    return 0;
  }

  // Pipe for one bed. The width is checked all over the bed every DRIP_STEP/2 ft, across the
  // bed's run (the way you'd tape it). A strip w wide needs 1/w ft of row
  // per sq ft, times the rows it gets. Slicing one way only read an L-shaped bed's leg lengthwise
  // as 30 ft wide and came out 46 ft instead of 56.
  function bedPipe(ring) {
    const cell = DRIP_STEP / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ring.forEach((p) => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    const dirs = [];
    for (let d = 0; d < 180; d += 7.5) dirs.push([Math.cos(d * DEG), Math.sin(d * DEG)]);
    // the bed's main direction: the long side of its tightest bounding box
    let bb = null;
    dirs.forEach(([ux, uy], i) => {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      ring.forEach((p) => {
        const a = p.x * ux + p.y * uy, b = -p.x * uy + p.y * ux;
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      });
      const area = (a1 - a0) * (b1 - b0);
      if (!bb || area < bb.area - 1e-9) bb = { area, i: a1 - a0 >= b1 - b0 ? i : (i + dirs.length / 2) % dirs.length };
    });
    let ft = 0, maxW = 0;
    for (let x = x0 + cell / 2; x < x1; x += cell)
      for (let y = y0 + cell / 2; y < y1; y += cell) {
        // the run direction here is the longest line through the spot; the width is the line square
        // to it. The plain narrowest line read a strip's ends as thin, cutting across the corners,
        // and put a 7x40 bed at 47 ft; lines up to 30 degrees off square still gave 45.
        const ch = dirs.map(([ux, uy]) => chordAt(ring, x, y, ux, uy));
        let li = 0;
        ch.forEach((c, i) => { if (c > ch[li]) li = i; });
        if (ch[li] <= 0) continue; // outside the bed
        // rows follow the bed's main direction unless this spot clearly runs another way (an L's
        // other leg, the ends of a curve). Going by the longest line alone ran a 40x40 bed's rows
        // corner to corner, 270 ft instead of 240.
        if (ch[bb.i] * 1.5 >= ch[li]) li = bb.i;
        const perp = (li + dirs.length / 2) % dirs.length;
        const w = ch[perp];
        if (!(w > 0)) continue;
        maxW = Math.max(maxW, w);
        // the 0.05 ft slack keeps a 7 ft bed that measures 7.0000001 from getting double rows
        const rows = w > DRIP_ROW_W + 0.05 ? Math.ceil((w - 0.05) / DRIP_ROW_W) : 1;
        ft += (rows / w) * cell * cell;
      }
    return { ft: Math.max(1, Math.round(ft)), maxWidth: maxW };
  }

  function ringGap(r1, r2) {
    let best = Infinity;
    for (const p of r1)
      for (let i = 0; i < r2.length; i++) {
        const a = r2[i], b = r2[(i + 1) % r2.length];
        best = Math.min(best, segDist({ ax: a.x, ay: a.y, bx: b.x, by: b.y }, p.x, p.y));
      }
    return best;
  }

  // beds: [{id, pts:[{x,y,b}]}] in feet. Returns {beds:[{id, ft, zone}], zones:[{n, ft, beds}], ft}.
  function dripPlan(beds) {
    const list = beds.map((b, i) => {
      const ring = bedRing(b.pts);
      return Object.assign({ id: b.id != null ? b.id : i, ring }, bedPipe(ring));
    });
    const n = list.length;
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const gap = [];
    for (let i = 0; i < n; i++) {
      gap[i] = [];
      for (let j = 0; j < n; j++)
        gap[i][j] = i === j ? 0 : j < i ? gap[j][i] : Math.min(ringGap(list[i].ring, list[j].ring), ringGap(list[j].ring, list[i].ring));
    }
    // touching beds share a zone
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (gap[i][j] < 0.5) parent[find(i)] = find(j);
    // a drip area is a bed, or beds touching each other: each run of drip ends in one end cap
    const areas = new Set(list.map((_, i) => find(i))).size;
    // a small bed joins the nearest bed in the same part of the yard
    for (let i = 0; i < n; i++) {
      if (list[i].ft >= DRIP_SMALL_FT) continue;
      let bj = -1;
      for (let j = 0; j < n; j++) if (j !== i && gap[i][j] <= DRIP_NEAR_FT && (bj < 0 || gap[i][j] < gap[i][bj])) bj = j;
      if (bj >= 0) parent[find(i)] = find(bj);
    }
    const groups = new Map();
    list.forEach((b, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(b);
    });
    // each group fills zones up to DRIP_ZONE_FT; a bed bigger than that gets zones of its own
    const zones = [];
    [...groups.values()].forEach((g) => {
      const bins = [];
      g.slice()
        .sort((a, b) => b.ft - a.ft)
        .forEach((b) => {
          if (b.ft > DRIP_ZONE_FT) {
            const k = Math.ceil(b.ft / DRIP_ZONE_FT);
            for (let m = 0; m < k; m++) zones.push({ ft: Math.round(b.ft / k), beds: [b.id] });
            b.zone = zones.length - k + 1;
            return;
          }
          let bin = bins.find((z) => z.ft + b.ft <= DRIP_ZONE_FT);
          if (!bin) {
            bin = { ft: 0, beds: [] };
            bins.push(bin);
            zones.push(bin);
          }
          bin.ft += b.ft;
          bin.beds.push(b.id);
          b.zone = zones.indexOf(bin) + 1;
        });
    });
    zones.forEach((z, i) => (z.n = i + 1));
    return {
      beds: list.map((b) => ({ id: b.id, ft: b.ft, zone: b.zone, maxWidth: b.maxWidth })),
      zones,
      areas,
      ft: list.reduce((a, b) => a + b.ft, 0),
    };
  }

  // Zach 2026-11-08: "dont have left over". Up to 350 ft only 100 ft rolls; 351 to 750 ft 250 and
  // 100 ft rolls; over 750 ft the 500s come in too. Within those sizes, the least pipe left over,
  // then the fewest rolls.
  function dripRolls(ft) {
    if (ft <= 0) return {};
    const sizes = ft <= 350 ? [100] : ft <= 750 ? [250, 100] : [500, 250, 100];
    const max = (sz) => (sizes.includes(sz) ? Math.ceil(ft / sz) : 0);
    let best = null;
    for (let a = 0; a <= max(500); a++)
      for (let b = 0; b <= max(250); b++) {
        const rest = ft - a * 500 - b * 250;
        const c = sizes.includes(100) ? Math.max(0, Math.ceil(rest / 100)) : 0;
        const tot = a * 500 + b * 250 + c * 100;
        if (tot < ft) continue;
        const cnt = a + b + c;
        if (!best || tot < best.tot || (tot === best.tot && cnt < best.cnt)) best = { tot, cnt, r: { 500: a, 250: b, 100: c } };
      }
    return best.r;
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
  // Zach 2026-11-10: brands and builds vary too much to list, so one line for the setup, plus a
  // stainless steel ball valve so all the water can be shut off.
  const WATER_SOURCE_PARTS = {
    culinary: [{ item: "Backflow setup", qty: 1 }, { item: "Stainless steel ball valve", qty: 1 }],
    secondary: [{ item: "Filter setup", qty: 1 }, { item: "Stainless steel ball valve", qty: 1 }],
  };
  const WATER_SOURCE_GROUP = {
    culinary: "Culinary water connection",
    secondary: "Secondary water connection",
  };

  // Sections, per Zach 2026-11-07: heads, pipe, fittings, manifold, controller, water source.
  // drip: a dripPlan() result. A bare number (old jobs) is read as that many drip zones with no pipe.
  // notes: text shown in a section's header, like the total drip footage.
  // setups: a company's own parts for the water connection, {culinary: [{item, qty}], secondary: [...]}.
  // Zach 2026-11-10: every contractor builds a backflow or filter differently, so each company can
  // save its breakdown once and every job uses it in place of the one generic line.
  // sizes: {lateral: '3/4"' | '1"', main: '3/4"' | '1"' | null}. Zach 2026-11-10: lateral fittings
  // carry the lateral size, so the list says which to buy; swing elbows and swing adapters don't.
  function parts(heads, zones, drip, water, setups, sizes) {
    const lat = sizes && sizes.lateral ? sizes.lateral + " " : "";
    const main = sizes && sizes.main ? sizes.main + " " : "";
    const notes = {};
    const dz = typeof drip === "number" ? drip : drip ? drip.zones.length : 0;
    const dripFt = drip && typeof drip === "object" ? drip.ft : 0;
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
      lines.push({ group: "Spray nozzles", item: k, qty: nozzles.get(k) }), // just "15H": the header says nozzles (Zach 2026-11-08)
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

    // Lateral and mainline fittings, per Zach 2026-11-10 (pipe lengths come later): for each
    // sprinkler zone 1 coupling, 2 tees and 1 swing adapter; for the yard 2 elbows and 30 mainline
    // pinch clamps; 1 bag of LD pinch clamps for every 10 zones, rounded up. Drip zones have
    // their own fittings in the Drip section.
    // and a saddle for every head where its swing pipe comes off the lateral (2026-11-10)
    const zn = zones.length;
    if (heads.length) lines.push({ group: "Fittings", item: lat + "saddle", qty: heads.length });
    if (zn) {
      lines.push({ group: "Fittings", item: lat + "coupling", qty: zn });
      lines.push({ group: "Fittings", item: lat + "tee", qty: 2 * zn });
      lines.push({ group: "Fittings", item: "Swing adapter", qty: zn });
      lines.push({ group: "Fittings", item: lat + "elbow", qty: 2 });
      lines.push({ group: "Fittings", item: lat + "LD pinch clamps, bag", qty: Math.ceil(zn / 10) });
      // these go on the mainline, so they take the supply size
      lines.push({ group: "Fittings", item: main + "mainline pinch clamp", qty: 30 });
    }

    // Drip, per Zach 2026-11-08: total feet, the rolls, 3 drip tees and 1 coupling for every
    // 100 ft (no elbows), and a figure 8 end cap for each separate drip area.
    if (dripFt) {
      const per100 = Math.ceil(dripFt / 100);
      notes.Drip = dripFt + " ft of drip pipe";
      const rolls = dripRolls(dripFt);
      DRIP_ROLLS.forEach((size) => {
        if (rolls[size]) lines.push({ group: "Drip", item: "Drip pipe, " + size + " ft roll", qty: rolls[size] });
      });
      lines.push({ group: "Drip", item: "Drip tee", qty: 3 * per100 });
      lines.push({ group: "Drip", item: "Drip coupling", qty: per100 });
      const caps = drip && drip.areas ? drip.areas : dz;
      if (caps) lines.push({ group: "Drip", item: "Figure 8 end cap", qty: caps });
    }
    const valves = zones.length;
    if (valves) lines.push({ group: "Manifold", item: "Zone valve", qty: valves });
    if (dz) lines.push({ group: "Manifold", item: "Drip zone valve", qty: dz });
    const stations = valves + dz;
    if (stations)
      lines.push({ group: "Controller", item: "Controller with at least " + stations + " stations", qty: 1 });

    const own = setups && Array.isArray(setups[water]) && setups[water].length ? setups[water] : null;
    (WATER_SOURCE_PARTS[water] ? own || WATER_SOURCE_PARTS[water] : []).forEach((p) => {
      if (p.item && p.qty > 0) lines.push({ group: WATER_SOURCE_GROUP[water], item: p.item, qty: p.qty });
    });
    return { lines, notes, stations, overLimit: stations > 16, waterSet: !!WATER_SOURCE_PARTS[water] };
  }

  /* ---------------- fences ---------------- */

  // Zach 2026-11-09: a lawn can be traced right through a fence, but sprinklers can't spray through
  // one, so a fence is a boundary with no width. A fence that crosses a lawn splits it into
  // separate lawns along the fence line; each side then gets its own heads with the fence as a
  // straight edge (zero overspray). Fence ends get FENCE_SNAP ft of reach so a line stopped just
  // short of the lawn edge still counts as crossing.
  const FENCE_SNAP = 1;

  // Circle of the arc edge a->b (bulge a.b = sagitta, + left of travel), or null if straight.
  function arcOf(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy);
    const bb = a.b || 0;
    if (Math.abs(bb) < 1e-6 || c < 1e-9) return null;
    const nx = -dy / c, ny = dx / c;
    const R = (c * c / 4 + bb * bb) / (2 * Math.abs(bb));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const off = bb - Math.sign(bb) * R;
    const cx = mx + nx * off, cy = my + ny * off;
    const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
    const ap = Math.atan2(my + ny * bb - cy, mx + nx * bb - cx);
    const ccwDist = (f, t) => (((t - f) % TAU) + TAU) % TAU;
    const ccw = ccwDist(a0, ap) < ccwDist(a0, a1);
    const sweep = ccw ? ccwDist(a0, a1) : ccwDist(a1, a0);
    return { cx, cy, R, a0, ccw, sweep, sign: Math.sign(bb) };
  }
  function arcPos(arc, x, y) {
    const ang = Math.atan2(y - arc.cy, x - arc.cx);
    const d = arc.ccw ? (((ang - arc.a0) % TAU) + TAU) % TAU : (((arc.a0 - ang) % TAU) + TAU) % TAU;
    return d <= arc.sweep + 1e-9 ? d / arc.sweep : -1;
  }
  // bulge of the piece of an arc between positions u0 < u1 (same side, same circle)
  function subBulge(arc, u0, u1) {
    return arc.sign * arc.R * (1 - Math.cos(((u1 - u0) * arc.sweep) / 2));
  }

  // Where fence segment P->Q crosses edge a->b: [{t (along PQ), u (along the edge), x, y}]
  function edgeHits(P, Q, a, b) {
    const out = [];
    const arc = arcOf(a, b);
    const dx = Q.x - P.x, dy = Q.y - P.y;
    if (!arc) {
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) return out;
      const t = ((a.x - P.x) * ey - (a.y - P.y) * ex) / den;
      const u = ((a.x - P.x) * dy - (a.y - P.y) * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u < 1) out.push({ t, u, x: P.x + t * dx, y: P.y + t * dy });
      return out;
    }
    const fx = P.x - arc.cx, fy = P.y - arc.cy;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - arc.R * arc.R;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < 1e-12) return out;
    for (const sg of [-1, 1]) {
      const t = (-B + sg * Math.sqrt(disc)) / (2 * A);
      if (t < 0 || t > 1) continue;
      const x = P.x + t * dx, y = P.y + t * dy;
      const u = arcPos(arc, x, y);
      if (u >= 0 && u < 1) out.push({ t, u, x, y });
    }
    return out;
  }

  function ringPolygon(ring) {
    const out = [];
    ring.forEach((v, i) => {
      out.push({ x: v.x, y: v.y });
      arcPoints(v, ring[(i + 1) % ring.length], v.b || 0, 0.5).forEach((p) => out.push(p));
    });
    return out;
  }
  function insidePolygon(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function polygonArea(poly) {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    return Math.abs(s) / 2;
  }

  // The first stretch of this fence that runs through the lawn from edge to edge, or null.
  function fenceCut(ring, fence) {
    if (fence.length < 2) return null;
    const pts = fence.map((p) => ({ x: p.x, y: p.y }));
    const ext = (A, B) => {
      const L = Math.hypot(A.x - B.x, A.y - B.y) || 1;
      return { x: A.x + ((A.x - B.x) / L) * FENCE_SNAP, y: A.y + ((A.y - B.y) / L) * FENCE_SNAP };
    };
    pts[0] = ext(pts[0], pts[1]);
    pts[pts.length - 1] = ext(pts[pts.length - 1], pts[pts.length - 2]);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const hits = [];
    for (let k = 0; k + 1 < pts.length; k++)
      ring.forEach((a, i) =>
        edgeHits(pts[k], pts[k + 1], a, ring[(i + 1) % ring.length]).forEach((h) =>
          hits.push(Object.assign(h, { i, s: cum[k] + h.t * (cum[k + 1] - cum[k]) })),
        ),
      );
    hits.sort((p, q) => p.s - q.s);
    const poly = ringPolygon(ring);
    for (let j = 0; j + 1 < hits.length; j++) {
      const h1 = hits[j], h2 = hits[j + 1];
      if (h2.s - h1.s < 0.5) continue;
      const mid = (h1.s + h2.s) / 2;
      let k = 0;
      while (k + 2 < cum.length && cum[k + 1] < mid) k++;
      const f = (mid - cum[k]) / (cum[k + 1] - cum[k] || 1);
      const mx = pts[k].x + f * (pts[k + 1].x - pts[k].x), my = pts[k].y + f * (pts[k + 1].y - pts[k].y);
      if (!insidePolygon(poly, mx, my)) continue;
      const inner = [];
      for (let m = 1; m + 1 < pts.length; m++) if (cum[m] > h1.s + 1e-9 && cum[m] < h2.s - 1e-9) inner.push({ x: pts[m].x, y: pts[m].y, b: 0 });
      return { h1, h2, inner };
    }
    return null;
  }

  // Split ring along a cut, keeping curved edges curved. Returns [ringA, ringB].
  function cutRing(ring, cut) {
    const n = ring.length;
    const marks = [Object.assign({ tag: 1 }, cut.h1), Object.assign({ tag: 2 }, cut.h2)];
    const out = [], startIdx = [], idx = {}, toNext = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % n];
      const arc = arcOf(a, b);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      let cur = { x: a.x, y: a.y, b: 0 };
      startIdx[i] = out.length;
      out.push(cur);
      let prevU = 0;
      marks
        .filter((m) => m.i === i)
        .sort((p, q) => p.u - q.u)
        .forEach((m) => {
          if (Math.hypot(m.x - a.x, m.y - a.y) < 0.05) return void (idx[m.tag] = startIdx[i]);
          if (Math.hypot(m.x - b.x, m.y - b.y) < 0.05) return void toNext.push([m.tag, i]);
          cur.b = arc ? subBulge(arc, prevU, m.u) : 0;
          const v = { x: m.x, y: m.y, b: 0 };
          idx[m.tag] = out.length;
          out.push(v);
          cur = v;
          prevU = m.u;
        });
      cur.b = arc ? subBulge(arc, prevU, 1) : 0;
      void L;
    });
    toNext.forEach(([tag, i]) => (idx[tag] = startIdx[(i + 1) % n]));
    const s0 = idx[1], e0 = idx[2];
    if (s0 == null || e0 == null || s0 === e0) return null;
    const walk = (from, to) => {
      const r = [];
      for (let m = from; ; m = (m + 1) % out.length) {
        r.push(Object.assign({}, out[m]));
        if (m === to) break;
      }
      return r;
    };
    const A = walk(s0, e0);
    A[A.length - 1].b = 0;
    cut.inner.slice().reverse().forEach((p) => A.push(Object.assign({}, p)));
    const B = walk(e0, s0);
    B[B.length - 1].b = 0;
    cut.inner.forEach((p) => B.push(Object.assign({}, p)));
    return [A, B];
  }

  // Zach 2026-11-09: a fence that stops partway into a lawn is still a wall; heads spray around its
  // open end, never through it. The lawn ring is routed in along the fence from where it crosses
  // the edge to its end and back out the other side (a slit with no width), so both faces of the
  // fence become lawn edge. A fence piece with both ends inside the lawn becomes a slit hole.
  // Call after splitByFences, which has already used every fence that crosses all the way.
  function fenceSlits(outer, fences) {
    let ring = outer.map((v) => Object.assign({}, v));
    const holes = [];
    for (const f of fences) {
      if (f.length < 2) continue;
      const poly = ringPolygon(ring);
      const pts = f.map((p) => ({ x: p.x, y: p.y }));
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
      const total = cum[cum.length - 1];
      const at = (sv) => {
        let k = 0;
        while (k + 2 < cum.length && cum[k + 1] < sv) k++;
        const t = (sv - cum[k]) / (cum[k + 1] - cum[k] || 1);
        return { x: pts[k].x + t * (pts[k + 1].x - pts[k].x), y: pts[k].y + t * (pts[k + 1].y - pts[k].y) };
      };
      const hits = [];
      for (let k = 0; k + 1 < pts.length; k++)
        ring.forEach((a, i) =>
          edgeHits(pts[k], pts[k + 1], a, ring[(i + 1) % ring.length]).forEach((h) =>
            hits.push(Object.assign(h, { i, s: cum[k] + h.t * (cum[k + 1] - cum[k]) })),
          ),
        );
      hits.sort((a, b) => a.s - b.s);
      // inside the lawn and not lying on its edge: after a fence splits a lawn it runs along the new
      // edge of each piece, and reading that as inside cut slits down the edge itself (first run
      // of the random yards: 20 crashes and 16 ft overspray)
      const inside = (sv) => {
        const q = at(sv);
        if (!insidePolygon(poly, q.x, q.y)) return false;
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          if (segDist({ ax: a.x, ay: a.y, bx: b.x, by: b.y }, q.x, q.y) < 0.05) return false;
        }
        return true;
      };
      // fence points strictly between two distances, in order
      const between = (s0, s1) => {
        const out = [];
        for (let m = 1; m + 1 < pts.length; m++) if (cum[m] > s0 + 1e-6 && cum[m] < s1 - 1e-6) out.push({ x: pts[m].x, y: pts[m].y });
        return out;
      };
      const stubs = [];
      if (!hits.length) {
        if (inside(total / 2) && total > 0.5) holes.push(slitHole(pts));
        continue;
      }
      // the end before the first crossing, and the end after the last, if they're in the lawn; a
      // stub under FENCE_SNAP is a fence drawn just short of the edge, which counts as reaching it
      if (hits[0].s > FENCE_SNAP && inside(hits[0].s / 2))
        stubs.push({ h: hits[0], path: between(0, hits[0].s).reverse().concat([at(0)]) });
      const last = hits[hits.length - 1];
      if (total - last.s > FENCE_SNAP && inside((last.s + total) / 2)) stubs.push({ h: last, path: between(last.s, total).concat([at(total)]) });
      // apply one stub at a time; the ring changes, so the rest are found again next pass
      if (stubs.length) {
        ring = insertSlit(ring, stubs[0].h, stubs[0].path);
        if (stubs.length > 1) {
          const again = fenceSlits(ring, [f]);
          ring = again.outer;
          again.holes.forEach((h) => holes.push(h));
        }
      }
    }
    return { outer: ring, holes };
  }

  // A point inside the shape, for deciding which side of a fence a bed piece is on. The average
  // of the corners can sit outside an L-shaped piece (a bed on the bend of an L fence got
  // attached to the lawn on the wrong side, random yards 2026-11-09), so fall back to the middle
  // of a small triangle at a corner that is inside.
  function pointInside(ring) {
    const poly = ringPolygon(ring);
    const c = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, y: poly.reduce((a, p) => a + p.y, 0) / poly.length };
    if (insidePolygon(poly, c.x, c.y)) return c;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n], b = poly[i], d = poly[(i + 1) % n];
      const q = { x: (a.x + b.x + d.x) / 3, y: (a.y + b.y + d.y) / 3 };
      if (insidePolygon(poly, q.x, q.y)) return q;
    }
    return c;
  }

  // A bed piece cut by a fence sits flush on the fence, which is now the lawn's edge, and the
  // engine read that stretch of edge as lawn: two heads landed in the bed. Pulling the bed's
  // fence edges BED_OFF_FENCE ft back into the bed makes it a proper hole; the gap is too thin for
  // a head and under the 0.4 ft the coverage check skips at an edge.
  // Each edge lying on a fence moves square to itself, into the bed, and a corner between two such
  // edges moves to where the two moved edges meet. The old pull toward the corner average moved
  // the inside corner of an L-shaped bed piece (a bed on the bend of an L fence) across the fence,
  // so the hole poked out of its lawn and a 15VAN on that corner sprayed 8.7 ft past a straight
  // edge (random yards seed 3, yard 34, 2026-11-09).
  const BED_OFF_FENCE = 0.3;
  function offFence(ring, fences) {
    const onFence = (p, q) =>
      fences.some((f) =>
        f.some((a, i) => {
          const b = f[i + 1];
          if (!b) return false;
          const s = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
          return segDist(s, p.x, p.y) < 0.05 && segDist(s, q.x, q.y) < 0.05 && segDist(s, (p.x + q.x) / 2, (p.y + q.y) / 2) < 0.05;
        }),
      );
    const n = ring.length;
    const ccw = signedArea(ringPolygon(ring)) > 0;
    // inward normal of each straight edge that lies on a fence, null otherwise
    const normals = ring.map((p, i) => {
      const q = ring[(i + 1) % n];
      if (Math.abs(p.b || 0) > 1e-6 || !onFence(p, q)) return null;
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < 1e-9) return null;
      const lx = -(q.y - p.y) / L, ly = (q.x - p.x) / L; // left of travel
      return ccw ? { x: lx, y: ly } : { x: -lx, y: -ly };
    });
    if (!normals.some(Boolean)) return ring;
    return ring.map((p, i) => {
      const n1 = normals[(i - 1 + n) % n], n2 = normals[i];
      if (!n1 && !n2) return p;
      let mx, my;
      if (n1 && n2) {
        // miter: the two moved edges meet out along the bisector; capped for a needle-sharp turn
        const s = Math.min(1 / Math.max(1 + n1.x * n2.x + n1.y * n2.y, 1e-9), 4);
        mx = (n1.x + n2.x) * s;
        my = (n1.y + n2.y) * s;
      } else {
        const m = n1 || n2;
        mx = m.x;
        my = m.y;
      }
      return Object.assign({}, p, { x: p.x + mx * BED_OFF_FENCE, y: p.y + my * BED_OFF_FENCE });
    });
  }

  // out along the path and back: a hole with no area, for a fence floating inside a lawn
  function slitHole(pts) {
    const back = pts.slice(1, -1).reverse();
    return pts.concat(back).map((p) => ({ x: p.x, y: p.y, b: 0 }));
  }

  // Put a slit into the ring where the fence crosses edge h.i, running along path (from the edge
  // inward, ending at the fence's end) and straight back.
  function insertSlit(ring, h, path) {
    const n = ring.length;
    const a = ring[h.i], b = ring[(h.i + 1) % n];
    const arc = arcOf(a, b);
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = Object.assign({}, ring[i]);
      if (i !== h.i) {
        out.push(v);
        continue;
      }
      const bBefore = arc ? subBulge(arc, 0, h.u) : 0;
      const bAfter = arc ? subBulge(arc, h.u, 1) : 0;
      v.b = bBefore;
      out.push(v);
      out.push({ x: h.x, y: h.y, b: 0 });
      path.forEach((p) => out.push({ x: p.x, y: p.y, b: 0 }));
      path.slice(0, -1).reverse().forEach((p) => out.push({ x: p.x, y: p.y, b: 0 }));
      out.push({ x: h.x, y: h.y, b: bAfter });
    }
    return out;
  }

  // outer: [{x,y,b}] lawn ring; fences: [[{x,y}]]. Returns the lawn rings left after every fence
  // that crosses the lawn has split it. A fence that stops inside the lawn doesn't split it.
  function splitByFences(outer, fences) {
    let pieces = [outer];
    for (let guard = 0; guard < 40; guard++) {
      let changed = false;
      const next = [];
      for (const ring of pieces) {
        let done = false;
        for (const f of fences) {
          const cut = fenceCut(ring, f);
          if (!cut) continue;
          const two = cutRing(ring, cut);
          if (!two) continue;
          two.forEach((r) => {
            if (r.length >= 3 && polygonArea(ringPolygon(r)) >= 4) next.push(r);
          });
          done = changed = true;
          break;
        }
        if (!done) next.push(ring);
      }
      pieces = next;
      if (!changed) break;
    }
    return pieces;
  }

  /* ---------------- whole job ---------------- */

  // job: {areas:[{outer, holes, mode:'auto'|'spray'|'rotor'}], psi, cap, popupsOnly, dripZones}
  // Zach's rotor rule turned around (2026-11-09): a yard that's mostly pop-ups with 2 rotors goes
  // all pop-ups, and a rotor lawn with a lone pop-up or two that can't share a valve with other
  // pop-ups drops them, as long as nothing goes dry. In the example yard two 15Hs on the curved
  // back bed, 57 ft apart, each needed a valve to double-cover about 4 sq ft that rotors already
  // reached once. STRAY_GAP_SQFT caps how much single-only coverage that may leave.
  const STRAY_GAP_SQFT = 10;
  function dropStrayPopups(allHeads, zones, areaResults) {
    let dropped = false;
    for (const z of zones) {
      if (z.family !== "spray" || z.heads.length > 2) continue;
      const ai = z.heads[0].area;
      const lawn = allHeads.filter((h) => h.area === ai);
      if (!lawn.some((h) => h.kind === "R")) continue; // a pop-up lawn keeps its pop-ups
      const G = areaResults[ai].G;
      const before = areaResults[ai].check;
      const without = lawn.filter((h) => !z.heads.includes(h));
      const after = verify(G, without);
      const addedSqft = (after.gaps - before.gaps) * 0.25; // verify samples every 0.5 ft
      const dry = after.gapPts.some((g) => g.c === 0);
      if (addedSqft > STRAY_GAP_SQFT || dry || after.overspray > before.overspray) continue;
      z.heads.forEach((h) => allHeads.splice(allHeads.indexOf(h), 1));
      areaResults[ai].check = after;
      areaResults[ai].strays = (areaResults[ai].strays || 0) + z.heads.length;
      dropped = true;
    }
    return dropped;
  }

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
    let zones = zoneHeads(allHeads, job.cap || 12);
    if (dropStrayPopups(allHeads, zones, areaResults)) zones = zoneHeads(allHeads, job.cap || 12);
    const p = parts(allHeads, zones, job.drip || 0, job.water);
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
    dripPlan,
    splitByFences,
    fenceSlits,
    pointInside,
    offFence,
    dripRolls,
    WATER_SOURCE_PARTS,
    swingRolls,
    FIXED,
    VAN,
    ROTOR,
    arcPoints,
    orient,
  };
});
