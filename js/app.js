/* Head to Head: map a yard on the phone, auto-place sprinkler heads, zone them, print the plan. */
(function () {
  "use strict";

  const E = window.SprinklerEngine;
  const Cloud = window.H2HCloud || {
    enabled: false,
    queueJob() {},
    queueDelete() {},
  };
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
    walk: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.5"/>',
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
    if (Array.isArray(j.markers))
      j.markers = j.markers.filter((m) => m.tag !== "gate");
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
  // Company settings kept on this phone, shared by every job: their own backflow and filter setups.
  const PREFS_KEY = "headtohead.prefs.v1";
  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch (e) {
      console.warn("Company settings unreadable", e);
      return {};
    }
  }
  const prefs = loadPrefs();
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      return true;
    } catch (e) {
      console.warn("Company settings not saved", e);
      toast("This phone wouldn't save that. Check storage space.");
      return false;
    }
  }

  // Homeowner mode (Zach 2026-11-15): a homeowner maps their own yard with no account. The heads
  // and parts list stay blurred until they pay once for that yard. Payments aren't hooked up yet, so
  // only a test copy on this Mac (localhost) shows a no-charge unlock button.
  const UNLOCK_PRICE = "$10";
  const isHome = () => !!prefs.homeowner;
  const locked = (job) => isHome() && !job.unlocked;
  // http only: the iPhone app also calls itself localhost, but over capacitor://, and must never
  // hand out free unlocks
  const TEST_COPY =
    location.protocol === "http:" &&
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // Website vs iPhone app (Zach 2026-11-16): the website is the front door and the office (sign
  // up, pay, map with a mouse, print); the app is for the yard (camera walk). Both share jobs.
  const NATIVE = !!(
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  );
  // where people land from an invite or "manage your plan"; headtoheadapp.com once it points here
  const SITE_URL = "https://zachlessig.github.io/head-to-head/";
  const DEVICE = NATIVE ? "phone" : "device";
  function setHomeowner(on) {
    prefs.homeowner = !!on;
    savePrefs();
    route();
  }

  function touch(job) {
    job.updated = Date.now();
    saveJobs();
    Cloud.queueJob(job.id);
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
    if (Cloud.enabled && !isHome() && !Cloud.session) return renderSignIn();
    if (Cloud.enabled && !isHome() && !Cloud.company)
      return renderMakeCompany();
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
    leaveLanding();
    const fid = currentFolder();
    const list = jobs
      .filter((j) => !fid || j.folderId === fid)
      .sort((a, b) => b.updated - a.updated);
    // fade in only when arriving at this screen, not when a sync redraws it
    let h =
      '<main class="home' +
      (document.querySelector(".home") ? "" : " enter") +
      '">';
    // header (Zach 2026-11-15, option B): just the drop, small and centered, with the company's name
    // centered under it and a thin line below
    h +=
      '<div class="brand"><img class="mark" src="icons/logo.svg" alt="Head to Head">' +
      (Cloud.enabled && Cloud.company
        ? '<button class="iconbtn" id="co" aria-label="Company and account">' +
          icon("sliders") +
          "</button>"
        : "") +
      (Cloud.enabled && Cloud.company
        ? '<div class="co-name">' + esc(Cloud.company.name) + "</div>"
        : "") +
      "</div>";
    if (Cloud.enabled && Cloud.company) {
      // crew folders: All, each folder, and + Folder
      h +=
        '<div class="chips" style="flex-wrap:wrap;margin-bottom:14px">' +
        '<button class="chip" data-f="" aria-pressed="' +
        !fid +
        '">All jobs</button>' +
        folderList
          .map(
            (f) =>
              '<button class="chip" data-f="' +
              esc(f.id) +
              '" aria-pressed="' +
              (fid === f.id) +
              '">' +
              esc(f.name) +
              "</button>",
          )
          .join("") +
        '<button class="chip" id="nf">' +
        icon("plus") +
        "Folder</button></div>";
    }
    if (isHome())
      h +=
        '<p class="lede">Trace your yard on the satellite photo and get every sprinkler head, zone and part laid out for you.</p>';
    h +=
      '<button class="btn primary" style="width:100%;margin-bottom:18px" id="new">' +
      icon("plus") +
      (isHome() ? "Map my yard" : "New job") +
      "</button>";
    if (!list.length) {
      h +=
        '<div class="empty"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="52" height="38" rx="6" fill="#e3f0d6" stroke="#3d5a2c" stroke-width="2"/><g fill="none" stroke="#1f6b45" stroke-width="2"><path d="M6 52a14 14 0 0 1 14-14"/><path d="M58 52a14 14 0 0 0-14-14"/><path d="M6 14a14 14 0 0 0 14 14"/></g><circle cx="6" cy="52" r="3" fill="#1f6b45"/><circle cx="58" cy="52" r="3" fill="#1f6b45"/><circle cx="6" cy="14" r="3" fill="#1f6b45"/></svg><div><b>No jobs yet</b></div><div>' +
        (isHome()
          ? "Find your house on the map and trace the lawn."
          : "Start one from the truck or standing in the yard.") +
        "</div></div>";
    } else {
      list.forEach((j) => {
        const heads = j.layout
          ? j.layout.heads.length + " heads"
          : "not laid out";
        h +=
          '<button class="job" data-id="' +
          esc(j.id) +
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
      '<p class="note" style="margin-top:22px">' +
      (Cloud.enabled && Cloud.company
        ? "Jobs save online to " +
          esc(Cloud.company.name) +
          " and on this " +
          DEVICE +
          ", so they work with no signal."
        : "Jobs save on this " + DEVICE + ".") +
      " Address search and satellite photos come from Mapbox.</p>";
    if (isHome())
      h +=
        '<button class="btn small ghost" style="width:100%" id="mode">Installer? Use the contractor version</button>';
    else if (!(Cloud.enabled && Cloud.company))
      h +=
        '<button class="btn small ghost" style="width:100%" id="mode">Homeowner? Map your own yard</button>';
    h += "</main>";
    app.innerHTML = h;
    app.querySelector("#new").onclick = newJobSheet;
    const md = app.querySelector("#mode");
    if (md) md.onclick = () => setHomeowner(!isHome());
    const co = app.querySelector("#co");
    if (co) co.onclick = companySheet;
    app.querySelectorAll("[data-f]").forEach(
      (b) =>
        (b.onclick = () => {
          setFolder(b.dataset.f || null);
          renderHome();
        }),
    );
    const nf = app.querySelector("#nf");
    if (nf) nf.onclick = newFolder;
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
      shape("lawn", [
        [0, 40],
        [90, 40],
        [90, 110, 8 / 90],
        [0, 110],
      ]),
      // side yard strip, 10 ft wide: pop-up country
      shape("lawn", [
        [96, 40],
        [106, 40],
        [106, 110],
        [96, 110],
      ]),
      // front lawn with a curved edge bulging out toward the street corner
      shape("lawn", [
        [0, -50],
        [70, -50],
        [70, -12],
        [0, -12, -6 / 38],
      ]),
      // park strip between the sidewalk and the street, 5 ft wide: strip nozzles
      shape("lawn", [
        [0, -60],
        [70, -60],
        [70, -55],
        [0, -55],
      ]),
      // fence bed behind the backyard, 12 to 20 ft deep: two and three rows of drip
      shape("bed", [
        [0, 110.5, -8 / 90],
        [90, 110.5],
        [90, 122],
        [0, 122],
      ]),
      // round tree ring inside the backyard
      // (4 points: the app skips shapes under 3 corners, and 0.2071 bends each quarter into a circle)
      shape("bed", [
        [55, 70, 0.2071],
        [60, 75, 0.2071],
        [65, 70, 0.2071],
        [60, 65, 0.2071],
      ]),
      // two beds along the front of the house that touch: one drip area
      shape("bed", [
        [8, -8],
        [35, -8],
        [35, -4],
        [8, -4],
      ]),
      shape("bed", [
        [35, -8],
        [62, -8],
        [62, -4],
        [35, -4],
      ]),
      // a little bed by the porch, close enough to join the porch beds
      shape("bed", [
        [65, -8],
        [68, -8],
        [68, -5],
        [65, -5],
      ]),
      // a side-yard fence across the strip: heads on each side stay on their own side
      shape("fence", [
        [93, 75],
        [109, 75],
      ]),
      // a raised garden bed out past the side yard: its own drip zone
      shape("bed", [
        [112, 60],
        [118, 60],
        [118, 92],
        [112, 92],
      ]),
    ];
    const marker = (tag, x, y) => Object.assign({ id: uid(), tag }, ll(x, y));
    const view = ll(53, 30);
    return {
      id: uid(),
      name: "Example yard",
      example: true,
      base: "grid",
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
      markers: [
        marker("meter", -8, -52),
        marker("valve", -4, 34),
        Object.assign(marker("tree", 60, 70), { trunk: 14 }),
      ],
      layout: null,
    };
  }

  function openExample() {
    const job = exampleJob();
    job.folderId = currentFolder();
    jobs.push(job);
    saveJobs();
    Cloud.queueJob(job.id);
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
        const pts = job.shapes.flatMap((sh) =>
          sh.pts.map((p) => [p.lat, p.lng]),
        );
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
            '<button type="button" data-w="' +
            k +
            '" aria-pressed="' +
            (cur === k) +
            '">' +
            t +
            "</button>",
        )
        .join("") +
      '</div><p class="note" id="wn">Culinary adds a backflow setup. Secondary adds a filter setup.</p></div>'
    );
  }
  function wireWaterSeg(el, onPick) {
    el.querySelectorAll("[data-w]").forEach(
      (b) =>
        (b.onclick = () => {
          el.querySelectorAll("[data-w]").forEach((x) =>
            x.setAttribute("aria-pressed", String(x === b)),
          );
          onPick(b.dataset.w);
        }),
    );
  }

  function newJobSheet() {
    let picked = null;
    let water = null;
    let supply = null; // the line from the street, picked here (Zach 2026-11-10)
    let base = null; // "satellite" or "grid" paper (Zach 2026-11-14)
    sheet(
      '<h2>New job</h2><div class="stack">' +
        '<div><label class="f" for="jn">Customer or job name</label><input class="t" id="jn" placeholder="Smith backyard" autocomplete="off"></div>' +
        '<div><label class="f">Draw on</label><div class="seg" id="bs">' +
        '<button type="button" data-b="satellite" aria-pressed="false">Satellite</button>' +
        '<button type="button" data-b="grid" aria-pressed="false">Grid paper</button>' +
        '</div><p class="note" id="bn">Grid paper is 1 ft squares with a darker line every 10 ft, for drawing from your tape.</p></div>' +
        '<div id="jab" hidden><label class="f" for="ja" id="jal">Address</label><div class="row"><input class="t" id="ja" placeholder="123 Main St" autocomplete="off"><button class="btn" id="js" aria-label="Find address">' +
        icon("search") +
        '</button></div><div class="results" id="jr"></div></div>' +
        '<button class="btn" id="jl" style="width:100%" hidden>' +
        icon("pin") +
        "Use where I am now</button>" +
        waterSeg(null) +
        '<div><label class="f">Supply line from the street</label><div class="seg" id="sl">' +
        [
          ["34", '3/4"'],
          ["1", '1"'],
        ]
          .map(
            ([k, t]) =>
              '<button type="button" data-s="' +
              k +
              '" aria-pressed="false">' +
              t +
              "</button>",
          )
          .join("") +
        '</div><p class="note" id="sln">Sets how much water each zone gets: 12 GPM on 3/4", 18 GPM on 1".</p></div>' +
        '<div class="row"><button class="btn grow" id="jc">Cancel</button><button class="btn primary grow" id="jo">Start mapping</button></div></div>',
      (el, close) => {
        const name = el.querySelector("#jn"),
          addr = el.querySelector("#ja"),
          res = el.querySelector("#jr");
        name.focus();
        el.querySelectorAll("[data-b]").forEach(
          (b) =>
            (b.onclick = () => {
              base = b.dataset.b;
              el.querySelectorAll("[data-b]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === b)),
              );
              const sat = base === "satellite";
              el.querySelector("#jab").hidden = false;
              el.querySelector("#js").hidden = !sat;
              el.querySelector("#jl").hidden = !sat;
              el.querySelector("#jal").textContent = sat
                ? "Address"
                : "Address (optional, shows on the plan)";
              if (!sat) {
                picked = null;
                res.innerHTML = "";
              }
            }),
        );
        const search = async () => {
          if (base !== "satellite") return;
          const q = addr.value.trim();
          if (!q) return;
          if (!res.querySelector("button"))
            res.innerHTML = '<p class="note">Searching...</p>';
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
          if (addr.value.trim().length >= 4)
            typeTimer = setTimeout(search, 350);
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
        el.querySelectorAll("[data-s]").forEach(
          (b) =>
            (b.onclick = () => {
              supply = b.dataset.s;
              el.querySelectorAll("[data-s]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === b)),
              );
            }),
        );
        el.querySelector("#jc").onclick = close;
        el.querySelector("#jo").onclick = () => {
          if (!base) {
            const bn = el.querySelector("#bn");
            bn.textContent = "Pick satellite or grid paper first.";
            bn.style.color = "var(--bad)";
            return;
          }
          if (!water) {
            const wn = el.querySelector("#wn");
            wn.textContent = "Pick culinary or secondary first.";
            wn.style.color = "var(--bad)";
            return;
          }
          if (!supply) {
            const sn = el.querySelector("#sln");
            sn.textContent = 'Pick 3/4" or 1" first.';
            sn.style.color = "var(--bad)";
            return;
          }
          const grid = base === "grid";
          const center = (!grid && picked) || DEFAULT_CENTER;
          const job = {
            id: uid(),
            name: name.value.trim() || "Untitled yard",
            address: addr.value.trim(),
            created: Date.now(),
            updated: Date.now(),
            origin: center,
            view: {
              lat: center.lat,
              lng: center.lng,
              zoom: grid ? 21 : picked ? 20 : 15,
            },
            scale: 1,
            psi: 50,
            line: supply,
            customCap: 12,
            popupsOnly: false,
            water,
            shapes: [],
            markers: [],
            layout: null,
          };
          if (grid) job.base = "grid";
          job.folderId = currentFolder();
          jobs.push(job);
          saveJobs();
          Cloud.queueJob(job.id);
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
    if (J.map) J.map.remove();
    J = null;
  }

  // Lateral line (past the valves): 3/4" or 1", starting at the supply size. Zach 2026-11-10: a
  // 3/4" lateral on a 1" supply cuts pressure, so the job is designed as if the supply were 3/4".
  function lateralOf(job) {
    return job.lateral || (job.line === "34" ? "34" : "1");
  }
  function capOf(job) {
    const supply =
      job.line === "34" ? 12 : job.line === "1" ? 18 : +job.customCap || 12;
    return lateralOf(job) === "34" ? Math.min(supply, 12) : supply;
  }
  // '3/4" line', or '1" supply, 3/4" lateral' when they differ
  function lineText(job) {
    const sup = job.line === "c" ? "custom" : sizeName(job.line);
    const lat = sizeName(lateralOf(job));
    return sup === lat ? sup + " line" : sup + " supply, " + lat + " lateral";
  }
  const sizeName = (k) => (k === "34" ? '3/4"' : k === "1" ? '1"' : null);
  function pipeSizes(job) {
    return { lateral: sizeName(lateralOf(job)), main: sizeName(job.line) };
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
      E.splitByFences(shapeLocal(s, P), fences)
        // a narrow arm of a bigger lawn (a side entrance) is cut off to get park strip nozzles
        .flatMap((piece) => {
          const cuts = E.stripCuts(piece);
          return cuts.length ? E.splitByFences(piece, cuts) : [piece];
        })
        .forEach((piece) => {
        // a fence that stops partway in is still a wall: the lawn wraps around it as a slit
        const slit = E.fenceSlits(piece, fences);
        const outer = slit.outer;
        const ring = densify(outer, true);
        // beds are split by fences too, so a bed running across a fence is a hole on both sides
        // (whole, it only cut into one side and the other side put pop-ups in the bed)
        const holes = beds
          .flatMap((b) => E.splitByFences(shapeLocal(b, P), fences))
          .map((h) => E.offFence(h, fences))
          .filter((h) => pointInRing(E.pointInside(h), ring));
        // big trees in this piece of lawn; the fences go along so a head on a fence line may sit
        // closer to a tree than 7 ft
        const trees = job.markers
          .filter((m) => m.tag === "tree" && (m.trunk || 0) >= E.BIG_TRUNK_IN)
          .map((m) => Object.assign(P.toXY(m), { trunk: m.trunk }))
          .filter((t) => pointInRing(t, ring));
        areas.push({
          outer,
          holes: holes.concat(slit.holes),
          trees,
          fences,
          mode: s.mode || "auto",
          shapeId: s.id,
        });
      });
    });
    // the rest of the yard, as seen from each piece: a park strip's heads go on the side facing it
    // (the sidewalk side)
    const mids = areas.map((a) => {
      const r = densify(a.outer, true);
      const w = Math.abs(ringArea(r));
      const c = r.reduce((t, p) => ({ x: t.x + p.x / r.length, y: t.y + p.y / r.length }), { x: 0, y: 0 });
      return { x: c.x, y: c.y, w };
    });
    areas.forEach((a, i) => {
      let x = 0, y = 0, w = 0;
      mids.forEach((m, k) => {
        if (k === i) return;
        x += m.x * m.w;
        y += m.y * m.w;
        w += m.w;
      });
      if (w > 0) a.toward = { x: x / w, y: y / w };
    });
    return areas;
  }

  // Finished fences as open lines in local feet.
  function fenceLines(job, P) {
    return job.shapes
      .filter((s) => s.type === "fence" && s.closed && s.pts.length >= 2)
      .map((s) => s.pts.map((p) => P.toXY(p)));
  }

  // Drip, per Zach 2026-11-08: every bed on the map is drip, zoned by the engine's rules.
  // Fences are left out on purpose: drip pipe runs under a fence (Zach 2026-11-09), so a bed that
  // crosses a fence stays one bed, and beds on either side still share a zone. Only heads split.
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
      job.markers
        .filter((m) => m.tag === "tree" && (m.trunk || 0) >= E.BIG_TRUNK_IN)
        .map((m) => [m.lat.toFixed(7), m.lng.toFixed(7), m.trunk]),
    ]);
  }

  function isStale() {
    return !!(J && J.job.layout && J.job.layout.sig !== signature(J.job));
  }

  // Shapes the engine can't trust: crossed traces, slivers, and beds hanging over a lawn edge.
  function shapeProblems(job) {
    const P = proj(job);
    const closed = job.shapes.filter(
      (s) => s.closed && s.type !== "fence" && s.pts.length >= 3,
    );
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
        // edges crossing count even with no corner inside: a bed drawn straight across a narrow
        // lawn has all four corners outside it (random yard 24, 2026-11-09)
        if ((inside && inside < b.ring.length) || ringsCross(b.ring, l.ring))
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
      job.base === "grid" ||
      job.layout ||
      job.shapes.some((s) => s.pts.length) ||
      job.markers.length
    )
      return;
    job.origin = { lat: ll.lat, lng: ll.lng };
  }

  // Grid paper (Zach 2026-11-14): a line every foot, a darker one every 10 ft, measured in the
  // job's own feet from its origin so drawn corners land on the squares.
  function gridPaper(job) {
    const Grid = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        const dpr = window.devicePixelRatio || 1;
        tile.width = size.x * dpr;
        tile.height = size.y * dpr;
        const ctx = tile.getContext("2d");
        ctx.scale(dpr, dpr);
        const P = proj(job);
        const nw = coords.scaleBy(size);
        const a = P.toXY(this._map.unproject(nw, coords.z));
        const b = P.toXY(this._map.unproject(nw.add(size), coords.z));
        const pxPerFt = size.x / (b.x - a.x);
        const lines = (step, color, width) => {
          if (step * pxPerFt < 4) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) {
            const px = Math.round((x - a.x) * pxPerFt) + 0.5;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, size.y);
          }
          // y grows north, screen grows down
          for (let y = Math.floor(a.y / step) * step; y >= b.y; y -= step) {
            const py = Math.round(((a.y - y) / (a.y - b.y)) * size.y) + 0.5;
            ctx.moveTo(0, py);
            ctx.lineTo(size.x, py);
          }
          ctx.stroke();
        };
        lines(1, "rgba(61,90,44,0.13)", 1);
        lines(10, "rgba(61,90,44,0.42)", 1.25);
        if (10 * pxPerFt < 4) lines(100, "rgba(61,90,44,0.42)", 1.25);
        return tile;
      },
    });
    return new Grid({ maxZoom: 22, maxNativeZoom: 22, tileSize: 256 });
  }

  // On grid paper, corners snap to the nearest foot, like counting squares.
  function gridSnap(ll) {
    if (!J || J.job.base !== "grid") return ll;
    const P = proj(J.job);
    const p = P.toXY(ll);
    return P.toLL(Math.round(p.x), Math.round(p.y));
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
      treeTrunk: 12, // inches across, for the next tree tapped onto the map
      selHead: null,
      selZone: null,
      moving: false,
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
    const grid = job.base === "grid";
    if (grid) {
      map.getContainer().style.background = "#fbfcf8";
      gridPaper(job).addTo(map);
      // zoomed out, the 1 ft lines drop away, so a scale bar says what a square is
      L.control.scale({ metric: false, position: "bottomleft" }).addTo(map);
    }
    // Mapbox satellite through the Static Tiles API. The v4 raster endpoint answered 429 for this
    // account on 2026-11-07 while this one served z21 imagery, so this is the one wired in.
    const satellite =
      job.example || grid
        ? null
        : L.tileLayer(
            "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=" +
              MAPBOX_TOKEN,
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
    let tileFails = 0,
      swapped = false;
    if (satellite)
      satellite.on("tileerror", () => {
        if (swapped || ++tileFails < 6) return;
        swapped = true;
        map.removeLayer(satellite);
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: 22,
            maxNativeZoom: 19,
            attribution: "Imagery: Esri, Maxar, Earthstar Geographics",
          },
        ).addTo(map);
        toast("Mapbox photos didn't load, so these are backup photos.");
      });
    map.setView([job.view.lat, job.view.lng], job.view.zoom);
    ["shapes", "heads", "labels", "edit", "measure", "markers"].forEach(
      (k) => (J.layers[k] = L.layerGroup().addTo(map)),
    );
    map.on("click", onMapClick);
    map.on("zoomend", () => {
      if (!J) return;
      if (J.mode === "heads") renderHeads();
      if (J.job.shapes.some((x) => x.type === "fence")) renderShapes();
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
      lineText(J.job),
    ];
    app.querySelector("#js").textContent = bits.join(" · ");
  }

  function zoomClass() {
    J.map.getContainer().classList.toggle("far", J.map.getZoom() < 19);
  }

  function setMode(mode) {
    if (mode === "plan") return openPlan();
    J.mode = mode;
    J.tool = mode === "draw" ? J.tool : null;
    J.measure = [];
    J.selHead = null;
    J.moving = false;
    if (mode !== "draw") {
      finishDrawing(false);
      J.selShape = null;
    }
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
    return densify(local, shape.closed && shape.type !== "fence").map((p) =>
      P.toLL(p.x, p.y),
    );
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
        // The map symbol for a fence: a line with x's on it (Zach 2026-11-09 wanted it to read as a
        // fence, not a random line). Near-black with a white edge, since the zone colors already
        // use nearly every bright color. The x's sit every FENCE_X_PX on screen at any zoom.
        const pick = (e) => {
          if (J.mode !== "draw" || J.drawing || J.tool === "marker") return;
          L.DomEvent.stopPropagation(e);
          J.selShape = s.id;
          J.selVertex = null;
          redraw();
        };
        const ink = sel ? "#f5b700" : "#16130f";
        const casing = L.polyline(lls, {
          color: "#ffffff",
          weight: 7,
          opacity: 0.9,
        });
        const line = L.polyline(lls, { color: ink, weight: 3 });
        [casing, line].forEach((ly) => {
          ly.on("click", pick);
          lay.addLayer(ly);
        });
        fenceXs(lls).forEach((ll) => {
          const x = L.marker(ll, {
            icon: L.divIcon({
              className: "fx",
              iconSize: [14, 14],
              html:
                '<svg viewBox="0 0 14 14" width="14" height="14"><path d="M3 3l8 8M11 3l-8 8" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M3 3l8 8M11 3l-8 8" stroke="' +
                ink +
                '" stroke-width="2.4" stroke-linecap="round"/></svg>',
            }),
            keyboard: false,
          });
          x.on("click", pick);
          lay.addLayer(x);
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

  // Spots for the x's along a fence, every FENCE_X_PX on screen, skipping the very ends.
  const FENCE_X_PX = 26;
  function fenceXs(lls) {
    const pts = lls.map((ll) => J.map.latLngToContainerPoint(ll));
    const out = [];
    let carry = FENCE_X_PX / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const L = a.distanceTo(b);
      let d = carry;
      while (d < L) {
        const t = d / L;
        out.push(
          J.map.containerPointToLatLng(
            L_point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
          ),
        );
        d += FENCE_X_PX;
      }
      carry = d - L;
    }
    return out;
  }
  const L_point = (x, y) => L.point(x, y);

  function vertexIcon(cls) {
    return L.divIcon({ className: cls, iconSize: [22, 22] });
  }

  function renderEdit() {
    const lay = J.layers.edit;
    lay.clearLayers();
    if (J.mode !== "draw") return;
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
        const ll = gridSnap(e.target.getLatLng());
        p.lat = ll.lat;
        p.lng = ll.lng;
        renderShapes();
        renderLabels(); // side lengths count up and down while the dot moves (Zach 2026-11-14)
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
        if (
          J.drawing &&
          s.type === "fence" &&
          i === s.pts.length - 1 &&
          s.pts.length >= 2
        )
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
        renderLabels();
      });
      m.on("dragend", () => {
        touch(J.job);
        redraw();
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (moved) return;
        pushUndo();
        const ll = gridSnap(P.toLL(apex.x, apex.y));
        s.pts[i].bf = 0;
        s.pts.splice(i + 1, 0, { lat: ll.lat, lng: ll.lng, bf: 0 });
        touch(J.job);
        redraw();
      });
      lay.addLayer(m);
    });
    if (!J.drawing) shapeMoveHandles(s, lay);
  }

  // Move and turn a whole shape (Zach 2026-11-15): a camera walk gets sizes and angles right but
  // lands in the middle of the screen, a little turned, so it gets lined up on the photo by hand.
  // The cross in the middle drags the shape; the round arrow above it turns it about its middle.
  function shapeMoveHandles(s, lay) {
    if (s.pts.length < 2) return;
    const P = proj(J.job);
    const xy0 = s.pts.map((p) => P.toXY(p));
    const xs = xy0.map((p) => p.x),
      ys = xy0.map((p) => p.y);
    const c = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const set = (f) => {
      xy0.forEach((q, i) => {
        const ll = P.toLL(...f(q));
        s.pts[i].lat = ll.lat;
        s.pts[i].lng = ll.lng;
      });
      renderShapes();
      renderLabels();
    };
    const icon = (cls, svg) =>
      L.divIcon({ className: cls, iconSize: [40, 40], html: svg });
    const done = () => {
      touch(J.job);
      redraw();
    };

    const mv = L.marker(P.toLL(c.x, c.y), {
      icon: icon(
        "shapemove",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ),
      draggable: true,
      keyboard: false,
      title: "Move the whole shape",
      zIndexOffset: 1200,
    });
    mv.on("dragstart", () => pushUndo());
    mv.on("drag", (e) => {
      const q = P.toXY(e.target.getLatLng());
      let dx = q.x - c.x,
        dy = q.y - c.y;
      if (J.job.base === "grid") {
        dx = Math.round(dx);
        dy = Math.round(dy);
      }
      set((p) => [p.x + dx, p.y + dy]);
    });
    mv.on("dragend", done);
    lay.addLayer(mv);

    const cp = J.map.latLngToContainerPoint(P.toLL(c.x, c.y));
    const rotAt = J.map.containerPointToLatLng([cp.x, cp.y - 64]);
    const r0 = P.toXY(rotAt);
    const a0 = Math.atan2(r0.y - c.y, r0.x - c.x);
    const rt = L.marker(rotAt, {
      icon: icon(
        "shaperot",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ),
      draggable: true,
      keyboard: false,
      title: "Turn the whole shape",
      zIndexOffset: 1200,
    });
    rt.on("dragstart", () => pushUndo());
    rt.on("drag", (e) => {
      const q = P.toXY(e.target.getLatLng());
      const t = Math.atan2(q.y - c.y, q.x - c.x) - a0;
      const co = Math.cos(t),
        si = Math.sin(t);
      set((p) => [
        c.x + (p.x - c.x) * co - (p.y - c.y) * si,
        c.y + (p.x - c.x) * si + (p.y - c.y) * co,
      ]);
    });
    rt.on("dragend", done);
    lay.addLayer(rt);
  }

  function renderLabels() {
    const lay = J.layers.labels;
    lay.clearLayers();
    if (J.mode === "heads") return;
    const P = proj(J.job);
    J.job.shapes.forEach((s) => {
      if (s.pts.length < 2) return;
      const local = shapeLocal(s, P);
      const n =
        s.closed && s.type !== "fence" ? local.length : local.length - 1;
      for (let i = 0; i < n; i++) {
        const e = edgeInfo(local[i], local[(i + 1) % local.length]);
        if (e.len < 2) continue;
        const what = s.type === "fence" ? "Fence · " : "";
        lay.addLayer(
          L.marker(P.toLL(e.mx, e.my), {
            icon: L.divIcon({
              className: "elabel",
              html: what + Math.round(e.len) + " ft",
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
            "</h2>" +
            (m.tag === "tree" ? trunkSlider(m.trunk || 0) : "") +
            '<div class="row"><button class="btn grow" id="mc">Keep</button><button class="btn danger grow" id="md">' +
            icon("trash") +
            "Remove</button></div>",
          (el, close) => {
            const was = m.trunk || 0;
            wireTrunkSlider(el, (v) => {
              m.trunk = v;
            });
            el.querySelector("#mc").onclick = () => {
              if ((m.trunk || 0) !== was) {
                touch(J.job);
                redraw();
              }
              close();
            };
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
      // a big tree shows its trunk and the ring heads stay out of
      if (m.tag === "tree" && (m.trunk || 0) >= E.BIG_TRUNK_IN) {
        const ftToM = 0.3048 / (J.job.scale || 1);
        lay.addLayer(
          L.circle([m.lat, m.lng], {
            radius: (m.trunk / 24 + E.TREE_KEEP) * ftToM,
            color: "#3d7a3a",
            weight: 1.5,
            dashArray: "4 4",
            fill: false,
            interactive: false,
          }),
        );
      }
    });
  }

  // Trunk size for a tree (Zach 2026-11-15): under 6 in it's laid out like open lawn; 6 in and up
  // blocks spray, keeps heads off it, and keeps rotors from blasting the bark
  // a whole number of inches, 0 to 48 (the slider's top); anything else, like a bad synced or
  // stored value, becomes a number. 0 is an old tree pin with no size, which the layout ignores.
  function trunkIn(v) {
    return Math.max(0, Math.min(48, Math.round(+v) || 0));
  }
  function trunkSlider(v) {
    v = trunkIn(v);
    return (
      '<label class="f" for="tk">Trunk across: <b id="tkv">' +
      v +
      ' in</b></label><input id="tk" type="range" min="2" max="48" step="1" value="' +
      v +
      '" style="width:100%;accent-color:var(--flag)"><p class="note" id="tkn" style="margin:4px 0 12px"></p>'
    );
  }
  function wireTrunkSlider(el, onSet) {
    const tk = el.querySelector("#tk");
    if (!tk) return;
    const show = () => {
      const v = +tk.value;
      el.querySelector("#tkv").textContent = v + " in";
      el.querySelector("#tkn").textContent =
        v < E.BIG_TRUNK_IN
          ? "Small tree: laid out like open lawn."
          : "Big tree: heads stay 7 ft away (a head on a fence line may be closer), no rotor sprays the trunk, pop-ups fill in around it, and the spray it blocks gets covered from another side.";
      onSet(v);
    };
    tk.oninput = show;
    show();
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
    if (open && J.mode === "draw") {
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
      J.job.markers.push(
        Object.assign(
          { id: uid(), tag: J.markerTag, lat: ll.lat, lng: ll.lng },
          J.markerTag === "tree" ? { trunk: J.treeTrunk } : {},
        ),
      );
      touch(J.job);
      renderMarkers();
      return;
    }
    if (J.drawing) {
      const s = J.job.shapes.find((x) => x.id === J.drawing);
      pushUndo();
      maybeRebase(ll);
      const at = gridSnap(ll);
      s.pts.push({ lat: at.lat, lng: at.lng, bf: 0 });
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
      strip: h.strip,
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
    L0.parts = E.parts(
      L0.heads,
      zones,
      dripFor(job),
      job.water,
      prefs.setups,
      pipeSizes(job),
    );
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
    if (h.strip) {
      // a park strip nozzle throws a band, not a pie slice
      const q = h.strip,
        v1 = Math.min(q.v1 - 0.3, Math.max(4, q.w || 4));
      [[q.u0, q.v0], [q.u1, q.v0], [q.u1, v1], [q.u0, v1]].forEach(([u, v]) =>
        pts.push(P.toLL(h.x + u * q.ux - v * q.uy, h.y + u * q.uy + v * q.ux)),
      );
      return pts;
    }
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
    J.map
      .getContainer()
      .classList.toggle("locked", !!L0 && J.mode === "heads" && locked(J.job));
    if (!L0 || J.mode !== "heads") return;
    const P = proj(J.job);
    // heads sharing a spot (both sides of a fence) are drawn a few pixels apart, toward the side
    // each one waters, so they read as two dots
    const nd = Plan.nudges(L0.heads, 7);
    const shift = (ll, i, k) => {
      if (!nd[i].dx && !nd[i].dy) return ll;
      const pt = J.map.latLngToContainerPoint(ll);
      return J.map.containerPointToLatLng(
        L.point(pt.x + nd[i].dx * k, pt.y + nd[i].dy * k),
      );
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
          ? L.circleMarker(ll, {
              radius: sel ? 9 : 6.5,
              color: "#fff",
              weight: sel ? 3.5 : 2,
              fillColor: col,
              fillOpacity: dim ? 0.35 : 1,
            })
          : L.marker(ll, {
              keyboard: false,
              icon: L.divIcon({
                className: "hshape",
                iconSize: [sel ? 24 : 18, sel ? 24 : 18],
                html:
                  '<svg viewBox="0 0 20 20" width="100%" height="100%" style="opacity:' +
                  (dim ? 0.4 : 1) +
                  '">' +
                  (key === "5004"
                    ? '<rect x="3" y="3" width="14" height="14" fill="' +
                      col +
                      '" stroke="#fff" stroke-width="2.5"/>'
                    : '<polygon points="10,2 18.5,17 1.5,17" fill="' +
                      col +
                      '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>') +
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
    const have = ["spray", "5004", "3504"].filter((k) =>
      heads.some((h) => Plan.shapeKey(h) === k),
    );
    return (
      '<p class="note" style="display:flex;gap:14px;flex-wrap:wrap">' +
      have
        .map(
          (k) =>
            '<span style="display:inline-flex;align-items:center;gap:5px"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' +
            sym[k] +
            "</svg>" +
            names[k] +
            "</span>",
        )
        .join("") +
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
        "</div>" +
        (J.markerTag === "tree" ? trunkSlider(J.treeTrunk) : "") +
        '<button class="btn" style="width:100%" id="done">' +
        icon("check") +
        "Done adding markers</button>";
      wireTrunkSlider(el, (v) => (J.treeTrunk = v));
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
        '<p class="hint"><b>Fence selected.</b> Drag the dots to move it, the cross to move all of it, or the round arrow to turn it. Heads on each side stay on their own side.</p>' +
        '<div class="row">' +
        (J.selVertex != null && s.pts.length > 2
          ? '<button class="btn grow" id="rv">Remove point</button>'
          : "") +
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
        " selected.</b> Drag the white dots to move corners. Drag a dashed dot to curve an edge, or tap it to add a corner. Drag the cross to move the whole " +
        (lawn ? "lawn" : "bed") +
        ", or the round arrow to turn it.</p>";
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
          (s.mode === "spray"
            ? "Pop-ups everywhere on this lawn."
            : "Rotors where the lawn opens up, pop-ups in narrow spots and along curves.") +
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
        : job.base === "grid"
          ? "Draw the lawn from your tape. Each square is 1 ft, every darker line is 10 ft."
          : "Zoom in on the yard and trace the lawn.") +
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

  // Camera walk (Zach 2026-11-15). GPS walking was too far off for a sprinkler map (2026-11-14,
  // off by up to 9 ft), so walking lives in the iPhone app, where the camera's motion tracking
  // (CameraWalk.swift) follows the phone. In a browser the tab says it's in the app.
  function cameraWalk() {
    const C = window.Capacitor;
    return C &&
      C.isNativePlatform &&
      C.isNativePlatform() &&
      C.Plugins &&
      C.Plugins.CameraWalk
      ? C.Plugins.CameraWalk
      : null;
  }

  function panelWalk(el) {
    const cam = cameraWalk();
    if (!cam) {
      // Zach 2026-11-16: everything maps on the website except the camera, and the website says
      // where to get it
      el.innerHTML =
        '<div class="appnote">' +
        icon("walk") +
        "<div><b>Walk the yard with your iPhone's camera</b>" +
        "<span>In the Head to Head iPhone app, you walk the edge of the lawn and the camera measures it as you go. Coming soon to the App Store.</span></div></div>" +
        '<p class="hint">Everything else works here. Trace the lawn on the Draw tab' +
        (Cloud.enabled && Cloud.company
          ? ", and jobs you start here show up in the app."
          : ".") +
        "</p>";
      return;
    }
    const what = J.walkWhat || "lawn";
    el.innerHTML =
      '<p class="hint">Point the circle at the edge of the ' +
      what +
      " and walk it all the way around. Tap Corner on each corner.</p>" +
      '<div class="seg" id="ww">' +
      [
        ["lawn", "Lawn"],
        ["bed", "Bed"],
      ]
        .map(
          ([k, t]) =>
            '<button type="button" data-k="' +
            k +
            '" aria-pressed="' +
            (what === k) +
            '">' +
            t +
            "</button>",
        )
        .join("") +
      "</div>" +
      '<button class="btn primary" style="width:100%" id="wgo">' +
      icon("walk") +
      "Start camera walk</button>";
    el.querySelectorAll("[data-k]").forEach(
      (b) =>
        (b.onclick = () => {
          J.walkWhat = b.dataset.k;
          renderPanel();
        }),
    );
    el.querySelector("#wgo").onclick = async () => {
      let res;
      try {
        res = await cam.start({ what });
      } catch (e) {
        console.warn("Camera walk failed", e);
        return toast(
          "The camera walk didn't start. " + ((e && e.message) || ""),
        );
      }
      if (!J || !res || res.cancelled || !res.points) return;
      placeWalk(res.points, what);
    };
  }

  // Walk points come back in feet from where the walk started (x east, y north). The shape goes
  // in the middle of the screen; the camera knows sizes and angles, not where the yard is.
  function placeWalk(raw, what) {
    const verts = window.H2HTrace.fit(raw, { precise: true });
    if (!verts || verts.length < 3)
      return toast(
        "Couldn't make a shape from that walk. Walk the whole edge back to where you started.",
      );
    const job = J.job;
    if (!job.base && !job.shapes.some((s) => s.pts.length)) {
      const c = J.map.getCenter();
      maybeRebase(c);
    }
    const P = proj(job);
    const mid = P.toXY(J.map.getCenter());
    const xs = verts.map((v) => v.x),
      ys = verts.map((v) => v.y);
    let dx = mid.x - (Math.min(...xs) + Math.max(...xs)) / 2,
      dy = mid.y - (Math.min(...ys) + Math.max(...ys)) / 2;
    if (job.base === "grid") {
      // keep the first corner on a grid line so the squares still count true
      dx = Math.round(verts[0].x + dx) - verts[0].x;
      dy = Math.round(verts[0].y + dy) - verts[0].y;
    }
    pushUndo();
    const shape = {
      id: uid(),
      type: what === "bed" ? "bed" : "lawn",
      closed: true,
      mode: "auto",
      pts: verts.map((v, i) => {
        const nx = verts[(i + 1) % verts.length];
        const chord = Math.hypot(nx.x - v.x, nx.y - v.y);
        const ll = P.toLL(v.x + dx, v.y + dy);
        return { lat: ll.lat, lng: ll.lng, bf: chord > 1e-6 ? v.b / chord : 0 };
      }),
    };
    job.shapes.push(shape);
    touch(job);
    setMode("draw");
    J.map.fitBounds(
      shape.pts.map((p) => [p.lat, p.lng]),
      { padding: [24, 24] },
    );
    const curves = verts.filter((v) => v.b).length;
    const straight = verts.length - curves;
    const name = shape.type === "bed" ? "Bed" : "Lawn";
    const parts =
      straight +
      " straight edge" +
      (straight === 1 ? "" : "s") +
      (curves ? " and " + curves + " curve" + (curves === 1 ? "" : "s") : "");
    if (selfCrosses(densify(shapeLocal(shape, P), true)))
      toast(
        name +
          " saved, but two edges cross. Drag a corner so it doesn't fold over itself.",
      );
    else toast(name + " saved: " + parts + ". Drag any dot to fix it up.");
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
    if (job.base === "grid") {
      // grid paper has no photo to be off, so there's nothing to correct with a tape
      if (J.measure.length >= 2)
        h =
          '<p class="hint">That\'s <b>' +
          ft.toFixed(1) +
          " ft</b> on the grid.</p>";
      el.innerHTML = h;
      return;
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

  // Park strip nozzles you can switch to by hand; RCS, LCS and SST are what the app picks, EST and
  // CST are for the odd case (Zach 2026-11-15)
  function stripSwapRow(hd) {
    return (
      '<p class="note" style="margin:0 0 6px">Switch nozzle:</p><div class="chips">' +
      Object.keys(E.STRIP)
        .map(
          (k) =>
            '<button class="chip" data-sn="' + k + '" aria-pressed="' + (hd.label === "15" + k) + '">15' + k + "</button>",
        )
        .join("") +
      "</div>"
    );
  }

  function panelHeads(el) {
    const job = J.job;
    const L0 = job.layout;
    const lineTxt = lineText(job) + ", " + capOf(job) + " GPM per zone";
    let h = "";
    if (J.selHead != null && L0 && L0.heads[J.selHead]) {
      const hd = L0.heads[J.selHead];
      const what =
        hd.kind === "R"
          ? "Rain Bird " + hd.model + " rotor"
          : hd.kind === "STRIP"
            ? "park strip nozzle on an 1804"
            : hd.kind === "VAN"
            ? hd.series + " series VAN on an 1804"
            : hd.series + hd.kind + " on an 1804";
      h +=
        '<dl class="kv"><dt>Head</dt><dd>' +
        esc(hd.label) +
        " · " +
        esc(what) +
        "</dd><dt>Throw</dt><dd>" +
        (hd.strip
          ? Math.max(4, hd.strip.w || 4).toFixed(1) +
            " ft wide, " +
            (hd.strip.u1 - hd.strip.u0).toFixed(1) +
            " ft along the strip"
          : hd.r.toFixed(1) +
            " ft" +
            (hd.kind === "R"
              ? " (screw set, " +
                (hd.model === "5004" ? "24 to 30" : "18 to 23") +
                " ft range)"
              : "") +
            ", " +
            Math.round(hd.arc) +
            "°") +
        "</dd><dt>Flow</dt><dd>" +
        hd.gpm.toFixed(2) +
        " GPM</dd><dt>Zone</dt><dd>" +
        esc(String(hd.zone)) +
        "</dd></dl>" +
        (hd.strip ? stripSwapRow(hd) : "");
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
      el.querySelectorAll("[data-sn]").forEach(
        (b) =>
          (b.onclick = () => {
            // swap the strip nozzle in place, same spot, same direction along the strip
            const q = hd.strip;
            const len = Math.max(Math.abs(q.u0), Math.abs(q.u1));
            const nh = E.stripHead(hd.x, hd.y, b.dataset.sn, { ux: q.ux, uy: q.uy, w: q.w || 4 }, len);
            Object.assign(hd, { label: nh.label, gpmBase: nh.gpmBase, strip: nh.strip, r: nh.r, dir: nh.dir });
            recheckLayout();
            redraw();
          }),
      );
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
    if (L0 && L0.totals && locked(job)) return panelLocked(el, stale);
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
            ? esc(String(t.overspray)) +
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
              esc(String(z.n)) +
              '" aria-pressed="' +
              (J.selZone === z.n) +
              '"><span class="dot" style="background:' +
              Plan.zoneColor(z.n) +
              '"></span>Zone ' +
              esc(String(z.n)) +
              ": " +
              esc(String(z.count)) +
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
          esc(String(parts.stations)) +
          " stations. Most common timers top out at 16.</div>";
      const notes = L0.areas.filter((a) => a.note).map((a) => a.note);
      if (notes.length)
        h += notes
          .map(
            (n) =>
              '<p class="note">' +
              esc(n.charAt(0).toUpperCase() + n.slice(1)) +
              ".</p>",
          )
          .join("");
      h +=
        '<p class="note">' +
        L0.heads.length +
        " heads · " +
        job.psi +
        " PSI · " +
        lineTxt +
        ". Tap a head to move or delete it.</p>" +
        shapeKeyRow(L0.heads);
      if (isHome()) h += trenchLine(job) + installersCard();
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

  // What a homeowner sees before paying: the layout is done, the map is blurred, and the numbers
  // that tell them what they're in for are shown
  function trenchLine(job) {
    const P = proj(job);
    const at = (tag) => {
      const m = job.markers.find((k) => k.tag === tag);
      return m ? P.toXY(m) : null;
    };
    const t = E.trenchFeet(job.layout.heads, at("valve"), at("meter"));
    return (
      '<dl class="kv"><dt>Trench to dig</dt><dd>About ' +
      t.ft +
      " ft</dd></dl>" +
      '<p class="note">A rough number for digging it yourself: the pipe between the heads, back to the valve box' +
      (t.hasBox
        ? ""
        : " (add a Meter and a Valve box on the Draw tab to count those runs)") +
      ", plus some extra for going around things. Drip in the beds lies on top, so it isn't counted.</p>"
    );
  }

  function panelLocked(el, stale) {
    const job = J.job;
    const L0 = job.layout;
    const drip = dripFor(job);
    let h = stale
      ? '<div class="badge warn">The yard changed since this layout. Generate again.</div>'
      : '<div class="badge ok">' +
        icon("check") +
        "Your layout is ready.</div>";
    h +=
      '<dl class="kv"><dt>Sprinkler heads</dt><dd>' +
      L0.heads.length +
      "</dd><dt>Zones</dt><dd>" +
      L0.zones.length +
      (drip.zones.length ? " sprinkler, " + drip.zones.length + " drip" : "") +
      "</dd></dl>" +
      trenchLine(job);
    h +=
      '<button class="btn primary" style="width:100%;margin:6px 0 10px" id="ul">Unlock the heads and parts list · ' +
      UNLOCK_PRICE +
      "</button>" +
      '<button class="btn small" style="width:100%" id="gen">Generate again</button>' +
      installersCard();
    el.innerHTML = h;
    el.querySelector("#ul").onclick = unlockSheet;
    el.querySelector("#gen").onclick = generate;
  }

  function unlockSheet() {
    sheet(
      "<h2>Unlock this yard</h2>" +
        '<p class="hint">One payment of ' +
        UNLOCK_PRICE +
        ", no subscription. You get every head on the map with its nozzle, a printable plan, and the full parts list to take to the store.</p>" +
        (PAY_HERE
          ? '<button class="btn primary" style="width:100%" id="pay">Pay ' + UNLOCK_PRICE + "</button>" +
            '<p class="note">Stripe takes the card. Head to Head never sees it.</p>'
          : '<button class="btn primary" style="width:100%" disabled>Payments open soon</button>') +
        (TEST_COPY
          ? '<button class="btn small" style="width:100%;margin-top:8px" id="tu">Unlock (test copy, no charge)</button>'
          : "") +
        '<button class="btn ghost" style="width:100%;margin-top:8px" id="nx">Not now</button>',
      (el, close) => {
        el.querySelector("#nx").onclick = close;
        const pay = el.querySelector("#pay");
        if (pay)
          pay.onclick = async () => {
            pay.disabled = true;
            pay.textContent = "Opening Stripe...";
            try {
              const r = await Cloud.pay("unlock", { job_id: J.job.id });
              location.assign(r.url);
            } catch (e) {
              console.warn("Checkout not opened", e);
              toast(e.message);
              pay.disabled = false;
              pay.textContent = "Pay " + UNLOCK_PRICE;
            }
          };
        const tu = el.querySelector("#tu");
        if (tu)
          tu.onclick = () => {
            J.job.unlocked = true;
            touch(J.job);
            close();
            redraw();
            toast("Unlocked.");
          };
      },
    );
  }

  // Installers who pay to be listed show up for homeowners in their area (Zach 2026-11-15), with
  // their Google rating. No one is signed up yet, so only the test copy shows a sample listing.
  // Off until homeowners are using it in numbers (Zach 2026-11-15: listing "would need to be a thing
  // once there is alot of DIY traction first"); the test copy still shows it
  const SHOW_INSTALLERS = false;
  function installersCard() {
    if (!SHOW_INSTALLERS && !TEST_COPY) return "";
    let h = '<div class="installers"><b>Rather have a pro put it in?</b>';
    if (TEST_COPY)
      h +=
        '<div class="inst"><div class="grow"><b>Sample Sprinkler Co.</b><span>Sample listing · Layton, UT</span></div>' +
        '<div class="stars">★ 4.8<span>Google rating</span></div></div>';
    else h += '<p class="note">Installers in your area show up here soon.</p>';
    return (
      h +
      '<p class="note">Installer? Get listed here from the contractor version.</p></div>'
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
        esc(String(job.psi)) +
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
        esc(String(job.customCap)) +
        '"></div></div>' +
        '<div><label class="f">Lateral line (past the valves)</label><div class="seg" id="lt">' +
        [
          ["34", '3/4"'],
          ["1", '1"'],
        ]
          .map(
            ([k, t]) =>
              '<button type="button" data-t="' +
              k +
              '" aria-pressed="' +
              (lateralOf(job) === k) +
              '">' +
              t +
              "</button>",
          )
          .join("") +
        '</div><p class="note" id="lw"></p></div>' +
        waterSeg(job.water) +
        (Cloud.enabled && Cloud.company && folderList.length
          ? '<div><label class="f" for="sf">Folder</label><select class="t" id="sf"><option value="">No folder</option>' +
            folderList
              .map(
                (f) =>
                  '<option value="' +
                  esc(f.id) +
                  '"' +
                  (job.folderId === f.id ? " selected" : "") +
                  ">" +
                  esc(f.name) +
                  "</option>",
              )
              .join("") +
            "</select></div>"
          : "") +
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
          lat = lateralOf(job),
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
        // warn when a 3/4" lateral sits on a bigger supply
        const latNote = () => {
          const lw = el.querySelector("#lw");
          const cv = parseFloat(el.querySelector("#cv").value) || 12;
          const bigger = line === "1" || (line === "c" && cv > 12);
          if (lat === "34" && bigger) {
            lw.textContent =
              'A 3/4" lateral on a bigger supply line cuts pressure. Zones will be designed as if the supply were 3/4": 12 GPM each.';
            lw.style.color = "var(--bad)";
          } else {
            lw.textContent = "Fittings on the parts list are sized to match.";
            lw.style.color = "";
          }
        };
        latNote();
        el.querySelector("#cv").addEventListener("input", latNote);
        el.querySelectorAll("[data-t]").forEach(
          (b) =>
            (b.onclick = () => {
              lat = b.dataset.t;
              el.querySelectorAll("[data-t]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === b)),
              );
              latNote();
            }),
        );
        el.querySelectorAll("[data-l]").forEach(
          (b) =>
            (b.onclick = () => {
              line = b.dataset.l;
              el.querySelectorAll("[data-l]").forEach((x) =>
                x.setAttribute("aria-pressed", String(x === b)),
              );
              el.querySelector("#cc").hidden = line !== "c";
              latNote();
            }),
        );
        el.querySelector("#sv").onclick = () => {
          job.name = el.querySelector("#sn").value.trim() || job.name;
          job.address = el.querySelector("#sa").value.trim();
          job.psi = psi;
          job.line = line;
          job.lateral = lat;
          const sf = el.querySelector("#sf");
          if (sf) job.folderId = sf.value || null;
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
          Cloud.queueDelete(job.id);
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
    if (locked(J.job)) return unlockSheet();
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
    return E.parts(
      L0.heads,
      L0.zones || [],
      dripFor(J.job),
      J.job.water,
      prefs.setups,
      pipeSizes(J.job),
    );
  }
  // The list the crew sees: the company's edited copy if there is one, else the app's.
  function shownParts(L0) {
    const fresh = freshParts(L0);
    return J.job.partsEdit
      ? { lines: J.job.partsEdit.lines, notes: fresh.notes }
      : fresh;
  }
  function partsTable(parts) {
    let h = '<table class="parts">';
    let group = null;
    parts.lines.forEach((l) => {
      if (l.group !== group) {
        group = l.group;
        const note = parts.notes && parts.notes[group];
        h +=
          '<tr><th class="g" colspan="2">' +
          esc(group) +
          (note ? ' <span class="gn">· ' + esc(note) + "</span>" : "") +
          "</th></tr>";
      }
      h +=
        "<tr><td>" +
        esc(l.item) +
        '</td><td class="q">' +
        esc(String(l.qty)) +
        "</td></tr>";
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

  // The company's own backflow (culinary) or filter (secondary) parts. Saved on the phone and used
  // on every job with that water source until they go back to the app's default.
  function setupSheet(water, after) {
    const name = water === "culinary" ? "backflow" : "filter";
    const base = E.WATER_SOURCE_PARTS[water] || [];
    const saved = prefs.setups && prefs.setups[water];
    let rows = (saved && saved.length ? saved : base).map((p) => ({
      item: p.item,
      qty: p.qty,
    }));
    sheet('<div id="su"></div>', (el, close) => {
      const draw = () => {
        el.querySelector("#su").innerHTML =
          "<h2>Our " +
          name +
          " setup</h2>" +
          '<p class="note">List the parts your company uses for a ' +
          name +
          ". Every job in your company with " +
          (water === "culinary" ? "culinary" : "secondary") +
          " water will use this list.</p>" +
          rows
            .map(
              (r, i) =>
                '<div class="pe"><input class="t" data-i="' +
                i +
                '" data-f="item" value="' +
                esc(r.item) +
                '" placeholder="Part" aria-label="Part"><input class="t q" data-i="' +
                i +
                '" data-f="qty" inputmode="numeric" value="' +
                esc(String(r.qty)) +
                '" aria-label="How many"><button class="iconbtn x" data-del="' +
                i +
                '" aria-label="Remove">' +
                icon("trash") +
                "</button></div>",
            )
            .join("") +
          '<button class="btn small ghost" id="suadd">' +
          icon("plus") +
          "Add a part</button>" +
          '<div class="row" style="margin-top:12px"><button class="btn grow" id="sucancel">Cancel</button><button class="btn primary grow" id="susave">' +
          icon("check") +
          "Save</button></div>" +
          (saved
            ? '<button class="btn small ghost" id="sureset" style="width:100%">' +
              icon("undo") +
              "Go back to the app's default</button>"
            : "");
        const pull = () =>
          el.querySelectorAll("[data-f]").forEach((inp) => {
            const r = rows[+inp.dataset.i];
            if (r) r[inp.dataset.f] = inp.value;
          });
        el.querySelectorAll("[data-del]").forEach(
          (b) =>
            (b.onclick = () => {
              pull();
              rows.splice(+b.dataset.del, 1);
              draw();
            }),
        );
        el.querySelector("#suadd").onclick = () => {
          pull();
          rows.push({ item: "", qty: 1 });
          draw();
          const last = el.querySelectorAll('[data-f="item"]');
          if (last.length) last[last.length - 1].focus();
        };
        el.querySelector("#sucancel").onclick = close;
        el.querySelector("#susave").onclick = () => {
          pull();
          const clean = rows
            .map((r) => ({
              item: String(r.item).trim(),
              qty: Math.max(0, Math.round(parseFloat(r.qty) || 0)),
            }))
            .filter((r) => r.item && r.qty > 0);
          prefs.setups = prefs.setups || {};
          if (clean.length) prefs.setups[water] = clean;
          else delete prefs.setups[water];
          if (!savePrefs()) return;
          shareSetups();
          close();
          toast(
            "Saved. Every " +
              (water === "culinary" ? "culinary" : "secondary") +
              " job uses it now.",
          );
          if (after) after();
        };
        const rs = el.querySelector("#sureset");
        if (rs)
          rs.onclick = () => {
            if (prefs.setups) delete prefs.setups[water];
            if (!savePrefs()) return;
            shareSetups();
            close();
            toast("Back to the app's default.");
            if (after) after();
          };
      };
      draw();
    });
  }

  function openParts() {
    if (locked(J.job)) return unlockSheet();
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
            h +=
              '<button class="btn small ghost" data-add="' +
              esc(group) +
              '">' +
              icon("plus") +
              "Add to " +
              esc(group) +
              "</button>";
          group = l.group;
          h += '<div class="pe-g">' + esc(group) + "</div>";
        }
        h +=
          '<div class="pe"><input class="t" data-i="' +
          i +
          '" data-f="item" value="' +
          esc(l.item) +
          '" aria-label="Part"><input class="t q" data-i="' +
          i +
          '" data-f="qty" inputmode="numeric" value="' +
          esc(String(l.qty)) +
          '" aria-label="How many"><button class="iconbtn x" data-del="' +
          i +
          '" aria-label="Remove ' +
          esc(l.item) +
          '">' +
          icon("trash") +
          "</button></div>";
      });
      if (group !== null)
        h +=
          '<button class="btn small ghost" data-add="' +
          esc(group) +
          '">' +
          icon("plus") +
          "Add to " +
          esc(group) +
          "</button>";
      h +=
        '<button class="btn small ghost" data-add="Other parts">' +
        icon("plus") +
        "Add a part in its own section</button>";
      return h;
    }

    function render() {
      let body = "";
      if (isStale())
        body +=
          '<div class="badge warn">The yard or settings changed since the last Generate. Generate again before using this.</div>';
      if (L0 && !job.water)
        body +=
          '<div class="badge warn">Water source isn\'t set, so the backflow or filter setup is missing. Pick culinary or secondary in Job settings.</div>';
      if (!L0) body += '<p class="note">Generate a layout first.</p>';
      else if (editing) {
        body +=
          '<p class="note">Change any part or count, remove lines, or add your own. The app\'s list stays saved, so you can go back to it.</p>' +
          editRows() +
          '<div class="row" style="margin-top:14px"><button class="btn grow" id="pcancel">Cancel</button><button class="btn primary grow" id="psave">' +
          icon("check") +
          "Save list</button></div>";
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
          '<p class="note">Drip covers the beds only, not the line from the valve box to each bed. Mainline pipe, lateral pipe and wire are not counted yet.</p>' +
          (job.water
            ? '<div class="row"><button class="btn grow" id="psetup">' +
              icon("sliders") +
              (job.water === "culinary"
                ? "Edit our backflow setup"
                : "Edit our filter setup") +
              "</button></div>"
            : "") +
          '<div class="row"><button class="btn grow" id="pedit">' +
          icon("pen") +
          "Edit list</button>" +
          (job.partsEdit
            ? '<button class="btn grow" id="preset">' +
              icon("undo") +
              "Reset to the app's list</button>"
            : "") +
          "</div>" +
          '<div class="row"><button class="btn primary grow" id="xcopy">' +
          icon("copy") +
          "Copy to text or email</button></div>";
      }
      ov.innerHTML =
        '<header class="topbar"><button class="iconbtn" id="xc" aria-label="Back">' +
        icon("back") +
        '</button><div class="title"><b>Parts list</b><span>' +
        esc(job.name) +
        "</span></div>" +
        (editing
          ? ""
          : '<button class="iconbtn" id="xp" aria-label="Copy list">' +
            icon("copy") +
            "</button>") +
        "</header>" +
        '<div class="body">' +
        body +
        "</div>";
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
      const ps2 = ov.querySelector("#psetup");
      if (ps2) ps2.onclick = () => setupSheet(job.water, render);
      const pe = ov.querySelector("#pedit");
      if (pe)
        pe.onclick = () => {
          editing = shownParts(L0).lines.map((l) => ({
            group: l.group,
            item: l.item,
            qty: l.qty,
          }));
          render();
        };
      const pr = ov.querySelector("#preset");
      if (pr)
        pr.onclick = () => {
          if (
            !confirm(
              "Throw away your edits and go back to the list the app made?",
            )
          )
            return;
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
            const target = [...inputs].find(
              (x) => +x.dataset.i === (at < 0 ? editing.length - 1 : at + 1),
            );
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
            .map((l) => ({
              group: l.group,
              item: String(l.item).trim(),
              qty: Math.max(0, Math.round(parseFloat(l.qty) || 0)),
            }))
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

  /* ---------------- accounts, company, folders, sync ---------------- */

  let folderList = [];
  const FOLDER_KEY = "headtohead.folder.v1";
  function currentFolder() {
    try {
      const f = localStorage.getItem(FOLDER_KEY);
      return f && folderList.some((x) => x.id === f) ? f : null;
    } catch (e) {
      return null;
    }
  }
  function setFolder(id) {
    try {
      if (id) localStorage.setItem(FOLDER_KEY, id);
      else localStorage.removeItem(FOLDER_KEY);
    } catch (e) {
      console.warn("Folder choice not saved", e);
    }
  }

  // the company's backflow and filter setups follow the company, not the phone
  function shareSetups() {
    if (!Cloud.enabled || !Cloud.company) return;
    const settings = Object.assign({}, Cloud.company.settings || {}, {
      setups: prefs.setups || {},
    });
    Cloud.saveSettings(settings).catch((e) => {
      console.warn("Setup not shared", e);
      toast(
        "Saved on this phone. It'll reach the rest of the company when there's signal.",
      );
    });
  }

  function brandBlock() {
    return '<div class="brand"><img class="mark" src="icons/logo.svg" alt=""><h1>Head to Head</h1></div>';
  }

  // The website's front page. Zach 2026-11-16: "lets really capitalize on the fact that this is
  // built by a landscaper so that i could save time on my own jobs. and lets really market the
  // camera idea ... it takes like 5 minutes to map an entire yard by literally just walking around.
  // No measuring wheels, no tapes, no mapping on their end." The 5 minutes is his estimate, not a
  // timed walk. The camera walk is iPhone-only and not on the App Store yet, so the page says so and
  // the website itself starts on satellite tracing. No reviews or customer counts: there aren't
  // any yet. img/app-layout.jpg is a capture of "Try an example yard".
  function walkDemo() {
    // a lawn with one curved side; the walker goes around it, then heads pop in at the corners and
    // along the edges, spraying head to head (drawing only, made for the page, not an engine run)
    const lawn = "M40 330 L40 92 Q160 34 280 92 L280 330 Z";
    const heads = [
      [40, 330], [280, 330], [40, 92], [280, 92],
      [40, 211], [280, 211], [160, 330], [160, 63],
    ];
    return (
      '<svg class="walk-demo" viewBox="0 0 320 400" role="img" aria-label="A phone walking the edge of a lawn, then sprinkler heads appearing head to head around it">' +
      '<defs><clipPath id="wd-clip"><path d="' + lawn + '"/></clipPath></defs>' +
      '<rect x="8" y="8" width="304" height="384" rx="22" class="wd-ground"/>' +
      '<path class="wd-lawn" d="' + lawn + '"/>' +
      '<g class="wd-spray" clip-path="url(#wd-clip)">' +
      heads.map(([x, y], i) => '<circle cx="' + x + '" cy="' + y + '" r="128" style="--i:' + i + '"/>').join("") +
      "</g>" +
      '<path class="wd-trail" pathLength="100" d="' + lawn + '"/>' +
      heads.map(([x, y], i) => '<circle class="wd-head" cx="' + x + '" cy="' + y + '" r="6" style="--i:' + i + '"/>').join("") +
      '<g class="wd-walker" style="offset-path:path(\'' + lawn + '\')"><circle r="11"/><circle r="4" class="wd-dot"/></g>' +
      '<text x="160" y="372" class="wd-cap wd-cap1">Walk the edge</text>' +
      '<text x="160" y="372" class="wd-cap wd-cap2">Heads, zones and parts: done</text>' +
      "</svg>"
    );
  }

  function landingPage() {
    const step = (n, t, d) =>
      '<li><span class="l-n">' + n + "</span><b>" + t + "</b><span>" + d + "</span></li>";
    return (
      '<main class="landing">' +
      '<header class="l-top"><img src="icons/logo.svg" alt=""><b>Head to Head</b>' +
      '<a href="#signin" class="btn small ghost" id="l-in">Sign in</a></header>' +
      '<section class="l-hero"><div class="l-copy">' +
      '<p class="l-kicker">Built by a landscaper</p>' +
      "<h1>Walk the yard. Get the sprinkler layout.</h1>" +
      '<p class="l-sub">Walk the edge of the lawn with your iPhone and Head to Head maps it as you go. About 5 minutes for a whole yard. No measuring wheel, no tape, no drawing it up later.</p>' +
      '<p class="l-sub">Then it places every head, splits the zones to fit your water, and writes the parts list for the counter.</p>' +
      '<div class="l-card" id="signin"></div>' +
      '</div><figure class="l-demo">' + walkDemo() +
      '<figcaption>Camera walk is coming to the App Store. On the website you trace the yard on the satellite photo today.</figcaption></figure></section>' +
      '<section class="l-sec l-founder"><h2>Built on my own jobs</h2>' +
      "<p>I'm a landscaper, and I used to work the counter at a sprinkler supply store. Every sprinkler job started the same way: measure the yard, sketch it out, figure out heads and zones, then write up the parts. I built Head to Head to save time on my own jobs.</p>" +
      "<p>The layout follows the rules I'd use myself. Heads go head to head, there's no overspray on straight edges, and rotors only go where three or more fit a zone.</p>" +
      '<p class="l-sign">Zach, founder</p></section>' +
      '<section class="l-sec"><h2>The yard measures itself</h2><div class="l-vs">' +
      '<div class="l-old"><b>How mapping usually goes</b><ul>' +
      "<li>Roll a measuring wheel down every side</li><li>Pull tape to the house corners</li><li>Sketch it on paper in the truck</li><li>Redraw it and count heads at home</li></ul></div>" +
      '<div class="l-new"><b>With Head to Head</b><ul>' +
      "<li>Walk the edge of the lawn with your phone</li><li>Tap Corner at each corner</li><li>Heads, zones and parts list come out the other end</li></ul></div>" +
      "</div></section>" +
      '<section class="l-sec l-split"><div><h2>Then it lays it out</h2><ol class="l-steps">' +
      step(1, "Map it", "Walk it with the iPhone camera, or trace it on the satellite photo or grid paper.") +
      step(2, "Lay it out", "Heads and nozzles placed head to head, with zones sized to your GPM and pressure.") +
      step(3, "Print and buy", "A plan for the customer, a plan for the crew, and a parts list ready for the counter.") +
      '</ol></div><figure class="l-shot"><img src="img/app-layout.jpg" width="508" height="1100" loading="lazy" alt="A laid-out yard in Head to Head: sprinkler heads, spray patterns and zones on a lawn, with a list of zones and their GPM"></figure></section>' +
      '<section class="l-sec"><h2>Pricing</h2><div class="l-prices">' +
      '<div class="l-price"><b>Contractors</b><div class="l-amt">$30<span>/month</span></div>' +
      "<p>The first contractors on Head to Head lock in <b>$20 a month</b>.</p>" +
      "<p>Jobs save online and your whole crew can open them.</p>" +
      '<a href="#signin" class="btn primary" id="l-co">Start my company</a></div>' +
      '<div class="l-price"><b>Homeowners</b><div class="l-amt">$10<span> once per yard</span></div>' +
      "<p>Map your yard for free and see how many heads and zones it needs.</p>" +
      "<p>Pay once to see every head and get the parts list.</p>" +
      '<button class="btn" id="l-ho">Map my yard</button></div>' +
      "</div>" +
      '<p class="note">Payments open soon. Nothing is charged yet.</p></section>' +
      '<footer class="l-foot">Built by a landscaper who ran a sprinkler supply counter. © ' +
      new Date().getFullYear() +
      " Head to Head</footer>" +
      "</main>"
    );
  }

  // the front page is long; the next screen would otherwise open at the old scroll spot (a phone
  // that tapped "Map my yard" down in Pricing landed on the home screen's footer)
  function leaveLanding() {
    if (app.querySelector(".landing")) window.scrollTo(0, 0);
  }

  function wireLanding() {
    const toForm = (e) => {
      e.preventDefault();
      const box = app.querySelector("#signin");
      box.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      const em = box.querySelector("#em");
      if (em) em.focus({ preventScroll: true });
    };
    app.querySelector("#l-in").onclick = toForm;
    app.querySelector("#l-co").onclick = toForm;
    app.querySelector("#l-ho").onclick = () => setHomeowner(true);
  }

  function renderSignIn() {
    teardownJob();
    const providers = (window.H2H_CLOUD && window.H2H_CLOUD.providers) || [];
    let email = "";
    // On the website, someone who isn't signed in sees the front page with the sign-in form in it.
    // The iPhone app keeps the plain sign-in: anyone opening it already knows what it is.
    if (!NATIVE) {
      app.innerHTML = landingPage();
      wireLanding();
    }
    const draw = (step, msg, focusBox) => {
      const box = NATIVE ? app : app.querySelector("#signin");
      box.innerHTML =
        (NATIVE ? '<main class="home">' + brandBlock() : "") +
        (step === "email"
          ? (NATIVE
              ? '<p class="lede">Sign in to save jobs online and share them with your crew. You stay signed in until you sign out.</p>'
              : '<h2 class="l-form-h">Contractors, start here</h2><p class="note">Enter your email and we\'ll send a 6-digit code. New here? The same code sets up your company.</p>') +
            providers
              .map(
                (p) =>
                  '<button class="btn" style="width:100%;margin-bottom:10px" data-p="' +
                  p +
                  '">Continue with ' +
                  (p === "google"
                    ? "Google"
                    : p === "apple"
                      ? "Apple"
                      : esc(p)) +
                  "</button>",
              )
              .join("") +
            '<label class="f" for="em">Email</label><input class="t" id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@company.com">' +
            '<button class="btn primary" style="width:100%;margin-top:12px" id="go">Email me a code</button>' +
            '<button class="btn small ghost" style="width:100%;margin-top:18px" id="mode">Homeowner? Map your own yard, no account needed</button>'
          : '<p class="lede">We sent a 6-digit code to <b>' +
            esc(email) +
            "</b>.</p>" +
            '<label class="f" for="cd">Code</label><input class="t" id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456">' +
            '<button class="btn primary" style="width:100%;margin-top:12px" id="vf">Sign in</button>' +
            '<button class="btn small ghost" style="width:100%;margin-top:8px" id="back">Use a different email</button>') +
        (msg
          ? '<p class="note" style="color:var(--bad);margin-top:12px">' +
            esc(msg) +
            "</p>"
          : "") +
        (NATIVE ? "</main>" : "");
      const md = app.querySelector("#mode");
      if (md) md.onclick = () => setHomeowner(true);
      app.querySelectorAll("[data-p]").forEach(
        (b) =>
          (b.onclick = () =>
            Cloud.signInWith(b.dataset.p).catch((e) => {
              console.warn("Provider sign-in failed", e);
              draw("email", "That sign-in didn't work. Try email instead.");
            })),
      );
      const go = app.querySelector("#go");
      if (go) {
        const em = app.querySelector("#em");
        // on the front page, jumping to the box on load would pop the keyboard over the page
        if (NATIVE || msg || focusBox) em.focus();
        const send = async () => {
          email = em.value.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return draw("email", "That doesn't look like an email address.");
          go.disabled = true;
          go.textContent = "Sending...";
          try {
            await Cloud.sendCode(email);
            draw("code");
          } catch (e) {
            console.warn("Code not sent", e);
            // the server allows one code per email a minute and a few an hour; say so instead of
            // blaming the signal (Zach 2026-11-15 only saw "Couldn't send the code")
            const msg = String((e && e.message) || "");
            const wait = msg.match(/after (\d+) seconds/);
            draw(
              "email",
              (e && e.status === 429) ||
                /rate limit|security purposes/i.test(msg)
                ? wait
                  ? "A code was just sent. Check your email, or wait " +
                    wait[1] +
                    " seconds and ask again."
                  : "Too many codes asked for this hour. Use the last code we sent, or try again later."
                : !navigator.onLine
                  ? "No signal. Try again when you have service."
                  : "Couldn't send the code (" +
                    (msg || "no answer from the server") +
                    "). Try again in a minute.",
            );
          }
        };
        go.onclick = send;
        em.addEventListener("keydown", (e) => {
          if (e.key === "Enter") send();
        });
      }
      const vf = app.querySelector("#vf");
      if (vf) {
        const cd = app.querySelector("#cd");
        cd.focus();
        const verify = async () => {
          vf.disabled = true;
          vf.textContent = "Checking...";
          try {
            await Cloud.verifyCode(email, cd.value);
            await afterSignIn();
          } catch (e) {
            console.warn("Code rejected", e);
            draw(
              "code",
              "That code didn't work. Codes expire after an hour; ask for a new one if it's old.",
            );
          }
        };
        vf.onclick = verify;
        cd.addEventListener("keydown", (e) => {
          if (e.key === "Enter") verify();
        });
        app.querySelector("#back").onclick = () => draw("email", "", true);
      }
    };
    draw("email");
  }

  // Jobs on this phone belong to the company it syncs with; joining or switching starts clean and
  // pulls that company's jobs (everything here was already sent up by switchCompany).
  function resetLocalJobs() {
    jobs = [];
    try {
      localStorage.setItem(STORE_KEY, "[]");
    } catch (e) {
      console.warn("Couldn't clear jobs on this phone", e);
    }
  }

  // Invites for the signed-in email, each waiting for Join or No thanks
  async function invitesBlock(container, after) {
    let list = [];
    try {
      list = await Cloud.myInvites();
    } catch (e) {
      console.warn("Invites not loaded", e);
    }
    if (!list.length) return 0;
    container.innerHTML =
      '<label class="f">Invites for you</label>' +
      list
        .map(
          (iv) =>
            '<div class="row" style="align-items:center;margin-bottom:6px"><span class="grow"><b>' +
            esc(iv.company_name) +
            "</b>" +
            (iv.invited_by_email
              ? '<br><span class="note" style="margin:0">from ' +
                esc(iv.invited_by_email) +
                "</span>"
              : "") +
            '</span><button class="btn small ghost" data-no="' +
            esc(iv.id) +
            '">No thanks</button><button class="btn small primary" data-yes="' +
            esc(iv.id) +
            '">Join</button></div>',
        )
        .join("");
    container.querySelectorAll("[data-yes]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await Cloud.acceptInvite(b.dataset.yes);
            resetLocalJobs();
            await afterSignIn();
            if (after) after();
          } catch (e) {
            console.warn("Join failed", e);
            toast("Couldn't join. Check your signal and try again.");
          }
        }),
    );
    container.querySelectorAll("[data-no]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await Cloud.declineInvite(b.dataset.no);
          } catch (e) {
            console.warn(e);
          }
          invitesBlock(container, after);
          if (!container.querySelector("[data-yes]")) container.innerHTML = "";
        }),
    );
    return list.length;
  }

  function renderMakeCompany() {
    leaveLanding();
    teardownJob();
    app.innerHTML =
      '<main class="home">' +
      brandBlock() +
      '<p class="lede">Signed in as <b>' +
      esc(Cloud.email || "") +
      "</b>. Name your company to get started. " +
      "If your company already uses Head to Head, ask the owner to invite this email, then tap Check again.</p>" +
      '<div id="iv"></div>' +
      '<label class="f" for="cn">Company name</label><input class="t" id="cn" placeholder="Sundown Outdoor Construction">' +
      '<button class="btn primary" style="width:100%;margin-top:12px" id="mk">Create company</button>' +
      '<button class="btn" style="width:100%;margin-top:8px" id="ck">Check again for an invite</button>' +
      '<button class="btn small ghost" style="width:100%;margin-top:8px" id="so">Sign out</button>' +
      '<p class="note" id="mm"></p></main>';
    const mm = app.querySelector("#mm");
    app.querySelector("#mk").onclick = async () => {
      const name = app.querySelector("#cn").value.trim();
      if (!name) return (mm.textContent = "Type your company's name first.");
      try {
        await Cloud.createCompany(name);
        await afterSignIn();
      } catch (e) {
        console.warn("Company not created", e);
        mm.textContent = "Couldn't create it. Check your signal and try again.";
      }
    };
    const ivBox = app.querySelector("#iv");
    invitesBlock(ivBox);
    app.querySelector("#ck").onclick = async () => {
      const n = await invitesBlock(ivBox);
      if (!n)
        mm.textContent =
          "No invite for " + (Cloud.email || "this email") + " yet.";
    };
    app.querySelector("#so").onclick = async () => {
      await Cloud.signOut();
      resetLocalJobs();
      route();
    };
  }

  // After signing in: join invites, load folders, offer this phone's jobs, sync, then show the app.
  async function afterSignIn(recheck) {
    if (recheck) await Cloud.start();
    if (!Cloud.company) return route();
    if (Cloud.company.settings && Cloud.company.settings.setups) {
      prefs.setups = Cloud.company.settings.setups;
      savePrefs();
    }
    await refreshFolders();
    if (!Cloud.hasSynced && jobs.length && !jobs.every((j) => j.example)) {
      const n = jobs.length;
      if (
        confirm(
          "Add the " +
            n +
            " job" +
            (n > 1 ? "s" : "") +
            " on this phone to " +
            Cloud.company.name +
            "?",
        )
      )
        jobs.forEach((j) => Cloud.queueJob(j.id));
    }
    await syncNow();
    route();
  }

  async function refreshFolders() {
    try {
      folderList = await Cloud.folders();
    } catch (e) {
      console.warn("Folders not loaded", e);
    }
  }

  // A job from the server was written by someone else's phone, so it's untrusted: keep only a
  // sane id and coerce the fields the screens print, so a booby-trapped job can't run code here
  // (security review 2026-11-10). Names, addresses and labels are escaped wherever they're shown.
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  // Rebuilt from an allowlist: only the fields the app uses, each forced to its type, everything else
  // dropped. Copying the job and fixing a few fields left the rest (zone numbers, labels) able to
  // carry code onto the page (security review 2026-11-10).
  function cleanRemote(j) {
    if (
      !j ||
      typeof j !== "object" ||
      !/^[A-Za-z0-9_-]{4,40}$/.test(String(j.id))
    )
      return null;
    const str = (v, max) =>
      typeof v === "string" ? v.slice(0, max || 300) : "";
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const word = (v) =>
      /^[A-Za-z0-9_.-]{1,40}$/.test(String(v)) ? String(v) : "";
    const arr = (v) => (Array.isArray(v) ? v : []);
    const pt = (p) => ({
      lat: num(p && p.lat, 0),
      lng: num(p && p.lng, 0),
      bf: num(p && p.bf, 0),
    });
    const out = {
      id: String(j.id),
      name: str(j.name) || "Untitled yard",
      address: str(j.address),
      created: num(j.created, Date.now()),
      updated: num(j.updated, Date.now()),
      origin: {
        lat: num(j.origin && j.origin.lat, DEFAULT_CENTER.lat),
        lng: num(j.origin && j.origin.lng, DEFAULT_CENTER.lng),
      },
      view: {
        lat: num(j.view && j.view.lat, DEFAULT_CENTER.lat),
        lng: num(j.view && j.view.lng, DEFAULT_CENTER.lng),
        zoom: num(j.view && j.view.zoom, 18),
      },
      scale: num(j.scale, 1),
      psi: num(j.psi, 50),
      line: pick(j.line, ["34", "1", "c"], "34"),
      lateral: pick(j.lateral, ["34", "1"], undefined),
      customCap: num(j.customCap, 12),
      popupsOnly: j.popupsOnly === true,
      water: pick(j.water, ["culinary", "secondary"], null),
      example: j.example === true,
      base: j.base === "grid" ? "grid" : undefined,
      folderId: /^[0-9a-f-]{36}$/.test(String(j.folderId)) ? j.folderId : null,
      shapes: arr(j.shapes).map((sh) => ({
        id: word(sh && sh.id) || uid(),
        type: pick(sh && sh.type, ["lawn", "bed", "fence"], "lawn"),
        closed: !!(sh && sh.closed),
        mode: pick(sh && sh.mode, ["auto", "spray"], "auto"),
        pts: arr(sh && sh.pts).map(pt),
      })),
      markers: arr(j.markers)
        .filter((m) => m && MARKERS[m.tag])
        .map((m) => ({
          id: word(m.id) || uid(),
          tag: m.tag,
          lat: num(m.lat, 0),
          lng: num(m.lng, 0),
          // trees keep their trunk size across phones (it was dropped here, so a synced tree
          // lost its size); clamped to the slider's own range
          ...(m.tag === "tree" && m.trunk != null
            ? { trunk: trunkIn(m.trunk) }
            : {}),
        })),
      layout: null,
    };
    const L = j.layout;
    if (L && typeof L === "object" && Array.isArray(L.heads)) {
      out.layout = {
        heads: L.heads
          .filter((h) => h && typeof h === "object")
          .map((h) => ({
            x: num(h.x, 0),
            y: num(h.y, 0),
            r: num(h.r, 0),
            dir: num(h.dir, 0),
            arc: num(h.arc, 360),
            role: word(h.role),
            kind: pick(h.kind, ["R", "Q", "H", "F", "VAN"], "F"),
            model: pick(h.model, ["1804", "3504", "5004"], "1804"),
            series: h.series == null ? null : num(h.series, null),
            label: /^[A-Za-z0-9.]{1,12}$/.test(String(h.label))
              ? String(h.label)
              : "?",
            gpmBase: num(h.gpmBase, 0),
            scales: h.scales === true,
            gpm: num(h.gpm, 0),
            area: num(h.area, 0),
            zone: num(h.zone, 1),
          })),
        areas: arr(L.areas).map((a) => ({
          family: pick(a && a.family, ["spray", "rotor", "mixed"], "spray"),
          note: str(a && a.note),
          issues: num(a && a.issues, 0),
        })),
        zones: arr(L.zones).map((z) => ({
          n: num(z && z.n, 0),
          family: pick(z && z.family, ["spray", "rotor"], "spray"),
          gpm: num(z && z.gpm, 0),
          count: num(z && z.count, 0),
        })),
        totals: {
          points: num(L.totals && L.totals.points, 0),
          gaps: num(L.totals && L.totals.gaps, 0),
          overspray: num(L.totals && L.totals.overspray, 0),
          coverage: num(L.totals && L.totals.coverage, 1),
        },
        gapPts: arr(L.gapPts)
          .slice(0, 400)
          .map((g) => ({ x: num(g && g.x, 0), y: num(g && g.y, 0) })),
        sig: str(L.sig, 200000),
        parts: {
          lines: [],
          stations: num(L.parts && L.parts.stations, 0),
          overLimit: !!(L.parts && L.parts.overLimit),
        },
      };
    }
    if (j.partsEdit && Array.isArray(j.partsEdit.lines))
      out.partsEdit = {
        lines: j.partsEdit.lines.map((l) => ({
          group: str(l && l.group, 80),
          item: str(l && l.item, 200),
          qty: num(l && l.qty, 0),
        })),
        base: str(j.partsEdit.base, 200000),
      };
    return out;
  }

  // pull other phones' changes into the jobs on this phone
  async function syncNow() {
    if (!Cloud.enabled || !Cloud.company) return;
    const { changed, removed } = await Cloud.pull();
    if (!changed.length && !removed.length) return;
    let open = J && J.job ? J.job.id : null;
    changed.forEach((raw) => {
      let rj = null;
      try {
        rj = cleanRemote(raw);
      } catch (e) {
        // one malformed job is skipped; it doesn't stop the rest of the sync
        console.warn("Skipped a job that couldn't be read", e);
      }
      if (!rj)
        return console.warn("Skipped a job with a bad id from the server");
      const i = jobs.findIndex((j) => j.id === rj.id);
      if (i < 0) jobs.push(rj);
      else if (rj.id !== open) jobs[i] = rj; // never swap a job out from under someone editing it
    });
    if (removed.length) {
      removed.forEach((id) => deletedIds.add(id));
      jobs = jobs.filter((j) => !removed.includes(j.id) || j.id === open);
    }
    saveJobs();
    if (!J) renderHome();
  }

  async function newFolder() {
    const name = prompt("Folder name, like a crew or a season");
    if (!name || !name.trim()) return;
    try {
      const f = await Cloud.addFolder(name);
      await refreshFolders();
      setFolder(f.id);
      renderHome();
    } catch (e) {
      console.warn("Folder not made", e);
      toast("Couldn't make the folder. Check your signal.");
    }
  }

  // Plan and billing (Zach picked Stripe 2026-11-16): paying happens on the website, where Apple
  // takes no cut. The iPhone app only says where to go. PAYMENTS_ON stays false while the Stripe
  // account is a sandbox (test cards only); the test copy on this Mac uses the sandbox anyway.
  const PAYMENTS_ON = false;
  const PAY_HERE = !NATIVE && (PAYMENTS_ON || TEST_COPY);
  const PLAN_PRICE = "$30 a month"; // Zach 2026-11-16: "lets go with 30 for standard as of right now"
  const FOUNDING_PRICE = "$20 a month";
  function planBlock() {
    return '<label class="f" style="margin-top:14px">Plan</label><div class="plan" id="plan"><p class="note" style="margin:0">Loading your plan...</p></div>';
  }
  async function fillPlan(box, owner) {
    if (!box) return;
    if (NATIVE) {
      box.innerHTML =
        "<p>Your plan is handled on the Head to Head website.</p>" +
        '<a class="btn small" href="' +
        SITE_URL +
        '" target="_blank" rel="noopener">Open the website</a>';
      return;
    }
    const offer =
      "<p><b>Founding contractor</b>: " +
      FOUNDING_PRICE +
      " locked in (" +
      PLAN_PRICE +
      " after the first contractors).</p>";
    if (!PAY_HERE) {
      box.innerHTML =
        offer +
        '<p class="note">Payments open soon. Nothing is charged yet' +
        (owner ? ", and you'll pick how to pay right here." : ".") +
        "</p>";
      return;
    }
    let b = null;
    try {
      b = await Cloud.billing();
    } catch (e) {
      console.warn("Plan not loaded", e);
      box.innerHTML = '<p class="note" style="margin:0">Couldn\'t load your plan. Check your signal.</p>';
      return;
    }
    const day = (iso) =>
      iso ? new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "";
    const price = b && b.plan === "standard" ? PLAN_PRICE : FOUNDING_PRICE;
    let h, btn;
    if (b && (b.status === "active" || b.status === "trialing")) {
      h =
        "<p><b>" +
        (b.plan === "standard" ? "Contractor plan" : "Founding contractor") +
        "</b>: " +
        price +
        ".</p>" +
        '<p class="note">' +
        (b.cancel_at_period_end ? "Cancelled. It runs until " : "Renews ") +
        esc(day(b.current_period_end)) +
        ".</p>";
      btn = owner ? ["portal", "Manage billing"] : null;
    } else if (b && (b.status === "past_due" || b.status === "unpaid")) {
      h = "<p><b>The last payment didn't go through.</b></p><p class=\"note\">Update the card to keep the plan.</p>";
      btn = owner ? ["portal", "Update the card"] : null;
    } else {
      h = offer;
      btn = owner ? ["subscribe", "Start the plan · " + FOUNDING_PRICE] : null;
      if (!owner) h += '<p class="note">The company\'s owner starts the plan.</p>';
    }
    box.innerHTML =
      h + (btn ? '<button class="btn primary small" style="width:100%" id="pb">' + btn[1] + "</button>" : "");
    const pb = box.querySelector("#pb");
    if (pb)
      pb.onclick = async () => {
        pb.disabled = true;
        pb.textContent = "Opening Stripe...";
        try {
          const r = await Cloud.pay(btn[0], { company_id: Cloud.company.id });
          location.assign(r.url);
        } catch (e) {
          console.warn("Billing page not opened", e);
          toast(e.message);
          pb.disabled = false;
          pb.textContent = btn[1];
        }
      };
  }

  // Coming back from Stripe's checkout page: confirm a yard payment with the server before
  // unlocking, and say what happened with a plan. Then tidy the address.
  async function paymentReturn() {
    const q = new URLSearchParams(location.search);
    const sid = q.get("unlock"),
      jid = q.get("job"),
      bill = q.get("billing");
    if (!sid && !bill) return;
    const clean = (hash) => history.replaceState(null, "", location.pathname + (hash || location.hash));
    if (bill) {
      clean();
      if (bill === "done") toast("Thanks! Your plan is starting. It can take a few seconds to show.");
      else if (bill === "cancel") toast("No charge. You can start the plan any time.");
      return;
    }
    const job = jobs.find((j) => j.id === jid);
    clean(job ? "#/job/" + job.id : "");
    if (!job) return toast("Paid, but that yard isn't on this device. Open it where you mapped it.");
    try {
      const r = await Cloud.pay("unlock-check", { session_id: sid, job_id: job.id });
      if (!r.paid) return toast("That payment didn't go through, so the yard is still locked.");
      job.unlocked = true;
      touch(job);
      toast("Paid. Your yard is unlocked.");
    } catch (e) {
      console.warn("Unlock check failed", e);
      toast("Couldn't confirm the payment. Check your signal and reload this page.");
    }
  }

  async function companySheet() {
    const c = Cloud.company;
    const owner = c.role === "owner";
    let people = [],
      pending = [];
    try {
      people = await Cloud.members();
      if (owner) pending = await Cloud.invites();
    } catch (e) {
      console.warn("Company not loaded", e);
    }
    // inside the iPhone app location is capacitor://localhost, which nobody else can open
    const link = NATIVE ? SITE_URL : location.origin + location.pathname;
    sheet(
      "<h2>" +
        esc(c.name) +
        "</h2>" +
        '<p class="note">Signed in as ' +
        esc(Cloud.email || "") +
        "</p>" +
        '<label class="f">People</label><div class="stack" style="gap:6px">' +
        people
          .map(
            (m) =>
              '<div class="row" style="align-items:center"><span class="grow">' +
              esc(m.email) +
              (m.role === "owner" ? " (owner)" : "") +
              "</span>" +
              (owner && m.role !== "owner"
                ? '<button class="btn small ghost" data-rm="' +
                  esc(m.user_id) +
                  '">Remove</button>'
                : "") +
              "</div>",
          )
          .join("") +
        pending
          .map(
            (iv) =>
              '<div class="row" style="align-items:center"><span class="grow">' +
              esc(iv.email) +
              ' <span class="note" style="margin:0">invited</span></span><button class="btn small ghost" data-ci="' +
              esc(iv.id) +
              '">Cancel</button></div>',
          )
          .join("") +
        "</div>" +
        (owner
          ? '<label class="f" for="ie" style="margin-top:12px">Invite by email</label><div class="row"><input class="t" id="ie" type="email" inputmode="email" placeholder="crew@company.com"><button class="btn primary" id="ib">Invite</button></div>' +
            '<p class="note" id="in">They sign in with that email and land in your company.</p>'
          : "") +
        (folderList.length
          ? '<label class="f" style="margin-top:12px">Folders</label><div class="stack" style="gap:6px">' +
            folderList
              .map(
                (f) =>
                  '<div class="row" style="align-items:center"><span class="grow">' +
                  esc(f.name) +
                  '</span><button class="btn small ghost" data-rf="' +
                  esc(f.id) +
                  '">Rename</button><button class="btn small ghost" data-df="' +
                  esc(f.id) +
                  '">Delete</button></div>',
              )
              .join("") +
            "</div>"
          : "") +
        '<div id="myiv" style="margin-top:12px"></div>' +
        (Cloud.companies.length > 1
          ? '<label class="f" for="sw" style="margin-top:12px">Company</label><select class="t" id="sw">' +
            Cloud.companies
              .map(
                (x) =>
                  '<option value="' +
                  esc(x.id) +
                  '"' +
                  (x.id === c.id ? " selected" : "") +
                  ">" +
                  esc(x.name) +
                  "</option>",
              )
              .join("") +
            "</select>"
          : "") +
        planBlock() +
        (NATIVE
          ? ""
          : '<p class="note" style="margin-top:12px">On iPhone, add this app to your home screen (Share, then Add to Home Screen) so Safari doesn\'t sign you out after a week away.</p>') +
        (owner
          ? ""
          : '<button class="btn danger" style="width:100%;margin-bottom:8px" id="lv">Leave ' +
            esc(c.name) +
            "</button>") +
        '<button class="btn" style="width:100%" id="so">Sign out</button>',
      (el, close) => {
        const reopen = () => {
          close();
          companySheet();
        };
        el.querySelectorAll("[data-rm]").forEach(
          (b) =>
            (b.onclick = async () => {
              if (!confirm("Remove this person from " + c.name + "?")) return;
              try {
                await Cloud.removeMember(b.dataset.rm);
              } catch (e) {
                console.warn(e);
                toast("Couldn't remove them. Check your signal.");
              }
              reopen();
            }),
        );
        el.querySelectorAll("[data-ci]").forEach(
          (b) =>
            (b.onclick = async () => {
              try {
                await Cloud.cancelInvite(b.dataset.ci);
              } catch (e) {
                console.warn(e);
              }
              reopen();
            }),
        );
        const ib = el.querySelector("#ib");
        if (ib)
          ib.onclick = async () => {
            const ie = el.querySelector("#ie");
            const note = el.querySelector("#in");
            try {
              await Cloud.invite(ie.value);
              const to = ie.value.trim().toLowerCase();
              const msg =
                "You're invited to " +
                c.name +
                " on Head to Head. Open " +
                link +
                " and sign in with " +
                to +
                ".";
              // hand the invite to the phone's own share sheet or mail app
              if (navigator.share)
                navigator.share({ text: msg }).catch(() => {});
              else
                location.href =
                  "mailto:" +
                  encodeURIComponent(to) +
                  "?subject=" +
                  encodeURIComponent("Join " + c.name + " on Head to Head") +
                  "&body=" +
                  encodeURIComponent(msg);
              reopen();
            } catch (e) {
              console.warn("Invite failed", e);
              note.textContent = e.message || "Couldn't send the invite.";
              note.style.color = "var(--bad)";
            }
          };
        el.querySelectorAll("[data-rf]").forEach(
          (b) =>
            (b.onclick = async () => {
              const f = folderList.find((x) => x.id === b.dataset.rf);
              const name = prompt("New name", f ? f.name : "");
              if (!name || !name.trim()) return;
              try {
                await Cloud.renameFolder(b.dataset.rf, name);
                await refreshFolders();
              } catch (e) {
                console.warn(e);
              }
              renderHome();
              reopen();
            }),
        );
        el.querySelectorAll("[data-df]").forEach(
          (b) =>
            (b.onclick = async () => {
              if (
                !confirm("Delete this folder? Its jobs stay, under All jobs.")
              )
                return;
              try {
                await Cloud.deleteFolder(b.dataset.df);
                jobs.forEach((j) => {
                  if (j.folderId === b.dataset.df) j.folderId = null;
                });
                saveJobs();
                await refreshFolders();
              } catch (e) {
                console.warn(e);
              }
              renderHome();
              reopen();
            }),
        );
        invitesBlock(el.querySelector("#myiv"), close);
        fillPlan(el.querySelector("#plan"), owner);
        const sw = el.querySelector("#sw");
        if (sw)
          sw.onchange = async () => {
            await Cloud.switchCompany(sw.value);
            resetLocalJobs();
            close();
            await afterSignIn();
          };
        const lv = el.querySelector("#lv");
        if (lv)
          lv.onclick = async () => {
            if (
              !confirm(
                "Leave " +
                  c.name +
                  "? Its jobs stay with the company and come off this phone.",
              )
            )
              return;
            try {
              await Cloud.pushNow();
              await Cloud.leaveCompany();
              resetLocalJobs();
              close();
              await afterSignIn();
            } catch (e) {
              console.warn("Leave failed", e);
              toast("Couldn't leave. Check your signal.");
            }
          };
        el.querySelector("#so").onclick = async () => {
          close();
          await Cloud.signOut();
          resetLocalJobs(); // a shared phone shouldn't hand this company's jobs to the next person
          route();
        };
      },
    );
  }

  async function boot() {
    await paymentReturn();
    if (!Cloud.enabled || isHome()) return route();
    Cloud.setLocalJobs(() => jobs);
    Cloud.on((what) => {
      if (what === "signedOut") route();
    });
    try {
      await Cloud.start();
    } catch (e) {
      // no signal on launch: run on what's saved on the phone and sync later
      console.warn("Couldn't reach the server", e);
      return route();
    }
    if (Cloud.session && Cloud.company) await afterSignIn();
    else route();
    // keep up with the rest of the crew while the app is open
    setInterval(() => {
      if (document.visibilityState === "visible") syncNow();
    }, 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncNow();
      else Cloud.pushNow();
    });
  }

  // opening animation (Zach's pick 2026-11-15, "the rain one"): three small drops fall, and where
  // they land the drop logo grows in
  function splash() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const s = document.createElement("div");
    s.className = "splash";
    s.setAttribute("aria-hidden", "true");
    s.innerHTML =
      '<div class="sp-in"><div class="sp-drop r1"></div><div class="sp-drop r2"></div><div class="sp-drop r3"></div>' +
      '<img class="sp-mark" src="icons/logo.svg" alt=""><div class="sp-sub">Sprinkler layouts in minutes</div></div>';
    document.body.appendChild(s);
    setTimeout(() => s.classList.add("out"), 1700);
    setTimeout(() => s.remove(), 2200);
  }

  splash();
  boot();
})();
