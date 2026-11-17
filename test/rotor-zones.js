// Draws stress-test yards whose rotor zones have fewer than 3 rotors (Zach's rule: rotors only
// where 3 or more fit in a zone), with those zones' rotors circled in red.
// node test/rotor-zones.js 6:3,6:11,14:33 > rotor-zones.html   (batch:yard pairs from test/fuzz.js)
const { execFileSync } = require("child_process");
const path = require("path");
const E = require("../js/engine.js");
const COLORS = [
  "#e74c3c",
  "#3498db",
  "#27ae60",
  "#9b59b6",
  "#f39c12",
  "#16a085",
  "#d35400",
  "#8e44ad",
  "#2c3e50",
  "#c0392b",
  "#f0932b",
  "#eb4d8b",
  "#17a2b8",
  "#6c5ce7",
];
const FUZZ = path.join(__dirname, "fuzz.js");

function yardOf(seed, n) {
  const out = execFileSync("node", [FUZZ, "50", String(seed)], {
    env: { ...process.env, DUMP: String(n) },
    maxBuffer: 1 << 26,
  });
  return JSON.parse(out.toString().trim().split("\n").pop()); // yards before n print their usual line first
}

function draw(title, d, o, badZones) {
  const pts = d.areas
    .flatMap((a) => a.outer)
    .concat(d.yard.fences.flatMap((f) => f.pts));
  const x0 = Math.min(...pts.map((p) => p.x)) - 8,
    x1 = Math.max(...pts.map((p) => p.x)) + 8;
  const y0 = Math.min(...pts.map((p) => p.y)) - 8,
    y1 = Math.max(...pts.map((p) => p.y)) + 8;
  const S = 560,
    k = S / Math.max(x1 - x0, y1 - y0);
  const tx = (x) => (x - x0) * k,
    ty = (y) => (y1 - y) * k;
  const ring = (r, fill, stroke) =>
    `<polygon points="${r.map((p) => tx(p.x) + "," + ty(p.y)).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  let s = `<div style="margin:10px;display:inline-block;vertical-align:top"><div style="font:600 15px sans-serif;margin-bottom:4px">${title}</div><svg width="${(x1 - x0) * k}" height="${(y1 - y0) * k}" style="background:#f4f1e8;border-radius:8px">`;
  d.areas.forEach((a) => {
    s += ring(a.outer, "#cfe5c2", "#4b6b3c");
    a.holes.forEach((h) => (s += ring(h, "#e8d5b5", "#a07b4f")));
  });
  o.heads.forEach((h) => {
    const col = COLORS[(h.zone - 1) % COLORS.length];
    let p;
    if (h.arc >= 359.5)
      p = `<circle cx="${tx(h.x)}" cy="${ty(h.y)}" r="${h.r * k}"`;
    else {
      const a0 = ((h.dir - h.arc / 2) * Math.PI) / 180,
        a1 = ((h.dir + h.arc / 2) * Math.PI) / 180;
      p = `<path d="M${tx(h.x)},${ty(h.y)} L${tx(h.x + h.r * Math.cos(a0))},${ty(h.y + h.r * Math.sin(a0))} A${h.r * k},${h.r * k} 0 ${h.arc > 180 ? 1 : 0} 0 ${tx(h.x + h.r * Math.cos(a1))},${ty(h.y + h.r * Math.sin(a1))} Z"`;
    }
    s +=
      p +
      ` fill="${col}" fill-opacity="0.13" stroke="${col}" stroke-opacity="0.5" stroke-width="0.7"/>`;
  });
  d.yard.fences.forEach(
    (f) =>
      (s += `<polyline points="${f.pts.map((p) => tx(p.x) + "," + ty(p.y)).join(" ")}" fill="none" stroke="#1d1d1d" stroke-width="3"/>`),
  );
  o.heads.forEach((h) => {
    const col = COLORS[(h.zone - 1) % COLORS.length];
    const bad = badZones.includes(h.zone);
    if (bad)
      s += `<circle cx="${tx(h.x)}" cy="${ty(h.y)}" r="13" fill="none" stroke="#d00" stroke-width="3"/>`;
    s +=
      h.kind === "R"
        ? `<rect x="${tx(h.x) - 4.5}" y="${ty(h.y) - 4.5}" width="9" height="9" fill="${col}" stroke="#fff"/>`
        : `<circle cx="${tx(h.x)}" cy="${ty(h.y)}" r="3.5" fill="${col}" stroke="#fff"/>`;
    if (bad || h.kind === "R")
      s += `<text x="${tx(h.x)}" y="${ty(h.y) - 8}" font-size="10" font-weight="700" text-anchor="middle" fill="${bad ? "#d00" : "#222"}">${h.label} z${h.zone}</text>`;
  });
  return s + "</svg></div>";
}

let html =
  '<html><body style="margin:0;padding:10px;background:#fff;font:13px sans-serif">';
html +=
  "<p>Rotors are squares, pop-ups are dots, fences are black lines. Red rings: rotors in a zone with fewer than 3 rotors.</p>";
for (const pair of (process.argv[2] || "").split(",").filter(Boolean)) {
  const [seed, n] = pair.split(":").map(Number);
  const d = yardOf(seed, n);
  const o = E.layoutJob({ areas: d.areas, psi: d.yard.psi, cap: d.yard.cap, water: d.yard.water });
  const bad = o.zones.filter((z) => z.heads.every((h) => h.kind === "R") && z.heads.length < 3);
  const why = bad.length
    ? bad.map((z) => "zone " + z.n + ": " + z.heads.length + " rotor" + (z.heads.length > 1 ? "s" : "")).join(", ")
    : "no short rotor zones";
  process.stderr.write("batch " + seed + " yard " + n + ": " + why + "\n");
  if (bad.length) html += draw("Batch " + seed + ", yard " + n + " (" + d.yard.name.replace(/^yard \d+ /, "") + "): " + why, d, o, bad.map((z) => z.n));
}
console.log(html + "</body></html>");
