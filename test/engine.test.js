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
  eq(!!cul.lines.find((l) => l.item === "Backflow preventer"), true, "culinary gets a backflow preventer");
  eq(!!cul.lines.find((l) => l.item === "Filter"), false, "culinary gets no filter");
  eq(!!sec.lines.find((l) => l.item === "Filter"), true, "secondary gets a filter");
  eq(!!sec.lines.find((l) => l.item === "Backflow preventer"), false, "secondary gets no backflow preventer");
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
  eq(noz.join(", "), "15H nozzle x2, 8Q nozzle x1", "a count per pop-up nozzle on the map");
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

console.log(fail ? fail + " failing" : "all passing");
process.exit(fail ? 1 : 0);
