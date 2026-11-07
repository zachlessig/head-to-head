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
eq(E.nozzle("R", 360, 18), null, "no rotor under 19 ft");
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

console.log(fail ? fail + " failing" : "all passing");
process.exit(fail ? 1 : 0);
