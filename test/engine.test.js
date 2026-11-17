// Runs the layout engine on a set of yards and checks Zach's two rules with an independent checker.
// node test/engine.test.js
const E = require("../js/engine.js");

const P = (pts) => pts.map(([x, y, b]) => ({ x, y, b: b || 0 }));
const yards = {
  "small rectangle 30x20": {
    outer: P([
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ]),
  },
  "pentagon 35x34": {
    outer: P([
      [0, 0],
      [35, 0],
      [38, 20],
      [17, 34],
      [-3, 20],
    ]),
  },
  "L shape 80x65": {
    outer: P([
      [0, 65],
      [0, 0],
      [80, 0],
      [80, 35],
      [40, 35],
      [40, 65],
    ]),
  },
  "odd angles": {
    outer: P([
      [0, 0],
      [42, 4],
      [50, 30],
      [12, 38],
    ]),
  },
  "curved front edge": {
    outer: P([
      [0, 0],
      [40, 0, -6],
      [40, 25],
      [0, 25],
    ]),
  },
  "bed in the middle": {
    outer: P([
      [0, 0],
      [45, 0],
      [45, 30],
      [0, 30],
    ]),
    holes: [
      P([
        [18, 10],
        [28, 10],
        [28, 18],
        [18, 18],
      ]),
    ],
  },
  "narrow side strip 6x40": {
    outer: P([
      [0, 0],
      [6, 0],
      [6, 40],
      [0, 40],
    ]),
  },
  "big back lawn 110x70": {
    outer: P([
      [0, 0],
      [110, 0],
      [110, 70],
      [0, 70],
    ]),
  },
  "back lawn with side strip": {
    outer: P([
      [0, 0],
      [70, 0],
      [70, 50],
      [8, 50],
      [8, 90],
      [0, 90],
    ]),
  },
  "medium square 40x40": {
    outer: P([
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ]),
  },
  "big L 120x90": {
    outer: P([
      [0, 0],
      [120, 0],
      [120, 45],
      [60, 45],
      [60, 90],
      [0, 90],
    ]),
  },
};

let fail = 0;
for (const [name, area] of Object.entries(yards)) {
  const t0 = Date.now();
  const out = E.layoutJob({
    areas: [Object.assign({ mode: "auto" }, area)],
    psi: 50,
    cap: 12,
    dripZones: 1,
  });
  const ms = Date.now() - t0;
  const a = out.areas[0];
  const c = a.check;
  const counts = {};
  out.heads.forEach((h) => (counts[h.label] = (counts[h.label] || 0) + 1));
  const overCap = out.zones.filter((z) => z.gpm > 12 + 1e-9).length;
  const smallRotor = out.zones.filter(
    (z) => z.family === "rotor" && z.heads.length < 3,
  ).length;
  const offEdgeH = out.heads.filter(
    (h) => h.kind === "H" && h.role === "interior",
  ).length;
  const ok =
    c.overspray === 0 &&
    c.coverage >= 0.995 &&
    overCap === 0 &&
    smallRotor === 0 &&
    offEdgeH === 0;
  if (!ok) fail++;
  console.log(
    (ok ? "PASS " : "FAIL ") + name.padEnd(24),
    a.family.padEnd(6),
    String(out.heads.length).padStart(3) + " heads",
    String(out.zones.length).padStart(2) + " zones",
    "overspray " +
      c.overspray +
      " (worst " +
      c.worstOverspray.toFixed(2) +
      " ft)",
    "coverage " + (c.coverage * 100).toFixed(2) + "%",
    overCap ? "OVERCAP " + overCap : "",
    smallRotor ? "SMALLROTOR " + smallRotor : "",
    ms + "ms",
  );
  console.log(
    "      ",
    Object.entries(counts)
      .map(([k, v]) => k + "x" + v)
      .join(" "),
    "| zones",
    out.zones.map((z) => z.heads.length + "/" + z.gpm.toFixed(1)).join(" "),
  );
}

// nozzle rules straight from the chat
const eq = (a, b, msg) => {
  if (a !== b) {
    fail++;
    console.log("FAIL", msg, a, "!=", b);
  }
};
eq(E.sprayKind(85), "Q", "85 deg is a Q");
eq(E.sprayKind(92), "VAN", "92 deg is a VAN");
eq(E.sprayKind(178), "H", "178 deg is an H");
eq(E.sprayKind(250), "VAN", "250 deg is a VAN");
eq(
  E.nozzle("VAN", 250, 13).gpm,
  2.78,
  "15VAN at 250 uses the 270 GPM (rounds up)",
);
eq(E.nozzle("R", 90, 27).label, "R1", "5004 quarter is R1");
eq(E.nozzle("R", 180, 22).label, "S2", "3504 half is S2");
eq(E.nozzle("R", 135, 24).model, "5004", "24 ft goes to the 5004");
eq(E.nozzle("R", 360, 17.5), null, "no rotor under 18 ft");
eq(E.nozzle("R", 180, 18).label, "S2", "3504 reaches down to 18 ft");
eq(E.nozzle("R", 180, 23.6).r, 23, "23 to 24 ft drops to a 3504 at 23");
eq(E.nozzle("R", 180, 23.6).model, "3504", "23.6 ft is a 3504");
eq(E.nozzle("H", 180, 13).label, "15H", "13 ft H is a 15H");
eq(E.nozzle("H", 180, 9.5).label, "12H", "9.5 ft H is a throttled 12H");

// regressions from review: a low cap used to crash fixSmallRotorZones on an emptied zone
{
  const sq = P([[0, 0], [110, 0], [110, 70], [0, 70]]);
  try {
    E.layoutJob({ areas: [{ outer: sq, mode: "auto" }], psi: 50, cap: 3 });
  } catch (e) {
    fail++;
    console.log("FAIL low cap crashes:", e.message);
  }
  const o = E.layoutJob({ areas: [{ outer: sq, mode: "auto" }], psi: 50, cap: 10 });
  const small = o.zones.filter((z) => z.family === "rotor" && z.heads.length < 3).length;
  eq(small, 0, "no rotor zone under 3 heads at a 10 GPM cap");
}

