// Draws every test yard to an HTML page of SVGs so a person can eyeball the layouts.
// node test/render.js > out.html
const E = require("../js/engine.js");
const P = (pts) => pts.map(([x, y, b]) => ({ x, y, b: b || 0 }));
const yards = {
  "Pentagon 35x34": {
    outer: P([
      [0, 0],
      [35, 0],
      [38, 20],
      [17, 34],
      [-3, 20],
    ]),
  },
  "Odd angles": {
    outer: P([
      [0, 0],
      [42, 4],
      [50, 30],
      [12, 38],
    ]),
  },
  "Curved edge": {
    outer: P([
      [0, 0],
      [40, 0, -6],
      [40, 25],
      [0, 25],
    ]),
  },
  "Bed in the middle": {
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
  "L 80x65 sprays only": {
    outer: P([
      [0, 65],
      [0, 0],
      [80, 0],
      [80, 35],
      [40, 35],
      [40, 65],
    ]),
    popups: true,
  },
  "Big L 120x90": {
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
const COLORS = [
  "#e4572e",
  "#2e86de",
  "#20a464",
  "#a55eea",
  "#f0932b",
  "#eb4d8b",
  "#17a2b8",
  "#6c5ce7",
];
let html =
  '<html><body style="margin:0;background:#fff;font:12px sans-serif;display:flex;flex-wrap:wrap">';
for (const [name, a] of Object.entries(yards)) {
  const out = E.layoutJob({
    areas: [{ outer: a.outer, holes: a.holes, mode: "auto" }],
    psi: 50,
    cap: 12,
    popupsOnly: !!a.popups,
  });
  const G = out.areas[0].G;
  const k = 360 / Math.max(G.x1 - G.x0, G.y1 - G.y0);
  const tx = (x) => 10 + (x - G.x0) * k,
    ty = (y) => 10 + (G.y1 - y) * k;
  let s = `<div style="margin:6px"><b>${name}</b> ${out.heads.length} heads, ${out.zones.length} zones, cov ${(out.totals.coverage * 100).toFixed(1)}%<br><svg width="380" height="380">`;
  G.rings.forEach((r, i) => {
    s += `<polygon points="${r.map((p) => tx(p.x) + "," + ty(p.y)).join(" ")}" fill="${i ? "#c9a27a" : "#7cb35b"}" stroke="#333"/>`;
  });
  out.heads.forEach((h) => {
    const col = COLORS[(h.zone - 1) % COLORS.length];
    let d;
    if (h.arc >= 359.5)
      d = `<circle cx="${tx(h.x)}" cy="${ty(h.y)}" r="${h.r * k}"`;
    else {
      const a0 = ((h.dir - h.arc / 2) * Math.PI) / 180,
        a1 = ((h.dir + h.arc / 2) * Math.PI) / 180;
      const x0 = tx(h.x + h.r * Math.cos(a0)),
        y0 = ty(h.y + h.r * Math.sin(a0));
      const x1 = tx(h.x + h.r * Math.cos(a1)),
        y1 = ty(h.y + h.r * Math.sin(a1));
      d = `<path d="M${tx(h.x)},${ty(h.y)} L${x0},${y0} A${h.r * k},${h.r * k} 0 ${h.arc > 180 ? 1 : 0} 0 ${x1},${y1} Z"`;
    }
    s +=
      d +
      ` fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="0.8"/>`;
  });
  out.heads.forEach((h) => {
    const col = COLORS[(h.zone - 1) % COLORS.length];
    s += `<circle cx="${tx(h.x)}" cy="${ty(h.y)}" r="3.5" fill="${col}" stroke="#fff"/><text x="${tx(h.x)}" y="${ty(h.y) - 6}" font-size="9" text-anchor="middle" font-weight="700">${h.label}</text>`;
  });
  out.areas[0].check.gapPts.forEach(
    (g) =>
      (s += `<circle cx="${tx(g.x)}" cy="${ty(g.y)}" r="1.2" fill="red"/>`),
  );
  html += s + "</svg></div>";
}
console.log(html + "</body></html>");
