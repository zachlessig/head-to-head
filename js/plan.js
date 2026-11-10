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
    // which head types are on this plan, for the symbol legend in the top corner
    const kinds = [
      { key: "spray", name: "Pop-up spray (1804)", count: d.heads.filter((h) => h.kind !== "R").length },
      { key: "5004", name: "5004 rotor, 24 to 30 ft", count: d.heads.filter((h) => h.kind === "R" && h.model === "5004").length },
      { key: "3504", name: "3504 rotor, 18 to 23 ft", count: d.heads.filter((h) => h.kind === "R" && h.model === "3504").length },
    ].filter((t) => t.count);
    const head = 130 + Math.max(1, kinds.length) * 32,
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
    // symbol legend, top right
    ctx.font = "600 19px Inter, sans-serif";
    kinds.forEach((t, i) => {
      const y = 104 + i * 32;
      const lx = W - 400;
      headShape(ctx, t.key, lx + 10, y - 6, "#1d2320", "#ffffff", 1.15);
      ctx.fillStyle = "#1d2320";
      ctx.textAlign = "left";
      ctx.fillText(t.name, lx + 30, y);
      ctx.textAlign = "right";
      ctx.fillText(String(t.count), W - 48, y);
    });

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

    // fences: a heavy dark line, no width
    (d.fences || []).forEach((f) => {
      if (f.length < 2) return;
      ctx.beginPath();
      f.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.strokeStyle = "#2b2118";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.stroke();
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

    // head symbols: circle pop-up, square 5004, triangle 3504
    const nd = nudges(d.heads, 11);
    d.heads.forEach((h, i) => headShape(ctx, shapeKey(h), X(h.x) + nd[i].dx, Y(h.y) + nd[i].dy, zoneColor(h.zone || 1), "#fff", 1));
    ctx.font = "800 19px Inter, sans-serif";
    ctx.textAlign = "center";
    d.heads.forEach((h, i) => {
      // a nudged twin gets its label out past its dot, on the side it waters
      const n = nd[i], len = Math.hypot(n.dx, n.dy);
      const tx = len ? X(h.x) + n.dx + (n.dx / len) * 26 : X(h.x),
        ty = len ? Y(h.y) + n.dy + (n.dy / len) * 26 + 7 : Y(h.y) - 14;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#fff";
      // the contractor copy shows how far to dial each rotor in, since the screw sets the throw
      const label = d.copy === "contractor" && h.kind === "R" ? h.label + " " + Math.round(h.r) + "'" : h.label;
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = "#1d2320";
      ctx.fillText(label, tx, ty);
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
    drawNorth(ctx, 48 + barFt * k + 70, by + 2);

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

  function shapeKey(h) {
    return h.kind === "R" ? h.model : "spray";
  }

  // one symbol per head model, so they read apart in black and white
  function headShape(ctx, key, x, y, fill, stroke, scale) {
    ctx.beginPath();
    if (key === "5004") {
      const a = 7.5 * scale;
      ctx.rect(x - a, y - a, 2 * a, 2 * a);
    } else if (key === "3504") {
      const a = 9.5 * scale;
      ctx.moveTo(x, y - a);
      ctx.lineTo(x + a * 0.95, y + a * 0.7);
      ctx.lineTo(x - a * 0.95, y + a * 0.7);
      ctx.closePath();
    } else ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
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

  // Two heads on the same spot (one each side of a fence, Zach 2026-11-09) read as one dot. Each
  // gets drawn px pixels toward the side it waters, so the fence line runs between two dots.
  // Drawing only: the head's real position and the coverage math don't move.
  function nudges(heads, px) {
    return heads.map((h) => {
      const twin = heads.find((o) => o !== h && Math.hypot(o.x - h.x, o.y - h.y) < 0.5);
      if (!twin) return { dx: 0, dy: 0 };
      // lean square to the fence: this head's spray direction minus its twin's (two quarter heads
      // aimed 45 and 315 degrees lean straight apart). Same aim, or a full circle: its own aim.
      const u = (g) => (g.arc < 359.5 ? [Math.cos((g.dir * Math.PI) / 180), Math.sin((g.dir * Math.PI) / 180)] : [0, 0]);
      const [hx, hy] = u(h), [tx, ty] = u(twin);
      let vx = hx - tx, vy = hy - ty;
      if (Math.hypot(vx, vy) < 0.2) [vx, vy] = Math.hypot(hx, hy) ? [hx, hy] : [1, 0];
      const L = Math.hypot(vx, vy);
      return { dx: (vx / L) * px, dy: (-vy / L) * px };
    });
  }

  window.SprinklerPlan = { drawPlan, zoneColor, ZONE_COLORS, shapeKey, nudges };
})();