// Zach 2026-11-06: only 2 rotors fit means pop-ups. Sweep lawn sizes and never allow a rotor zone under 3.
for (let w = 20; w <= 62; w += 7)
  for (let h = 20; h <= 62; h += 7) {
    const o = E.layoutJob({ areas: [{ outer: P([[0, 0], [w, 0], [w, h], [0, h]]), mode: "auto" }], psi: 50, cap: 12 });
    const short = o.zones.filter((z) => z.family === "rotor" && z.heads.length < 3).length;
    if (short) { fail++; console.log("FAIL", w + "x" + h, "has a rotor zone under 3 heads"); }
  }


// Zach 2026-11-07: swing joints. 1/2" elbow per pop-up and 3504, 3/4" per 5004,
// 3 ft of swing pipe per head in 100 ft rolls, whole rolls rounded up, at least one.
eq(E.swingRolls(1), 1, "1 head is still 1 roll");
eq(E.swingRolls(33), 1, "33 heads = 99 ft = 1 roll");
eq(E.swingRolls(34), 2, "34 heads = 102 ft = 2 rolls");
eq(E.swingRolls(67), 3, "67 heads = 201 ft = 3 rolls");
eq(E.swingRolls(0), 0, "no heads, no pipe");
{
  const fake = [
    { kind: "S", label: "15Q" }, { kind: "S", label: "15H" }, { kind: "S", label: "15H" },
    { kind: "R", model: "3504", gpmBase: 1 }, { kind: "R", model: "3504", gpmBase: 2 },
    { kind: "R", model: "5004", gpmBase: 3 }, { kind: "R", model: "5004", gpmBase: 3 }, { kind: "R", model: "5004", gpmBase: 4 },
  ];
  const p = E.parts(fake, [{}, {}], 0);
  const q = (item) => (p.lines.find((l) => l.item.startsWith(item)) || {}).qty;
  eq(q('1/2" swing elbow'), 5, "3 pop-ups + 2 3504s get 1/2 inch elbows");
  eq(q('3/4" swing elbow'), 3, "3 5004s get 3/4 inch elbows");
  eq(q("Swing pipe"), 1, "8 heads = 24 ft = 1 roll");
}
{
  // every generated job: elbows add up to the head count and rolls follow the rule
  const o = E.layoutJob({ areas: [{ outer: P([[0, 0], [120, 0], [120, 90], [0, 90]]), mode: "auto" }], psi: 50, cap: 12 });
  const q = (item) => (o.parts.lines.find((l) => l.item.startsWith(item)) || { qty: 0 }).qty;
  eq(q('1/2" swing elbow') + q('3/4" swing elbow'), o.heads.length, "one elbow per head on a real job");
  eq(q("Swing pipe"), Math.max(1, Math.ceil((o.heads.length * 3) / 100)), "rolls on a real job");
}


// Zach 2026-11-07: one zone valve per zone in the manifold section; culinary adds a backflow
// preventer, secondary a filter; sections run heads, pipe, fittings, manifold, controller, water.
{
  const fake = [{ kind: "S", label: "15H" }, { kind: "R", model: "5004", gpmBase: 3 }];
  const zones3 = [{}, {}, {}];
  const groups = (p) => [...new Set(p.lines.map((l) => l.group))];
  const cul = E.parts(fake, zones3, 0, "culinary");
  const sec = E.parts(fake, zones3, 0, "secondary");
  const none = E.parts(fake, zones3, 0);
  eq(cul.lines.find((l) => l.item === "Zone valve").qty, 3, "a zone valve for each of 3 zones");
  eq(cul.lines.find((l) => l.item === "Zone valve").group, "Manifold", "zone valves sit in the manifold section");
  eq(!!cul.lines.find((l) => l.item === "Backflow setup"), true, "culinary gets a backflow setup");
  eq(!!cul.lines.find((l) => l.item === "Filter setup"), false, "culinary gets no filter");
  eq(!!sec.lines.find((l) => l.item === "Filter setup"), true, "secondary gets a filter setup");
  eq(!!sec.lines.find((l) => l.item === "Backflow setup"), false, "secondary gets no backflow");
  eq(none.waterSet, false, "no water source flagged as unset");
  eq(groups(cul).join(" > "), "Spray heads > Spray nozzles > Rotors > Pipe > Fittings > Manifold > Controller > Culinary water connection", "section order");
}


// Zach 2026-11-08: rotors counted by model only (they come with every nozzle); pop-ups as one
// body count plus a count per nozzle that's actually on the map, never a zero line.
{
  const fake = [
    { kind: "S", label: "15H" }, { kind: "S", label: "15H" }, { kind: "S", label: "8Q" },
    { kind: "R", model: "5004", gpmBase: 2 }, { kind: "R", model: "5004", gpmBase: 4 },
    { kind: "R", model: "3504", gpmBase: 1 },
  ];
  const p = E.parts(fake, [{}], 0, "culinary");
  const rot = p.lines.filter((l) => l.group === "Rotors").map((l) => l.item + " x" + l.qty);
  eq(rot.join(", "), "5004 rotor x2, 3504 rotor x1", "rotors by model, no nozzle lines");
  eq(p.lines.find((l) => l.item === "1804 pop-up spray body").qty, 3, "pop-up body total");
  const noz = p.lines.filter((l) => l.group === "Spray nozzles").map((l) => l.item + " x" + l.qty);
  eq(noz.join(", "), "15H x2, 8Q x1", "a count per pop-up nozzle on the map, named without the word nozzle");
  eq(p.lines.some((l) => l.qty === 0), false, "no zero lines");
}


