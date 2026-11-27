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
    // Zach 2026-11-17: "a spigot feature that allows the user to add a spigot somewhere in the yard"
    spigot: { letter: "S", color: "#f4a261", name: "Spigot" },
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
  // Zach 2026-11-17: "lets say each yard is $15 for a homeowner/contractor. both are the same."
  // Down to $10 on 2026-11-27 ("$10 per single yard").
  const UNLOCK_PRICE = "$10";
  const isHome = () => !!prefs.homeowner;
  // Who pays for a yard (Zach 2026-11-17). Homeowners always pay per yard. A contractor company
  // with no active plan (never started, or cancelled) also pays per yard: they keep every job and
  // can map new ones, but a yard's heads stay blurred and Plan and Parts stay shut until it's paid
  // for. Yards laid out while the plan was active stay open after a cancel. Only enforced once
  // payments are on (or on the test copy), so nobody gets locked out before they can pay.
  let planActive = null; // true, false, or null while unknown (offline): unknown never locks
  const contractor = () => !isHome() && Cloud.enabled && !!Cloud.company;
  // the example yard keeps showing homeowners the lock, the way it always has; contractors get it free
  const needsPay = (job) =>
    isHome() ||
    (!job.example && ENFORCE && contractor() && planActive === false);
  const locked = (job) => needsPay(job) && !(job.unlocked && inPlace(job));

  // A paid yard stays tied to the yard it was paid for, so one $15 can't be dragged across town
  // and redrawn as the next customer's yard. Zach 2026-11-17: "lets say it needs to move more than
  // 500 feet". On grid paper there's no location, so the lawn area changing by more than half
  // (his okay on "about half", 2026-11-17) counts as a new yard. Corner fixes, beds, curves and
  // generating again stay free.
  const MOVE_LIMIT_FT = 500;
  const AREA_LIMIT = 0.5;
  function yardSnapshot(job) {
    const lawns = job.shapes.filter(
      (s) => s.type === "lawn" && s.closed && s.pts.length >= 3,
    );
    if (!lawns.length) return null;
    const pts = lawns.flatMap((s) => s.pts);
    const P = proj(job);
    const area = lawns.reduce(
      (t, s) => t + Math.abs(ringArea(densify(shapeLocal(s, P), true))),
      0,
    );
    return {
      lat: pts.reduce((t, p) => t + p.lat, 0) / pts.length,
      lng: pts.reduce((t, p) => t + p.lng, 0) / pts.length,
      area: Math.round(area),
    };
  }
  function movedFt(a, b) {
    const c = Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(
      (b.lng - a.lng) * c * FT_PER_DEG,
      (b.lat - a.lat) * FT_PER_DEG,
    );
  }
  function inPlace(job) {
    const now = yardSnapshot(job);
    if (!now) return true;
    // yards paid for before this check existed get their spot recorded the first time they're seen
    if (!job.paidAt) {
      job.paidAt = now;
      saveJobs();
      return true;
    }
    if (job.base === "grid") {
      const was = job.paidAt.area || now.area;
      return Math.abs(now.area - was) <= was * AREA_LIMIT;
    }
    return movedFt(job.paidAt, now) <= MOVE_LIMIT_FT;
  }
  function markPaid(job) {
    job.unlocked = true;
    job.paidAt = yardSnapshot(job);
  }
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
  const SITE_URL = "https://headtoheadapp.com/";
  // Zach 2026-11-18: opening headtoheadapp.com should show the front page, not the homeowner screen
  // left over from an earlier visit. On the website, homeowner mode lasts for the visit; a link to
  // a job or the trip back from paying keeps it.
  if (
    !NATIVE &&
    prefs.homeowner &&
    !location.hash &&
    !/[?&](unlock|yard)=/.test(location.search)
  )
    prefs.homeowner = false;
  // the link in a homeowner's plan email always opens the homeowner side
  if (!NATIVE && /[?&]yard=/.test(location.search)) prefs.homeowner = true;
  const DEVICE = NATIVE ? "phone" : "device";
  function setHomeowner(on) {
    prefs.homeowner = !!on;
    savePrefs();
    if (!on && Cloud.enabled && !cloudUp)
      return startCloud().then(() =>
        cloudUp && Cloud.session && Cloud.company ? afterSignIn() : route(),
      );
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
  /* ---------------- first-time tour ---------------- */
  // Zach 2026-11-16: "a welcome screen for anyone logging into the app for the first time. it pulls
  // up an example yard and shows all the features ... just simple pop ups with some text and an 'X'".
  // One tip at a time, pointing at the tab it's about; X closes it and the next one comes up.
  function tourSteps() {
    const steps = [
      {
        title: "Welcome to Head to Head",
        text: "This is a made-up yard so you can see everything the app does. Close each tip with the X to see the next one.",
      },
      {
        mode: "draw",
        tab: "draw",
        title: "Draw",
        text: "Trace the yard here on the satellite photo or grid paper: lawns, beds and fences. Tap to drop corners, drag one to move it, and pull the dot in the middle of a side to curve it. Add trees, the meter and the valve box as markers. A tree has a trunk size, and big ones keep heads away.",
      },
      {
        mode: "walk",
        tab: "walk",
        title: "Walk",
        text: "In the iPhone app, walk the edge of the lawn with the camera and the app traces it for you. Tap Corner at each corner.",
      },
      {
        mode: "measure",
        tab: "measure",
        title: "Measure",
        text: "Tap two spots to check a length. If it doesn't match your tape, enter the real number and the whole yard rescales. The lawn's square feet and how many pallets of sod it takes are here too.",
      },
      {
        mode: "heads",
        tab: "heads",
        title: "Heads",
        text: isHome()
          ? "Tap Generate and the app lays out every head and zone. You'll see the head count, zones and about how much trench to dig. Unlock the yard to see where each head goes and get the parts list."
          : "Tap Generate and the app lays out every head: rotors in the open, pop-ups in the narrow spots, strip nozzles on park strips, and zones that stay together. Tap a zone to light it up, or tap a head to move it, delete it or switch its nozzle.",
      },
      {
        tab: "plan",
        title: "Plan and parts",
        text: isHome()
          ? "Once the yard is unlocked, Plan prints a full sprinkler map and Parts gives you the shopping list."
          : "Plan prints a to-scale map for the customer or the crew. The Parts button on the Heads tab gives you the full parts list to copy, edit or print.",
      },
      {
        title: "You're set",
        text:
          "Go back to the home screen and tap " +
          (isHome() ? "Map my yard" : "New job") +
          " to start your own. You can watch this tour again from the home screen.",
      },
    ];
    return steps;
  }

  function startTour() {
    tourPending = true;
    openExample();
  }
  let tourPending = false;

  function runTour() {
    tourPending = false;
    const steps = tourSteps();
    let i = 0;
    const show = () => {
      document
        .querySelectorAll(".tour, .tour-hl")
        .forEach((el) =>
          el.classList.contains("tour")
            ? el.remove()
            : el.classList.remove("tour-hl"),
        );
      if (!J) return;
      if (i >= steps.length) return backTip();
      const st = steps[i];
      if (st.mode && J.mode !== st.mode) setMode(st.mode);
      const tab =
        st.tab && app.querySelector('.tab[data-mode="' + st.tab + '"]');
      const box = document.createElement("div");
      box.className = "tour" + (tab ? " at-tab" : "");
      box.setAttribute("role", "dialog");
      box.innerHTML =
        '<button class="tour-x" aria-label="Close tip">' +
        icon("x") +
        "</button>" +
        "<b>" +
        esc(st.title) +
        "</b><p>" +
        esc(st.text) +
        "</p>" +
        '<div class="tour-foot"><span>' +
        (i + 1) +
        " of " +
        steps.length +
        "</span>" +
        (i < steps.length - 1
          ? '<button class="tour-skip">Skip tour</button>'
          : "") +
        "</div>";
      document.body.appendChild(box);
      if (tab) {
        tab.classList.add("tour-hl");
        // sit just above the tab bar, the arrow over the tab
        const tr = tab.getBoundingClientRect(),
          bar = tab.parentElement.getBoundingClientRect();
        box.style.bottom = window.innerHeight - bar.top + 12 + "px";
        box.style.setProperty(
          "--arrow",
          Math.max(
            24,
            Math.min(
              box.offsetWidth - 24,
              tr.left + tr.width / 2 - box.getBoundingClientRect().left,
            ),
          ) + "px",
        );
      }
      box.querySelector(".tour-x").onclick = () => {
        i++;
        show();
      };
      const sk = box.querySelector(".tour-skip");
      if (sk)
        sk.onclick = () => {
          i = steps.length;
          show();
        };
    };
    show();
  }

  // Zach 2026-11-18: after the tour, homeowners get a small tip pointing at the back button, so they
  // know how to leave the example yard and map their own
  function backTip() {
    const back = app.querySelector("#back");
    if (!J || !J.job.example || !isHome() || !back) return;
    const box = document.createElement("div");
    box.className = "tour at-back";
    box.setAttribute("role", "dialog");
    box.innerHTML =
      '<button class="tour-x" aria-label="Close tip">' +
      icon("x") +
      "</button><b>Ready for your yard?</b><p>Tap the back arrow up here to leave the example yard, then tap Map my yard to start your own map.</p>";
    document.body.appendChild(box);
    const r = back.getBoundingClientRect();
    box.style.top = r.bottom + 12 + "px";
    box.style.setProperty(
      "--arrow",
      Math.max(24, r.left + r.width / 2 - box.getBoundingClientRect().left) +
        "px",
    );
    back.classList.add("tour-hl");
    const close = () => {
      box.remove();
      back.classList.remove("tour-hl");
    };
    box.querySelector(".tour-x").onclick = close;
    back.addEventListener("click", close, { once: true });
  }

  function route() {
    if (Cloud.enabled && !isHome() && !Cloud.session) return renderSignIn();
    if (Cloud.enabled && !isHome() && !Cloud.company)
      return renderMakeCompany();
    const m = location.hash.match(/^#\/job\/(\w+)/);
    if (!m && !prefs.toured) {
      prefs.toured = true;
      savePrefs();
      teardownJob();
      return startTour();
    }
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
    h +=
      '<button class="btn small ghost" style="width:100%" id="tour">Take the tour</button>';
    h +=
      '<p class="note" style="text-align:center"><a href="terms.html">Terms of Use</a> · <a href="privacy.html">Privacy Policy</a></p>';
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
    app.querySelector("#tour").onclick = startTour;
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
        marker("spigot", 40, 30),
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
        if (tourPending) setTimeout(runTour, 300);
      }, 900);
    }, 300);
  }

  // Water pressure as a gauge (Zach 2026-11-17: "put a PSI guage on the screen for a homeowner as
  // well. that way they can map the yard accurately"). 0 to 100 PSI across a half circle, the
  // needle on the value; set with - and + in steps of 5 between 20 and 100, as job settings always has.
  const PSI_NOTE =
    "Not sure? Use a pressure gauge on the pipe, ask a neighbor with an existing system, or call your local city.";
  function gaugeSvg(v) {
    const ang = Math.PI * (1 - Math.min(100, Math.max(0, v)) / 100);
    const x = (r) => (60 + r * Math.cos(ang)).toFixed(1),
      y = (r) => (62 - r * Math.sin(ang)).toFixed(1);
    let ticks = "";
    for (let t = 0; t <= 100; t += 10) {
      const a = Math.PI * (1 - t / 100),
        r0 = t % 50 ? 44 : 40;
      ticks +=
        '<line x1="' +
        (60 + r0 * Math.cos(a)).toFixed(1) +
        '" y1="' +
        (62 - r0 * Math.sin(a)).toFixed(1) +
        '" x2="' +
        (60 + 50 * Math.cos(a)).toFixed(1) +
        '" y2="' +
        (62 - 50 * Math.sin(a)).toFixed(1) +
        '"/>';
    }
    return (
      '<svg class="psi-g" viewBox="0 0 120 70" aria-hidden="true">' +
      '<path class="psi-arc" d="M10 62 A50 50 0 0 1 110 62"/>' +
      '<g class="psi-ticks">' +
      ticks +
      "</g>" +
      '<text x="12" y="70">0</text><text x="108" y="70" text-anchor="end">100</text>' +
      '<line class="psi-needle" x1="60" y1="62" x2="' +
      x(40) +
      '" y2="' +
      y(40) +
      '"/>' +
      '<circle class="psi-hub" cx="60" cy="62" r="4.5"/></svg>'
    );
  }
  function psiBlock(id, v) {
    return (
      '<div><label class="f">Water pressure (PSI)</label><div class="psi-wrap" id="' +
      id +
      '">' +
      gaugeSvg(v) +
      '<div class="stepper"><button type="button" data-p="-" aria-label="Lower pressure">-</button><output>' +
      v +
      ' PSI</output><button type="button" data-p="+" aria-label="Raise pressure">+</button></div></div>' +
      '<p class="note">' +
      PSI_NOTE +
      "</p></div>"
    );
  }
  function wirePsi(el, id, start, onSet) {
    const box = el.querySelector("#" + id);
    let v = start;
    box.querySelectorAll("[data-p]").forEach(
      (b) =>
        (b.onclick = () => {
          v = b.dataset.p === "+" ? Math.min(100, v + 5) : Math.max(20, v - 5);
          box.querySelector("svg").outerHTML = gaugeSvg(v);
          box.querySelector("output").textContent = v + " PSI";
          onSet(v);
        }),
    );
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
    let psi = 50;
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
        psiBlock("jpsi", 50) +
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
        // Use where I am now (Zach 2026-11-17: "isnt working very well. its not getting close to my
        // house"). It used the phone's first fix, which is often a rough Wi-Fi or cell guess. Now
        // it listens for up to 12 s and keeps the tightest fix (stops early inside 10 m), then
        // snaps to the nearest street address so the map opens on the house, not the street.
        el.querySelector("#jl").onclick = () => {
          if (!navigator.geolocation)
            return toast("This browser has no location access.");
          const btn = el.querySelector("#jl");
          let best = null,
            watch = null,
            done = false;
          btn.disabled = true;
          res.innerHTML =
            '<p class="note">Finding you. Hold still a few seconds...</p>';
          const finish = async () => {
            if (done) return;
            done = true;
            navigator.geolocation.clearWatch(watch);
            btn.disabled = false;
            if (!best)
              return (res.innerHTML =
                '<p class="note">Couldn\'t get your location. Allow location in Settings, or type the address.</p>');
            const gps = {
              lat: best.coords.latitude,
              lng: best.coords.longitude,
            };
            const acc = Math.round(best.coords.accuracy * 3.28);
            picked = gps;
            try {
              const r = await fetch(
                "https://api.mapbox.com/search/geocode/v6/reverse?types=address&limit=1&longitude=" +
                  gps.lng +
                  "&latitude=" +
                  gps.lat +
                  "&access_token=" +
                  MAPBOX_TOKEN,
              );
              const f = r.ok ? (await r.json()).features[0] : null;
              if (f) {
                const at = {
                  lat: f.geometry.coordinates[1],
                  lng: f.geometry.coordinates[0],
                };
                const off = movedFt(gps, at);
                // trust the address point only when it's about as close as the fix itself
                if (off <= Math.max(200, acc * 1.5)) {
                  picked = at;
                  addr.value = (
                    f.properties.full_address ||
                    f.properties.name ||
                    ""
                  )
                    .split(",")
                    .slice(0, 3)
                    .join(",");
                  res.innerHTML =
                    '<p class="note">' +
                    icon("check") +
                    " Found " +
                    esc(addr.value) +
                    ". Not your house? Type the address instead.</p>";
                  return;
                }
              }
            } catch (e) {
              console.warn("Reverse lookup failed", e);
            }
            res.innerHTML =
              '<p class="note">' +
              icon("check") +
              " Got your location, within about " +
              acc +
              " ft. You can drag the map once it opens.</p>";
          };
          watch = navigator.geolocation.watchPosition(
            (p) => {
              if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
              res.innerHTML =
                '<p class="note">Finding you. Within about ' +
                Math.round(best.coords.accuracy * 3.28) +
                " ft so far...</p>";
              if (best.coords.accuracy <= 10) finish();
            },
            (e) => {
              if (e.code === 1) {
                done = true;
                navigator.geolocation.clearWatch(watch);
                btn.disabled = false;
                res.innerHTML =
                  '<p class="note">Location is blocked. Allow it in Settings, or type the address.</p>';
              }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
          );
          setTimeout(finish, 12000);
        };
        wireWaterSeg(el, (w) => (water = w));
        wirePsi(el, "jpsi", psi, (v) => (psi = v));
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
            psi,
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
    document.querySelectorAll(".tour").forEach((el) => el.remove());
    document.querySelectorAll(".overlay, .scrim").forEach((el) => el.remove());
    if (!J) return;
    if (J.map) J.map.remove();
    J = null;
  }

  // Lateral line (past the valves): 3/4" or 1", starting at the supply size. Zach 2026-11-10: a
  // 3/4" lateral on a 1" supply cuts pressure, so the job is designed as if the supply were 3/4".
  // Zach 2026-11-17: the lateral matches the supply from the street, but "some landscapers only use
  // 1 inch everywhere for simplicity sake", so a company that picks 1" gets it on every new job.
  function lateralOf(job) {
    return (
      job.lateral ||
      (prefs.lateral === "1" ? "1" : job.line === "34" ? "34" : "1")
    );
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
  // valve box size: the contractor's pick on the parts list, remembered as the company's default
  function boxSize(job) {
    return job.boxSize || prefs.boxSize || "standard";
  }
  // mainline (meter to the valve boxes, spigots, its pinch clamps) is 1" on every yard (Zach
  // 2026-11-17); the supply size only sets the lateral's default and the GPM cap
  function pipeSizes(job) {
    return {
      lateral: sizeName(lateralOf(job)),
      main: sizeName("1"),
      box: boxSize(job),
    };
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
        .flatMap((piece) => E.splitStrips(piece))
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
      const c = r.reduce(
        (t, p) => ({ x: t.x + p.x / r.length, y: t.y + p.y / r.length }),
        { x: 0, y: 0 },
      );
      return { x: c.x, y: c.y, w };
    });
    areas.forEach((a, i) => {
      let x = 0,
        y = 0,
        w = 0;
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
        // laid out on the plan (or before payments started, or offline with the plan unknown):
        // stays open after a cancel
        if (contractor() && planActive !== false) markPaid(J.job);
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
      L0.heads.length ? trenchInfo(job).pipe : null,
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
      [
        [q.u0, q.v0],
        [q.u1, q.v0],
        [q.u1, v1],
        [q.u0, v1],
      ].forEach(([u, v]) =>
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
    // where the app would put the valve boxes, each with its zones closest together, and the trench
    // network joining the meter, the boxes and the zones
    const tinfo = !locked(J.job) && L0.heads.length ? trenchInfo(J.job) : null;
    if (tinfo)
      tinfo.edges.forEach(([a, b]) =>
        lay.addLayer(
          L.polyline([P.toLL(a.x, a.y), P.toLL(b.x, b.y)], {
            color: "#6b4f2a",
            weight: 2.5,
            opacity: 0.85,
            dashArray: "6 5",
            interactive: false,
          }),
        ),
      );
    if (tinfo)
      tinfo.boxes.forEach((bx, i, all) =>
        lay.addLayer(
          L.marker(P.toLL(bx.x, bx.y), {
            icon: L.divIcon({
              className: "vbox",
              html: "VB" + (all.length > 1 ? i + 1 : ""),
              iconSize: null,
            }),
            interactive: false,
            keyboard: false,
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

  // Sod calculator (Zach 2026-11-17): the lawn's total square feet, and pallets of 500 sq ft with
  // 10% added for cuts and edges. Beds inside a lawn come out of the total.
  function sodBlock(job) {
    const sqft = buildAreas(job).reduce(
      (t, a) =>
        t +
        Math.abs(ringArea(densify(a.outer, true))) -
        (a.holes || []).reduce(
          (u, hl) => u + Math.abs(ringArea(densify(hl, true))),
          0,
        ),
      0,
    );
    if (sqft < 1) return "";
    const sod = E.sodPallets(sqft);
    return (
      '<div class="sod"><b>Sod</b><dl class="kv"><dt>Lawn</dt><dd>' +
      Math.round(sqft).toLocaleString() +
      " sq ft</dd><dt>Pallets</dt><dd>" +
      sod.pallets +
      "</dd></dl>" +
      '<p class="note">Based on 500 sq ft pallets, with 10% added for edges and cuts (' +
      Math.round(sod.withExtra).toLocaleString() +
      " sq ft).</p></div>"
    );
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
      el.innerHTML = h + sodBlock(job);
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
    el.innerHTML = h + sodBlock(job);
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
            '<button class="chip" data-sn="' +
            k +
            '" aria-pressed="' +
            (hd.label === "15" + k) +
            '">15' +
            k +
            "</button>",
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
            const nh = E.stripHead(
              hd.x,
              hd.y,
              b.dataset.sn,
              { ux: q.ux, uy: q.uy, w: q.w || 4 },
              len,
            );
            Object.assign(hd, {
              label: nh.label,
              gpmBase: nh.gpmBase,
              strip: nh.strip,
              r: nh.r,
              dir: nh.dir,
            });
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
      const vb = parts.boxes || [];
      if (vb.length)
        h +=
          '<p class="note">' +
          vb.length +
          (vb.length > 1
            ? " valve boxes: " + vb.join(", ") + " valves"
            : " valve box") +
          ".</p>";
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
  // Where the valve boxes go and how much trench it takes (Zach's method, trenchPlan in the engine)
  function trenchInfo(job) {
    const P = proj(job);
    const L0 = job.layout;
    const zones = [];
    const byZone = new Map();
    L0.heads.forEach((h) => {
      if (!byZone.has(h.zone)) byZone.set(h.zone, []);
      byZone.get(h.zone).push(h);
    });
    byZone.forEach((hs) =>
      zones.push({
        x: hs.reduce((t, h) => t + h.x, 0) / hs.length,
        y: hs.reduce((t, h) => t + h.y, 0) / hs.length,
        kind: hs.some((h) => h.kind === "R") ? "rotor" : "spray",
        heads: hs.map((h) => ({ x: h.x, y: h.y })),
      }),
    );
    // a drip zone's trench goes to the edge of its beds
    const drip = dripFor(job);
    drip.zones.forEach((z) => {
      const pts = job.shapes
        .filter((sh) => z.beds.includes(sh.id))
        .flatMap((sh) => sh.pts.map((p) => P.toXY(p)));
      if (pts.length)
        zones.push({
          x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
          y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
          kind: "drip",
          // the trench only has to reach the bed
          edge: job.shapes
            .filter((sh) => z.beds.includes(sh.id))
            .flatMap((sh) => densify(shapeLocal(sh, P), true)),
        });
    });
    const meter = job.markers.find((k) => k.tag === "meter");
    const rings = buildAreas(job).map((a) => densify(a.outer, true));
    const spigots = job.markers
      .filter((k) => k.tag === "spigot")
      .map((k) => P.toXY(k));
    const plan = E.trenchPlan(
      zones,
      meter ? P.toXY(meter) : null,
      rings,
      spigots,
    );
    plan.pipe = E.pipePlan(zones, meter ? P.toXY(meter) : null, plan, spigots);
    return plan;
  }

  // homeowners see just the total (Zach 2026-11-17: "keep it simple. just tell them the total")
  function trenchLine(job) {
    return (
      '<dl class="kv"><dt>Estimated trenching</dt><dd>About ' +
      trenchInfo(job).ft +
      " ft</dd></dl>"
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
      '<button class="btn primary" style="width:100%;margin:6px 0 10px" id="ul">' +
      (contractor()
        ? "Unlock the heads, plans and parts list · "
        : "Unlock the heads and parts list · ") +
      (contractor() ? YARD_PRICE : UNLOCK_PRICE) +
      "</button>" +
      '<button class="btn small" style="width:100%" id="gen">Generate again</button>' +
      // the installer list is for homeowners; a contractor shouldn't be shown other installers
      // (2026-11-17 test)
      (isHome() ? installersCard() : "");
    el.innerHTML = h;
    el.querySelector("#ul").onclick = unlockSheet;
    el.querySelector("#gen").onclick = generate;
  }

  function unlockSheet() {
    const pro = contractor();
    const price = pro ? YARD_PRICE : UNLOCK_PRICE;
    const moved = J.job.unlocked && !inPlace(J.job);
    sheet(
      "<h2>" +
        (pro ? "Lay out this yard" : "Unlock this yard") +
        "</h2>" +
        (moved
          ? '<p class="hint"><b>This yard moved more than ' +
            MOVE_LIMIT_FT +
            " ft from the one that was paid for</b>" +
            (J.job.base === "grid"
              ? " (or its lawn size changed by more than half)"
              : "") +
            ", so it counts as a new yard.</p>"
          : "") +
        '<p class="hint">' +
        (pro
          ? "Your company doesn't have an active plan, so this yard is " +
            price +
            ". You get every head, the printable plan, and the parts list. It stays in your job log for your crew."
          : "One payment of " +
            price +
            ", no subscription. You get every head on the map with its nozzle, a printable plan, and the full parts list to take to the store.") +
        "</p>" +
        // Zach 2026-11-18: the homeowner types an email and gets the plan sent once it's paid
        (!pro && !J.job.example && (PAY_HERE || PAY_LINK)
          ? '<label class="f" for="pe">Your email</label><input class="t" id="pe" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' +
            esc(prefs.homeEmail || "") +
            '"><p class="note" style="margin-top:4px">Once it\'s paid we email you the plan and a link back to this yard and its parts list, so it\'s never lost.</p>'
          : "") +
        '<p class="note">It\'s an estimate from your map. By paying you agree to the <a href="terms.html">Terms of Use</a>.</p>' +
        // the example yard shows the lock but can't be bought (payments live 2026-11-18)
        (J.job.example
          ? '<p class="hint"><b>This is the example yard, so it can\'t be unlocked.</b> Go back and tap Map my yard to make your own.</p>'
          : PAY_HERE || PAY_LINK
            ? '<button class="btn primary" style="width:100%" id="pay">Pay ' +
              price +
              (PAY_LINK ? " on the website" : "") +
              "</button>" +
              '<p class="note">' +
              (PAY_LINK
                ? "Opens Stripe's checkout in Safari. Come back to the app when you're done and the yard unlocks."
                : "Stripe takes the card. Head to Head never sees it.") +
              "</p>"
            : '<button class="btn primary" style="width:100%" disabled>Payments open soon</button>') +
        (TEST_COPY
          ? '<button class="btn small" style="width:100%;margin-top:8px" id="tu">Unlock (test copy, no charge)</button>'
          : "") +
        (pro && Cloud.company.role === "owner" && (PAY_HERE || PAY_LINK)
          ? '<button class="btn small" style="width:100%;margin-top:8px" id="sp">Or start the plan' +
            (PAY_LINK ? " on the website" : "") +
            ": " +
            (FOUNDING_OPEN ? FOUNDING_PRICE : PLAN_PRICE) +
            ", every yard included</button>"
          : "") +
        '<button class="btn ghost" style="width:100%;margin-top:8px" id="nx">Not now</button>',
      (el, close) => {
        el.querySelector("#nx").onclick = close;
        const pay = el.querySelector("#pay");
        if (pay)
          pay.onclick = async () => {
            const emBox = el.querySelector("#pe");
            const email = emBox ? emBox.value.trim() : "";
            if (emBox && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              toast("Enter your email so we can send you the plan.");
              return emBox.focus();
            }
            if (email) {
              prefs.homeEmail = email;
              savePrefs();
            }
            pay.disabled = true;
            pay.textContent = "Opening Stripe...";
            try {
              const r = await Cloud.pay("unlock", {
                job_id: J.job.id,
                kind: pro ? "contractor" : "homeowner",
                from: PAY_LINK ? "app" : undefined,
                ...(email ? { email, copy: yardCopy() } : {}),
              });
              if (PAY_LINK) {
                // the session id is in Stripe's checkout address; it's checked when the app comes back
                const sid = (String(r.url).match(
                  /cs_(?:test|live)_[A-Za-z0-9]+/,
                ) || [])[0];
                if (sid) savePendingUnlock({ sid, job: J.job.id });
                window.open(r.url, "_blank");
                close();
                return;
              }
              location.assign(r.url);
            } catch (e) {
              console.warn("Checkout not opened", e);
              toast(e.message);
              pay.disabled = false;
              pay.textContent = "Pay " + price;
            }
          };
        const sp = el.querySelector("#sp");
        if (sp)
          sp.onclick = () => {
            close();
            if (PAY_LINK) window.open(SITE_URL, "_blank");
            else companySheet();
          };
        const tu = el.querySelector("#tu");
        if (tu)
          tu.onclick = () => {
            markPaid(J.job);
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
        '<div><label class="f">Working pressure (PSI)</label><div class="psi-wrap" id="spsi">' +
        gaugeSvg(job.psi) +
        '</div><div class="stepper"><button id="pm" aria-label="Lower pressure">-</button><output id="pv">' +
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
            PSI_NOTE +
            " " +
            (psi < 50
              ? "Below 50 PSI your 12 and 18 GPM caps may be too high. A flow test is safer."
              : "Spray flow is the 30 PSI chart times " +
                Math.sqrt(psi / 30).toFixed(2) +
                ".");
        };
        note();
        const needle = () =>
          (el.querySelector("#spsi svg").outerHTML = gaugeSvg(psi));
        el.querySelector("#pm").onclick = () => {
          psi = Math.max(20, psi - 5);
          el.querySelector("#pv").textContent = psi;
          needle();
          note();
        };
        el.querySelector("#pp").onclick = () => {
          psi = Math.min(100, psi + 5);
          el.querySelector("#pv").textContent = psi;
          needle();
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
  function planData() {
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
      // Zach 2026-11-17: a homeowner's plan says "Homeowner plan" and carries no company name, and a
      // contractor's carries theirs, so the homeowner side is no use for handing plans to customers
      homeowner: isHome(),
      company:
        !isHome() && Cloud.enabled && Cloud.company ? Cloud.company.name : "",
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
      disclaimer: E.DISCLAIMER,
    };
  }

  function openPlan() {
    if (locked(J.job)) return unlockSheet();
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
      // one plan for everyone (Zach 2026-11-18: "get rid of the contractor copy and the customer copy")
      '<div class="body">' +
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
    const draw = () => Plan.drawPlan(cv, planData());
    draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    Plan.whenLogo(draw);
    const doPrint = () => {
      if (isStale())
        return toast("Generate again first. This layout is out of date.");
      printPlan(cv);
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
      L0.heads.length ? trenchInfo(J.job).pipe : null,
    );
  }
  // The list the crew sees: the company's edited copy if there is one, else the app's.
  function shownParts(L0) {
    const fresh = freshParts(L0);
    return J.job.partsEdit
      ? {
          lines: J.job.partsEdit.lines,
          notes: fresh.notes,
          footer: fresh.footer,
        }
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
    return (
      h +
      "</table>" +
      (parts.footer
        ? '<p class="parts-foot">' + esc(parts.footer) + "</p>"
        : "") +
      '<p class="note parts-terms">' +
      esc(E.DISCLAIMER.replace(/ See the Terms of Use\.$/, "")) +
      ' See the <a href="terms.html">Terms of Use</a>.</p>'
    );
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
    if (parts.footer) t += "\n" + parts.footer + "\n";
    t += "\n" + E.DISCLAIMER + "\n";
    return t;
  }

  // what a homeowner's plan email carries (Zach 2026-11-18): the yard itself, so the link in the
  // email can open it again anywhere with its parts list, plus the finished plan picture
  function yardCopy() {
    const job = JSON.parse(JSON.stringify(J.job));
    let png = "";
    if (J.job.layout) {
      const cv = document.createElement("canvas");
      cv.width = 1700;
      cv.height = 2200;
      png = planPng(cv);
    }
    return { job, plan_png: png };
  }

  // a browser that won't let a page read back a canvas with the logo on it still gets the plan,
  // just without the logo
  function planPng(cv) {
    Plan.drawPlan(cv, planData());
    try {
      return cv.toDataURL("image/png").split(",")[1] || "";
    } catch (e) {
      console.warn("Plan drawn without the logo", e);
      Plan.drawPlan(cv, Object.assign(planData(), { noLogo: true }));
      return cv.toDataURL("image/png").split(",")[1] || "";
    }
  }

  function printPlan(cv) {
    const area = document.getElementById("print-area");
    const L0 = J.job.layout;
    const png = planPng(cv);
    // the plan, then the parts list on its own page with the logo at its foot
    area.innerHTML =
      '<img alt="Sprinkler plan" src="data:image/png;base64,' +
      png +
      '">' +
      (L0
        ? '<div class="print-parts">' +
          partsTable(shownParts(L0)) +
          '<div class="print-logo"><img src="' +
          Plan.LOGO_SRC +
          '" alt=""><span>Head to Head</span></div></div>'
        : "");
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
          '<label class="f">Lateral line</label><div class="seg" id="vlat" style="margin-bottom:12px">' +
          ["34", "1"]
            .map(
              (k) =>
                '<button data-lt="' +
                k +
                '" aria-pressed="' +
                (lateralOf(job) === k) +
                '">' +
                sizeName(k) +
                "</button>",
            )
            .join("") +
          "</div>" +
          '<label class="f">Valve boxes</label><div class="seg" id="vbox" style="margin-bottom:12px">' +
          ["standard", "jumbo"]
            .map(
              (k) =>
                '<button data-vb="' +
                k +
                '" aria-pressed="' +
                (boxSize(job) === k) +
                '">' +
                (k === "jumbo" ? "Jumbo" : "Standard") +
                "</button>",
            )
            .join("") +
          "</div>" +
          partsTable(shownParts(L0)) +
          '<p class="note">Drip covers the beds; the line from the valve box to each bed is in the lateral pipe. Mainline pipe is counted from the meter to each valve box and each spigot (add the Meter on the Draw tab), lateral pipe from each box out to every head.</p>' +
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
      ov.querySelectorAll("[data-lt]").forEach(
        (b) =>
          (b.onclick = () => {
            job.lateral = b.dataset.lt;
            // 1" is remembered for the company's next jobs; 3/4" stays this job's
            prefs.lateral = b.dataset.lt === "1" ? "1" : null;
            savePrefs();
            touch(job);
            render();
          }),
      );
      ov.querySelectorAll("[data-vb]").forEach(
        (b) =>
          (b.onclick = () => {
            job.boxSize = prefs.boxSize = b.dataset.vb;
            savePrefs();
            touch(job);
            render();
          }),
      );
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
      [40, 330],
      [280, 330],
      [40, 92],
      [280, 92],
      [40, 211],
      [280, 211],
      [160, 330],
      [160, 63],
    ];
    return (
      '<svg class="walk-demo" viewBox="0 0 320 400" role="img" aria-label="A phone walking the edge of a lawn, then sprinkler heads appearing head to head around it">' +
      '<defs><clipPath id="wd-clip"><path d="' +
      lawn +
      '"/></clipPath></defs>' +
      '<rect x="8" y="8" width="304" height="384" rx="22" class="wd-ground"/>' +
      '<path class="wd-lawn" d="' +
      lawn +
      '"/>' +
      '<g class="wd-spray" clip-path="url(#wd-clip)">' +
      heads
        .map(
          ([x, y], i) =>
            '<circle cx="' +
            x +
            '" cy="' +
            y +
            '" r="128" style="--i:' +
            i +
            '"/>',
        )
        .join("") +
      "</g>" +
      '<path class="wd-trail" pathLength="100" d="' +
      lawn +
      '"/>' +
      heads
        .map(
          ([x, y], i) =>
            '<circle class="wd-head" cx="' +
            x +
            '" cy="' +
            y +
            '" r="6" style="--i:' +
            i +
            '"/>',
        )
        .join("") +
      '<g class="wd-walker" style="offset-path:path(\'' +
      lawn +
      '\')"><circle r="11"/><circle r="4" class="wd-dot"/></g>' +
      '<text x="160" y="372" class="wd-cap wd-cap1">Walk the edge</text>' +
      '<text x="160" y="372" class="wd-cap wd-cap2">Heads, zones and parts: done</text>' +
      "</svg>"
    );
  }

  function landingPage() {
    // Front page, redone 2026-11-23 with Zach's colors (lawn green on cream, Fraunces) pushed
    // further: grid-paper ground like the app's own grid jobs, real captures of the example yard
    // (img/screen-*.jpg, from appstore/capture-screens.cjs), one screen per section. Words are
    // his from the earlier page and the 2026-11-18 flyer; the four layout rules are his rules
    // from CLAUDE.md.
    const phone = (src, alt, cls) =>
      '<figure class="lp-phone' +
      (cls ? " " + cls : "") +
      '"><img src="' +
      src +
      '" width="630" height="1370" alt="' +
      alt +
      '"' +
      (cls && cls.includes("lp-in") ? "" : ' loading="lazy"') +
      "></figure>";
    const toSign = (label, cls, id) =>
      '<a href="#signin" class="lp-btn ' +
      cls +
      '" data-signin' +
      (id ? ' id="' + id + '"' : "") +
      ">" +
      label +
      "</a>";
    const step = (n, title, text, src, alt) =>
      '<li class="lp-step"><div class="lp-step-t"><span class="lp-n">' +
      n +
      "</span><h3>" +
      title +
      "</h3><p>" +
      text +
      "</p></div>" +
      phone(src, alt) +
      "</li>";
    return (
      '<main class="landing lp">' +
      '<section class="lp-hero lp-grid-paper">' +
      '<header class="lp-top lp-wrap"><a class="lp-brand" href="./" aria-label="Head to Head home"><img src="icons/logo.svg" alt="" width="34" height="37"><span>Head to Head</span></a>' +
      toSign("Sign in", "lp-ghost lp-small", "l-in") +
      "</header>" +
      '<div class="lp-wrap lp-hero-in">' +
      '<div class="lp-hero-copy">' +
      '<p class="lp-eyebrow lp-in" style="--d:0">Sprinkler layouts, built by a landscaper</p>' +
      '<h1 class="lp-in" style="--d:1">Map a whole yard in <em>about 5 minutes.</em></h1>' +
      '<p class="lp-lede lp-in" style="--d:2">Walk the edge of the lawn with your iPhone. Head to Head draws the yard, places every head, zones it to your water and writes the parts list.</p>' +
      '<div class="lp-actions lp-in" style="--d:3">' +
      toSign("Start my company", "lp-primary", "l-co") +
      '<button type="button" class="lp-btn lp-ghost" id="l-ho">Map my own yard</button></div>' +
      '<p class="lp-fine lp-in" style="--d:4">The camera walk is in the iPhone app, coming to the App Store. On the website you trace the yard on a satellite photo or grid paper today.</p>' +
      "</div>" +
      phone(
        "img/screen-layout.jpg",
        "The example yard laid out in Head to Head: heads, spray circles and valve boxes on the lawn, a note that says no overspray and 99.9% double covered, and 16 zones with their GPM",
        "lp-hero-phone lp-in",
      ) +
      "</div></section>" +
      walkScene() +
      '<section class="lp-sec lp-vs-sec"><div class="lp-wrap lp-vs-wrap">' +
      '<div class="lp-vs-copy"><h2>The yard measures itself</h2>' +
      '<div class="lp-vs">' +
      '<div class="lp-old"><h3>The old way</h3><ol>' +
      "<li>Roll a measuring wheel down every side</li><li>Pull tape to the house corners</li><li>Sketch it on paper in the truck</li><li>Redraw it and count heads at home</li><li>Guess the parts list at the counter</li></ol></div>" +
      '<div class="lp-new"><h3>With Head to Head</h3><ol>' +
      "<li>Walk the edge of the lawn</li><li>Tap Generate</li><li>Print the plan and parts list</li></ol>" +
      '<p class="lp-big">~5 min<span>to map a whole yard</span></p></div>' +
      "</div></div>" +
      "</div></section>" +
      '<section class="lp-sec lp-steps-sec"><div class="lp-wrap">' +
      "<h2>Heads, zones and parts from one walk</h2>" +
      '<p class="lp-sec-lede">Heads and nozzles go in head to head, with zones sized to your GPM and pressure. The plan and the parts list come from the same map.</p>' +
      '<ol class="lp-steps">' +
      step(
        1,
        "Map it",
        "Walk it with the iPhone camera, or trace it on the satellite photo or grid paper.",
        "img/screen-draw.jpg",
        "Drawing the example yard: lawns, a tree, a spigot and measurements in feet, with buttons to add a lawn, bed, fence or marker",
      ) +
      step(
        2,
        "A plan to scale",
        "One plan for you, the crew and the customer. Print it or save a PDF.",
        "img/screen-plan.jpg",
        "The to-scale sprinkler plan for the example yard, with a Print or save PDF button",
      ) +
      step(
        3,
        "Parts for the counter",
        "Heads, nozzles, pipe, fittings and valves, already counted.",
        "img/screen-parts.jpg",
        "The parts list for the example yard: pop-up bodies and spray nozzles with counts",
      ) +
      "</ol></div></section>" +
      '<section class="lp-sec lp-founder"><div class="lp-wrap lp-founder-in">' +
      '<div class="lp-founder-copy"><h2>Built on my own jobs</h2>' +
      "<p>I'm a landscaper, and I used to work the counter at a sprinkler and plumbing supply store. Every sprinkler job started the same way: measure the yard, sketch it out, figure out heads and zones, then guess on a parts list once I got in the store. I built Head to Head to save time on my own jobs.</p>" +
      "<p>The layout follows the rules I'd use myself. The yard gets double coverage, it's split into zones by pressure and flow rate, and the heads are strategically placed to make the install easy.</p>" +
      '<p class="lp-sign">Zach, founder</p></div>' +
      "</div></section>" +
      '<section class="lp-sec lp-price-sec" id="pricing"><div class="lp-wrap">' +
      "<h2>Pricing</h2>" +
      '<div class="lp-prices">' +
      '<div class="lp-price lp-price-main"><h3>Contractors</h3><p class="lp-amt">$15<span>/month</span></p>' +
      "<p>Founding price for contractors who start by the end of 2027, and you keep it as long as you keep the plan. After 2027 it's " +
      PLAN_PRICE +
      ".</p>" +
      "<p>Jobs save online and your whole crew can open them. " +
      FREE_CREW +
      " crew members are included, then " +
      CREW_PRICE +
      " for each person after that.</p>" +
      "<p>Got a referral code from another contractor? Take " +
      REFERRAL_OFF +
      " off your first month.</p>" +
      "<p>Or pay for the year up front: <b>" +
      SEASON_PRICE +
      "</b>, or <b>" +
      FOUNDING_SEASON_PRICE +
      "</b> for founding contractors.</p>" +
      toSign("Start my company", "lp-primary", "l-py") +
      "</div>" +
      '<div class="lp-price"><h3>Contractors, a few yards a month</h3><p class="lp-amt">' +
      YARD_PRICE +
      "<span> per yard</span></p>" +
      "<p>Only do a couple of sprinkler installs a month? Pay for each yard you lay out, nothing in the slow months.</p>" +
      "<p>You still keep a log of every job you've done, and your crew can open them too.</p>" +
      "<p>Three or more yards a month, and the monthly plan costs less.</p>" +
      toSign("Start my company", "lp-ghost") +
      "</div>" +
      '<div class="lp-price"><h3>Homeowners</h3><p class="lp-amt">' +
      UNLOCK_PRICE +
      '<span> once per yard</span></p>' +
      "<p>Map your yard for free and see how many heads and zones it needs.</p>" +
      // Zach's words, 2026-11-17
      "<p>Only pay once the yard and part list has been generated.</p>" +
      '<button type="button" class="lp-btn lp-ghost" data-homeowner>Map my yard</button></div>' +
      "</div>" +
      '<p class="lp-fine">Stripe takes the card. Head to Head never sees it.</p>' +
      "</div></section>" +
      '<section class="lp-sec lp-close lp-grid-paper"><div class="lp-wrap lp-close-in">' +
      '<div class="lp-close-copy"><h2>Set up your company</h2>' +
      "<p>Jobs save online and your whole crew can open them. Start by the end of 2027 and keep " +
      FOUNDING_PRICE +
      " for good.</p>" +
      "</div>" +
      '<div class="l-card lp-form" id="signin"></div>' +
      "</div>" +
      '<footer class="lp-foot lp-wrap"><span>Built by a landscaper who worked at a sprinkler and plumbing supply store.</span><span>© ' +
      new Date().getFullYear() +
      ' Head to Head App LLC · <a href="terms.html">Terms of Use</a> · <a href="privacy.html">Privacy Policy</a></span></footer>' +
      "</section>" +
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
    app.querySelectorAll("[data-signin]").forEach((a) => (a.onclick = toForm));
    app
      .querySelectorAll("#l-ho, [data-homeowner]")
      .forEach((b) => (b.onclick = () => setHomeowner(true)));
    wireWalkScene();
  }

  // The scroll moment under the hero (2026-11-23, Zach: "create some animations that animate as
  // you scroll through the site"). One pinned section, scrubbed to the scrollbar: the walk draws
  // the lawn, the heads go in head to head, the sprays split into two zones, and the parts list
  // counts up. It's a drawing made for the page, not an engine run: a 30 x 30 ft lawn at 10 units
  // a foot with 15 ft sprays, so every spray reaches the next head along the edge (four 15Q
  // corners, four 15H sides). The counts match that drawing by Zach's parts rules (one 1804 body
  // and one 1/2" swing elbow per pop-up, one valve per zone, up to 4 valves in a standard box).
  const WALK_HEADS = [
    // x, y, zone, start angle, sweep: corners throw a quarter, sides a half, into the lawn
    [0, 300, 0, -90, 90],
    [0, 150, 0, -90, 180],
    [0, 0, 0, 0, 90],
    [150, 0, 0, 0, 180],
    [300, 0, 1, 90, 90],
    [300, 150, 1, 90, 180],
    [300, 300, 1, 180, 90],
    [150, 300, 1, 180, 180],
  ];
  const WALK_ZONES = ["#2b7bd8", "#e07a2e"];
  const WALK_PARTS = [
    ["1804 pop-up spray body", 8],
    ["15Q nozzle", 4],
    ["15H nozzle", 4],
    ['1/2" swing elbow', 8],
    ["Zone valve", 2],
    ["Standard valve box", 1],
  ];

  function walkScene() {
    // spray radius: 15 ft at 10 units a foot, the lawn's half width, so sprays meet head to head
    const R = 150;
    const arc = ([x, y, , a, sweep]) => {
      const r1 = (a * Math.PI) / 180;
      const r2 = ((a + sweep) * Math.PI) / 180;
      const p = (r) =>
        (x + R * Math.cos(r)).toFixed(1) +
        " " +
        (y + R * Math.sin(r)).toFixed(1);
      return (
        "M" + x + " " + y + " L" + p(r1) + " A" + R + " " + R + " 0 0 1 " + p(r2) + " Z"
      );
    };
    const chapter = (i, title, text) =>
      '<li data-ch="' + i + '"><h3>' + title + "</h3><p>" + text + "</p></li>";
    const corners = [
      [0, 0],
      [300, 0],
      [300, 300],
      [0, 300],
    ];
    return (
      '<section class="lp-walk" id="lp-walk" aria-labelledby="lp-walk-h">' +
      '<div class="lp-walk-pin"><div class="lp-wrap lp-walk-in">' +
      '<div class="lp-walk-copy">' +
      '<p class="lp-eyebrow">One walk, start to finish</p>' +
      '<h2 id="lp-walk-h">Watch a yard lay itself out</h2>' +
      '<ol class="lp-chapters">' +
      chapter(0, "Walk the edge", "Walk the edge of the lawn with your iPhone and tap Corner at each corner.") +
      chapter(1, "Heads go in head to head", "Quarter sprays in the corners, halves along the sides, each one throwing to the next head.") +
      chapter(2, "Zoned to your water", "Heads are split into zones by your GPM and pressure, and each zone stays in one part of the yard.") +
      chapter(3, "Parts for the counter", "Bodies, nozzles, swing elbows, valves and the valve box, counted before you leave the yard.") +
      "</ol></div>" +
      '<div class="lp-walk-stage">' +
      '<svg class="lp-yard" viewBox="-70 -78 440 446" role="img" aria-label="A 30 by 30 foot lawn: walked around its edge, then 8 sprinkler heads placed head to head, split into 2 zones, with a valve box">' +
      '<defs><clipPath id="lp-lawn-clip"><rect x="0" y="0" width="300" height="300" rx="4"/></clipPath></defs>' +
      '<text class="lp-y-label" x="0" y="-44">Front lawn · 30 × 30 ft</text>' +
      '<rect class="lp-y-lawn" x="0" y="0" width="300" height="300" rx="4"/>' +
      '<g clip-path="url(#lp-lawn-clip)">' +
      WALK_HEADS.map(
        (h, i) =>
          '<path class="lp-y-spray" data-i="' + i + '" d="' + arc(h) + '" style="--zc:' + WALK_ZONES[h[2]] + ";transform-origin:" + h[0] + "px " + h[1] + 'px"/>',
      ).join("") +
      "</g>" +
      '<path class="lp-y-trench" d="M225 300 V225 H75 V150 M225 225 V150"/>' +
      '<path class="lp-y-trail" pathLength="100" d="M0 300 V0 H300 V300 Z"/>' +
      corners
        .map(([x, y], i) => '<g class="lp-y-corner" data-c="' + i + '" transform="translate(' + x + " " + y + ')"><circle r="7"/></g>')
        .join("") +
      WALK_HEADS.map(
        ([x, y, z], i) =>
          '<circle class="lp-y-head" data-i="' + i + '" cx="' + x + '" cy="' + y + '" r="8" style="--zc:' + WALK_ZONES[z] + ";transform-origin:" + x + "px " + y + 'px"/>',
      ).join("") +
      '<g class="lp-y-vb" transform="translate(225 300)"><rect x="-17" y="-11" width="34" height="22" rx="5"/><text y="4.5">VB</text></g>' +
      '<g class="lp-y-walker"><circle r="13"/><circle r="5" class="lp-y-dot"/></g>' +
      '<g class="lp-y-scale" transform="translate(0 336)"><path d="M0 -5 V5 M0 0 H100 M100 -5 V5"/><text x="112" y="5">10 ft</text></g>' +
      '<g class="lp-y-zones" transform="translate(300 341)">' +
      '<g class="lp-y-zk"><circle cx="-128" cy="-5" r="6" style="fill:' + WALK_ZONES[0] + '"/><text x="-118" y="0">Zone 1</text></g>' +
      '<g class="lp-y-zk"><circle cx="-52" cy="-5" r="6" style="fill:' + WALK_ZONES[1] + '"/><text x="-42" y="0">Zone 2</text></g></g>' +
      "</svg>" +
      '<div class="lp-parts"><p class="lp-parts-h">Parts list</p><ul>' +
      WALK_PARTS.map(([name, n], i) => '<li data-r="' + i + '"><span>' + name + '</span><b data-n="' + n + '">' + n + "</b></li>").join("") +
      "</ul></div>" +
      "</div>" +
      "</div></div></section>"
    );
  }

  function wireWalkScene() {
    const sec = app.querySelector("#lp-walk");
    if (!sec) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const trail = sec.querySelector(".lp-y-trail");
    const walker = sec.querySelector(".lp-y-walker");
    const sprays = [...sec.querySelectorAll(".lp-y-spray")];
    const heads = [...sec.querySelectorAll(".lp-y-head")];
    const corners = [...sec.querySelectorAll(".lp-y-corner")];
    const rows = [...sec.querySelectorAll(".lp-parts li")];
    const chapters = [...sec.querySelectorAll(".lp-chapters li")];
    const len = trail.getTotalLength();
    let last = -1;
    // Scroll shares, picked so each chapter gets about a quarter of the run and every step finishes
    // with scroll to spare before the next starts (guessed, then checked in screenshots).
    const paint = (p) => {
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      // 1. the walk, 0 to 0.22
      const w = clamp(p / 0.22);
      trail.style.strokeDashoffset = String(100 - w * 100);
      const pt = trail.getPointAtLength(w * len);
      walker.setAttribute("transform", "translate(" + pt.x + " " + pt.y + ")");
      walker.style.opacity = String(clamp(1 - (p - 0.22) / 0.04));
      // the walk starts bottom left and goes up, so it passes the corners at each quarter
      corners.forEach((c, i) => c.classList.toggle("is-on", w >= (i + 1) / 4 - 0.001));
      // 2. heads, then their sprays, 0.26 to 0.5
      const h = clamp((p - 0.26) / 0.24);
      heads.forEach((el, i) => el.style.setProperty("--k", String(clamp((h - i * 0.07) / 0.2))));
      sprays.forEach((el, i) => el.style.setProperty("--k", String(clamp((h - i * 0.07 - 0.12) / 0.3))));
      // 3. zones, 0.52 to 0.68
      sec.style.setProperty("--z", String(clamp((p - 0.52) / 0.16)));
      // 4. parts, 0.74 to 0.96
      const q = clamp((p - 0.74) / 0.22);
      rows.forEach((r, i) => {
        const k = clamp((q - i * 0.1) / 0.35);
        r.style.setProperty("--k", String(k));
        const b = r.querySelector("b");
        b.textContent = String(Math.round(k * Number(b.dataset.n)));
      });
      sec.style.setProperty("--q", String(q));
      const ch = Math.min(3, Math.floor(p * 4 + 0.02));
      chapters.forEach((c, i) => c.classList.toggle("is-on", i === ch));
    };
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!document.body.contains(sec)) {
          removeEventListener("scroll", onScroll);
          removeEventListener("resize", onScroll);
          return;
        }
        if (still.matches) {
          sec.classList.add("is-still");
          paint(1);
          return;
        }
        sec.classList.remove("is-still");
        const r = sec.getBoundingClientRect();
        const run = sec.offsetHeight - innerHeight;
        paint(run > 0 ? clamp(-r.top / run) : 1);
      });
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    onScroll();
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
            '<p class="note" style="margin-top:10px">By signing in you agree to the <a href="terms.html">Terms of Use</a> and <a href="privacy.html">Privacy Policy</a>.</p>' +
            '<button class="btn small ghost" style="width:100%;margin-top:18px" id="mode">Homeowner? Map your own yard, no account needed</button>'
          : '<p class="lede">We sent a 6-digit code to <b>' +
            esc(email) +
            "</b>.</p>" +
            '<label class="f" for="cd">Code</label><input class="t" id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="16" placeholder="123456">' +
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
        // in the app, wait for the opening animation to finish first (Zach 2026-11-18: the keyboard
        // came up before the animation was done)
        if (msg || focusBox) em.focus();
        else if (NATIVE) {
          const sp = document.querySelector(".splash");
          if (!sp) em.focus();
          else
            setTimeout(() => {
              if (document.activeElement !== em && em.isConnected) em.focus();
            }, 2300);
        }
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
    await refreshPlan();
    route();
    if (planPoll) waitForPlan();
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
      // a paid yard stays paid on every phone in the company (review 2026-11-17: dropping these
      // here locked paid yards again after a sync)
      unlocked: j.unlocked === true,
      paidAt:
        j.paidAt && typeof j.paidAt === "object"
          ? {
              lat: num(j.paidAt.lat, 0),
              lng: num(j.paidAt.lng, 0),
              area: Math.max(0, num(j.paidAt.area, 0)),
            }
          : null,
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
  // takes no cut. The iPhone app only says where to go. Live since 2026-11-18 (Head to Head App
  // LLC verified on Stripe; the server's key is the live one, so the test copy charges real cards too).
  const PAYMENTS_ON = true;
  const PAY_HERE = !NATIVE && (PAYMENTS_ON || TEST_COPY);
  // The iPhone app is on the US App Store only (Zach 2026-11-18), where Apple allows a button that
  // takes people to pay on the web (App Review Guideline 3.1.1(a), US storefront). Stripe's
  // checkout opens in Safari; the yard unlocks when they come back to the app.
  const PAY_LINK = NATIVE && PAYMENTS_ON;
  // locks only apply once someone could actually pay (the iPhone app sends them to the website)
  const ENFORCE = PAYMENTS_ON || TEST_COPY;
  // Zach 2026-11-27: "lets move the subscription down to 15 dollars a month for founders and 20 for
  // not ... founders who sign up through 2027 will get that price forever as long as they keep paying"
  const PLAN_PRICE = "$20 a month";
  // Zach 2026-11-16: "lets do $15 per yard and lets just say you can pay for the 'season' up front
  // and just give it to them for the year for a discounted price ... would 260 a year sound good?"
  const YARD_PRICE = UNLOCK_PRICE;
  // Zach 2026-11-16: "lets give founders 200 a year. 250 for the yearly for the 30 a month ones"
  const SEASON_PRICE = "$250";
  const FOUNDING_SEASON_PRICE = "$200";
  const FOUNDING_PRICE = "$15 a month";
  // founding is open to plans started before 2028 in Utah (midnight Jan 1 MST); the billing
  // function decides the same way, so the button and the charge agree
  const FOUNDING_OPEN = Date.now() < Date.UTC(2028, 0, 1, 7);
  // Zach 2026-11-17: "lets just say you can have 5 crew members on the app before you need $5 more
  // a month". The owner isn't counted. Billing is in the billing function (FREE_CREW there too).
  const FREE_CREW = 5;
  const CREW_PRICE = "$5 a month";
  // Referrals (Zach 2026-11-17): the new contractor gets $5 off their first month; the company
  // that shared the code gets a free month after the new contractor's second payment; they stack.
  const REFERRAL_OFF = "$5";
  function crewNote(crew) {
    const extra = Math.max(0, crew - FREE_CREW);
    return (
      '<p class="note" id="crewn">' +
      FREE_CREW +
      " crew members come with the plan, not counting you. " +
      (extra
        ? "You have " +
          crew +
          ", so " +
          extra +
          " extra at " +
          CREW_PRICE +
          " each."
        : "You have " +
          crew +
          ". After " +
          FREE_CREW +
          ", each person is " +
          CREW_PRICE +
          ".") +
      "</p>"
    );
  }
  function referralBlock() {
    const code = Cloud.company && Cloud.company.referral_code;
    if (!code) return "";
    return (
      '<label class="f" style="margin-top:14px">Your referral code</label>' +
      '<div class="row" style="align-items:center"><b class="grow" style="font-size:20px;letter-spacing:2px">' +
      esc(code) +
      '</b><button class="btn small" id="rc">Copy</button></div>' +
      '<p class="note">Give it to another contractor. They get ' +
      REFERRAL_OFF +
      " off their first month, and you get a free month once they've made their second payment. Free months stack.</p>"
    );
  }
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
    const offer = !FOUNDING_OPEN
      ? "<p><b>Contractor plan</b>: " + PLAN_PRICE + ".</p>"
      : "<p><b>Founding contractor</b>: " +
      FOUNDING_PRICE +
      " for as long as you keep the plan, for contractors who start by the end of 2027 (" +
      PLAN_PRICE +
      " after that).</p>";
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
      box.innerHTML =
        '<p class="note" style="margin:0">Couldn\'t load your plan. Check your signal.</p>';
      return;
    }
    planActive = !!(b && ["active", "trialing", "past_due"].includes(b.status));
    const day = (iso) =>
      iso
        ? new Date(iso).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })
        : "";
    const price = b && b.plan === "standard" ? PLAN_PRICE : FOUNDING_PRICE;
    let h,
      btn,
      yearly = null;
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
      // Deactivate (Zach 2026-11-17): stop paying, keep the account and every job
      if (owner && !b.cancel_at_period_end)
        h +=
          '<button class="btn small ghost" style="width:100%;margin:0 0 6px" id="pd">Deactivate the plan</button>';
    } else if (b && (b.status === "past_due" || b.status === "unpaid")) {
      h =
        '<p><b>The last payment didn\'t go through.</b></p><p class="note">Update the card to keep the plan.</p>';
      btn = owner ? ["portal", "Update the card"] : null;
    } else {
      h = offer;
      // a code only counts on a company's first plan; the server checks that
      if (owner && !(b && b.status))
        h +=
          '<label class="f" for="rf">Referral code (optional)</label>' +
          '<input class="t" id="rf" autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="From another contractor" style="margin-bottom:10px">';
      if (owner)
        h +=
          '<p class="note">The plan renews every month, or every year if you pay for the year, until you cancel. Cancel any time on this screen and it runs to the end of what you\'ve paid for. By starting a plan you agree to the <a href="terms.html">Terms of Use</a>.</p>';
      btn = owner
        ? ["subscribe", "Start the plan · " + (FOUNDING_OPEN ? FOUNDING_PRICE : PLAN_PRICE)]
        : null;
      if (owner)
        yearly = "Pay for the year · " + (FOUNDING_OPEN ? FOUNDING_SEASON_PRICE : SEASON_PRICE);
      if (!owner)
        h += '<p class="note">The company\'s owner starts the plan.</p>';
    }
    box.innerHTML =
      h +
      (btn
        ? '<button class="btn primary small" style="width:100%" id="pb">' +
          btn[1] +
          "</button>"
        : "") +
      (yearly
        ? '<button class="btn small" style="width:100%;margin-top:8px" id="py">' +
          yearly +
          "</button>"
        : "");
    const wire = (el, action, label, interval) => {
      if (!el) return;
      el.onclick = async () => {
        el.disabled = true;
        el.textContent = "Opening Stripe...";
        try {
          const rf = box.querySelector("#rf");
          const r = await Cloud.pay(action, {
            company_id: Cloud.company.id,
            interval,
            referral_code:
              action === "subscribe" && rf && rf.value.trim()
                ? rf.value.trim()
                : undefined,
          });
          location.assign(r.url);
        } catch (e) {
          console.warn("Billing page not opened", e);
          toast(e.message);
          el.disabled = false;
          el.textContent = label;
        }
      };
    };
    if (btn) wire(box.querySelector("#pb"), btn[0], btn[1], "month");
    const pd = box.querySelector("#pd");
    if (pd)
      pd.onclick = async () => {
        if (
          !confirm(
            "Stop the plan when this billing period ends? Your account and every job stay: you can still open, print and share them, and your crew keeps access. New yards cost " +
              YARD_PRICE +
              " each until you start the plan again.",
          )
        )
          return;
        pd.disabled = true;
        try {
          await Cloud.pay("cancel", { company_id: Cloud.company.id });
          toast(
            "Deactivated. The plan stops at the end of this billing period.",
          );
          setTimeout(() => fillPlan(box, owner), 2500);
        } catch (e) {
          console.warn("Deactivate failed", e);
          toast(e.message);
          pd.disabled = false;
        }
      };
    if (yearly) wire(box.querySelector("#py"), "subscribe", yearly, "year");
  }

  // Coming back from Stripe's checkout page: confirm a yard payment with the server before
  // unlocking, and say what happened with a plan. Then tidy the address.
  // Ask the server whether the company's plan is active. Kept in planActive for the locks; a
  // failed check (no signal) leaves it as it was.
  let planPoll = 0;
  async function refreshPlan() {
    if (!ENFORCE || !contractor()) return;
    try {
      const b = await Cloud.billing();
      const was = planActive;
      planActive = !!(
        b && ["active", "trialing", "past_due"].includes(b.status)
      );
      if (was !== planActive && J) redraw();
    } catch (e) {
      console.warn("Plan not checked", e);
    }
  }
  // right after checkout, keep checking for a few seconds until Stripe's message lands
  async function waitForPlan() {
    while (planPoll > 0 && planActive !== true) {
      planPoll--;
      await new Promise((r) => setTimeout(r, 2500));
      await refreshPlan();
    }
    if (planActive) toast("Your plan is active. Every yard is included.");
  }

  // iPhone app: a yard paid for in Safari. Kept on the phone until the server confirms it, and
  // checked whenever the app comes back to the front.
  const PENDING_KEY = "headtohead.pendingUnlock.v1";
  function savePendingUnlock(p) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch (e) {
      console.warn("Pending payment not saved", e);
    }
  }
  async function checkPendingUnlock() {
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    } catch (e) {
      p = null;
    }
    if (!p || !p.sid || !p.job) return;
    const job = jobs.find((j) => j.id === p.job);
    if (!job) return localStorage.removeItem(PENDING_KEY);
    try {
      const r = await Cloud.pay("unlock-check", {
        session_id: p.sid,
        job_id: job.id,
      });
      if (!r.paid) return; // not paid yet; it stays pending until checkout is done or replaced
      localStorage.removeItem(PENDING_KEY);
      markPaid(job);
      touch(job);
      if (J && J.job.id === job.id) redraw();
      toast("Paid. Your yard is unlocked.");
    } catch (e) {
      console.warn("Unlock check failed", e);
    }
  }
  if (NATIVE) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkPendingUnlock();
    });
    setTimeout(checkPendingUnlock, 1500);
  }

  async function paymentReturn() {
    const q = new URLSearchParams(location.search);
    const yard = q.get("yard");
    if (yard) {
      history.replaceState(null, "", location.pathname);
      try {
        const r = await Cloud.pay("yard-copy", { token: yard });
        // the copy on this device wins if it's here; otherwise the saved one comes back
        let job = jobs.find((j) => j.id === r.job.id);
        if (!job) {
          job = r.job;
          jobs.unshift(job);
        }
        if (!job.unlocked) markPaid(job);
        saveJobs();
        location.hash = "#/job/" + job.id;
        toast("Here's your yard.");
      } catch (e) {
        console.warn("Yard link not opened", e);
        toast(e.message);
      }
      return;
    }
    const sid = q.get("unlock"),
      jid = q.get("job"),
      bill = q.get("billing"),
      fromApp = q.get("paid");
    // checkout opened from the iPhone app finishes here, in Safari; the yard lives in the app
    if (fromApp) {
      history.replaceState(null, "", location.pathname);
      return sheet(
        fromApp === "app"
          ? '<h2>Payment received</h2><p class="hint">Go back to the Head to Head app. Your yard unlocks there in a moment.</p>'
          : '<h2>No charge</h2><p class="hint">Go back to the Head to Head app whenever you\'re ready.</p>',
        () => {},
      );
    }
    if (!sid && !bill) return;
    const clean = (hash) =>
      history.replaceState(
        null,
        "",
        location.pathname + (hash || location.hash),
      );
    if (bill) {
      clean();
      if (bill === "done") {
        toast(
          "Thanks! Your plan is starting. It can take a few seconds to show.",
        );
        planPoll = 6;
      } else if (bill === "cancel")
        toast("No charge. You can start the plan any time.");
      return;
    }
    const job = jobs.find((j) => j.id === jid);
    clean(job ? "#/job/" + job.id : "");
    if (!job)
      return toast(
        "Paid, but that yard isn't on this device. Open it where you mapped it.",
      );
    try {
      const r = await Cloud.pay("unlock-check", {
        session_id: sid,
        job_id: job.id,
      });
      if (!r.paid)
        return toast(
          "That payment didn't go through, so the yard is still locked.",
        );
      markPaid(job);
      touch(job);
      toast("Paid. Your yard is unlocked.");
    } catch (e) {
      console.warn("Unlock check failed", e);
      toast(
        "Couldn't confirm the payment. Check your signal and reload this page.",
      );
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
        (owner
          ? crewNote(people.filter((m) => m.role !== "owner").length)
          : "") +
        planBlock() +
        (owner ? referralBlock() : "") +
        (NATIVE
          ? ""
          : '<p class="note" style="margin-top:12px">On iPhone, add this app to your home screen (Share, then Add to Home Screen) so Safari doesn\'t sign you out after a week away.</p>') +
        (owner
          ? ""
          : '<button class="btn danger" style="width:100%;margin-bottom:8px" id="lv">Leave ' +
            esc(c.name) +
            "</button>") +
        '<button class="btn" style="width:100%" id="so">Sign out</button>' +
        '<button class="btn small ghost danger" style="width:100%;margin-top:14px" id="da">Delete my account</button>',
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
        // the owner opening this screen also squares the plan's extra-crew line with the crew
        if (owner && ENFORCE) Cloud.crewSync(c.id);
        const rc = el.querySelector("#rc");
        if (rc)
          rc.onclick = async () => {
            try {
              await navigator.clipboard.writeText(c.referral_code);
              toast("Referral code copied.");
            } catch (e) {
              console.warn("Copy failed", e);
              toast("Couldn't copy. The code is " + c.referral_code + ".");
            }
          };
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
        // Delete account (Zach 2026-11-17; Apple requires it in the app too)
        el.querySelector("#da").onclick = async () => {
          const mine = Cloud.companies
            .filter((x) => x.role === "owner")
            .map((x) => x.name);
          const what = mine.length
            ? "This deletes your sign-in and " +
              mine.join(" and ") +
              ", with every job, folder and invite in it, for everyone on your crew. Your plan stops today. It can't be undone.\n\nJust want to stop paying? Use Deactivate the plan instead: it keeps every job."
            : "This deletes your sign-in and takes you off " +
              c.name +
              ". The company's jobs stay with the company. It can't be undone.";
          // (an owner of another company hears about that one too, above)
          const typed = prompt(
            what + "\n\nType DELETE to delete your account.",
          );
          if (!typed || typed.trim().toUpperCase() !== "DELETE") return;
          try {
            await Cloud.pay("delete-account");
          } catch (e) {
            console.warn("Delete failed", e);
            return toast(
              e.message || "Couldn't delete the account. Check your signal.",
            );
          }
          close();
          await Cloud.signOut(true).catch(() => {});
          resetLocalJobs();
          route();
          toast("Your account is deleted.");
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

  // Connects to the server once. The homeowner side doesn't need it, so an app that opens there
  // connects when someone switches to the contractor side (2026-11-18: on Zach's phone the switch
  // went straight to sign-in with no connection, and "Email me a code" failed on 'sb.auth').
  let cloudWired = false,
    cloudUp = false;
  async function startCloud() {
    if (!Cloud.enabled || cloudUp) return cloudUp;
    if (!cloudWired) {
      cloudWired = true;
      Cloud.setLocalJobs(() => jobs);
      Cloud.on((what) => {
        if (what === "signedOut") route();
      });
      // keep up with the rest of the crew while the app is open
      setInterval(() => {
        if (cloudUp && document.visibilityState === "visible") syncNow();
      }, 30000);
      document.addEventListener("visibilitychange", () => {
        if (!cloudUp) return;
        if (document.visibilityState === "visible") syncNow();
        else Cloud.pushNow();
      });
    }
    try {
      await Cloud.start();
      cloudUp = true;
    } catch (e) {
      // no signal: run on what's saved on the phone; the next switch or sign-in tries again
      console.warn("Couldn't reach the server", e);
    }
    return cloudUp;
  }

  async function boot() {
    if (!Cloud.enabled || isHome()) {
      await paymentReturn();
      return route();
    }
    await startCloud();
    // after the session is back, so a contractor's paid yard is queued to go up to the company
    await paymentReturn();
    if (cloudUp && Cloud.session && Cloud.company) await afterSignIn();
    else route();
  }

  // opening animation (Zach's pick 2026-11-15, "the rain one"): three small drops fall, and where
  // they land the drop logo grows in
  // iPhone app only (Zach 2026-11-18: "get rid of the animation when you open the website. i like it
  // on the app though")
  function splash() {
    if (!NATIVE) return;
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
