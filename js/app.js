/* Head to Head: map a yard on the phone, auto-place sprinkler heads, zone them, print the plan. */
(function () {
  "use strict";

  const E = window.SprinklerEngine;
  const Plan = window.SprinklerPlan;
  const app = document.getElementById("app");
  const FT_PER_DEG = 365221; // feet per degree of latitude
  const DEFAULT_CENTER = { lat: 41.0602, lng: -111.9711 }; // default map center when no address is picked
  const STORE_KEY = "headtohead.jobs.v1";
  // Mapbox public token (pk.). Public tokens are meant to sit in browser code; usage bills to Zach's account.
  const MAPBOX_TOKEN =
    "pk.eyJ1IjoiemFjaGxlc3NpZyIsImEiOiJjbXc2bWFyaHcwMGk3Mnlvb2hjcG1lemNrIn0.ZbZrd_YpTtswPnCeqPN_WA";
  const MARKERS = {
    tree: { letter: "T", color: "#7bc96f", name: "Tree" },
    meter: { letter: "M", color: "#5bc8e6", name: "Meter" },
    valve: { letter: "V", color: "#c9a7f5", name: "Valve box" },
    note: { letter: "!", color: "#ffd166", name: "Note" },
  };

  /* ---------------- icons ---------------- */
  const ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    sliders:
      '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    walk: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.5"/>',
    ruler:
      '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    drop: '<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z"/>',
    plan: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    print:
      '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    pin: '<path d="M12 22s7-7.2 7-13a7 7 0 0 0-14 0c0 5.8 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  };
  const icon = (n) =>
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
    ICONS[n] +
    "</svg>";
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------------- storage ---------------- */
  function loadJobs() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn("Could not read saved jobs", e);
      // keep the unreadable copy so the next save can't wipe every job
      try {
        if (raw) localStorage.setItem(STORE_KEY + ".backup-" + Date.now(), raw);
      } catch (e2) {
        console.warn("Could not back up saved jobs", e2);
      }
      return [];
    }
  }
  let jobs = loadJobs();
  // gate markers were removed 2026-11-09 (fences replaced them)
  jobs.forEach((j) => {
    if (Array.isArray(j.markers)) j.markers = j.markers.filter((m) => m.tag !== "gate");
  });
  const deletedIds = new Set();
  function saveJobs() {
    try {
      // another tab (home-screen app and Safari) may have added jobs since this one loaded
      const ids = new Set(jobs.map((j) => j.id));
      loadJobs().forEach((j) => {
        if (!ids.has(j.id) && !deletedIds.has(j.id)) jobs.push(j);
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(jobs));
    } catch (e) {
      console.warn("Could not save jobs", e);
      toast("This phone would not save the job. Check storage space.");
    }
  }
  function touch(job) {
    job.updated = Date.now();
    saveJobs();
  }

  /* ---------------- small UI helpers ---------------- */
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
  }

  function sheet(html, onMount) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(scrim);
    const close = () => scrim.remove();
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });
    if (onMount) onMount(scrim.querySelector(".sheet"), close);
    return close;
  }

  function ago(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.round(d / 60) + " min ago";
    if (d < 86400) return Math.round(d / 3600) + " hr ago";
    return new Date(ts).toLocaleDateString();
  }

  /* ---------------- routing ---------------- */
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY || J) return;
    jobs = loadJobs();
    renderHome();
  });
  function route() {
    const m = location.hash.match(/^#\/job\/(\w+)/);
    teardownJob();
    if (m) {
      const job = jobs.find((j) => j.id === m[1]);
      if (job) return openJob(job);
    }
    renderHome();
  }

  /* ---------------- home ---------------- */
  function renderHome() {
    const list = jobs.slice().sort((a, b) => b.updated - a.updated);
    let h = '<main class="home">';
    h +=
      '<div class="brand"><svg class="mark" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="9" fill="#1f6b45"/><path d="M9 25a11 11 0 0 1 16 0M12 21a7 7 0 0 1 10 0" stroke="#fffdf8" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="17" cy="25" r="2.6" fill="#fffdf8"/></svg><h1>Head to Head</h1></div>';
    h +=
      '<p class="lede">Trace the yard, tap Generate, and get heads, zones and a parts list.</p>';
    h +=
      '<button class="btn primary" style="width:100%;margin-bottom:18px" id="new">' +
      icon("plus") +
      "New job</button>";
    if (!list.length) {
      h +=
        '<div class="empty"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="52" height="38" rx="6" fill="#e3f0d6" stroke="#3d5a2c" stroke-width="2"/><g fill="none" stroke="#1f6b45" stroke-width="2"><path d="M6 52a14 14 0 0 1 14-14"/><path d="M58 52a14 14 0 0 0-14-14"/><path d="M6 14a14 14 0 0 0 14 14"/></g><circle cx="6" cy="52" r="3" fill="#1f6b45"/><circle cx="58" cy="52" r="3" fill="#1f6b45"/><circle cx="6" cy="14" r="3" fill="#1f6b45"/></svg><div><b>No jobs yet</b></div><div>Start one from the truck or standing in the yard.</div></div>';
    } else {
      list.forEach((j) => {
        const heads = j.layout
          ? j.layout.heads.length + " heads"
          : "not laid out";
        h +=
          '<button class="job" data-id="' +
          j.id +
          '"><div class="grow"><b>' +
          esc(j.name) +
          "</b><span>" +
          esc(j.address || "No address") +
          '</span></div><div class="meta">' +
          heads +
          "<br>" +
          ago(j.updated) +
          "</div></button>";
      });
    }
    h +=
      '<button class="btn" style="width:100%;margin-top:14px" id="example">' +
      icon("plan") +
      "Try an example yard</button>";
    h +=
      '<p class="note" style="margin-top:22px">Jobs save on this phone. Address search and satellite photos come from Mapbox.</p>';
    h += "</main>";
    app.innerHTML = h;
    app.querySelector("#new").onclick = newJobSheet;
    app.querySelector("#example").onclick = openExample;
    app
      .querySelectorAll(".job")
      .forEach(
        (b) => (b.onclick = () => (location.hash = "#/job/" + b.dataset.id)),
      );
  }

  // A made-up yard that shows every feature: rotors in the open, pop-ups in a narrow strip, curved
  // edges, a bed inside a lawn, a wide bed that needs two rows, beds that touch, a small bed that
  // joins its neighbour, a bed far enough away to be its own drip zone, and markers.
  function exampleJob() {
    const origin = { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
    const c = Math.cos((origin.lat * Math.PI) / 180);
    const ll = (x, y, bf) => ({
      lat: origin.lat + y / FT_PER_DEG,
      lng: origin.lng + x / (FT_PER_DEG * c),
      bf: bf || 0,
    });
    const shape = (type, pts) => ({
      id: uid(),
      type,
      closed: true,
      mode: "auto",
      pts: pts.map(([x, y, bf]) => ll(x, y, bf)),
    });
    const shapes = [
      // backyard, 90 x 70 ft, its back edge curving in along the fence bed
      shape("lawn", [[0, 40], [90, 40], [90, 110, 8 / 90], [0, 110]]),
      // side yard strip, 10 ft wide: pop-up country
      shape("lawn", [[96, 40], [106, 40], [106, 110], [96, 110]]),
      // front lawn with a curved edge bulging out toward the street corner
      shape("lawn", [[0, -50], [70, -50], [70, -12], [0, -12, -6 / 38]]),
      // fence bed behind the backyard, 12 to 20 ft deep: two and three rows of drip
      shape("bed", [[0, 110.5, -8 / 90], [90, 110.5], [90, 122], [0, 122]]),
      // round tree ring inside the backyard
      // (4 points: the app skips shapes under 3 corners, and 0.2071 bends each quarter into a circle)
      shape("bed", [[55, 70, 0.2071], [60, 75, 0.2071], [65, 70, 0.2071], [60, 65, 0.2071]]),
      // two beds along the front of the house that touch: one drip area
      shape("bed", [[8, -8], [35, -8], [35, -4], [8, -4]]),
      shape("bed", [[35, -8], [62, -8], [62, -4], [35, -4]]),
      // a little bed by the porch, close enough to join the porch beds
      shape("bed", [[65, -8], [68, -8], [68, -5], [65, -5]]),
      // a side-yard fence across the strip: heads on each side stay on their own side
      shape("fence", [[93, 75], [109, 75]]),
      // a raised garden bed out past the side yard: its own drip zone
      shape("bed", [[112, 60], [118, 60], [118, 92], [112, 92]]),
    ];
    const marker = (tag, x, y) => Object.assign({ id: uid(), tag }, ll(x, y));
    const view = ll(53, 30);
    return {
      id: uid(),
      name: "Example yard",
      example: true,
      address: "Made-up yard to show the app",
      created: Date.now(),
      updated: Date.now(),
      origin,
      view: { lat: view.lat, lng: view.lng, zoom: 19 },
      scale: 1,
      psi: 50,
      line: "34",
      customCap: 12,
      popupsOnly: false,
      water: "secondary",
      shapes,
      markers: [marker("meter", -8, -52), marker("valve", -4, 34), marker("tree", 60, 70)],
      layout: null,
    };
  }

  function openExample() {
    const job = exampleJob();
    jobs.push(job);
    saveJobs();
    location.hash = "#/job/" + job.id;
    // lay it out right away so the heads, zones and parts list are there to look at
    setTimeout(() => {
      if (!J || J.job !== job) return;
      setMode("heads");
      generate();
      // the heads panel is taller than the drawing one, so fit the yard once it has settled
      setTimeout(() => {
        if (!J || J.job !== job) return;
        J.map.invalidateSize();
        const pts = job.shapes.flatMap((sh) => sh.pts.map((p) => [p.lat, p.lng]));
        J.map.fitBounds(pts, { padding: [16, 16] });
      }, 900);
    }, 300);
  }

  // Culinary (city) or secondary water decides the connection parts on the parts list.
  function waterSeg(cur) {
    return (
      '<div><label class="f">Water source</label><div class="seg" id="ws">' +
      [
        ["culinary", "Culinary"],
        ["secondary", "Secondary"],
      ]
        .map(
          ([k, t]) =>
            '<button type="button" data-w="' + k + '" aria-pressed="' + (cur === k) + '">' + t + "</button>",
        )
        .join("") +
      '</div><p class="note" id="wn">Culinary adds a backflow preventer. Secondary adds a filter.</p></div>'
    );
  }
  function wireWaterSeg(el, onPick) {
    el.querySelectorAll("[data-w]").forEach(
      (b) =>
        (b.onclick = () => {
          el.querySelectorAll("[data-w]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          onPick(b.dataset.w);
        }),
    );
  }

  function newJobSheet() {
    let picked = null;
    let water = null;
    sheet(
      '<h2>New job</h2><div class="stack">' +
        '<div><label class="f" for="jn">Customer or job name</label><input class="t" id="jn" placeholder="Smith backyard" autocomplete="off"></div>' +
        '<div><label class="f" for="ja">Address</label><div class="row"><input class="t" id="ja" placeholder="123 Main St" autocomplete="off"><button class="btn" id="js" aria-label="Find address">' +
        icon("search") +
        '</button></div><div class="results" id="jr"></div></div>' +
        '<button class="btn" id="jl" style="width:100%">' +
        icon("pin") +
        "Use where I am now</button>" +
        waterSeg(null) +
        '<div class="row"><button class="btn grow" id="jc">Cancel</button><button class="btn primary grow" id="jo">Start mapping</button></div></div>',
      (el, close) => {
        const name = el.querySelector("#jn"),
          addr = el.querySelector("#ja"),
          res = el.querySelector("#jr");
        name.focus();
        const search = async () => {
          const q = addr.value.trim();
          if (!q) return;
          if (!res.querySelector("button")) res.innerHTML = '<p class="note">Searching...</p>';
          try {
            const r = await fetch(
              "https://api.mapbox.com/search/geocode/v6/forward?country=us&autocomplete=true&limit=5&proximity=ip&types=address,street,place&q=" +
                encodeURIComponent(q) +
                "&access_token=" +
                MAPBOX_TOKEN,
            );
            if (!r.ok) throw new Error("search " + r.status);
            const list = (await r.json()).features.map((f) => ({
              display_name: f.properties.full_address || f.properties.name,
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
            }));
            if (q !== addr.value.trim()) return; // a newer keystroke already searched
            if (!list.length) {
              res.innerHTML =
                '<p class="note">No match. Try adding the city.</p>';
              return;
            }
            res.innerHTML = list
              .map(
                (p, i) =>
                  '<button data-i="' +
                  i +
                  '">' +
                  esc(p.display_name) +
                  "</button>",
              )
              .join("");
            res.querySelectorAll("button").forEach(
              (b) =>
                (b.onclick = () => {
                  const p = list[+b.dataset.i];
                  picked = { lat: +p.lat, lng: +p.lon };
                  addr.value = p.display_name.split(",").slice(0, 3).join(",");
                  res.innerHTML =
                    '<p class="note">' + icon("check") + " Found it.</p>";
                }),
            );
          } catch (e) {
            console.warn("Address search failed", e);
            res.innerHTML =
              '<p class="note">Address search is not reachable right now. You can still start and pan the map yourself.</p>';
          }
        };
        el.querySelector("#js").onclick = search;
        addr.addEventListener("keydown", (e) => {
          if (e.key === "Enter") search();
        });
        // suggestions as you type, after a short pause so every keystroke isn't a search
        let typeTimer;
        addr.addEventListener("input", () => {
          clearTimeout(typeTimer);
          if (addr.value.trim().length >= 4) typeTimer = setTimeout(search, 350);
        });
        el.querySelector("#jl").onclick = () => {
          if (!navigator.geolocation)
            return toast("This browser has no location access.");
          toast("Finding you...");
          navigator.geolocation.getCurrentPosition(
            (p) => {
              picked = { lat: p.coords.latitude, lng: p.coords.longitude };
              toast("Got your location.");
            },
            () =>
              toast(
                "Location was blocked. Allow it in Settings, or type the address.",
              ),
            { enableHighAccuracy: true, timeout: 15000 },
          );
        };
        wireWaterSeg(el, (w) => (water = w));
        el.querySelector("#jc").onclick = close;
        el.querySelector("#jo").onclick = () => {
          if (!water) {
            const wn = el.querySelector("#wn");
            wn.textContent = "Pick culinary or secondary first.";
            wn.style.color = "var(--bad)";
            return;
          }
          const center = picked || DEFAULT_CENTER;
          const job = {
            id: uid(),
            name: name.value.trim() || "Untitled yard",
            address: addr.value.trim(),
            created: Date.now(),
            updated: Date.now(),
            origin: center,
            view: { lat: center.lat, lng: center.lng, zoom: picked ? 20 : 15 },
            scale: 1,
            psi: 50,
            line: "34",
            customCap: 12,
            popupsOnly: false,
            water,
            shapes: [],
            markers: [],
            layout: null,
          };
          jobs.push(job);
          saveJobs();
          close();
          location.hash = "#/job/" + job.id;
        };
      },
    );
  }

  /* ---------------- job screen ---------------- */
  let J = null; // current job context

  function teardownJob() {
    document.querySelectorAll(".overlay, .scrim").forEach((el) => el.remove());
    if (!J) return;
    stopGps();
    if (J.map) J.map.remove();
    J = null;
  }

  function capOf(job) {
    return job.line === "34"
      ? 12
      : job.line === "1"
        ? 18
        : +job.customCap || 12;
  }

  function proj(job) {
    const lat0 = job.origin.lat,
      lng0 = job.origin.lng;
    const c = Math.cos((lat0 * Math.PI) / 180),
      k = job.scale || 1;
    return {
      toXY: (ll) => ({
        x: (ll.lng - lng0) * c * FT_PER_DEG * k,
        y: (ll.lat - lat0) * FT_PER_DEG * k,
      }),
      toLL: (x, y) =>
        L.latLng(lat0 + y / k / FT_PER_DEG, lng0 + x / k / (FT_PER_DEG * c)),
    };
  }

  // Shape vertex: {lat, lng, bf}. bf = bulge as a fraction of the edge length, so scaling never distorts curves.
  function shapeLocal(shape, P) {
    const v = shape.pts.map((p) => P.toXY(p));
    return v.map((p, i) => {
      const q = v[(i + 1) % v.length];
      const chord = Math.hypot(q.x - p.x, q.y - p.y);
      return { x: p.x, y: p.y, b: (shape.pts[i].bf || 0) * chord };
    });
  }

  function densify(verts, closed) {
    const out = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      out.push({ x: verts[i].x, y: verts[i].y });
      if (!closed && i === n - 1) break;
      const nx = verts[(i + 1) % n];
      E.arcPoints(verts[i], nx, verts[i].b, 0.75).forEach((p) => out.push(p));
    }
    return out;
  }

  function pointInRing(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a.y > pt.y !== b.y > pt.y &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
      )
        c = !c;
    }
    return c;
  }

  // Everything the engine needs, built from what's on the map.
  function buildAreas(job) {
    const P = proj(job);
    const lawns = job.shapes.filter(
      (s) => s.type === "lawn" && s.closed && s.pts.length >= 3,
    );
    const beds = job.shapes.filter(
      (s) => s.type === "bed" && s.closed && s.pts.length >= 3,
    );
    // a fence across a lawn splits it: sprinklers can't throw through a fence
    const fences = fenceLines(job, P);
    const areas = [];
    lawns.forEach((s) => {
      E.splitByFences(shapeLocal(s, P), fences).forEach((outer) => {
        const ring = densify(outer, true);
        const holes = beds
          .map((b) => shapeLocal(b, P))
          .filter((h) => {
            const c = {
              x: h.reduce((a, p) => a + p.x, 0) / h.length,
              y: h.reduce((a, p) => a + p.y, 0) / h.length,
            };
            return pointInRing(c, ring);
          });
        areas.push({ outer, holes, mode: s.mode || "auto", shapeId: s.id });
      });
    });
    return areas;
  }

  // A fence that pokes into a lawn without crossing it doesn't split it, so heads can still throw
  // around its end (a gate opening works the same way). Say so instead of guessing.
  function partFences(job) {
    const P = proj(job);
    const lawns = job.shapes.filter((s) => s.type === "lawn" && s.closed && s.pts.length >= 3);
    for (const f of fenceLines(job, P))
      for (const l of lawns) {
        const outer = shapeLocal(l, P);
        const ring = densify(outer, true);
        const inside = f.some((p) => pointInRing(p, ring));
        if (inside && E.splitByFences(outer, [f]).length < 2)
          return "A fence stops partway into a lawn, so heads can spray around its end. Run it past the lawn edge at both ends if it goes all the way across.";
      }
    return null;
  }

  // Finished fences as open lines in local feet.
  function fenceLines(job, P) {
    return job.shapes
      .filter((s) => s.type === "fence" && s.closed && s.pts.length >= 2)
      .map((s) => s.pts.map((p) => P.toXY(p)));
  }

  // Drip, per Zach 2026-11-08: every bed on the map is drip, zoned by the engine's rules.
  function dripFor(job) {
    const P = proj(job);
    const beds = job.shapes
      .filter((s) => s.type === "bed" && s.closed && s.pts.length >= 3)
      .map((s) => ({ id: s.id, pts: shapeLocal(s, P) }));
    return E.dripPlan(beds);
  }

  function signature(job) {
    return JSON.stringify([
      job.shapes.map((s) => [
        s.type,
        s.closed,
        s.mode,
        s.pts.map((p) => [
          p.lat.toFixed(7),
          p.lng.toFixed(7),
          (p.bf || 0).toFixed(3),
        ]),
      ]),
      job.scale,
      job.psi,
      capOf(job),
      job.popupsOnly,
    ]);
  }

  function isStale() {
    return !!(J && J.job.layout && J.job.layout.sig !== signature(J.job));
  }

  // Shapes the engine can't trust: crossed traces, slivers, and beds hanging over a lawn edge.
  function shapeProblems(job) {
    const P = proj(job);
    const closed = job.shapes.filter((s) => s.closed && s.type !== "fence" && s.pts.length >= 3);
    const rings = closed.map((s) => ({
      s,
      ring: densify(shapeLocal(s, P), true),
    }));
    const out = [];
    const name = (s) => (s.type === "lawn" ? "A lawn" : "A bed");
    rings.forEach(({ s, ring }) => {
      if (Math.abs(ringArea(ring)) < 4)
        out.push(name(s) + " has almost no area. Delete it or redraw it.");
      else if (selfCrosses(ring))
        out.push(
          name(s) +
            " crosses over itself. Drag its corners so the edges don't cross.",
        );
    });
    const lawns = rings.filter((r) => r.s.type === "lawn");
    const beds = rings.filter((r) => r.s.type === "bed");
    beds.forEach((b) => {
      lawns.forEach((l) => {
        const inside = b.ring.filter((p) => pointInRing(p, l.ring)).length;
        if (inside && (inside < b.ring.length || ringsCross(b.ring, l.ring)))
          out.push(
            "A bed hangs over the lawn edge. Move its corners inside the lawn.",
          );
      });
    });
    for (let i = 0; i < beds.length; i++)
      for (let j = i + 1; j < beds.length; j++)
        if (
          ringsCross(beds[i].ring, beds[j].ring) ||
          pointInRing(beds[i].ring[0], beds[j].ring) ||
          pointInRing(beds[j].ring[0], beds[i].ring)
        )
          out.push("Two beds overlap. Merge them into one bed.");
    return [...new Set(out)];
  }

  function ringArea(r) {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i],
        q = r[(i + 1) % r.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  function segCross(a, b, c, d) {
    const o = (p, q, r) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = o(c, d, a),
      d2 = o(c, d, b),
      d3 = o(a, b, c),
      d4 = o(a, b, d);
    return (
      ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
      ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
    );
  }

  function selfCrosses(r) {
    const n = r.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
      }
    return false;
  }

  function ringsCross(a, b) {
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++)
        if (segCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
          return true;
    return false;
  }

  // Put the map origin on the first traced point, so east-west feet are right wherever the yard is.
  function maybeRebase(ll) {
    const job = J.job;
    if (
      job.layout ||
      job.shapes.some((s) => s.pts.length) ||
      job.markers.length
    )
      return;
    job.origin = { lat: ll.lat, lng: ll.lng };
  }

  function openJob(job) {
    J = {
      job,
      mode: "draw",
      tool: null,
      drawing: null,
      selShape: null,
      selVertex: null,
      markerTag: "tree",
      selHead: null,
      selZone: null,
      moving: false,
      gps: null,
      offset: { lat: 0, lng: 0 },
      anchoring: false,
      measure: [],
      undo: [],
      layers: {},
    };
    app.innerHTML =
      '<div class="jobview">' +
      '<header class="topbar"><button class="iconbtn" id="back" aria-label="All jobs">' +
      icon("back") +
      "</button>" +
      '<div class="title"><b id="jt"></b><span id="js"></span></div>' +
      '<button class="iconbtn" id="set" aria-label="Job settings">' +
      icon("sliders") +
      "</button></header>" +
      '<div id="map"></div>' +
      '<section class="panel" id="panel" aria-live="polite"></section>' +
      '<nav class="tabs" role="tablist">' +
      tabBtn("draw", "pen", "Draw") +
      tabBtn("walk", "walk", "Walk") +
      tabBtn("measure", "ruler", "Measure") +
      tabBtn("heads", "drop", "Heads") +
      tabBtn("plan", "plan", "Plan") +
      "</nav></div>";
    app.querySelector("#back").onclick = () => (location.hash = "#/");
    app.querySelector("#set").onclick = settingsSheet;
    app
      .querySelectorAll(".tab")
      .forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));
    setTitle();

    const map = L.map("map", {
      zoomControl: false,
      maxZoom: 22,
      attributionControl: true,
      tap: true,
    });
    J.map = map;
    // the example yard is made up, so no photo of a real place goes under it
    if (job.example) map.getContainer().style.background = "#e9efe2";
    // Mapbox satellite through the Static Tiles API. The v4 raster endpoint answered 429 for this
    // account on 2026-11-07 while this one served z21 imagery, so this is the one wired in.
    const satellite = job.example ? null : L.tileLayer(
      "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=" + MAPBOX_TOKEN,
      {
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 22,
        maxNativeZoom: 22,
        attribution:
          '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © Maxar <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><b>Improve this map</b></a>',
      },
    );
    if (satellite) satellite.addTo(map);
    // if Mapbox refuses (token, quota, outage), fall back to Esri photos so the job still opens
    let tileFails = 0, swapped = false;
    if (satellite) satellite.on("tileerror", () => {
      if (swapped || ++tileFails < 6) return;
      swapped = true;
      map.removeLayer(satellite);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 22,
        maxNativeZoom: 19,
        attribution: "Imagery: Esri, Maxar, Earthstar Geographics",
      }).addTo(map);
      toast("Mapbox photos didn't load, so these are backup photos.");
    });
    map.setView([job.view.lat, job.view.lng], job.view.zoom);
    ["shapes", "heads", "labels", "edit", "gps", "measure", "markers"].forEach(
      (k) => (J.layers[k] = L.layerGroup().addTo(map)),
    );
    map.on("click", onMapClick);
    map.on("zoomend", () => {
      if (J && J.mode === "heads") renderHeads();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      job.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
      saveJobs();
    });
    map.on("zoomend", zoomClass);
    zoomClass();
    setMode(job.layout ? "heads" : "draw");
  }

  function tabBtn(mode, ic, label) {
    return (
      '<button class="tab" role="tab" data-mode="' +
      mode +
      '" aria-selected="false">' +
      icon(ic) +
      label +
      "</button>"
    );
  }

  function setTitle() {
    app.querySelector("#jt").textContent = J.job.name;
    const bits = [
      J.job.address || "No address",
      J.job.psi + " PSI",
      (J.job.line === "34" ? '3/4"' : J.job.line === "1" ? '1"' : "custom") +
        " line",
    ];
    app.querySelector("#js").textContent = bits.join(" · ");
  }

  function zoomClass() {
    J.map.getContainer().classList.toggle("far", J.map.getZoom() < 19);
  }

  function setMode(mode) {
    if (mode === "plan") return openPlan();
    if (J.mode === "walk" && mode !== "walk") stopGps();
    J.mode = mode;
    J.tool = mode === "draw" ? J.tool : null;
    J.anchoring = false;
    J.measure = [];
    J.selHead = null;
    J.moving = false;
    if (mode !== "draw" && mode !== "walk") {
      finishDrawing(false);
      J.selShape = null;
    }
    if (mode === "walk") startGps();
    app
      .querySelectorAll(".tab")
      .forEach((t) =>
        t.setAttribute("aria-selected", String(t.dataset.mode === mode)),
      );
    redraw();
  }

  function redraw() {
    renderShapes();
    renderEdit();
    renderLabels();
    renderMarkers();
    renderHeads();
    renderMeasure();
    renderPanel();
  }

  /* ---------------- map drawing ---------------- */
  function shapeLatLngs(shape, P) {
    const local = shapeLocal(shape, P);
    return densify(local, shape.closed && shape.type !== "fence").map((p) => P.toLL(p.x, p.y));
  }

  function renderShapes() {
    const lay = J.layers.shapes;
    lay.clearLayers();
    const P = proj(J.job);
    J.job.shapes.forEach((s) => {
      if (!s.pts.length) return;
      const lls = shapeLatLngs(s, P);
      const sel = J.selShape === s.id || (J.drawing && J.drawing === s.id);
      const lawn = s.type === "lawn";
      if (s.type === "fence") {
        // a dark line with a light core shows on grass, concrete and the plain example background
        const casing = L.polyline(lls, { color: "#2b2118", weight: sel ? 8 : 6, opacity: 0.85 });
        const core = L.polyline(lls, { color: sel ? "#f5b700" : "#f3ead7", weight: sel ? 4 : 2.5, dashArray: "1 7", lineCap: "round" });
        [casing, core].forEach((ly) => {
          ly.on("click", (e) => {
            if (J.mode !== "draw" || J.drawing || J.tool === "marker") return;
            L.DomEvent.stopPropagation(e);
            J.selShape = s.id;
            J.selVertex = null;
            redraw();
          });
          lay.addLayer(ly);
        });
        return;
      }
      const style = {
        color: sel ? "#f5b700" : lawn ? "#ffffff" : "#ffd8a8",
        weight: sel ? 4 : 2.5,
        fillColor: lawn ? "#8fd16a" : "#b07a45",
        fillOpacity: J.mode === "heads" ? 0.08 : lawn ? 0.28 : 0.5,
        dashArray: lawn ? null : "6 5",
      };
      const layer = s.closed ? L.polygon(lls, style) : L.polyline(lls, style);
      layer.on("click", (e) => {
        if (J.mode !== "draw" || J.drawing || J.tool === "marker") return;
        L.DomEvent.stopPropagation(e);
        J.selShape = s.id;
        J.selVertex = null;
        redraw();
      });
      lay.addLayer(layer);
    });
  }

  function vertexIcon(cls) {
    return L.divIcon({ className: cls, iconSize: [22, 22] });
  }

  function renderEdit() {
    const lay = J.layers.edit;
    lay.clearLayers();
    if (J.mode !== "draw" && J.mode !== "walk") return;
    const id = J.drawing || J.selShape;
    const s = J.job.shapes.find((x) => x.id === id);
    if (!s) return;
    const P = proj(J.job);
    s.pts.forEach((p, i) => {
      const cls =
        "vh" +
        (i === 0 && J.drawing ? " first" : "") +
        (J.selVertex === i && !J.drawing ? " sel" : "");
      const m = L.marker([p.lat, p.lng], {
        icon: vertexIcon(cls),
        draggable: true,
        keyboard: false,
        zIndexOffset: 1000,
      });
      m.on("dragstart", () => pushUndo());
      m.on("drag", (e) => {
        const ll = e.target.getLatLng();
        p.lat = ll.lat;
        p.lng = ll.lng;
        renderShapes();
      });
      m.on("dragend", () => {
        touch(J.job);
        redraw();
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (J.drawing && i === 0 && s.pts.length >= 3 && s.type !== "fence")
          return finishDrawing(true);
        // a fence is open: tapping its last dot finishes it
        if (J.drawing && s.type === "fence" && i === s.pts.length - 1 && s.pts.length >= 2)
          return finishDrawing(true);
        if (!J.drawing) {
          J.selVertex = i;
          renderEdit();
          renderPanel();
        }
      });
      lay.addLayer(m);
    });
    if (!s.closed || J.drawing || s.type === "fence") return;
    // midpoint handles: drag to bend the edge into a smooth arc, tap to add a corner
    const local = shapeLocal(s, P);
    local.forEach((a, i) => {
      const b = local[(i + 1) % local.length];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        c = Math.hypot(dx, dy);
      if (c < 1) return;
      const nl = { x: -dy / c, y: dx / c };
      const apex = {
        x: (a.x + b.x) / 2 + nl.x * a.b,
        y: (a.y + b.y) / 2 + nl.y * a.b,
      };
      const m = L.marker(P.toLL(apex.x, apex.y), {
        icon: L.divIcon({ className: "mh", iconSize: [18, 18] }),
        draggable: true,
        keyboard: false,
        zIndexOffset: 900,
      });
      let moved = false;
      m.on("dragstart", () => {
        moved = true;
        pushUndo();
      });
      m.on("drag", (e) => {
        const q = P.toXY(e.target.getLatLng());
        let bulge =
          (q.x - (a.x + b.x) / 2) * nl.x + (q.y - (a.y + b.y) / 2) * nl.y;
        if (Math.abs(bulge) < 0.6) bulge = 0; // snaps back to a straight edge
        bulge = Math.max(-0.9 * c, Math.min(0.9 * c, bulge));
        s.pts[i].bf = bulge / c;
        renderShapes();
      });
      m.on("dragend", () => {
        touch(J.job);
        redraw();
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (moved) return;
        pushUndo();
        const ll = P.toLL(apex.x, apex.y);
        s.pts[i].bf = 0;
        s.pts.splice(i + 1, 0, { lat: ll.lat, lng: ll.lng, bf: 0 });
        touch(J.job);
        redraw();
      });
      lay.addLayer(m);
    });
  }

  function renderLabels() {
    const lay = J.layers.labels;
    lay.clearLayers();
    if (J.mode === "heads") return;
    const P = proj(J.job);
    J.job.shapes.forEach((s) => {
      if (s.pts.length < 2) return;
      const local = shapeLocal(s, P);
      const n = s.closed && s.type !== "fence" ? local.length : local.length - 1;
      for (let i = 0; i < n; i++) {
        const e = edgeInfo(local[i], local[(i + 1) % local.length]);
        if (e.len < 2) continue;
        lay.addLayer(
          L.marker(P.toLL(e.mx, e.my), {
            icon: L.divIcon({
              className: "elabel",
              html: Math.round(e.len) + " ft",
              iconSize: null,
            }),
            interactive: false,
            keyboard: false,
          }),
        );
      }
    });
  }

  // length and label position of an edge, straight or curved
  function edgeInfo(a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      c = Math.hypot(dx, dy);
    const nl = c ? { x: -dy / c, y: dx / c } : { x: 0, y: 0 };
    const bb = a.b || 0;
    let len = c;
    if (Math.abs(bb) > 0.05 && c > 0) {
      const R = ((c * c) / 4 + bb * bb) / (2 * Math.abs(bb));
      const half = Math.asin(Math.min(1, c / 2 / R));
      const theta = Math.abs(bb) > R ? 2 * Math.PI - 2 * half : 2 * half;
      len = R * theta;
    }
    return {
      len,
      mx: (a.x + b.x) / 2 + nl.x * bb,
      my: (a.y + b.y) / 2 + nl.y * bb,
    };
  }

  function renderMarkers() {
    const lay = J.layers.markers;
    lay.clearLayers();
    J.job.markers.forEach((m) => {
      const t = MARKERS[m.tag] || MARKERS.note;
      const mk = L.marker([m.lat, m.lng], {
        icon: L.divIcon({
          className: "mk",
          html: t.letter,
          iconSize: [26, 26],
        }),
        draggable: J.mode === "draw",
        keyboard: false,
      });
      mk.getElement &&
        setTimeout(() => {
          const el = mk.getElement();
          if (el) el.style.background = t.color;
        }, 0);
      mk.on("dragend", (e) => {
        const ll = e.target.getLatLng();
        m.lat = ll.lat;
        m.lng = ll.lng;
        touch(J.job);
      });
      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (J.mode !== "draw") return;
        sheet(
          "<h2>" +
            t.name +
            '</h2><div class="row"><button class="btn grow" id="mc">Keep</button><button class="btn danger grow" id="md">' +
            icon("trash") +
            "Remove</button></div>",
          (el, close) => {
            el.querySelector("#mc").onclick = close;
            el.querySelector("#md").onclick = () => {
              pushUndo();
              J.job.markers = J.job.markers.filter((x) => x !== m);
              touch(J.job);
              close();
              redraw();
            };
          },
        );
      });
      lay.addLayer(mk);
    });
  }

  /* ---------------- drawing tools ---------------- */
  function pushUndo() {
    J.undo.push(
      JSON.stringify({ shapes: J.job.shapes, markers: J.job.markers }),
    );
    if (J.undo.length > 50) J.undo.shift();
  }
  function doUndo() {
    const s = J.undo.pop();
    if (!s) return toast("Nothing to undo.");
    const o = JSON.parse(s);
    J.job.shapes = o.shapes;
    J.job.markers = o.markers;
    if (J.drawing && !J.job.shapes.find((x) => x.id === J.drawing))
      J.drawing = null;
    // undoing a close reopens the shape, so keep drawing it
    const open = J.job.shapes.find((x) => !x.closed);
    if (open && (J.mode === "draw" || J.mode === "walk")) {
      J.drawing = open.id;
      J.selShape = null;
    } else if (open && open.pts.length < 3) {
      J.job.shapes = J.job.shapes.filter((x) => x !== open);
    }
    if (J.selShape && !J.job.shapes.find((x) => x.id === J.selShape))
      J.selShape = null;
    touch(J.job);
    redraw();
  }

  function startShape(type) {
    finishDrawing(false);
    pushUndo();
    const s = { id: uid(), type, pts: [], closed: false, mode: "auto" };
    J.job.shapes.push(s);
    J.drawing = s.id;
    J.selShape = null;
    J.tool = type;
    redraw();
    return s;
  }

  function finishDrawing(close) {
    if (!J || !J.drawing) return;
    const s = J.job.shapes.find((x) => x.id === J.drawing);
    if (close) pushUndo();
    J.drawing = null;
    J.tool = null;
    if (s && s.type === "fence") {
      // a fence is a line, so two points are enough; closed here just means finished
      if (s.pts.length >= 2) {
        s.closed = true;
        if (close) toast("Fence saved. Heads won't spray across it.");
      } else J.job.shapes = J.job.shapes.filter((x) => x !== s);
    } else if (s) {
      if (s.pts.length >= 3) {
        s.closed = true;
        if (close && selfCrosses(densify(shapeLocal(s, proj(J.job)), true))) {
          touch(J.job);
          redraw();
          return toast(
            "Those edges cross. Drag a corner so the shape doesn't fold over itself.",
          );
        }
        if (close)
          toast(
            s.type === "lawn"
              ? "Lawn saved. Drag a dashed dot to curve an edge."
              : "Bed saved. It gets drip, not heads.",
          );
      } else J.job.shapes = J.job.shapes.filter((x) => x !== s);
    }
    touch(J.job);
    redraw();
  }

  function onMapClick(e) {
    const ll = e.latlng;
    if (J.mode === "walk" && J.anchoring) {
      if (!J.gps) return toast("Waiting for GPS before anchoring.");
      J.offset = { lat: ll.lat - J.gps.lat, lng: ll.lng - J.gps.lng };
      J.anchoring = false;
      toast("Anchored. GPS points now line up with that spot.");
      renderGps();
      renderPanel();
      return;
    }
    if (J.mode === "measure") {
      if (J.measure.length >= 2) J.measure = [];
      J.measure.push(snapToVertex(ll));
      renderMeasure();
      renderPanel();
      return;
    }
    if (J.mode !== "draw") return;
    if (J.tool === "marker") {
      pushUndo();
      J.job.markers.push({
        id: uid(),
        tag: J.markerTag,
        lat: ll.lat,
        lng: ll.lng,
      });
      touch(J.job);
      renderMarkers();
      return;
    }
    if (J.drawing) {
      const s = J.job.shapes.find((x) => x.id === J.drawing);
      pushUndo();
      maybeRebase(ll);
      s.pts.push({ lat: ll.lat, lng: ll.lng, bf: 0 });
      touch(J.job);
      renderShapes();
      renderEdit();
      renderLabels();
      renderPanel();
      return;
    }
    if (J.selShape) {
      J.selShape = null;
      J.selVertex = null;
      redraw();
    }
  }

  function snapToVertex(ll) {
    const pt = J.map.latLngToContainerPoint(ll);
    let best = null,
      bd = 28;
    J.job.shapes.forEach((s) =>
      s.pts.forEach((p) => {
        const d = J.map.latLngToContainerPoint([p.lat, p.lng]).distanceTo(pt);
        if (d < bd) {
          bd = d;
          best = L.latLng(p.lat, p.lng);
        }
      }),
    );
    return best || ll;
  }

  /* ---------------- GPS walk ---------------- */
  function startGps() {
    if (!navigator.geolocation) {
      J.gpsError = "This browser has no GPS access.";
      return;
    }
    if (J.watch != null) return;
    J.gpsError = null;
    J.watch = navigator.geolocation.watchPosition(
      (p) => {
        if (!J) return;
        const first = !J.gps;
        J.gpsError = null;
        J.gps = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy,
        };
        if (first) J.map.setView(corrected(), Math.max(J.map.getZoom(), 20));
        renderGps();
        if (J.mode === "walk") renderPanel();
      },
      (err) => {
        if (!J) return;
        if (err.code !== 1 && J.gps) return; // a slow update after a good fix is not worth a warning
        J.gpsError =
          err.code === 1
            ? "Location is blocked for this site. Turn it on in Settings > Privacy > Location Services > Safari Websites."
            : "No GPS fix yet. Step out from under trees for a moment.";
        renderPanel();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }
  function stopGps() {
    if (J && J.watch != null) {
      navigator.geolocation.clearWatch(J.watch);
      J.watch = null;
      J.layers.gps && J.layers.gps.clearLayers();
    }
    if (J) J.gps = null; // never drop a corner at a fix from before the user walked away
  }
  function corrected() {
    return L.latLng(J.gps.lat + J.offset.lat, J.gps.lng + J.offset.lng);
  }
  function renderGps() {
    const lay = J.layers.gps;
    lay.clearLayers();
    if (!J.gps || J.mode !== "walk") return;
    const c = corrected();
    lay.addLayer(
      L.circle(c, {
        radius: J.gps.acc,
        color: "#1f6fe0",
        weight: 1,
        fillOpacity: 0.12,
        interactive: false,
      }),
    );
    lay.addLayer(
      L.marker(c, {
        icon: L.divIcon({ className: "me", iconSize: [18, 18] }),
        interactive: false,
        keyboard: false,
      }),
    );
  }
  function dropGpsPoint() {
    if (!J.gps) return toast("Waiting for a GPS fix.");
    let s = J.drawing && J.job.shapes.find((x) => x.id === J.drawing);
    if (!s) s = startShape(J.walkType || "lawn");
    pushUndo();
    const c = corrected();
    maybeRebase(c);
    s.pts.push({ lat: c.lat, lng: c.lng, bf: 0 });
    touch(J.job);
    toast("Corner " + s.pts.length + " dropped.");
    redraw();
  }

  /* ---------------- measure ---------------- */
  function measureFeet() {
    if (J.measure.length < 2) return 0;
    const P = proj(J.job);
    const a = P.toXY(J.measure[0]),
      b = P.toXY(J.measure[1]);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function renderMeasure() {
    const lay = J.layers.measure;
    lay.clearLayers();
    if (J.mode !== "measure") return;
    J.measure.forEach((ll) =>
      lay.addLayer(
        L.circleMarker(ll, {
          radius: 8,
          color: "#fff",
          weight: 3,
          fillColor: "#f5b700",
          fillOpacity: 1,
        }),
      ),
    );
    if (J.measure.length === 2) {
      lay.addLayer(
        L.polyline(J.measure, {
          color: "#f5b700",
          weight: 4,
          dashArray: "8 6",
        }),
      );
    }
  }

  /* ---------------- heads ---------------- */
  function generate() {
    const problems = shapeProblems(J.job);
    if (problems.length) {
      toast(problems[0]);
      J.problems = problems;
      renderPanel();
      return;
    }
    J.problems = null;
    const areas = buildAreas(J.job);
    if (!areas.length) return toast("Trace and close at least one lawn first.");
    const stub = partFences(J.job);
    if (stub) toast(stub);
    // a lawn traced while zoomed out to the neighborhood froze the page on the first live test;
    // 40,000 sq ft is about a full acre of turf, far past any residential lawn
    const big = areas.find(
      (a) => Math.abs(ringArea(densify(a.outer, true))) > 40000,
    );
    if (big)
      return toast(
        "That lawn is over 40,000 sq ft. Zoom in close and trace it again, or split it into smaller lawns.",
      );
    const busy = document.createElement("div");
    busy.className = "busy";
    busy.textContent = "Laying out heads...";
    app.querySelector(".jobview").appendChild(busy);
    setTimeout(() => {
      try {
        const out = E.layoutJob({
          areas,
          psi: J.job.psi,
          cap: capOf(J.job),
          popupsOnly: J.job.popupsOnly,
        });
        J.job.layout = {
          heads: out.heads.map(cleanHead),
          areas: out.areas.map((a) => ({
            family: a.family,
            note: a.note,
            issues: a.issues.length,
          })),
          sig: signature(J.job),
        };
        applyCheck(
          J.job,
          out.totals,
          out.areas.flatMap((a) => a.check.gapPts),
        );
        touch(J.job);
        J.selZone = null;
        J.selHead = null;
        redraw();
      } catch (e) {
        console.error("Layout failed", e);
        toast(
          "Layout hit a problem with this shape. Try removing a tiny edge or a tight curve.",
        );
      } finally {
        busy.remove();
      }
    }, 30);
  }

  function cleanHead(h) {
    return {
      x: h.x,
      y: h.y,
      r: h.r,
      dir: h.dir,
      arc: h.arc,
      role: h.role,
      kind: h.kind,
      model: h.model,
      series: h.series,
      label: h.label,
      gpmBase: h.gpmBase,
      scales: h.scales,
      gpm: h.gpm,
      area: h.area,
      zone: h.zone,
    };
  }

  // Zones and parts follow the heads; the check numbers come from the engine's independent verifier.
  function applyCheck(job, totals, gapPts) {
    const L0 = job.layout;
    const byZone = new Map();
    L0.heads.forEach((h) => {
      h.gpm = h.scales ? h.gpmBase * Math.sqrt(job.psi / 30) : h.gpmBase;
      if (!byZone.has(h.zone))
        byZone.set(h.zone, {
          n: h.zone,
          family: h.kind === "R" ? "rotor" : "spray",
          heads: [],
        });
      byZone.get(h.zone).heads.push(h);
    });
    const zones = [...byZone.values()].sort((a, b) => a.n - b.n);
    zones.forEach((z) => {
      z.gpm = z.heads.reduce((s, h) => s + h.gpm, 0);
      z.count = z.heads.length;
    });
    L0.zones = zones.map((z) => ({
      n: z.n,
      family: z.family,
      gpm: z.gpm,
      count: z.count,
    }));
    L0.parts = E.parts(L0.heads, zones, dripFor(job), job.water);
    L0.totals = {
      points: totals.points,
      gaps: totals.gaps,
      overspray: totals.overspray,
      coverage: totals.coverage,
    };
    L0.gapPts = gapPts.slice(0, 400).map((g) => ({ x: g.x, y: g.y }));
  }

  function recheckLayout() {
    const areas = buildAreas(J.job);
    const t = E.recheck({ areas }, J.job.layout.heads);
    applyCheck(J.job, t, t.gapPts);
    touch(J.job);
  }

  function sectorLatLngs(h, P) {
    const pts = [];
    if (h.arc >= 359.5) {
      for (let a = 0; a < 360; a += 6)
        pts.push(
          P.toLL(
            h.x + h.r * Math.cos((a * Math.PI) / 180),
            h.y + h.r * Math.sin((a * Math.PI) / 180),
          ),
        );
      return pts;
    }
    pts.push(P.toLL(h.x, h.y));
    const steps = Math.max(6, Math.ceil(h.arc / 5));
    for (let i = 0; i <= steps; i++) {
      const a = ((h.dir - h.arc / 2 + (h.arc * i) / steps) * Math.PI) / 180;
      pts.push(P.toLL(h.x + h.r * Math.cos(a), h.y + h.r * Math.sin(a)));
    }
    return pts;
  }

  function renderHeads() {
    const lay = J.layers.heads;
    lay.clearLayers();
    const L0 = J.job.layout;
    if (!L0 || J.mode !== "heads") return;
    const P = proj(J.job);
    // heads sharing a spot (both sides of a fence) are drawn a few pixels apart, toward the side
    // each one waters, so they read as two dots
    const nd = Plan.nudges(L0.heads, 7);
    const shift = (ll, i, k) => {
      if (!nd[i].dx && !nd[i].dy) return ll;
      const pt = J.map.latLngToContainerPoint(ll);
      return J.map.containerPointToLatLng(L.point(pt.x + nd[i].dx * k, pt.y + nd[i].dy * k));
    };
    L0.heads.forEach((h, i) => {
      const col = Plan.zoneColor(h.zone || 1);
      const dim = J.selZone != null && J.selZone !== h.zone;
      lay.addLayer(
        L.polygon(sectorLatLngs(h, P), {
          color: col,
          weight: 1.2,
          opacity: dim ? 0.15 : 0.9,
          fillColor: col,
          fillOpacity: dim ? 0.03 : 0.2,
          interactive: false,
        }),
      );
      const ll = shift(P.toLL(h.x, h.y), i, 1);
      // circle pop-up, square 5004, triangle 3504, same as the printed plan
      const key = Plan.shapeKey(h);
      const sel = J.selHead === i;
      const dot =
        key === "spray"
          ? L.circleMarker(ll, { radius: sel ? 9 : 6.5, color: "#fff", weight: sel ? 3.5 : 2, fillColor: col, fillOpacity: dim ? 0.35 : 1 })
          : L.marker(ll, {
              keyboard: false,
              icon: L.divIcon({
                className: "hshape",
                iconSize: [sel ? 24 : 18, sel ? 24 : 18],
                html:
                  '<svg viewBox="0 0 20 20" width="100%" height="100%" style="opacity:' + (dim ? 0.4 : 1) + '">' +
                  (key === "5004"
                    ? '<rect x="3" y="3" width="14" height="14" fill="' + col + '" stroke="#fff" stroke-width="2.5"/>'
                    : '<polygon points="10,2 18.5,17 1.5,17" fill="' + col + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>') +
                  "</svg>",
              }),
            });
      dot.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        J.selHead = i;
        J.moving = false;
        renderHeads();
        renderPanel();
      });
      lay.addLayer(dot);
      if (!dim)
        lay.addLayer(
          L.marker(shift(P.toLL(h.x, h.y), i, 3.2), {
            icon: L.divIcon({
              className: "hlabel",
              html: esc(h.label),
              iconSize: null,
            }),
            interactive: false,
            keyboard: false,
          }),
        );
    });
    (L0.gapPts || []).forEach((g) =>
      lay.addLayer(
        L.circleMarker(P.toLL(g.x, g.y), {
          radius: 2.5,
          color: "#ff2d2d",
          weight: 0,
          fillOpacity: 0.9,
          interactive: false,
        }),
      ),
    );
    if (J.moving && J.selHead != null) {
      const h = L0.heads[J.selHead];
      const m = L.marker(P.toLL(h.x, h.y), {
        draggable: true,
        icon: L.divIcon({ className: "vh sel", iconSize: [22, 22] }),
        zIndexOffset: 2000,
      });
      m.on("dragend", (e) => {
        const q = P.toXY(e.target.getLatLng());
        h.x = q.x;
        h.y = q.y;
        recheckLayout();
        renderHeads();
        renderPanel();
      });
      lay.addLayer(m);
    }
  }

  // small key under the zones: which symbol is which head, only for types on this job
  function shapeKeyRow(heads) {
    const sym = {
      spray: '<circle cx="8" cy="8" r="5.5" fill="#1d2320"/>',
      5004: '<rect x="2.5" y="2.5" width="11" height="11" fill="#1d2320"/>',
      3504: '<polygon points="8,1.5 14.5,13.5 1.5,13.5" fill="#1d2320"/>',
    };
    const names = { spray: "Pop-up", 5004: "5004 rotor", 3504: "3504 rotor" };
    const have = ["spray", "5004", "3504"].filter((k) => heads.some((h) => Plan.shapeKey(h) === k));
    return (
      '<p class="note" style="display:flex;gap:14px;flex-wrap:wrap">' +
      have.map((k) => '<span style="display:inline-flex;align-items:center;gap:5px"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + sym[k] + "</svg>" + names[k] + "</span>").join("") +
      "</p>"
    );
  }

  /* ---------------- panel ---------------- */
  function renderPanel() {
    const el = app.querySelector("#panel");
    if (!el) return;
    const f = {
      draw: panelDraw,
      walk: panelWalk,
      measure: panelMeasure,
      heads: panelHeads,
    }[J.mode];
    el.innerHTML = "";
    f(el);
  }

  function panelDraw(el) {
    const job = J.job;
    if (J.drawing) {
      const s = job.shapes.find((x) => x.id === J.drawing);
      if (s.type === "fence") {
        el.innerHTML =
          '<p class="hint"><b>Fence:</b> tap where it starts, each corner, and where it ends. Run it past the lawn edge where it meets the lawn. ' +
          s.pts.length +
          " point" +
          (s.pts.length === 1 ? "" : "s") +
          " so far.</p>" +
          '<div class="row"><button class="btn grow" id="u">' +
          icon("undo") +
          'Undo</button><button class="btn primary grow" id="d"' +
          (s.pts.length < 2 ? " disabled" : "") +
          ">" +
          icon("check") +
          "Done</button></div>";
        el.querySelector("#u").onclick = doUndo;
        el.querySelector("#d").onclick = () => finishDrawing(true);
        return;
      }
      el.innerHTML =
        '<p class="hint">' +
        (s.type === "lawn"
          ? "<b>Lawn:</b> tap each corner on the photo."
          : "<b>Bed:</b> tap its corners. Beds get drip, not heads.") +
        " Tap the first dot to close it. " +
        s.pts.length +
        " corner" +
        (s.pts.length === 1 ? "" : "s") +
        " so far.</p>" +
        '<div class="row"><button class="btn grow" id="u">' +
        icon("undo") +
        'Undo</button><button class="btn primary grow" id="d"' +
        (s.pts.length < 3 ? " disabled" : "") +
        ">" +
        icon("check") +
        "Close shape</button></div>";
      el.querySelector("#u").onclick = doUndo;
      el.querySelector("#d").onclick = () => finishDrawing(true);
      return;
    }
    if (J.tool === "marker") {
      el.innerHTML =
        '<p class="hint">Pick what it is, then tap the map. Tap a marker later to remove it.</p><div class="chips">' +
        Object.keys(MARKERS)
          .map(
            (k) =>
              '<button class="chip" data-t="' +
              k +
              '" aria-pressed="' +
              (J.markerTag === k) +
              '"><span class="dot" style="background:' +
              MARKERS[k].color +
              '"></span>' +
              MARKERS[k].name +
              "</button>",
          )
          .join("") +
        '</div><button class="btn" style="width:100%" id="done">' +
        icon("check") +
        "Done adding markers</button>";
      el.querySelectorAll(".chip").forEach(
        (c) =>
          (c.onclick = () => {
            J.markerTag = c.dataset.t;
            renderPanel();
          }),
      );
      el.querySelector("#done").onclick = () => {
        J.tool = null;
        redraw();
      };
      return;
    }
    const s = J.selShape && job.shapes.find((x) => x.id === J.selShape);
    if (s && s.type === "fence") {
      el.innerHTML =
        '<p class="hint"><b>Fence selected.</b> Drag the dots to move it. Heads on each side stay on their own side.</p>' +
        '<div class="row">' +
        (J.selVertex != null && s.pts.length > 2 ? '<button class="btn grow" id="rv">Remove point</button>' : "") +
        '<button class="btn danger grow" id="del">' +
        icon("trash") +
        'Delete</button><button class="btn grow" id="ok">' +
        icon("check") +
        "Done</button></div>";
      const rv = el.querySelector("#rv");
      if (rv)
        rv.onclick = () => {
          pushUndo();
          s.pts.splice(J.selVertex, 1);
          J.selVertex = null;
          touch(job);
          redraw();
        };
      el.querySelector("#del").onclick = () => {
        pushUndo();
        job.shapes = job.shapes.filter((x) => x !== s);
        J.selShape = null;
        touch(job);
        redraw();
      };
      el.querySelector("#ok").onclick = () => {
        J.selShape = null;
        J.selVertex = null;
        redraw();
      };
      return;
    }
    if (s) {
      const lawn = s.type === "lawn";
      let h =
        '<p class="hint"><b>' +
        (lawn ? "Lawn" : "Bed") +
        " selected.</b> Drag the white dots to move corners. Drag a dashed dot to curve an edge, or tap it to add a corner.</p>";
      if (lawn) {
        h +=
          '<label class="f">Heads for this lawn</label><div class="seg" style="margin-bottom:10px">' +
          [
            ["auto", "Auto"],
            ["spray", "Pop-ups only"],
          ]
            .map(
              ([k, t]) =>
                '<button data-m="' +
                k +
                '" aria-pressed="' +
                ((s.mode === "spray" ? "spray" : "auto") === k) +
                '">' +
                t +
                "</button>",
            )
            .join("") +
          "</div>" +
          '<p class="note" style="margin-top:-4px">' +
          (s.mode === "spray" ? "Pop-ups everywhere on this lawn." : "Rotors where the lawn opens up, pop-ups in narrow spots and along curves.") +
          "</p>";
      }
      h +=
        '<div class="row">' +
        (J.selVertex != null && s.pts.length > 3
          ? '<button class="btn grow" id="rv">Remove corner</button>'
          : "") +
        '<button class="btn danger grow" id="del">' +
        icon("trash") +
        'Delete</button><button class="btn grow" id="ok">' +
        icon("check") +
        "Done</button></div>";
      el.innerHTML = h;
      el.querySelectorAll("[data-m]").forEach(
        (b) =>
          (b.onclick = () => {
            s.mode = b.dataset.m;
            touch(job);
            renderPanel();
          }),
      );
      const rv = el.querySelector("#rv");
      if (rv)
        rv.onclick = () => {
          pushUndo();
          s.pts.splice(J.selVertex, 1);
          J.selVertex = null;
          touch(job);
          redraw();
        };
      el.querySelector("#del").onclick = () => {
        pushUndo();
        job.shapes = job.shapes.filter((x) => x !== s);
        J.selShape = null;
        touch(job);
        redraw();
      };
      el.querySelector("#ok").onclick = () => {
        J.selShape = null;
        J.selVertex = null;
        redraw();
      };
      return;
    }
    const lawns = job.shapes.filter((x) => x.type === "lawn").length;
    el.innerHTML =
      '<p class="hint">' +
      (lawns
        ? "Tap a shape to edit it, or add another."
        : "Zoom in on the yard and trace the lawn. Where trees hide the edge, use <b>Walk</b>.") +
      "</p>" +
      '<div class="row"><button class="btn primary grow" id="al">' +
      icon("plus") +
      'Lawn</button><button class="btn grow" id="ab">' +
      icon("plus") +
      'Bed</button></div><div class="row"><button class="btn grow" id="af">' +
      icon("plus") +
      'Fence</button><button class="btn grow" id="am">' +
      icon("pin") +
      "Marker</button></div>" +
      (J.undo.length
        ? '<div class="row"><button class="btn small ghost" id="u">' +
          icon("undo") +
          "Undo last change</button></div>"
        : "");
    el.querySelector("#al").onclick = () => startShape("lawn");
    el.querySelector("#ab").onclick = () => startShape("bed");
    el.querySelector("#af").onclick = () => startShape("fence");
    el.querySelector("#am").onclick = () => {
      J.tool = "marker";
      J.selShape = null;
      redraw();
    };
    const u = el.querySelector("#u");
    if (u) u.onclick = doUndo;
  }

  function panelWalk(el) {
    const s = J.drawing && J.job.shapes.find((x) => x.id === J.drawing);
    let h = "";
    if (J.gpsError)
      h += '<div class="badge warn">' + esc(J.gpsError) + "</div>";
    const accFt = J.gps ? Math.round(J.gps.acc * 3.281) : null;
    h +=
      '<p class="hint">Stand on each corner and drop a point. Passing something you can see on the photo, like a house corner? Tap <b>Anchor</b>, then tap that spot.</p>';
    h +=
      '<p class="hint"><span class="gps">' +
      (J.gps ? "GPS within about " + accFt + " ft" : "Waiting for GPS...") +
      "</span>" +
      (J.offset.lat || J.offset.lng ? " · anchored" : "") +
      (s ? " · " + s.pts.length + " corners" : "") +
      "</p>";
    if (J.anchoring)
      h +=
        '<div class="badge warn">Tap the map where you are standing right now.</div>';
    h +=
      '<div class="seg" style="margin-bottom:8px"><button data-w="lawn" aria-pressed="' +
      ((J.walkType || "lawn") === "lawn") +
      '">Walking a lawn</button><button data-w="bed" aria-pressed="' +
      (J.walkType === "bed") +
      '">Walking a bed</button></div>';
    h +=
      '<div class="row"><button class="btn primary grow" id="dp"' +
      (J.gps ? "" : " disabled") +
      ">" +
      icon("pin") +
      'Drop corner here</button><button class="btn grow" id="an">Anchor</button></div>';
    h +=
      '<div class="row"><button class="btn grow" id="u">' +
      icon("undo") +
      'Undo</button><button class="btn grow" id="fs"' +
      (s && s.pts.length >= 3 ? "" : " disabled") +
      ">" +
      icon("check") +
      "Close shape</button></div>";
    el.innerHTML = h;
    el.querySelectorAll("[data-w]").forEach(
      (b) =>
        (b.onclick = () => {
          J.walkType = b.dataset.w;
          renderPanel();
        }),
    );
    el.querySelector("#dp").onclick = dropGpsPoint;
    el.querySelector("#an").onclick = () => {
      J.anchoring = !J.anchoring;
      renderPanel();
    };
    el.querySelector("#u").onclick = doUndo;
    el.querySelector("#fs").onclick = () => finishDrawing(true);
  }

  function panelMeasure(el) {
    const job = J.job;
    const ft = measureFeet();
    let h = "";
    if (J.measure.length < 2) {
      h +=
        '<p class="hint">Tap both ends of something you can tape on site, like the back wall of the house. Taps snap to corners you traced.</p>';
    } else {
      h +=
        '<p class="hint">The map says <b>' +
        ft.toFixed(1) +
        " ft</b>. What does your tape say?</p>" +
        '<div class="row"><input class="t" id="tp" inputmode="decimal" placeholder="Tape reading in feet" aria-label="Tape reading in feet"><button class="btn primary" id="ap">Apply</button></div>';
    }
    const pct = (job.scale - 1) * 100;
    h +=
      '<p class="note">' +
      (Math.abs(pct) < 0.05
        ? "Scale has not been corrected yet."
        : "Scale corrected by " +
          (pct > 0 ? "+" : "") +
          pct.toFixed(1) +
          "% from your tape.") +
      "</p>";
    if (Math.abs(pct) >= 0.05)
      h += '<button class="btn small" id="rs">Reset scale</button>';
    el.innerHTML = h;
    const ap = el.querySelector("#ap");
    if (ap)
      ap.onclick = () => {
        const tape = parseFloat(el.querySelector("#tp").value);
        if (!(tape > 0))
          return toast("Type the tape reading in feet, like 42.5");
        const ratio = tape / ft;
        if (ratio < 0.5 || ratio > 2)
          return toast(
            "That is more than double off. Check you tapped the right two spots.",
          );
        job.scale *= ratio;
        J.measure = [];
        touch(job);
        toast("Scale locked to your tape.");
        redraw();
      };
    const rs = el.querySelector("#rs");
    if (rs)
      rs.onclick = () => {
        job.scale = 1;
        touch(job);
        redraw();
      };
  }

  function panelHeads(el) {
    const job = J.job;
    const L0 = job.layout;
    const lineTxt =
      (job.line === "34" ? '3/4"' : job.line === "1" ? '1"' : "custom") +
      " line, " +
      capOf(job) +
      " GPM per zone";
    let h = "";
    if (J.selHead != null && L0 && L0.heads[J.selHead]) {
      const hd = L0.heads[J.selHead];
      const what =
        hd.kind === "R"
          ? "Rain Bird " + hd.model + " rotor"
          : hd.kind === "VAN"
            ? hd.series + " series VAN on an 1804"
            : hd.series + hd.kind + " on an 1804";
      h +=
        '<dl class="kv"><dt>Head</dt><dd>' +
        esc(hd.label) +
        " · " +
        esc(what) +
        "</dd><dt>Throw</dt><dd>" +
        hd.r.toFixed(1) +
        " ft" +
        (hd.kind === "R" ? " (screw set, " + (hd.model === "5004" ? "24 to 30" : "18 to 23") + " ft range)" : "") +
        ", " +
        Math.round(hd.arc) +
        "°</dd><dt>Flow</dt><dd>" +
        hd.gpm.toFixed(2) +
        " GPM</dd><dt>Zone</dt><dd>" +
        hd.zone +
        "</dd></dl>";
      h +=
        '<div class="row"><button class="btn grow" id="mv">' +
        icon("move") +
        (J.moving ? "Drag the dot" : "Move") +
        '</button><button class="btn danger grow" id="dh">' +
        icon("trash") +
        'Delete</button><button class="btn grow" id="cl">' +
        icon("check") +
        "Done</button></div>";
      el.innerHTML = h;
      el.querySelector("#mv").onclick = () => {
        J.moving = !J.moving;
        renderHeads();
        renderPanel();
      };
      el.querySelector("#dh").onclick = () => {
        L0.heads.splice(J.selHead, 1);
        J.selHead = null;
        J.moving = false;
        recheckLayout();
        redraw();
      };
      el.querySelector("#cl").onclick = () => {
        J.selHead = null;
        J.moving = false;
        renderHeads();
        renderPanel();
      };
      return;
    }
    const stale = L0 && L0.sig !== signature(job);
    if (J.problems && J.problems.length)
      h += J.problems
        .map((m) => '<div class="badge bad">' + esc(m) + "</div>")
        .join("");
    if (L0 && L0.totals) {
      const t = L0.totals;
      const cov = (t.coverage * 100).toFixed(1);
      if (stale)
        h +=
          '<div class="badge warn">The yard or settings changed since this layout. Generate again.</div>';
      else if (t.overspray === 0 && t.coverage >= 0.995)
        h +=
          '<div class="badge ok">' +
          icon("check") +
          "No overspray. " +
          cov +
          "% double covered.</div>";
      else
        h +=
          '<div class="badge bad">' +
          (t.overspray
            ? t.overspray +
              " head" +
              (t.overspray > 1 ? "s spray" : " sprays") +
              " past the edge. "
            : "") +
          cov +
          "% double covered. Red dots show thin spots.</div>";
      const parts = L0.parts;
      h +=
        '<div class="chips">' +
        L0.zones
          .map(
            (z) =>
              '<button class="chip" data-z="' +
              z.n +
              '" aria-pressed="' +
              (J.selZone === z.n) +
              '"><span class="dot" style="background:' +
              Plan.zoneColor(z.n) +
              '"></span>Zone ' +
              z.n +
              ": " +
              z.count +
              ", " +
              z.gpm.toFixed(1) +
              " GPM</button>",
          )
          .join("") +
        "</div>";
      const drip = dripFor(job);
      if (drip.zones.length)
        h +=
          '<p class="note">Plus ' +
          drip.zones.length +
          " drip zone" +
          (drip.zones.length > 1 ? "s" : "") +
          " for the beds, " +
          drip.ft +
          " ft of drip pipe.</p>";
      const smallRotor = L0.zones.filter(
        (z) => z.family === "rotor" && z.count < 3,
      );
      if (smallRotor.length)
        h +=
          '<div class="badge warn">Zone ' +
          smallRotor.map((z) => z.n).join(", ") +
          " has fewer than 3 rotors and nothing nearby could take them. Try Pop-ups for that lawn, or a bigger line.</div>";
      if (parts.overLimit)
        h +=
          '<div class="badge warn">' +
          parts.stations +
          " stations. Most common timers top out at 16.</div>";
      const notes = L0.areas.filter((a) => a.note).map((a) => a.note);
      if (notes.length)
        h +=
          notes.map((n) => '<p class="note">' + esc(n.charAt(0).toUpperCase() + n.slice(1)) + ".</p>").join("");
      h +=
        '<p class="note">' +
        L0.heads.length +
        " heads · " +
        job.psi +
        " PSI · " +
        lineTxt +
        ". Tap a head to move or delete it.</p>" +
        shapeKeyRow(L0.heads);
      h +=
        '<div class="row"><button class="btn primary grow" id="gen">Generate again</button><button class="btn grow" id="pl">' +
        icon("list") +
        "Parts</button></div>";
    } else {
      h +=
        '<p class="hint">Rotors go where the lawn opens up and pop-ups fill the narrow spots. Corners first, then each edge, then the fewest and biggest full circles in the middle. Nothing sprays past your lines.</p>';
      h +=
        '<p class="note">' +
        job.psi +
        " PSI · " +
        lineTxt +
        (job.popupsOnly ? " · pop-ups only" : "") +
        ". Change these with the sliders button up top.</p>";
      h +=
        '<button class="btn primary" style="width:100%" id="gen">Generate layout</button>';
    }
    el.innerHTML = h;
    el.querySelector("#gen").onclick = generate;
    const pl = el.querySelector("#pl");
    if (pl) pl.onclick = openParts;
    el.querySelectorAll("[data-z]").forEach(
      (c) =>
        (c.onclick = () => {
          const n = +c.dataset.z;
          J.selZone = J.selZone === n ? null : n;
          renderHeads();
          renderPanel();
        }),
    );
  }

  /* ---------------- settings ---------------- */
  function settingsSheet() {
    const job = J.job;
    sheet(
      '<h2>Job settings</h2><div class="stack">' +
        '<div><label class="f" for="sn">Name</label><input class="t" id="sn" value="' +
        esc(job.name) +
        '"></div>' +
        '<div><label class="f" for="sa">Address</label><input class="t" id="sa" value="' +
        esc(job.address) +
        '"></div>' +
        '<div><label class="f">Working pressure (PSI)</label><div class="stepper"><button id="pm" aria-label="Lower pressure">-</button><output id="pv">' +
        job.psi +
        '</output><button id="pp" aria-label="Raise pressure">+</button></div><p class="note" id="pn"></p></div>' +
        '<div><label class="f">Supply line</label><div class="seg" id="ln">' +
        [
          ["34", '3/4" (12)'],
          ["1", '1" (18)'],
          ["c", "Custom"],
        ]
          .map(
            ([k, t]) =>
              '<button data-l="' +
              k +
              '" aria-pressed="' +
              (job.line === k) +
              '">' +
              t +
              "</button>",
          )
          .join("") +
        '</div><div id="cc" style="margin-top:8px"' +
        (job.line === "c" ? "" : " hidden") +
        '><label class="f" for="cv">Max GPM per zone</label><input class="t" id="cv" inputmode="decimal" value="' +
        job.customCap +
        '"></div></div>' +
        waterSeg(job.water) +
        '<label class="toggle"><span><b>Pop-ups only</b><br><span class="note" style="margin:0">Skip rotors on every lawn</span></span><input type="checkbox" id="po"' +
        (job.popupsOnly ? " checked" : "") +
        "></label>" +
        '<button class="btn primary" style="width:100%" id="sv">' +
        icon("check") +
        "Save</button>" +
        '<button class="btn danger" style="width:100%" id="dj">' +
        icon("trash") +
        "Delete this job</button></div>",
      (el, close) => {
        let psi = job.psi,
          line = job.line,
          water = job.water || null;
        wireWaterSeg(el, (w) => (water = w));
        const pn = el.querySelector("#pn");
        const note = () => {
          pn.textContent =
            psi < 50
              ? "Below 50 PSI your 12 and 18 GPM caps may be too high. A flow test is safer."
              : "Spray flow is the 30 PSI chart times " +
                Math.sqrt(psi / 30).toFixed(2) +
                ".";
        };
        note();
        el.querySelector("#pm").onclick = () => {
          psi = Math.max(20, psi - 5);
          el.querySelector("#pv").textContent = psi;
          note();
        };
        el.querySelector("#pp").onclick = () => {
          psi = Math.min(100, psi + 5);
          el.querySelector("#pv").textContent = psi;
          note();
        };
        el.querySelectorAll("[data-l]").forEach(
          (b) =>
            (b.onclick = () => {
              line = b.dataset.l;
              el.querySelectorAll("[data-l]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === b)),
              );
              el.querySelector("#cc").hidden = line !== "c";
            }),
        );
        el.querySelector("#sv").onclick = () => {
          job.name = el.querySelector("#sn").value.trim() || job.name;
          job.address = el.querySelector("#sa").value.trim();
          job.psi = psi;
          job.line = line;
          const cv = parseFloat(el.querySelector("#cv").value);
          // below 5 GPM a single rotor or 15F at 50 PSI can't fit on a zone at all
          if (cv >= 5) job.customCap = cv;
          else if (line === "c")
            toast(
              "Custom cap must be at least 5 GPM. Kept " + job.customCap + ".",
            );
          job.popupsOnly = el.querySelector("#po").checked;
          if (water) job.water = water;
          touch(job);
          close();
          setTitle();
          redraw();
        };
        el.querySelector("#dj").onclick = () => {
          if (!confirm('Delete "' + job.name + '"? This cannot be undone.'))
            return;
          deletedIds.add(job.id);
          jobs = jobs.filter((x) => x !== job);
          saveJobs();
          close();
          location.hash = "#/";
        };
      },
    );
  }

  /* ---------------- plan and parts ---------------- */
  function planData(copy) {
    const job = J.job;
    const P = proj(job);
    const shapes = job.shapes
      .filter((s) => s.closed && s.type !== "fence" && s.pts.length >= 3)
      .map((s) => {
        const local = shapeLocal(s, P);
        const edges = local.map((a, i) =>
          edgeInfo(a, local[(i + 1) % local.length]),
        );
        return { type: s.type, ring: densify(local, true), edges };
      });
    const L0 = job.layout;
    return {
      fences: fenceLines(job, P),
      copy,
      title: job.name,
      address: job.address,
      date: new Date().toLocaleDateString(),
      shapes,
      heads: L0 ? L0.heads : [],
      zones: L0 ? L0.zones : [],
      legendRows: L0 ? L0.zones.length : 0,
      markers: job.markers.map((m) => {
        const q = P.toXY(m);
        const t = MARKERS[m.tag] || MARKERS.note;
        return { x: q.x, y: q.y, letter: t.letter, color: t.color };
      }),
    };
  }

  function openPlan() {
    let copy = "customer";
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML =
      '<header class="topbar"><button class="iconbtn" id="pc" aria-label="Back to map">' +
      icon("back") +
      '</button><div class="title"><b>Plan</b><span>' +
      esc(J.job.name) +
      "</span></div>" +
      '<button class="iconbtn" id="pp" aria-label="Print or save PDF">' +
      icon("print") +
      "</button></header>" +
      '<div class="body"><div class="seg" style="margin-bottom:10px"><button data-c="customer" aria-pressed="true">Customer copy</button><button data-c="contractor" aria-pressed="false">Contractor copy</button></div>' +
      (isStale()
        ? '<div class="badge warn">The yard or settings changed since the last Generate. Generate again before using this.</div>'
        : "") +
      '<canvas id="pcv" width="1700" height="2200"></canvas>' +
      (J.job.layout
        ? ""
        : '<p class="note">No heads yet. Go to Heads and tap Generate.</p>') +
      '<div class="row" style="margin-top:12px"><button class="btn grow" id="pa">' +
      icon("list") +
      'Parts list</button><button class="btn primary grow" id="pr">' +
      icon("print") +
      "Print or save PDF</button></div></div>";
    document.body.appendChild(ov);
    const cv = ov.querySelector("#pcv");
    const draw = () => Plan.drawPlan(cv, planData(copy));
    draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    ov.querySelectorAll("[data-c]").forEach(
      (b) =>
        (b.onclick = () => {
          copy = b.dataset.c;
          ov.querySelectorAll("[data-c]").forEach((x) =>
            x.setAttribute("aria-pressed", String(x === b)),
          );
          draw();
        }),
    );
    const doPrint = () => {
      if (isStale())
        return toast("Generate again first. This layout is out of date.");
      printPlan(cv, copy);
    };
    ov.querySelector("#pp").onclick = doPrint;
    ov.querySelector("#pr").onclick = doPrint;
    ov.querySelector("#pa").onclick = openParts;
    ov.querySelector("#pc").onclick = () => ov.remove();
  }

  // Rebuilt on every open so jobs saved before a parts rule changed still get the current list.
  function freshParts(L0) {
    return E.parts(L0.heads, L0.zones || [], dripFor(J.job), J.job.water);
  }
  // The list the crew sees: the company's edited copy if there is one, else the app's.
  function shownParts(L0) {
    const fresh = freshParts(L0);
    return J.job.partsEdit ? { lines: J.job.partsEdit.lines, notes: fresh.notes } : fresh;
  }
  function partsTable(parts) {
    let h = '<table class="parts">';
    let group = null;
    parts.lines.forEach((l) => {
      if (l.group !== group) {
        group = l.group;
        const note = parts.notes && parts.notes[group];
        h += '<tr><th class="g" colspan="2">' + esc(group) + (note ? ' <span class="gn">· ' + esc(note) + "</span>" : "") + "</th></tr>";
      }
      h +=
        "<tr><td>" + esc(l.item) + '</td><td class="q">' + l.qty + "</td></tr>";
    });
    return h + "</table>";
  }

  function partsText(parts) {
    let t =
      J.job.name + (J.job.address ? " (" + J.job.address + ")" : "") + "\n";
    let group = null;
    parts.lines.forEach((l) => {
      if (l.group !== group) {
        group = l.group;
        const note = parts.notes && parts.notes[group];
        t += "\n" + group + (note ? " (" + note + ")" : "") + "\n";
      }
      t += l.qty + "  " + l.item + "\n";
    });
    return t;
  }

  function printPlan(cv, copy) {
    const area = document.getElementById("print-area");
    const L0 = J.job.layout;
    area.innerHTML =
      '<img alt="Sprinkler plan" src="' +
      cv.toDataURL("image/png") +
      '">' +
      (copy === "contractor" && L0 ? partsTable(shownParts(L0)) : "");
    setTimeout(() => window.print(), 50);
  }

  function openParts() {
    const L0 = J.job.layout;
    const job = J.job;
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.style.zIndex = 950;
    let editing = null; // working copy of the lines while editing

    const appLines = () => (L0 ? freshParts(L0).lines : []);
    const sameAsBase = () =>
      !job.partsEdit || job.partsEdit.base === JSON.stringify(appLines());

    function editRows() {
      let h = "";
      let group = null;
      editing.forEach((l, i) => {
        if (l.group !== group) {
          if (group !== null)
            h += '<button class="btn small ghost" data-add="' + esc(group) + '">' + icon("plus") + "Add to " + esc(group) + "</button>";
          group = l.group;
          h += '<div class="pe-g">' + esc(group) + "</div>";
        }
        h +=
          '<div class="pe"><input class="t" data-i="' + i + '" data-f="item" value="' + esc(l.item) +
          '" aria-label="Part"><input class="t q" data-i="' + i + '" data-f="qty" inputmode="numeric" value="' + esc(String(l.qty)) +
          '" aria-label="How many"><button class="iconbtn x" data-del="' + i + '" aria-label="Remove ' + esc(l.item) + '">' + icon("trash") + "</button></div>";
      });
      if (group !== null)
        h += '<button class="btn small ghost" data-add="' + esc(group) + '">' + icon("plus") + "Add to " + esc(group) + "</button>";
      h += '<button class="btn small ghost" data-add="Other parts">' + icon("plus") + "Add a part in its own section</button>";
      return h;
    }

    function render() {
      let body = "";
      if (isStale())
        body += '<div class="badge warn">The yard or settings changed since the last Generate. Generate again before using this.</div>';
      if (L0 && !job.water)
        body += '<div class="badge warn">Water source isn\'t set, so the backflow preventer or filter is missing. Pick culinary or secondary in Job settings.</div>';
      if (!L0) body += '<p class="note">Generate a layout first.</p>';
      else if (editing) {
        body +=
          '<p class="note">Change any part or count, remove lines, or add your own. The app\'s list stays saved, so you can go back to it.</p>' +
          editRows() +
          '<div class="row" style="margin-top:14px"><button class="btn grow" id="pcancel">Cancel</button><button class="btn primary grow" id="psave">' +
          icon("check") + "Save list</button></div>";
      } else {
        if (job.partsEdit)
          body +=
            '<div class="badge warn">' +
            (sameAsBase()
              ? "This is your edited list."
              : "This is your edited list. The layout changed after you edited it, so it may be out of date. Reset to get the app's new list.") +
            "</div>";
        body +=
          partsTable(shownParts(L0)) +
          '<p class="note">Drip covers the beds only, not the line from the valve box to each bed. Mainline and lateral pipe, other fittings and wire are not counted yet.</p>' +
          '<div class="row"><button class="btn grow" id="pedit">' + icon("pen") + "Edit list</button>" +
          (job.partsEdit ? '<button class="btn grow" id="preset">' + icon("undo") + "Reset to the app's list</button>" : "") +
          "</div>" +
          '<div class="row"><button class="btn primary grow" id="xcopy">' + icon("copy") + "Copy to text or email</button></div>";
      }
      ov.innerHTML =
        '<header class="topbar"><button class="iconbtn" id="xc" aria-label="Back">' + icon("back") +
        '</button><div class="title"><b>Parts list</b><span>' + esc(job.name) + "</span></div>" +
        (editing ? "" : '<button class="iconbtn" id="xp" aria-label="Copy list">' + icon("copy") + "</button>") +
        "</header>" +
        '<div class="body">' + body + "</div>";
      wire();
    }

    // keep typed values in the working copy before any re-render
    function pull() {
      ov.querySelectorAll("[data-f]").forEach((inp) => {
        const l = editing[+inp.dataset.i];
        if (!l) return;
        if (inp.dataset.f === "item") l.item = inp.value;
        else l.qty = inp.value;
      });
    }

    function wire() {
      ov.querySelector("#xc").onclick = () => ov.remove();
      const copy = async () => {
        if (!L0) return;
        try {
          await navigator.clipboard.writeText(partsText(shownParts(L0)));
          toast("Parts list copied.");
        } catch (e) {
          console.warn("Clipboard blocked", e);
          toast("Copy was blocked. Press and hold the list to select it.");
        }
      };
      const xp = ov.querySelector("#xp");
      if (xp) xp.onclick = copy;
      const xcopy = ov.querySelector("#xcopy");
      if (xcopy) xcopy.onclick = copy;
      const pe = ov.querySelector("#pedit");
      if (pe)
        pe.onclick = () => {
          editing = shownParts(L0).lines.map((l) => ({ group: l.group, item: l.item, qty: l.qty }));
          render();
        };
      const pr = ov.querySelector("#preset");
      if (pr)
        pr.onclick = () => {
          if (!confirm("Throw away your edits and go back to the list the app made?")) return;
          delete job.partsEdit;
          touch(job);
          render();
          toast("Back to the app's list.");
        };
      ov.querySelectorAll("[data-del]").forEach(
        (b) =>
          (b.onclick = () => {
            pull();
            editing.splice(+b.dataset.del, 1);
            render();
          }),
      );
      ov.querySelectorAll("[data-add]").forEach(
        (b) =>
          (b.onclick = () => {
            pull();
            const g = b.dataset.add;
            let at = -1;
            editing.forEach((l, i) => {
              if (l.group === g) at = i;
            });
            const row = { group: g, item: "", qty: 1 };
            if (at < 0) editing.push(row);
            else editing.splice(at + 1, 0, row);
            render();
            const inputs = ov.querySelectorAll('[data-f="item"]');
            const target = [...inputs].find((x) => +x.dataset.i === (at < 0 ? editing.length - 1 : at + 1));
            if (target) target.focus();
          }),
      );
      const pc = ov.querySelector("#pcancel");
      if (pc)
        pc.onclick = () => {
          editing = null;
          render();
        };
      const ps = ov.querySelector("#psave");
      if (ps)
        ps.onclick = () => {
          pull();
          const lines = editing
            .map((l) => ({ group: l.group, item: String(l.item).trim(), qty: Math.max(0, Math.round(parseFloat(l.qty) || 0)) }))
            .filter((l) => l.item);
          job.partsEdit = { lines, base: JSON.stringify(appLines()) };
          touch(job);
          editing = null;
          render();
          toast("Your list is saved for this job.");
        };
    }

    document.body.appendChild(ov);
    render();
  }

  route();
})();
