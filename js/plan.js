/* Draws the printable plan: the yard to scale, every head with its arc and label, colored by zone.
 * Customer copy hides GPM. Contractor copy adds zone flow. */
(function () {
  "use strict";

  const ZONE_COLORS = [
    "#e4572e",
    "#2e86de",
    "#1e9e5a",
    "#9b51e0",
    "#f2994a",
    "#d6457f",
    "#139eb0",
    "#5f5bd6",
    "#b38b00",
    "#7a5230",
    "#2d9c8f",
    "#c0392b",
    "#3b6fb6",
    "#8e44ad",
    "#16a085",
    "#d35400",
  ];

  function zoneColor(n) {
    return ZONE_COLORS[(n - 1) % ZONE_COLORS.length];
  }

  // shapes: [{type:'lawn'|'bed', ring:[{x,y}] densified}], heads, zones, markers [{x,y,tag}]
  function drawPlan(canvas, d) {
    // lay out on an 1100-wide page and scale up, so text stays readable on a printed letter sheet
    // (drawn at full 1700 px, the 17 px labels printed at about 6 pt)
    const ctx = canvas.getContext("2d");
    const s = canvas.width / 1100;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const W = 1100,
      H = canvas.height / s;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const pts = [];
    d.shapes.forEach((s) => s.ring.forEach((p) => pts.push(p)));
    if (!pts.length) {
      ctx.fillStyle = "#5f6964";
      ctx.font = "600 28px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Trace a lawn first", W / 2, H / 2);
      return;
    }
    const x0 = Math.min(...pts.map((p) => p.x)),
      x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)),
      y1 = Math.max(...pts.map((p) => p.y));
    const head = 150,
      foot = d.legendRows ? 70 + Math.ceil(d.legendRows / 2) * 34 : 90,
      side = 70;
    const k = Math.min(
      (W - 2 * side) / Math.max(1, x1 - x0),
      (H - head - foot - 30) / Math.max(1, y1 - y0),
    );
    const ox = side + (W - 2 * side - (x1 - x0) * k) / 2;
    const oy = head + 15;
    const X = (x) => ox + (x - x0) * k;
    const Y = (y) => oy + (y1 - y) * k;

    // title block
    ctx.fillStyle = "#1d2320";
    ctx.textAlign = "left";
    ctx.font = "800 40px Inter, sans-serif";
    ctx.fillText(d.title || "Sprinkler plan", 48, 70);
    ctx.font = "500 24px Inter, sans-serif";
    ctx.fillStyle = "#5f6964";
    ctx.fillText([d.address, d.date].filter(Boolean).join("   "), 48, 108);
    ctx.textAlign = "right";
    ctx.fillText(
      d.copy === "contractor" ? "Contractor copy" : "Sprinkler plan",
      W - 48,
      70,
    );
    drawNorth(ctx, W - 80, 108);

    // lawns, then beds on top
    d.shapes
      .filter((s) => s.type === "lawn")
      .forEach((s) => path(ctx, s.ring, X, Y, "#e3f0d6", "#3d5a2c", 3));
    d.shapes
      .filter((s) => s.type === "bed")
      .forEach((s) => {
        path(ctx, s.ring, X, Y, "#efe2cf", "#8a6a44", 2.5);
        const c = centroid(s.ring);
        ctx.fillStyle = "#8a6a44";
        ctx.font = "700 20px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Drip", X(c.x), Y(c.y) + 7);
      });

    // edge lengths
    ctx.font = "600 18px Inter, sans-serif";
    ctx.textAlign = "center";
    d.shapes.forEach((s) =>
      (s.edges || []).forEach((e) => {
        if (e.len < 3) return;
        const mx = X(e.mx),
          my = Y(e.my);
        const label = Math.round(e.len) + "'";
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(mx - w / 2, my - 12, w, 22);
        ctx.fillStyle = "#3d4a43";
        ctx.fillText(label, mx, my + 5);
      }),
    );

    // arcs
    d.heads.forEach((h) => {
      const col = zoneColor(h.zone || 1);
      ctx.beginPath();
      if (h.arc >= 359.5) ctx.arc(X(h.x), Y(h.y), h.r * k, 0, Math.PI * 2);
      else {
        // canvas y runs down, so angles flip sign
        const a0 = (-(h.dir + h.arc / 2) * Math.PI) / 180,
          a1 = (-(h.dir - h.arc / 2) * Math.PI) / 180;
        ctx.moveTo(X(h.x), Y(h.y));
        ctx.arc(X(h.x), Y(h.y), h.r * k, a0, a1);
        ctx.closePath();
      }
      ctx.fillStyle = col + "22";
      ctx.fill();
      ctx.strokeStyle = col + "aa";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // markers
    (d.markers || []).forEach((m) => {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(X(m.x), Y(m.y), 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = "800 14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.letter, X(m.x), Y(m.y) + 5);
    });

    // head dots and labels
    d.heads.forEach((h) => {
      const col = zoneColor(h.zone || 1);
      ctx.beginPath();
      ctx.arc(X(h.x), Y(h.y), 7, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    });
    ctx.font = "800 19px Inter, sans-serif";
    ctx.textAlign = "center";
    d.heads.forEach((h) => {
      const tx = X(h.x),
        ty = Y(h.y) - 14;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#fff";
      ctx.strokeText(h.label, tx, ty);
      ctx.fillStyle = "#1d2320";
      ctx.fillText(h.label, tx, ty);
    });

    // scale bar
    const barFt = niceFeet(160 / k);
    const by = H - foot + 34;
    ctx.fillStyle = "#1d2320";
    ctx.fillRect(48, by, barFt * k, 6);
    ctx.font = "600 18px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("0", 44, by + 30);
    ctx.textAlign = "center";
    ctx.fillText(barFt + " ft", 48 + barFt * k, by + 30);

    // zone legend
    if (d.zones && d.zones.length) {
      ctx.textAlign = "left";
      ctx.font = "600 18px Inter, sans-serif";
      const colW = (W - 360) / 2;
      d.zones.forEach((z, i) => {
        const cx = 330 + (i % 2) * colW,
          cy = H - foot + 30 + Math.floor(i / 2) * 34;
        ctx.fillStyle = zoneColor(z.n);
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1d2320";
        const kind = z.family === "rotor" ? "rotors" : "sprays";
        const txt =
          d.copy === "contractor"
            ? "Zone " +
              z.n +
              ": " +
              z.count +
              " " +
              kind +
              ", " +
              z.gpm.toFixed(1) +
              " GPM"
            : "Zone " + z.n + ": " + z.count + " " + kind;
        ctx.fillText(txt, cx + 18, cy + 6);
      });
    }
  }

  function path(ctx, ring, X, Y, fill, stroke, w) {
    ctx.beginPath();
    ring.forEach((p, i) =>
      i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)),
    );
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  function centroid(ring) {
    return {
      x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
      y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    };
  }

  function niceFeet(v) {
    const steps = [5, 10, 20, 25, 50, 100];
    for (const s of steps) if (s >= v * 0.6) return s;
    return 100;
  }

  function drawNorth(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#1d2320";
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(10, 6);
    ctx.lineTo(0, 0);
    ctx.lineTo(-10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = "800 16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", 0, 24);
    ctx.restore();
  }

  window.SprinklerPlan = { drawPlan, zoneColor, ZONE_COLORS };
})();
