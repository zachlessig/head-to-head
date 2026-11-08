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

console.log(fail ? fail + " failing" : "all passing");
process.exit(fail ? 1 : 0);