// Zach 2026-11-08: curved edges get slight overspray (up to ARC_OVER, 1 ft) and no small VANs
// (4VAN, 6VAN) along them; straight edges still get zero overspray.
{
  const curvy = {
    "bed curving in": P([[0, 0], [50, 0], [50, 40], [0, 40, 10]]),
    "lawn bulging out": P([[0, 0], [50, 0], [50, 40], [0, 40, -10]]),
    "kidney": P([[0, 0, 5], [40, 0, -6], [40, 30, 5], [0, 30, -6]]),
    "curved bed line": P([[0, 0], [60, 0, 6], [60, 35], [0, 35]]),
    "big curve": P([[0, 0], [90, 0], [90, 60, -15], [0, 60]]),
  };
  for (const [name, outer] of Object.entries(curvy))
    for (const mode of ["spray", "auto"]) {
      const o = E.layoutJob({ areas: [{ outer, mode }], psi: 50, cap: 12 });
      const small = o.heads.filter((h) => /^(4|6)VAN$/.test(h.label)).length;
      eq(small, 0, name + " " + mode + ": no 4VAN or 6VAN on a curved lawn");
      eq(o.areas[0].check.overspray, 0, name + " " + mode + ": overspray within the curve allowance");
      if (o.areas[0].check.coverage < 0.99) { fail++; console.log("FAIL", name, mode, "coverage", o.areas[0].check.coverage); }
    }
  // nothing past a curve over 1 ft, ever (verify flags past ARC_OVER; worst stays on its 0.35 scale)
  const o = E.layoutJob({ areas: [{ outer: curvy["kidney"], mode: "spray" }], psi: 50, cap: 12 });
  if (o.areas[0].check.worstOverspray > 0.35) { fail++; console.log("FAIL kidney worst overspray over the allowance"); }
  // Zach: small VANs aren't banned, "there will be curves where people are in a tight area and
  // require a smaller head". A 4 ft curved strip still gets them.
  const tight = E.layoutJob({ areas: [{ outer: P([[0, 0, 6], [30, 0], [30, 4, -6], [0, 4]]), mode: "spray" }], psi: 50, cap: 12 });
  eq(tight.heads.some((h) => /^(4|6)VAN$/.test(h.label)), true, "a tight curved strip can still use small VANs");
  eq(tight.areas[0].check.overspray, 0, "tight curved strip stays within the overspray limit");
}


// Zach 2026-11-08: drip. Width checked all over each bed; over 7 ft gets an extra row there.
// 250 ft per drip zone (beds only, not the line from the valve box). Separate beds are separate
// zones, touching beds share one, a bed under 20 ft of pipe joins one nearby. Rolls 100/250/500.
{
  const R = (x, y, w, h) => [{ x, y, b: 0 }, { x: x + w, y, b: 0 }, { x: x + w, y: y + h, b: 0 }, { x, y: y + h, b: 0 }];
  const plan = (...beds) => E.dripPlan(beds.map((pts, i) => ({ id: i, pts })));
  eq(plan(R(0, 0, 40, 3)).ft, 40, "3x40 bed is one 40 ft row");
  eq(plan(R(0, 0, 40, 7)).ft, 40, "a 7 ft wide bed is still one row");
  eq(plan(R(0, 0, 40, 8)).ft, 80, "over 7 ft wide gets a second row");
  eq(plan(R(0, 0, 40, 40)).ft, 240, "a 40 ft square runs 6 rows along a side");
  const L = [[0, 0], [30, 0], [30, 4], [4, 4], [4, 30], [0, 30]].map(([x, y]) => ({ x, y, b: 0 }));
  const lf = plan(L).ft;
  if (lf < 52 || lf > 60) { fail++; console.log("FAIL L-shaped 4 ft bed should be about 56 ft, got", lf); }
  const big = plan(R(0, 0, 300, 3));
  eq(big.zones.length, 2, "300 ft of drip splits into 2 zones");
  eq(Math.max(...big.zones.map((z) => z.ft)) <= 250, true, "no drip zone over 250 ft");
  eq(plan(R(0, 0, 20, 3), R(20, 0, 20, 3)).zones.length, 1, "touching beds share a zone");
  eq(plan(R(0, 0, 100, 3), R(0, 50, 100, 3)).zones.length, 2, "separate beds are separate zones");
  eq(plan(R(0, 0, 40, 3), R(0, 15, 6, 2)).zones.length, 1, "a small bed nearby joins the zone");
  eq(plan(R(0, 0, 40, 3), R(0, 80, 6, 2)).zones.length, 2, "a small bed far away gets its own zone");
  // Zach 2026-11-08 rolls: 100s up to 350 ft, 250s and 100s to 750, 500s past that, no leftover
  const rolls = (ft) => { const r = E.dripRolls(ft); return [500, 250, 100].map((k) => r[k] || 0).join("/"); };
  eq(rolls(40), "0/0/1", "40 ft is one 100 roll");
  eq(rolls(350), "0/0/4", "350 ft is four 100s");
  eq(rolls(600), "0/2/1", "600 ft is two 250s and a 100");
  eq(rolls(750), "0/3/0", "750 ft is three 250s");
  eq(rolls(760), "1/0/3", "760 ft gets a 500 and three 100s");
  eq(rolls(1000), "2/0/0", "1000 ft is two 500s");
  eq(plan(R(0, 0, 40, 3), R(0, 20, 6, 2)).zones.length, 2, "a small bed 17 ft away is its own zone");
  eq(plan(R(0, 0, 40, 3), R(0, 15, 6, 2)).zones.length, 1, "a small bed 12 ft away joins");
  const p = E.parts([{ kind: "S", label: "15H" }], [{}], plan(R(0, 0, 40, 3), R(0, 50, 100, 3)), "culinary");
  eq(p.lines.find((l) => l.item === "Drip zone valve").qty, 2, "a drip zone valve per drip zone");
  eq(p.lines.find((l) => l.item === "Drip zone valve").group, "Manifold", "drip valves in the manifold");
  eq(p.stations, 3, "drip zones count as controller stations");
  eq(!!p.lines.find((l) => /^Drip pipe, 100 ft roll/.test(l.item)), true, "drip pipe on the list");
  // Zach 2026-11-08: a Drip section with the total feet, 3 tees and 1 coupling per 100 ft, no
  // elbows, a figure 8 end cap per separate drip area, and the roll size changeable.
  const d = plan(R(0, 0, 140, 3), R(0, 50, 100, 3), R(0, 100, 20, 3), R(20, 100, 20, 3));
  const dp = E.parts([], [], d, "culinary");
  const q = (item) => (dp.lines.find((l) => l.item === item) || {}).qty;
  eq(d.ft, 280, "drip total for four beds");
  eq(dp.notes.Drip, "280 ft of drip pipe", "total drip feet in the Drip header");
  eq(dp.lines.some((l) => /total/i.test(l.item)), false, "no separate total line");
  eq(q("Drip tee"), 9, "3 tees per 100 ft, rounded up");
  eq(q("Drip coupling"), 3, "1 coupling per 100 ft, rounded up");
  eq(q("Figure 8 end cap"), 3, "an end cap per drip area (two touching beds are one area)");
  eq(dp.lines.some((l) => /elbow/i.test(l.item) && l.group === "Drip"), false, "no drip elbows");
  eq(dp.lines.filter((l) => (/^Drip /.test(l.item) || /end cap/.test(l.item)) && l.item !== "Drip zone valve").every((l) => l.group === "Drip"), true, "drip parts in the Drip section");
  eq((dp.lines.find((l) => l.item === "Drip zone valve") || {}).group, "Manifold", "drip valves stay with the manifold");

}


// pop-up zones of one or two heads join a nearby pop-up zone (the example yard had three
// single-15H zones along a curved edge of a rotor lawn)
{
  const chord = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const S = (pts) => P(pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [p[0], p[1], (p[2] || 0) * chord(p, q)]; }));
  const o = E.layoutJob({
    areas: [
      { outer: S([[0, 40], [90, 40], [90, 110, 8 / 90], [0, 110]]), holes: [S([[55, 70, 0.2071], [60, 75, 0.2071], [65, 70, 0.2071], [60, 65, 0.2071]])], mode: "auto" },
      { outer: S([[96, 40], [106, 40], [106, 110], [96, 110]]), mode: "auto" },
      { outer: S([[0, -50], [70, -50], [70, -12], [0, -12, -6 / 38]]), mode: "auto" },
    ],
    psi: 50,
    cap: 12,
  });
  const tiny = o.zones.filter((z) => z.family === "spray" && z.heads.length < 3).length;
  eq(tiny, 0, "stray pop-ups along the back bed share a valve");
  eq(o.zones.every((z) => z.gpm <= 12 + 1e-9), true, "every zone still under the GPM cap");
}


// Zach 2026-11-09: a zone stays in one part of the yard. No head sits off on its own away from
// the rest of its zone, and two zones that are neighbours and fit under the cap together are merged.
{
  const chord = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const S = (pts) => P(pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [p[0], p[1], (p[2] || 0) * chord(p, q)]; }));
  const jobs = {
    "example": [
      { outer: S([[0, 40], [90, 40], [90, 110, 8 / 90], [0, 110]]), mode: "auto" },
      { outer: S([[96, 40], [106, 40], [106, 110], [96, 110]]), mode: "auto" },
      { outer: S([[0, -50], [70, -50], [70, -12], [0, -12, -6 / 38]]), mode: "auto" },
    ],
    "big rectangle": [{ outer: S([[0, 0], [120, 0], [120, 90], [0, 90]]), mode: "auto" }],
    "L shape": [{ outer: S([[0, 65], [0, 0], [80, 0], [80, 35], [40, 35], [40, 65]]), mode: "spray" }],
    "two lawns far apart": [
      { outer: S([[0, 0], [20, 0], [20, 15], [0, 15]]), mode: "spray" },
      { outer: S([[0, 120], [20, 120], [20, 135], [0, 135]]), mode: "spray" },
    ],
  };
  for (const [name, areas] of Object.entries(jobs)) {
    const o = E.layoutJob({ areas, psi: 50, cap: 12 });
    for (const z of o.zones) {
      // connected when each link is within 45 ft or the two heads' sprays reach each other
      // (30 ft rotors sit 45.3 ft apart on a diagonal, head to head)
      const seen = new Set([z.heads[0]]);
      const stack = [z.heads[0]];
      while (stack.length) {
        const u = stack.pop();
        for (const v of z.heads) if (!seen.has(v) && Math.hypot(u.x - v.x, u.y - v.y) <= Math.max(45, u.r + v.r)) { seen.add(v); stack.push(v); }
      }
      if (seen.size !== z.heads.length) { fail++; console.log("FAIL", name, "zone", z.n, "is split across the yard"); }
    }
  }
  const far = E.layoutJob({ areas: jobs["two lawns far apart"], psi: 50, cap: 12 });
  eq(far.zones.length >= 2, true, "lawns 105 ft apart never share a zone");
}


// Zach 2026-11-09: a fence is a boundary with no width. A fence across a lawn splits it, and no
// head sprays across the fence line.
{
  const dens = (r) => { const o = []; r.forEach((v, i) => { o.push(v); E.arcPoints(v, r[(i + 1) % r.length], v.b, 0.25).forEach((q) => o.push(q)); }); return o; };
  const area = (r) => { r = dens(r); let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j].x + r[i].x) * (r[j].y - r[i].y); return Math.abs(s) / 2; };
  const rect = P([[0, 0], [60, 0], [60, 40], [0, 40]]);
  const across = [[{ x: 30, y: -2 }, { x: 30, y: 42 }]];
  eq(E.splitByFences(rect, across).length, 2, "a fence across a lawn splits it in two");
  eq(E.splitByFences(rect, [[{ x: 30, y: 0.5 }, { x: 30, y: 39.5 }]]).length, 2, "a fence stopped just short of the edge still splits");
  eq(E.splitByFences(rect, [[{ x: 30, y: -2 }, { x: 30, y: 20 }]]).length, 1, "a fence that stops inside the lawn doesn't split it");
  eq(E.splitByFences(rect, [[{ x: -2, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 42 }]]).length, 2, "an L-shaped fence splits");
  eq(E.splitByFences(rect, [[{ x: 20, y: -2 }, { x: 20, y: 42 }], [{ x: 40, y: -2 }, { x: 40, y: 42 }]]).length, 3, "two fences make three lawns");
  const curved = P([[0, 0], [60, 0], [60, 40, 8], [0, 40]]);
  const halves = E.splitByFences(curved, [[{ x: 30, y: -2 }, { x: 30, y: 60 }]]);
  eq(Math.round(halves.reduce((a, r) => a + area(r), 0)), Math.round(area(curved)), "split pieces add up to the whole curved lawn");
  eq(halves.every((r) => r.some((v) => Math.abs(v.b) > 1)), true, "each half keeps its piece of the curve");
  for (const mode of ["auto", "spray"]) {
    const pieces = E.splitByFences(P([[0, 0], [90, 0], [90, 60], [0, 60]]), [[{ x: 45, y: -2 }, { x: 45, y: 62 }]]);
    const leftArea = pieces.map((r) => r.reduce((a, v) => a + v.x, 0) / r.length).map((cx) => cx < 45);
    const o = E.layoutJob({ areas: pieces.map((outer) => ({ outer, mode })), psi: 50, cap: 12 });
    let worst = 0;
    for (const h of o.heads) {
      const onLeft = leftArea[h.area];
      const full = h.arc >= 359.5, a0 = full ? 0 : h.dir - h.arc / 2, span = full ? 360 : h.arc;
      for (let i = 0; i <= Math.ceil(span); i++) {
        const a = ((a0 + (span * i) / Math.ceil(span)) * Math.PI) / 180;
        const x = h.x + h.r * Math.cos(a);
        const side = onLeft ? x - 45 : 45 - x; // how far past the fence on the far side
        worst = Math.max(worst, side);
      }
    }
    if (worst > 0.35) { fail++; console.log("FAIL", mode, "a head sprays", worst.toFixed(2), "ft across the fence"); }
    eq(o.areas[0].check.overspray + o.areas[1].check.overspray, 0, mode + ": no overspray with a fence across the yard");
  }
}


// a bed that runs across a fence is cut out of the lawn on both sides (2026-11-09: a bed strip
// crossing a fence only cut into one side and the other side put pop-ups in the bed)
{
  const lawn = P([[0, 0], [80, 0], [80, 60], [0, 60]]);
  const bed = P([[10, 40], [70, 40], [70, 46], [10, 46]]);
  const fence = [[{ x: 40, y: -2 }, { x: 40, y: 62 }]];
  const lawns = E.splitByFences(lawn, fence);
  const split = E.splitByFences(bed, fence);
  eq(split.length, 2, "the bed splits along the fence too");
  // the same 0.3 ft pull-back from the fence that js/app.js makes
  const beds = split.map((r) => E.offFence(r, fence));
  const inside = (r, p) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  const areas = lawns.map((outer) => ({ outer, mode: "spray", holes: beds.filter((h) => inside(outer, { x: h.reduce((a, p) => a + p.x, 0) / h.length, y: h.reduce((a, p) => a + p.y, 0) / h.length })) }));
  eq(areas.every((a) => a.holes.length === 1), true, "each side of the fence gets its piece of the bed");
  const o = E.layoutJob({ areas, psi: 50, cap: 12 });
  const inBed = o.heads.filter((h) => h.x > 10.5 && h.x < 69.5 && h.y > 40.5 && h.y < 45.5).length;
  eq(inBed, 0, "no heads inside a bed that crosses a fence");
}


// random yard 10, 2026-11-09: a fence slanted under 5 degrees off a straight lawn edge isn't a
// corner, and that small bend used to switch on the curve allowance: 0.9 ft past a straight edge
{
  const L = P([[190, 3.3], [225.2, 3.3], [225.2, 32.8], [213.5, 32.8], [213.5, 76.3], [190.1, 76.3]]);
  const pieces = E.splitByFences(L, [[{ x: 209.6, y: 1.3 }, { x: 213.8, y: 78.3 }]]);
  const o = E.layoutJob({ areas: pieces.map((outer) => ({ outer, mode: "auto" })), psi: 50, cap: 12 });
  eq(o.totals.overspray, 0, "no overspray beside a slightly slanted fence");
}


// random yards seed 3, yard 34, 2026-11-09: a bed on the bend of an L fence splits into an L piece.
// Pulling it off the fence toward its corner average moved the inside corner across the fence, the
// hole poked out of its lawn, and a 15VAN on that corner sprayed 8.7 ft past a straight edge. In
// the same commit js/app.js lost its offFence() while still calling it, so any lawn with a bed
// threw; the app and the random yards now share E.offFence.
{
  const lawn = P([[0, -0.6], [84.9, -0.6], [84.9, 58.3], [0, 58.3]]);
  const fence = [[{ x: -2, y: 35.4 }, { x: 42.5, y: 35.4 }, { x: 42.5, y: 60.3 }]];
  const bed = P([[32.8, 33.3], [43.4, 33.3], [43.4, 37.9], [32.8, 37.9]]);
  eq(typeof E.offFence, "function", "the engine has offFence for js/app.js");
  const inside = (r, p) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  const pieces = E.splitByFences(lawn, fence);
  const beds = E.splitByFences(bed, fence).map((h) => E.offFence(h, fence));
  const areas = pieces.map((outer) => ({ outer, mode: "auto", holes: beds.filter((h) => inside(outer, E.pointInside(h))) }));
  eq(areas.every((a) => a.holes.length === 1), true, "each side of the L fence gets its piece of the bed");
  eq(areas.every((a) => a.holes.every((h) => h.every((p) => inside(a.outer, p)))), true, "a bed piece pulled off the fence stays inside its own lawn");
  const o = E.layoutJob({ areas, psi: 60, cap: 12 });
  eq(o.totals.overspray, 0, "no overspray from a head on a bed corner at the bend of an L fence");
}


// random yards seed 3, yard 44: a bed 2.4 ft from an L fence leaves a thin strip that comes out
// single covered in spots (98.2%). Zach chose to leave it rather than add 4VANs (2026-11-10), so
// this only checks the strip stays free of overspray and doesn't sprout sliver heads again.
{
  const inside = (r, p) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  const lawn = P([[37.59, 8.86], [24.44, 21.62], [6.5, 17.23], [6.76, 0.65], [24.77, -4.78]]);
  const fence = [[{ x: 4.5, y: 11.04 }, { x: 22.04, y: 11.04 }, { x: 22.04, y: 23.62 }]];
  const bed = P([[14.02, 4.6], [25.74, 4.6], [25.74, 8.63], [14.02, 8.63]]);
  const areas = E.splitByFences(lawn, fence).map((outer) => ({ outer, mode: "auto", holes: inside(outer, E.pointInside(bed)) ? [bed] : [] }));
  const o = E.layoutJob({ areas, psi: 60, cap: 9 });
  eq(o.totals.overspray, 0, "no overspray around a thin strip between a bed and a fence");
  eq(o.heads.length, 28, "no extra sliver heads in the thin strip");
}


// Zach 2026-11-10: per sprinkler zone 1 coupling, 2 tees, 1 swing adapter; per yard 2 elbows and
// 30 mainline pinch clamps; 1 bag of LD pinch clamps per 10 zones; both water setups get a
// stainless steel ball valve
{
  const zones = (n) => Array.from({ length: n }, () => ({}));
  const q = (p, item) => (p.lines.find((l) => l.item === item) || { qty: 0 }).qty;
  const p7 = E.parts([{ kind: "S", label: "15H" }], zones(7), 0, "secondary");
  eq(q(p7, "coupling"), 7, "a coupling per zone");
  eq(q(p7, "tee"), 14, "2 tees per zone");
  eq(q(p7, "Swing adapter"), 7, "a swing adapter per zone");
  eq(q(p7, "elbow"), 2, "2 elbows per yard");
  eq(q(p7, "mainline pinch clamp"), 30, "30 mainline pinch clamps per yard");
  eq(q(p7, "LD pinch clamps, bag"), 1, "7 zones, 1 bag of LD clamps");
  eq(q(E.parts([], zones(10), 0, "secondary"), "LD pinch clamps, bag"), 1, "10 zones, 1 bag");
  eq(q(E.parts([], zones(11), 0, "secondary"), "LD pinch clamps, bag"), 2, "11 zones, 2 bags");
  eq(q(p7, "Filter setup"), 1, "secondary: filter setup");
  eq(q(p7, "Stainless steel ball valve"), 1, "secondary: a ball valve");
  eq(q(E.parts([], zones(3), 0, "culinary"), "Stainless steel ball valve"), 1, "culinary: a ball valve");
  eq(q(E.parts([], [], 0, "culinary"), "coupling"), 0, "no zones, no lateral fittings");
  // Zach 2026-11-10: a saddle per head; lateral fittings carry the lateral size, mainline clamps
  // the supply size, swing elbows and swing adapters no size
  const heads3 = [{ kind: "S", label: "15H" }, { kind: "S", label: "12Q" }, { kind: "R", model: "5004", gpmBase: 2 }];
  const sized = E.parts(heads3, zones(2), 0, "culinary", null, { lateral: '1"', main: '3/4"' });
  eq(q(sized, '1" saddle'), 3, "a saddle per head, lateral size");
  eq(q(sized, '1" coupling'), 2, "couplings sized to the lateral");
  eq(q(sized, '1" tee'), 4, "tees sized to the lateral");
  eq(q(sized, '1" elbow'), 2, "elbows sized to the lateral");
  eq(q(sized, '1" LD pinch clamps, bag'), 1, "LD clamps sized to the lateral");
  eq(q(sized, '3/4" mainline pinch clamp'), 30, "mainline clamps sized to the supply");
  eq(q(sized, "Swing adapter"), 2, "swing adapters have no size");
  eq(q(sized, '1/2" swing elbow') + q(sized, '3/4" swing elbow'), 3, "swing elbows keep their own sizes");
}


// Zach 2026-11-15, his Camera v1 lawn (walked with the camera): "pop ups along the north curvy side
// and rotors along the straight south. split down the middle". Going around the edge the heads may
// switch between rotor and pop-up only twice: one run of rotors, one run of pop-ups. Before this rule
// the north edge went R1, 12VAN, 15VAN, R1, 12VAN, 10H, R0.5, ... (14 switches).
{
  const cam = P([[37.3, -14.4, 0.0], [-60.9, 29.7, 0.78], [-57.2, 35.5, 0.43], [-46.5, 52.4, 0.0], [-34.4, 46.1, 0.0], [-28.5, 46.8, 0.0], [-23.1, 47.8, -1.26], [-19.2, 40.5, -3.43], [-8.2, 44.5, 0.0], [-2.4, 37.0, 0.36], [13.8, 31.0, -0.75], [26.7, 12.9, -0.76], [41.5, -6.1, 0.0]]);
  const o = E.layoutJob({ areas: [{ outer: cam, mode: "auto" }], psi: 50, cap: 18 });
  const n = cam.length;
  let acc = 0;
  const sides = cam.map((a, i) => {
    const b = cam[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y), sd = { a, b, L, s: acc };
    acc += L;
    return sd;
  });
  const along = o.heads
    .map((h) => {
      let best = Infinity, pos = 0;
      sides.forEach((sd) => {
        const dx = sd.b.x - sd.a.x, dy = sd.b.y - sd.a.y;
        const t = Math.max(0, Math.min(1, ((h.x - sd.a.x) * dx + (h.y - sd.a.y) * dy) / (sd.L * sd.L)));
        const d = Math.hypot(h.x - sd.a.x - t * dx, h.y - sd.a.y - t * dy);
        if (d < best) { best = d; pos = sd.s + t * sd.L; }
      });
      return { d: best, pos, rot: h.kind === "R" };
    })
    .filter((q) => q.d < 4)
    .sort((p, q) => p.pos - q.pos);
  let switches = 0;
  along.forEach((q, i) => { if (q.rot !== along[(i + 1) % along.length].rot) switches++; });
  eq(switches <= 2, true, "Camera v1: rotors and pop-ups each keep one run around the edge (" + switches + " switches)");
  eq(o.heads.some((h) => h.kind === "R") && o.heads.some((h) => h.kind !== "R"), true, "Camera v1 still has both rotors and pop-ups");
  eq(o.totals.overspray, 0, "Camera v1: no overspray");
  eq(o.totals.coverage >= 0.995, true, "Camera v1: double covered (" + (o.totals.coverage * 100).toFixed(2) + "%)");
}

// Zach 2026-11-15: "the straight edge doesn't need to be a certain distance before it gets rotors",
// the 3-rotor rule decides. A short straight bit between curves (too short for 3 rotors head to head)
// stays with the curvy side; a short straight lawn edge with no curves near it is still a rotor edge.
{
  const G = E.prepare({ outer: P([[0, 0], [90, 0], [90, 30, -5], [62, 50], [40, 50, -6], [12, 46, -4], [0, 30]]) });
  const len = (q) => Math.hypot(q.bx - q.ax, q.by - q.ay);
  const straight = G.outerSegs.filter((q) => len(q) > 5);
  eq(straight.find((q) => Math.abs(len(q) - 22) < 0.5).rotorEdge, false, "a 22 ft straight between curves is pop-up side");
  eq(straight.filter((q) => len(q) >= 29).every((q) => q.rotorEdge), true, "the 90 ft south and 30 ft ends are rotor side");
  const sq = E.prepare({ outer: P([[0, 0], [20, 0], [20, 20], [0, 20]]) });
  eq(sq.outerSegs.every((q) => q.rotorEdge), true, "a 20 ft straight-edged lawn has no length minimum");
}

// Zach 2026-11-15: a 35 ft curved end on a long rotor lawn stays rotor ground, but a rotor partway
// along that curve sat alone among its VANs: "the rotor what says S1.5 is in the middle of pop ups".
{
  const o = E.layoutJob({ areas: [{ outer: P([[0, 0], [100, 0, -7], [100, 35], [0, 35]]), mode: "auto" }], psi: 50, cap: 12 });
  const onCurve = o.heads.filter((h) => h.kind === "R" && h.x > 100.5);
  eq(onCurve.length, 0, "no rotor partway along a short curved end (" + onCurve.map((h) => h.label).join(" ") + ")");
  eq(o.heads.filter((h) => h.kind === "R").length >= 6, true, "the long lawn is still rotors");
  eq(o.totals.overspray, 0, "short curved end: no overspray");
}

// DIY trench estimate: each zone's heads joined by the shortest tree, one shared trench from the valve
// box out to every zone, and the meter-to-valve mainline, plus 15% and rounded up to 10 ft.
{
  const hs = [{ x: 0, y: 0, zone: 1 }, { x: 20, y: 0, zone: 1 }, { x: 40, y: 0, zone: 1 }, { x: 0, y: 30, zone: 2 }, { x: 25, y: 30, zone: 2 }];
  const t = E.trenchFeet(hs, { x: 0, y: -10 }, { x: 0, y: -40 });
  eq(t.laterals, 65, "trench: zone 1 is 40 ft of lateral, zone 2 is 25");
  eq(t.feeders, 40, "trench: one shared trench from the valve box, 10 ft to zone 1 and 30 more to zone 2");
  eq(t.main, 30, "trench: 30 ft of mainline from meter to valve box");
  eq(t.ft, 160, "trench: 135 ft plus 15%, rounded up to 160");
  eq(E.trenchFeet(hs, null, null).ft, 80, "trench: no markers counts laterals only");
}

// Trees (Zach 2026-11-15): under 6 in of trunk the layout ignores it. A bigger trunk blocks spray,
// heads stay 7 ft off it unless they sit on a fence line, and no rotor's spray hits the trunk.
// Checked here independently: spray lines are traced past the trunk at 200 steps.
{
  const rect = P([[0, 0], [60, 0], [60, 40], [0, 40]]);
  const lay = (trees) => E.layoutJob({ areas: [{ outer: rect, trees, mode: "auto" }], psi: 50, cap: 12 });
  const sig = (o) => o.heads.map((h) => h.label + Math.round(h.x) + "," + Math.round(h.y)).join(" ");
  eq(sig(lay([{ x: 30, y: 20, trunk: 4 }])), sig(lay([])), "a 4 in tree changes nothing");
  const t = { x: 30, y: 20, trunk: 18 }, tr = 18 / 24;
  const o = lay([t]);
  const inArc = (h, x, y) => {
    if (Math.hypot(x - h.x, y - h.y) > h.r) return false;
    if (h.arc >= 359.5) return true;
    const a = (Math.atan2(y - h.y, x - h.x) * 180) / Math.PI;
    return Math.abs(((((a - h.dir) % 360) + 540) % 360) - 180) <= h.arc / 2 + 1e-6;
  };
  const shadow = (h, x, y) => {
    for (let i = 1; i < 200; i++) {
      const f = i / 200;
      if (Math.hypot(h.x + (x - h.x) * f - t.x, h.y + (y - h.y) * f - t.y) < tr) return true;
    }
    return false;
  };
  eq(o.heads.every((h) => Math.hypot(h.x - t.x, h.y - t.y) >= tr + 7 - 1e-6), true, "no head within 7 ft of a big trunk");
  const hit = o.heads.filter((h) => {
    if (h.kind !== "R") return false;
    for (let a = 0; a < 360; a += 5)
      if (inArc(h, t.x + tr * Math.cos((a * Math.PI) / 180), t.y + tr * Math.sin((a * Math.PI) / 180))) return true;
    return false;
  });
  eq(hit.length, 0, "no rotor sprays a big trunk");
  let n = 0, dbl = 0;
  for (let x = 0.75; x < 59.5; x += 0.5)
    for (let y = 0.75; y < 39.5; y += 0.5) {
      if (Math.hypot(x - t.x, y - t.y) < tr + 0.3) continue;
      n++;
      let c = 0;
      for (const h of o.heads) if (inArc(h, x, y) && !shadow(h, x, y)) c++;
      if (c >= 2) dbl++;
    }
  eq(dbl / n >= 0.99, true, "the shadow behind a big trunk is still double covered (" + ((dbl / n) * 100).toFixed(1) + "%)");
  eq(o.totals.overspray, 0, "big tree: no overspray");
  // an 8 ft strip with a 12 in tree 1.5 ft off its top edge: when that edge is a fence, a head on
  // the fence line may sit right by the tree
  const strip = (fence) =>
    E.layoutJob({
      areas: [{ outer: P([[0, 0], [40, 0], [40, 8], [0, 8]]), trees: [{ x: 20, y: 6.5, trunk: 12 }], fences: fence ? [[{ x: 0, y: 8 }, { x: 40, y: 8 }]] : [], mode: "auto" }],
      psi: 50,
      cap: 12,
    });
  const near = (o) => o.heads.filter((h) => Math.hypot(h.x - 20, h.y - 6.5) < 0.5 + 7);
  eq(near(strip(false)).length, 0, "strip: heads stay 7 ft off the trunk");
  const nf = near(strip(true));
  eq(nf.length > 0 && nf.every((h) => Math.abs(h.y - 8) < 0.5), true, "strip: only heads on the fence line come closer (" + nf.length + ")");
}

// Park strips (Zach 2026-11-15): a lawn 3 to 6 ft wide gets Rain Bird strip nozzles, "the LCS RCS
// and SST are the main ones installers use", head to head. Coverage is checked here with its own
// model of the patterns: a band as wide as the strip (4 ft at least) and up to 15 ft long.
{
  const strip = (w, L) => E.layoutJob({ areas: [{ outer: P([[0, 0], [L, 0], [L, w], [0, w]]), mode: "auto" }], psi: 50, cap: 12 });
  const o = strip(4.5, 47);
  const labels = o.heads.map((h) => h.label);
  eq(labels[0] === "15RCS" && labels[labels.length - 1] === "15LCS" && labels.slice(1, -1).every((l) => l === "15SST"), true, "strip: RCS and LCS in the corners, SSTs between (" + labels.join(" ") + ")");
  eq(new Set(o.heads.map((h) => Math.round(h.y * 10))).size, 1, "strip: every head on the same side");
  const xs = o.heads.map((h) => h.x).sort((a, b) => a - b);
  eq(xs.every((x, i) => !i || x - xs[i - 1] <= 15 + 1e-6), true, "strip: no more than 15 ft between heads");
  const reach = { "15RCS": [0, 1], "15LCS": [-1, 0], "15SST": [-1, 1] };
  const sp = xs[1] - xs[0];
  let n = 0, dbl = 0;
  for (let x = 0.25; x < 47; x += 0.5)
    for (let y = 0.25; y < 4.5; y += 0.5) {
      n++;
      const c = o.heads.filter((h) => {
        const [a, b] = reach[h.label];
        return x - h.x >= a * sp - 1e-6 && x - h.x <= b * sp + 1e-6;
      }).length;
      if (c >= 2) dbl++;
    }
  eq(dbl, n, "strip: every spot double covered, head to head");
  eq(o.totals.overspray, 0, "strip: no overspray");
  eq(o.parts.lines.some((l) => l.item === "15SST"), true, "strip: SSTs on the parts list");
  eq(strip(3, 30).heads.every((h) => /^15(RCS|LCS|SST)$/.test(h.label)), true, "a 3 ft strip still gets strip nozzles");
  eq(strip(2.5, 30).heads.some((h) => /^15(RCS|LCS|SST)$/.test(h.label)), false, "under 3 ft keeps regular pop-ups");
  eq(strip(7, 40).heads.some((h) => /^15(RCS|LCS|SST)$/.test(h.label)), false, "over 6 ft keeps regular pop-ups");
}

// A narrow side entrance traced as part of the backyard (Zach 2026-11-15, "build the auto detect"):
// the 5 ft arm is cut off where it opens into the yard and gets strip nozzles on the side facing the
// yard ("sidewalk side always").
{
  const L = P([[0, 0], [60, 0], [60, -30], [65, -30], [65, 40], [0, 40]]);
  const cuts = E.stripCuts(L);
  eq(cuts.length, 1, "side entrance: one cut where the arm meets the yard");
  const pieces = E.splitStrips(L);
  const o = E.layoutJob({ areas: pieces.map((r) => ({ outer: r, mode: "auto", toward: { x: 30, y: 20 } })), psi: 50, cap: 12 });
  const st = o.heads.filter((h) => h.strip);
  eq(st.length >= 3 && st.every((h) => Math.abs(h.x - 60) < 0.2), true, "side entrance: strip heads along the side facing the yard");
  eq(o.totals.overspray, 0, "side entrance: no overspray");
  eq(o.totals.coverage >= 0.995, true, "side entrance: double covered (" + (o.totals.coverage * 100).toFixed(1) + "%)");
  eq(E.stripCuts(P([[0, 0], [60, 0], [60, 40], [0, 40]])).length, 0, "a plain rectangle has no narrow arm");
  // the backyard keeps its rotors with a big tree by the back fence (a 0.05 ft jog left by the cut
  // once dropped them all)
  const yard = E.splitStrips(P([[0, 0], [65, 0], [65, -35], [70, -35], [70, 45], [0, 45]]));
  const oy = E.layoutJob({ areas: yard.map((r) => ({ outer: r, fences: [[{ x: -1, y: 45 }, { x: 71, y: 45 }]], trees: [{ x: 35, y: 42, trunk: 14 }], mode: "auto" })), psi: 50, cap: 12 });
  eq(oy.heads.filter((h) => h.kind === "R").length >= 6, true, "side entrance + tree: the backyard keeps its rotors");
}

// Valve boxes (Zach 2026-11-16): 4 valves fit in a box, spread evenly ("6 zones i would do 3 and 3").
{
  eq(JSON.stringify(E.valveBoxes(6)), "[3,3]", "6 valves: two boxes of 3");
  eq(JSON.stringify(E.valveBoxes(9)), "[3,3,3]", "9 valves: three boxes of 3");
  eq(JSON.stringify(E.valveBoxes(5)), "[3,2]", "5 valves: 3 and 2");
  eq(JSON.stringify(E.valveBoxes(4)), "[4]", "4 valves: one box");
  eq(JSON.stringify(E.valveBoxes(0)), "[]", "no valves, no box");
  const zones = Array.from({ length: 4 }, (_, i) => ({ n: i + 1, family: "spray", heads: [] }));
  const q = (p, item) => (p.lines.find((l) => l.item === item) || { qty: 0 }).qty;
  eq(q(E.parts([], zones, { zones: [1, 2], ft: 80 }, "culinary"), "Standard valve box"), 2, "4 zone valves and 2 drip valves: 2 standard boxes");
  eq(q(E.parts([], zones, 0, "culinary", null, { box: "jumbo" }), "Jumbo valve box"), 1, "jumbo when the contractor picks it");
}

// Zach 2026-11-10: a company can save its own backflow or filter parts once and every job uses them
{
  const q = (p, item) => (p.lines.find((l) => l.item === item) || { qty: 0 }).qty;
  const own = { culinary: [{ item: "Febco 765 1 in", qty: 1 }, { item: "1 in brass union", qty: 2 }] };
  const c = E.parts([], [{}], 0, "culinary", own);
  eq(q(c, "Febco 765 1 in"), 1, "the company's backflow part is listed");
  eq(q(c, "1 in brass union"), 2, "with its count");
  eq(q(c, "Backflow setup"), 0, "in place of the generic line");
  eq(c.lines.filter((l) => l.group === "Culinary water connection").length, 2, "only the company's lines in that section");
  eq(q(E.parts([], [{}], 0, "secondary", own), "Filter setup"), 1, "secondary keeps the default when only culinary is set");
  eq(q(E.parts([], [{}], 0, "culinary", { culinary: [] }), "Backflow setup"), 1, "an empty company list falls back to the default");
}

console.log(fail ? fail + " failing" : "all passing");
process.exit(fail ? 1 : 0);
